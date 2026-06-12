/* ===== KINTORE — 筋トレ記録アプリ ===== */
"use strict";

/* ---------- 定数 ---------- */
const STORAGE_KEY = "kintore_data_v1";
const MUSCLES = ["胸", "背中", "脚", "肩", "腕", "体幹"];
const DOW = ["日", "月", "火", "水", "木", "金", "土"];

const DEFAULT_EXERCISES = [
  ["ベンチプレス", "胸"], ["ダンベルプレス", "胸"], ["インクラインベンチプレス", "胸"],
  ["チェストフライ", "胸"], ["ディップス", "胸"], ["腕立て伏せ", "胸"],
  ["デッドリフト", "背中"], ["懸垂", "背中"], ["ラットプルダウン", "背中"],
  ["ベントオーバーロウ", "背中"], ["シーテッドロウ", "背中"],
  ["スクワット", "脚"], ["レッグプレス", "脚"], ["レッグエクステンション", "脚"],
  ["レッグカール", "脚"], ["カーフレイズ", "脚"], ["ランジ", "脚"], ["ヒップスラスト", "脚"],
  ["ショルダープレス", "肩"], ["サイドレイズ", "肩"], ["リアレイズ", "肩"], ["フロントレイズ", "肩"],
  ["バーベルカール", "腕"], ["ダンベルカール", "腕"], ["ハンマーカール", "腕"],
  ["トライセプスエクステンション", "腕"], ["ケーブルプッシュダウン", "腕"],
  ["クランチ", "体幹"], ["レッグレイズ", "体幹"], ["アブローラー", "体幹"], ["プランク", "体幹"],
].map(([name, muscle], i) => ({ id: "d" + i, name, muscle, custom: false }));

/* ---------- 状態 ---------- */
let data = loadData();
let currentDate = todayStr();
let calMonth = currentDate.slice(0, 7); // "YYYY-MM"
let pickerMuscle = "all";
let listMuscle = "all";
let restTimer = null; // { remain, total, intervalId }

/* ---------- ストレージ ---------- */
function loadData() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const d = JSON.parse(raw);
      if (d && Array.isArray(d.workouts) && Array.isArray(d.exercises)) {
        d.settings = Object.assign({ restSec: 90, autoTimer: true }, d.settings);
        return d;
      }
    }
  } catch (e) { /* 壊れたデータは初期化 */ }
  return {
    exercises: DEFAULT_EXERCISES.map(e => ({ ...e })),
    workouts: [], // { date, entries: [{ exerciseId, sets: [{ w, r, done }] }] }
    settings: { restSec: 90, autoTimer: true },
  };
}

function saveData() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}

/* ---------- ユーティリティ ---------- */
function $(id) { return document.getElementById(id); }

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function fmtDate(dateStr) {
  const [y, m, d] = dateStr.split("-").map(Number);
  const dow = DOW[new Date(y, m - 1, d).getDay()];
  return `${m}月${d}日 (${dow})`;
}

function fmtVol(v) {
  if (v >= 10000) return (v / 1000).toFixed(1) + "t";
  return Math.round(v).toLocaleString() + "kg";
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

// Epley式による推定1RM
function e1rm(w, r) {
  if (!w || !r) return 0;
  if (r === 1) return w;
  return w * (1 + r / 30);
}

function getExercise(id) {
  return data.exercises.find(e => e.id === id);
}

function getWorkout(date) {
  return data.workouts.find(w => w.date === date);
}

function setVolume(sets) {
  return sets.reduce((sum, s) => sum + (s.w || 0) * (s.r || 0), 0);
}

// 指定日より前の、この種目の直近の記録を返す
function prevEntry(exerciseId, beforeDate) {
  const past = data.workouts
    .filter(w => w.date < beforeDate && w.entries.some(e => e.exerciseId === exerciseId))
    .sort((a, b) => b.date.localeCompare(a.date));
  if (!past.length) return null;
  return {
    date: past[0].date,
    entry: past[0].entries.find(e => e.exerciseId === exerciseId),
  };
}

// 指定日以前を除いた全期間の自己ベスト(推定1RM)
function bestE1rm(exerciseId, excludeDate) {
  let best = 0;
  for (const w of data.workouts) {
    if (w.date === excludeDate) continue;
    for (const e of w.entries) {
      if (e.exerciseId !== exerciseId) continue;
      for (const s of e.sets) best = Math.max(best, e1rm(s.w, s.r));
    }
  }
  return best;
}

function toast(msg, isPr) {
  const el = $("toast");
  el.textContent = msg;
  el.classList.toggle("pr", !!isPr);
  el.classList.remove("hidden");
  clearTimeout(el._t);
  el._t = setTimeout(() => el.classList.add("hidden"), 2200);
}

/* ---------- ストリーク(週単位の連続記録) ---------- */
function weekKey(dateStr) {
  const [y, m, d] = dateStr.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() - dt.getDay()); // 週の頭(日曜)に揃える
  return dt.getTime();
}

function currentStreakWeeks() {
  const weeks = new Set(data.workouts.filter(w => w.entries.length).map(w => weekKey(w.date)));
  if (!weeks.size) return 0;
  const WEEK_MS = 7 * 86400000;
  let wk = weekKey(todayStr());
  if (!weeks.has(wk)) wk -= WEEK_MS; // 今週まだ未実施なら先週から数える
  let streak = 0;
  while (weeks.has(wk)) { streak++; wk -= WEEK_MS; }
  return streak;
}

/* ---------- タブ切替 ---------- */
const TABS = ["home", "history", "stats", "exercises", "settings"];

function switchTab(tab) {
  TABS.forEach(t => $("tab-" + t).classList.toggle("hidden", t !== tab));
  document.querySelectorAll(".nav-btn").forEach(b =>
    b.classList.toggle("active", b.dataset.tab === tab));
  if (tab === "home") renderHome();
  if (tab === "history") renderHistory();
  if (tab === "stats") renderStats();
  if (tab === "exercises") renderExerciseTab();
  if (tab === "settings") renderSettings();
  window.scrollTo(0, 0);
}

/* ---------- ホーム(記録) ---------- */
function shiftDate(days) {
  const [y, m, d] = currentDate.split("-").map(Number);
  const dt = new Date(y, m - 1, d + days);
  currentDate = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
  renderHome();
}

function renderHome() {
  const disp = $("dateDisplay");
  disp.textContent = fmtDate(currentDate);
  disp.classList.toggle("is-today", currentDate === todayStr());
  $("datePicker").value = currentDate;

  const workout = getWorkout(currentDate);
  const area = $("workoutArea");

  if (!workout || !workout.entries.length) {
    area.innerHTML = `
      <div class="empty-state">
        <div class="big">💪</div>
        <p>まだ記録がありません。<br>「種目を追加」してトレーニングを始めましょう！</p>
      </div>`;
    renderHeaderStreak();
    return;
  }

  area.innerHTML = workout.entries.map((entry, ei) => {
    const ex = getExercise(entry.exerciseId);
    const name = ex ? ex.name : "(削除された種目)";
    const muscle = ex ? ex.muscle : "";
    const prev = prevEntry(entry.exerciseId, currentDate);
    const prevHtml = prev
      ? `前回 (${fmtDate(prev.date)}): <b>${prev.entry.sets.map(s => `${s.w ?? 0}kg×${s.r ?? 0}`).join(", ")}</b>`
      : "今回が初記録の種目です 🔰";

    const setsHtml = entry.sets.map((s, si) => `
      <div class="set-row">
        <div class="set-num">${si + 1}</div>
        <input class="set-input" type="number" inputmode="decimal" min="0" step="0.5"
          placeholder="kg" value="${s.w ?? ""}" data-ei="${ei}" data-si="${si}" data-field="w">
        <div class="set-x">×</div>
        <input class="set-input" type="number" inputmode="numeric" min="0" step="1"
          placeholder="回" value="${s.r ?? ""}" data-ei="${ei}" data-si="${si}" data-field="r">
        <button class="set-done ${s.done ? "done" : ""}" data-action="toggle-done"
          data-ei="${ei}" data-si="${si}">✓</button>
        <button class="set-del" data-action="del-set" data-ei="${ei}" data-si="${si}">🗑</button>
      </div>`).join("");

    const bestSet = entry.sets.reduce((b, s) => Math.max(b, e1rm(s.w, s.r)), 0);
    const prBest = bestE1rm(entry.exerciseId, currentDate);
    const isPr = bestSet > 0 && bestSet > prBest;
    const e1rmHtml = bestSet > 0
      ? `<div class="e1rm-note">推定1RM: ${bestSet.toFixed(1)}kg${isPr ? ' <span class="pr-badge">🏆 PR更新!</span>' : ""}</div>`
      : "";

    return `
      <div class="card exercise-card">
        <div class="exercise-head">
          <div>
            <span class="exercise-name">${escapeHtml(name)}</span>
            ${muscle ? `<span class="exercise-muscle">${muscle}</span>` : ""}
          </div>
          <button class="icon-btn" data-action="del-exercise" data-ei="${ei}">✕</button>
        </div>
        <div class="prev-record">${prevHtml}</div>
        <div class="set-row header">
          <div>SET</div><div>重量 kg</div><div></div><div>回数</div><div>完了</div><div></div>
        </div>
        ${setsHtml}
        <div class="exercise-actions">
          <button class="btn-small" data-action="add-set" data-ei="${ei}">＋ セット追加</button>
        </div>
        ${e1rmHtml}
      </div>`;
  }).join("");

  renderHeaderStreak();
}

function renderHeaderStreak() {
  const s = currentStreakWeeks();
  $("headerStreak").textContent = s > 0 ? `🔥 ${s}週連続` : "";
}

function ensureWorkout(date) {
  let w = getWorkout(date);
  if (!w) {
    w = { id: uid(), date, entries: [] };
    data.workouts.push(w);
    data.workouts.sort((a, b) => a.date.localeCompare(b.date));
  }
  return w;
}

function addExerciseToWorkout(exerciseId) {
  const w = ensureWorkout(currentDate);
  if (w.entries.some(e => e.exerciseId === exerciseId)) {
    toast("この種目は既に追加されています");
    return;
  }
  // 前回の1セット目を初期値として提案(プログレッシブオーバーロード支援)
  const prev = prevEntry(exerciseId, currentDate);
  const first = prev && prev.entry.sets[0] ? { w: prev.entry.sets[0].w, r: prev.entry.sets[0].r } : { w: null, r: null };
  w.entries.push({ exerciseId, sets: [{ ...first, done: false }] });
  saveData();
  renderHome();
}

function homeAction(action, ei, si) {
  const w = getWorkout(currentDate);
  if (!w) return;
  const entry = w.entries[ei];
  if (!entry) return;

  if (action === "add-set") {
    const last = entry.sets[entry.sets.length - 1];
    entry.sets.push({ w: last ? last.w : null, r: last ? last.r : null, done: false });
  } else if (action === "del-set") {
    entry.sets.splice(si, 1);
    if (!entry.sets.length) w.entries.splice(ei, 1);
  } else if (action === "del-exercise") {
    if (!confirm("この種目の記録を削除しますか？")) return;
    w.entries.splice(ei, 1);
  } else if (action === "toggle-done") {
    const s = entry.sets[si];
    s.done = !s.done;
    if (s.done) {
      const best = bestE1rm(entry.exerciseId, currentDate);
      const cur = e1rm(s.w, s.r);
      if (cur > 0 && cur > best) {
        const ex = getExercise(entry.exerciseId);
        toast(`🏆 ${ex ? ex.name : ""} PR更新! 推定1RM ${cur.toFixed(1)}kg`, true);
      }
      if (data.settings.autoTimer) startRest(data.settings.restSec);
    }
  }
  if (!w.entries.length) data.workouts = data.workouts.filter(x => x !== w);
  saveData();
  renderHome();
}

/* ---------- レストタイマー ---------- */
function startRest(sec) {
  stopRest();
  restTimer = { remain: sec, total: sec };
  $("restTimer").classList.remove("hidden");
  updateRestUI();
  restTimer.intervalId = setInterval(() => {
    restTimer.remain--;
    if (restTimer.remain <= 0) {
      stopRest();
      toast("⏰ レスト終了！次のセットへ");
      if (navigator.vibrate) navigator.vibrate([200, 100, 200]);
      return;
    }
    updateRestUI();
  }, 1000);
}

function updateRestUI() {
  if (!restTimer) return;
  const m = Math.floor(restTimer.remain / 60);
  const s = restTimer.remain % 60;
  $("restTime").textContent = `${m}:${String(s).padStart(2, "0")}`;
  $("restProgress").style.width = (restTimer.remain / restTimer.total * 100) + "%";
}

function stopRest() {
  if (restTimer && restTimer.intervalId) clearInterval(restTimer.intervalId);
  restTimer = null;
  $("restTimer").classList.add("hidden");
}

/* ---------- 種目選択モーダル ---------- */
function openPicker() {
  pickerMuscle = "all";
  $("pickerSearch").value = "";
  renderPickerFilter();
  renderPickerList();
  $("pickerModal").classList.remove("hidden");
}

function renderPickerFilter() {
  $("pickerFilter").innerHTML = ["all", ...MUSCLES].map(m =>
    `<button class="chip ${pickerMuscle === m ? "active" : ""}" data-muscle="${m}">${m === "all" ? "すべて" : m}</button>`
  ).join("");
}

function renderPickerList() {
  const q = $("pickerSearch").value.trim();
  const list = data.exercises.filter(e =>
    (pickerMuscle === "all" || e.muscle === pickerMuscle) &&
    (!q || e.name.includes(q)));
  $("pickerList").innerHTML = list.length
    ? list.map(e => `
        <button class="picker-item" data-id="${e.id}">
          <span>${escapeHtml(e.name)}</span>
          <span class="pi-muscle">${e.muscle}${e.custom ? " ・カスタム" : ""}</span>
        </button>`).join("")
    : `<div class="chart-empty">該当する種目がありません</div>`;
}

/* ---------- 履歴 ---------- */
function renderHistory() {
  renderCalendar();
  const list = [...data.workouts]
    .filter(w => w.entries.length)
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, 30);

  $("historyList").innerHTML = list.length
    ? list.map(w => {
        const vol = w.entries.reduce((s, e) => s + setVolume(e.sets), 0);
        const setCount = w.entries.reduce((s, e) => s + e.sets.length, 0);
        const entriesHtml = w.entries.map(e => {
          const ex = getExercise(e.exerciseId);
          return `
            <div class="history-entry">
              <div class="h-name">${escapeHtml(ex ? ex.name : "(削除された種目)")}</div>
              <div class="h-sets">${e.sets.map(s => `${s.w ?? 0}kg×${s.r ?? 0}`).join("　")}</div>
            </div>`;
        }).join("");
        return `
          <div class="card history-card">
            <div class="history-date">
              <span>${fmtDate(w.date)}</span>
              <span class="history-summary">${w.entries.length}種目 / ${setCount}セット / ${fmtVol(vol)}</span>
            </div>
            ${entriesHtml}
            <div class="history-actions">
              <button class="btn-small" data-action="edit-day" data-date="${w.date}">✏️ 編集</button>
              <button class="btn-small" data-action="del-day" data-date="${w.date}">🗑 削除</button>
            </div>
          </div>`;
      }).join("")
    : `<div class="empty-state"><div class="big">📭</div><p>まだワークアウトの記録がありません。</p></div>`;
}

function renderCalendar() {
  const [y, m] = calMonth.split("-").map(Number);
  $("calTitle").textContent = `${y}年${m}月`;
  const first = new Date(y, m - 1, 1);
  const days = new Date(y, m, 0).getDate();
  const workoutDays = new Set(data.workouts.filter(w => w.entries.length).map(w => w.date));
  const today = todayStr();

  let html = DOW.map(d => `<div class="cal-dow">${d}</div>`).join("");
  for (let i = 0; i < first.getDay(); i++) html += "<div></div>";
  for (let d = 1; d <= days; d++) {
    const ds = `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    const cls = ["cal-day"];
    if (workoutDays.has(ds)) cls.push("has-workout");
    if (ds === today) cls.push("today");
    html += `<button class="${cls.join(" ")}" data-date="${ds}">${d}</button>`;
  }
  $("calGrid").innerHTML = html;
}

function shiftCalMonth(diff) {
  const [y, m] = calMonth.split("-").map(Number);
  const dt = new Date(y, m - 1 + diff, 1);
  calMonth = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}`;
  renderCalendar();
}

/* ---------- 統計 ---------- */
function renderStats() {
  const workouts = data.workouts.filter(w => w.entries.length);
  const monthPrefix = todayStr().slice(0, 7);
  const monthCount = workouts.filter(w => w.date.startsWith(monthPrefix)).length;
  const totalVol = workouts.reduce((s, w) => s + w.entries.reduce((a, e) => a + setVolume(e.sets), 0), 0);
  const totalSets = workouts.reduce((s, w) => s + w.entries.reduce((a, e) => a + e.sets.length, 0), 0);

  $("statCards").innerHTML = `
    <div class="stat-card"><div class="val">${monthCount}<small> 回</small></div><div class="lbl">今月のワークアウト</div></div>
    <div class="stat-card"><div class="val">${currentStreakWeeks()}<small> 週</small></div><div class="lbl">連続記録 🔥</div></div>
    <div class="stat-card"><div class="val">${fmtVol(totalVol)}</div><div class="lbl">総挙上ボリューム</div></div>
    <div class="stat-card"><div class="val">${totalSets.toLocaleString()}<small> セット</small></div><div class="lbl">総セット数</div></div>`;

  renderWeeklyChart(workouts);
  renderRmSelect();
  renderRmChart();
  renderMuscleChart(workouts);
  renderPrList(workouts);
}

function renderWeeklyChart(workouts) {
  const WEEK_MS = 7 * 86400000;
  const thisWeek = weekKey(todayStr());
  const weeks = [];
  for (let i = 7; i >= 0; i--) weeks.push(thisWeek - i * WEEK_MS);
  const vols = weeks.map(wk =>
    workouts.filter(w => weekKey(w.date) === wk)
      .reduce((s, w) => s + w.entries.reduce((a, e) => a + setVolume(e.sets), 0), 0));

  const max = Math.max(...vols, 1);
  const W = 520, H = 180, pad = 8, bw = (W - pad * 2) / 8 - 10;
  const bars = vols.map((v, i) => {
    const h = Math.max(v / max * (H - 50), v > 0 ? 4 : 0);
    const x = pad + i * ((W - pad * 2) / 8) + 5;
    const y = H - 26 - h;
    const label = new Date(weeks[i]);
    return `
      <rect x="${x}" y="${y}" width="${bw}" height="${h}" rx="5" fill="${i === 7 ? "#ff5c35" : "#3a4150"}"/>
      ${v > 0 ? `<text x="${x + bw / 2}" y="${y - 6}" text-anchor="middle" fill="#8b93a3" font-size="10">${fmtVol(v)}</text>` : ""}
      <text x="${x + bw / 2}" y="${H - 8}" text-anchor="middle" fill="#8b93a3" font-size="10">${label.getMonth() + 1}/${label.getDate()}</text>`;
  }).join("");

  $("weeklyChart").innerHTML = vols.some(v => v > 0)
    ? `<svg class="chart-svg" viewBox="0 0 ${W} ${H}">${bars}</svg>`
    : `<div class="chart-empty">記録がたまるとここにグラフが表示されます</div>`;
}

function renderRmSelect() {
  const recorded = new Set();
  data.workouts.forEach(w => w.entries.forEach(e => {
    if (e.sets.some(s => e1rm(s.w, s.r) > 0)) recorded.add(e.exerciseId);
  }));
  const sel = $("statExerciseSelect");
  const prev = sel.value;
  const options = data.exercises.filter(e => recorded.has(e.id));
  sel.innerHTML = options.length
    ? options.map(e => `<option value="${e.id}">${escapeHtml(e.name)}</option>`).join("")
    : `<option value="">記録のある種目がありません</option>`;
  if (prev && options.some(e => e.id === prev)) sel.value = prev;
}

function renderRmChart() {
  const exId = $("statExerciseSelect").value;
  const container = $("rmChart");
  if (!exId) { container.innerHTML = `<div class="chart-empty">重量×回数を記録するとグラフが表示されます</div>`; return; }

  const points = data.workouts
    .filter(w => w.entries.some(e => e.exerciseId === exId))
    .sort((a, b) => a.date.localeCompare(b.date))
    .map(w => {
      const e = w.entries.find(e => e.exerciseId === exId);
      const best = e.sets.reduce((b, s) => Math.max(b, e1rm(s.w, s.r)), 0);
      return { date: w.date, val: best };
    })
    .filter(p => p.val > 0)
    .slice(-20);

  if (points.length < 2) {
    container.innerHTML = `<div class="chart-empty">2回以上記録すると推移グラフが表示されます</div>`;
    return;
  }

  const W = 520, H = 200, padX = 36, padY = 26;
  const vals = points.map(p => p.val);
  const min = Math.min(...vals), max = Math.max(...vals);
  const range = max - min || 1;
  const x = i => padX + i / (points.length - 1) * (W - padX * 2);
  const y = v => H - padY - (v - min) / range * (H - padY * 2);

  const path = points.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p.val).toFixed(1)}`).join(" ");
  const dots = points.map((p, i) => {
    const isMax = p.val === max;
    return `<circle cx="${x(i).toFixed(1)}" cy="${y(p.val).toFixed(1)}" r="4" fill="${isMax ? "#ffc83d" : "#ff5c35"}"/>
      ${isMax ? `<text x="${x(i).toFixed(1)}" y="${(y(p.val) - 10).toFixed(1)}" text-anchor="middle" fill="#ffc83d" font-size="11" font-weight="bold">${p.val.toFixed(1)}kg</text>` : ""}`;
  }).join("");
  const firstLbl = points[0].date.slice(5).replace("-", "/");
  const lastLbl = points[points.length - 1].date.slice(5).replace("-", "/");

  container.innerHTML = `
    <svg class="chart-svg" viewBox="0 0 ${W} ${H}">
      <path d="${path}" fill="none" stroke="#ff5c35" stroke-width="2.5" stroke-linejoin="round"/>
      ${dots}
      <text x="${padX}" y="${H - 6}" fill="#8b93a3" font-size="10">${firstLbl}</text>
      <text x="${W - padX}" y="${H - 6}" text-anchor="end" fill="#8b93a3" font-size="10">${lastLbl}</text>
    </svg>`;
}

function renderMuscleChart(workouts) {
  const cutoff = new Date(Date.now() - 30 * 86400000);
  const cutoffStr = `${cutoff.getFullYear()}-${String(cutoff.getMonth() + 1).padStart(2, "0")}-${String(cutoff.getDate()).padStart(2, "0")}`;
  const byMuscle = Object.fromEntries(MUSCLES.map(m => [m, 0]));
  workouts.filter(w => w.date >= cutoffStr).forEach(w => w.entries.forEach(e => {
    const ex = getExercise(e.exerciseId);
    if (ex && byMuscle[ex.muscle] !== undefined) byMuscle[ex.muscle] += setVolume(e.sets);
  }));

  const max = Math.max(...Object.values(byMuscle), 1);
  const total = Object.values(byMuscle).reduce((a, b) => a + b, 0);
  $("muscleChart").innerHTML = total > 0
    ? MUSCLES.map(m => `
        <div class="muscle-bar-row">
          <span>${m}</span>
          <div class="muscle-bar-track"><div class="muscle-bar-fill" style="width:${(byMuscle[m] / max * 100).toFixed(1)}%"></div></div>
          <span class="muscle-bar-val">${fmtVol(byMuscle[m])}</span>
        </div>`).join("")
    : `<div class="chart-empty">直近30日の記録がありません</div>`;
}

function renderPrList(workouts) {
  const best = {}; // exerciseId -> { val, w, r, date }
  workouts.forEach(w => w.entries.forEach(e => e.sets.forEach(s => {
    const v = e1rm(s.w, s.r);
    if (v > 0 && (!best[e.exerciseId] || v > best[e.exerciseId].val)) {
      best[e.exerciseId] = { val: v, w: s.w, r: s.r, date: w.date };
    }
  })));

  const rows = Object.entries(best)
    .map(([id, b]) => ({ ex: getExercise(id), ...b }))
    .filter(r => r.ex)
    .sort((a, b) => b.val - a.val);

  $("prList").innerHTML = rows.length
    ? rows.map(r => `
        <div class="pr-row">
          <div>
            <div>${escapeHtml(r.ex.name)}</div>
            <div class="pr-detail">${r.w}kg × ${r.r}回 ・ ${fmtDate(r.date)}</div>
          </div>
          <span class="pr-val">1RM ${r.val.toFixed(1)}kg</span>
        </div>`).join("")
    : `<div class="chart-empty">記録するとここに自己ベストが表示されます</div>`;
}

/* ---------- 種目タブ ---------- */
function renderExerciseTab() {
  $("muscleFilter").innerHTML = ["all", ...MUSCLES].map(m =>
    `<button class="chip ${listMuscle === m ? "active" : ""}" data-muscle="${m}">${m === "all" ? "すべて" : m}</button>`
  ).join("");

  const best = {};
  data.workouts.forEach(w => w.entries.forEach(e => e.sets.forEach(s => {
    const v = e1rm(s.w, s.r);
    if (v > 0) best[e.exerciseId] = Math.max(best[e.exerciseId] || 0, v);
  })));

  const list = data.exercises.filter(e => listMuscle === "all" || e.muscle === listMuscle);
  $("exerciseList").innerHTML = list.map(e => `
    <div class="exercise-item">
      <div>
        <span>${escapeHtml(e.name)}</span>
        <span class="ei-muscle">${e.muscle}${e.custom ? " ・カスタム" : ""}</span>
      </div>
      <div>
        ${best[e.id] ? `<span class="ei-best">1RM ${best[e.id].toFixed(1)}kg</span>` : ""}
        ${e.custom ? `<button class="icon-btn" data-action="del-custom" data-id="${e.id}">🗑</button>` : ""}
      </div>
    </div>`).join("");
}

/* ---------- 設定 ---------- */
function renderSettings() {
  $("autoTimerToggle").checked = data.settings.autoTimer;
  $("restSecSelect").value = String(data.settings.restSec);
}

function exportData() {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `kintore-backup-${todayStr()}.json`;
  a.click();
  URL.revokeObjectURL(url);
  toast("エクスポートしました");
}

function importData(file) {
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const d = JSON.parse(reader.result);
      if (!d || !Array.isArray(d.workouts) || !Array.isArray(d.exercises)) throw new Error("invalid");
      if (!confirm("現在のデータをインポートした内容で上書きします。よろしいですか？")) return;
      d.settings = Object.assign({ restSec: 90, autoTimer: true }, d.settings);
      data = d;
      saveData();
      toast("インポートしました");
      switchTab("home");
    } catch (e) {
      toast("⚠️ 読み込めないファイルです");
    }
  };
  reader.readAsText(file);
}

/* ---------- イベント登録 ---------- */
function init() {
  // ナビ
  document.querySelectorAll(".nav-btn").forEach(b =>
    b.addEventListener("click", () => switchTab(b.dataset.tab)));

  // 日付
  $("datePrev").addEventListener("click", () => shiftDate(-1));
  $("dateNext").addEventListener("click", () => shiftDate(1));
  $("dateDisplay").addEventListener("click", () => {
    const p = $("datePicker");
    if (p.showPicker) p.showPicker(); else p.click();
  });
  $("datePicker").addEventListener("change", e => {
    if (e.target.value) { currentDate = e.target.value; renderHome(); }
  });

  // ワークアウトエリア(イベント委譲)
  $("workoutArea").addEventListener("click", e => {
    const btn = e.target.closest("[data-action]");
    if (!btn) return;
    homeAction(btn.dataset.action, Number(btn.dataset.ei), Number(btn.dataset.si));
  });
  $("workoutArea").addEventListener("change", e => {
    const input = e.target.closest(".set-input");
    if (!input) return;
    const w = getWorkout(currentDate);
    if (!w) return;
    const set = w.entries[Number(input.dataset.ei)]?.sets[Number(input.dataset.si)];
    if (!set) return;
    const v = parseFloat(input.value);
    set[input.dataset.field] = isNaN(v) ? null : v;
    saveData();
    renderHome();
  });

  // 種目追加モーダル
  $("addExerciseBtn").addEventListener("click", openPicker);
  $("pickerSearch").addEventListener("input", renderPickerList);
  $("pickerFilter").addEventListener("click", e => {
    const chip = e.target.closest(".chip");
    if (!chip) return;
    pickerMuscle = chip.dataset.muscle;
    renderPickerFilter();
    renderPickerList();
  });
  $("pickerList").addEventListener("click", e => {
    const item = e.target.closest(".picker-item");
    if (!item) return;
    $("pickerModal").classList.add("hidden");
    addExerciseToWorkout(item.dataset.id);
  });

  // モーダル共通: ✕ボタンと背景クリックで閉じる
  document.querySelectorAll("[data-close]").forEach(b =>
    b.addEventListener("click", () => $(b.dataset.close).classList.add("hidden")));
  document.querySelectorAll(".modal-overlay").forEach(o =>
    o.addEventListener("click", e => { if (e.target === o) o.classList.add("hidden"); }));

  // レストタイマー
  $("restMinus").addEventListener("click", () => {
    if (restTimer) { restTimer.remain = Math.max(1, restTimer.remain - 15); updateRestUI(); }
  });
  $("restPlus").addEventListener("click", () => {
    if (restTimer) { restTimer.remain += 15; restTimer.total = Math.max(restTimer.total, restTimer.remain); updateRestUI(); }
  });
  $("restSkip").addEventListener("click", stopRest);

  // 履歴
  $("calPrev").addEventListener("click", () => shiftCalMonth(-1));
  $("calNext").addEventListener("click", () => shiftCalMonth(1));
  $("calGrid").addEventListener("click", e => {
    const day = e.target.closest(".cal-day");
    if (!day) return;
    currentDate = day.dataset.date;
    switchTab("home");
  });
  $("historyList").addEventListener("click", e => {
    const btn = e.target.closest("[data-action]");
    if (!btn) return;
    const date = btn.dataset.date;
    if (btn.dataset.action === "edit-day") {
      currentDate = date;
      switchTab("home");
    } else if (btn.dataset.action === "del-day") {
      if (!confirm(`${fmtDate(date)} の記録を削除しますか？`)) return;
      data.workouts = data.workouts.filter(w => w.date !== date);
      saveData();
      renderHistory();
      toast("削除しました");
    }
  });

  // 統計
  $("statExerciseSelect").addEventListener("change", renderRmChart);

  // 種目タブ
  $("muscleFilter").addEventListener("click", e => {
    const chip = e.target.closest(".chip");
    if (!chip) return;
    listMuscle = chip.dataset.muscle;
    renderExerciseTab();
  });
  $("exerciseList").addEventListener("click", e => {
    const btn = e.target.closest('[data-action="del-custom"]');
    if (!btn) return;
    const used = data.workouts.some(w => w.entries.some(en => en.exerciseId === btn.dataset.id));
    const msg = used
      ? "この種目には記録があります。種目を削除しても記録は残りますが種目名が表示されなくなります。削除しますか？"
      : "この種目を削除しますか？";
    if (!confirm(msg)) return;
    data.exercises = data.exercises.filter(x => x.id !== btn.dataset.id);
    saveData();
    renderExerciseTab();
  });
  $("newExerciseBtn").addEventListener("click", () => {
    $("createName").value = "";
    $("createMuscle").innerHTML = MUSCLES.map(m => `<option value="${m}">${m}</option>`).join("");
    $("createModal").classList.remove("hidden");
  });
  $("createSubmit").addEventListener("click", () => {
    const name = $("createName").value.trim();
    if (!name) { toast("種目名を入力してください"); return; }
    if (data.exercises.some(e => e.name === name)) { toast("同名の種目が既にあります"); return; }
    data.exercises.push({ id: uid(), name, muscle: $("createMuscle").value, custom: true });
    saveData();
    $("createModal").classList.add("hidden");
    renderExerciseTab();
    toast(`「${name}」を作成しました`);
  });

  // 設定
  $("autoTimerToggle").addEventListener("change", e => {
    data.settings.autoTimer = e.target.checked;
    saveData();
  });
  $("restSecSelect").addEventListener("change", e => {
    data.settings.restSec = Number(e.target.value);
    saveData();
  });
  $("exportBtn").addEventListener("click", exportData);
  $("importInput").addEventListener("change", e => {
    if (e.target.files[0]) importData(e.target.files[0]);
    e.target.value = "";
  });
  $("resetBtn").addEventListener("click", () => {
    if (!confirm("すべての記録・カスタム種目・設定を削除します。本当によろしいですか？")) return;
    if (!confirm("この操作は取り消せません。最終確認: 削除しますか？")) return;
    localStorage.removeItem(STORAGE_KEY);
    data = loadData();
    toast("初期化しました");
    switchTab("home");
  });

  renderHome();
}

init();
