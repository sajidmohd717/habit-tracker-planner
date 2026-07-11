/* ============ Habitloom — Habit Tracker & Planner ============ */

// historical key from before the Habitloom rename — do not change, or existing users lose their data
const STORAGE_KEY = "one-percent-better";
const MAX_FREEZES = 2;
const FREEZE_EVERY = 7; // earn a freeze every 7-day streak milestone
const DAY_START_HOUR = 6;  // timeline shows 6:00 – 23:00
const DAY_END_HOUR = 23;
const PX_PER_ROW = 56;
const ensureCategoryState = window.__ensureCategoryState;
// zoom: 0 = 1-hour rows, 1 = 30-minute rows (device preference, not synced)
let timelineZoom = Number(localStorage.getItem("opb-zoom")) || 0;
function rowMinutes() { return timelineZoom === 1 ? 30 : 60; }
function pxPerHour() { return (60 / rowMinutes()) * PX_PER_ROW; }

let state = load();

function load() {
  let s = null;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) s = JSON.parse(raw);
  } catch (e) { /* corrupted storage — start fresh */ }
  if (!s) s = { habits: [], tasksByDate: {} };
  if (!s.entries) s.entries = []; // time-tracker entries (migration for older saves)
  if (!s.tasksByDate) s.tasksByDate = {};
  if (!s.deleted) s.deleted = { habits: {}, tasks: {}, entries: {}, categories: {} };
  for (const kind of ["habits", "tasks", "entries", "categories"]) if (!s.deleted[kind]) s.deleted[kind] = {};
  for (const h of s.habits) if (!h.checkins) h.checkins = []; // per-day history for the heatmap
  if (!s.resetAt) s.resetAt = 0; // bumped on account reset so sync merges don't resurrect old data
  ensureCategoryState(s);
  normalizeRunning(s);
  return s;
}
function save() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  window.dispatchEvent(new Event("state-saved")); // sync.js mirrors to the cloud when signed in
}

function touch(item, at = Date.now()) {
  item.updatedAt = Math.max((item.updatedAt || 0) + 1, at);
  return item;
}

function rememberDeletion(kind, id) {
  state.deleted ??= { habits: {}, tasks: {}, entries: {}, categories: {} };
  state.deleted[kind] ??= {};
  state.deleted[kind][id] = Date.now();
}

const emptyState = window.__emptyState;
const stableStringify = window.__stableStringify;
const mergeStates = window.__mergeStates;

function adoptExternalState(next, persist = false) {
  state = next;
  ensureCategoryState(state);
  normalizeRunning(state);
  if (persist) save();
  renderHabits();
  renderTimeline();
  renderTracker();
  if (!document.getElementById("categories-overlay").classList.contains("hidden")) renderCategoryManager();
}

function clearLocalStateAfterSignOut() {
  state = emptyState();
  ensureCategoryState(state);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  renderHabits();
  renderTimeline();
  renderTracker();
}

window.__adoptExternalState = adoptExternalState;
window.__clearLocalStateAfterSignOut = clearLocalStateAfterSignOut;

window.addEventListener("storage", event => {
  if (event.key === "opb-signed-out") {
    clearLocalStateAfterSignOut();
    return;
  }
  if (event.key !== STORAGE_KEY || !event.newValue) return;
  try {
    const incoming = JSON.parse(event.newValue);
    const merged = mergeStates(state, incoming);
    adoptExternalState(merged, stableStringify(merged) !== stableStringify(incoming));
  } catch (error) {
    console.error("Could not apply an update from another tab:", error);
  }
});

/* ---------- date helpers ---------- */
function todayKey() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function daysBetween(keyA, keyB) {
  // whole days from keyA to keyB (date keys "YYYY-MM-DD"), local time
  const a = new Date(keyA + "T00:00:00");
  const b = new Date(keyB + "T00:00:00");
  return Math.round((b - a) / 86400000);
}
function fmtTime(minutes) {
  const h = Math.floor(minutes / 60), m = minutes % 60;
  const ampm = h >= 12 ? "PM" : "AM";
  const hh = ((h + 11) % 12) + 1;
  return `${hh}:${String(m).padStart(2, "0")} ${ampm}`;
}
function fmtDuration(min) {
  const h = Math.floor(min / 60), m = min % 60;
  if (h && m) return `${h}h ${m}m`;
  if (h) return `${h}h`;
  return `${m}m`;
}

/* ============================================================
   HABITS
   ============================================================ */

// Reconcile streaks on load: consume freezes for missed days, or reset.
function reconcileHabits() {
  const today = todayKey();
  const messages = [];
  let changed = false;
  for (const h of state.habits) {
    if (!h.lastCheckin) continue; // never checked in — nothing to break yet
    const gap = daysBetween(h.lastCheckin, today);
    const missed = gap - 1; // days with no check-in between last check-in and today
    if (missed <= 0) continue;
    if (missed <= h.freezes) {
      h.freezes -= missed;
      // pretend the streak carried through the missed days
      h.lastCheckin = today === h.lastCheckin ? h.lastCheckin : addDays(h.lastCheckin, missed);
      touch(h);
      changed = true;
      messages.push(`🧊 Used ${missed} streak freeze${missed > 1 ? "s" : ""} to protect "${h.name}" — your ${h.streak}-day streak is safe!`);
    } else {
      messages.push(`💔 Streak for "${h.name}" reset (missed ${missed} day${missed > 1 ? "s" : ""}). Best streak stays at ${Math.max(h.bestStreak, h.streak)} days — start again today!`);
      h.bestStreak = Math.max(h.bestStreak, h.streak);
      h.streak = 0;
      h.freezes = 0;
      h.lastFreezeAward = 0;
      h.lastCheckin = null;
      touch(h);
      changed = true;
    }
  }
  if (changed) save();
  const box = document.getElementById("freeze-notice");
  if (messages.length) {
    box.innerHTML = messages.join("<br>");
    box.classList.remove("hidden");
  }
}
function addDays(key, n) {
  const d = new Date(key + "T00:00:00");
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function habitCreatedToday() {
  return state.habits.some(h => h.createdAt === todayKey());
}

function addHabit(name, note) {
  if (habitCreatedToday()) return; // one new habit per day — that's the 1%
  state.habits.push(touch({
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    name,
    note: note || "",
    checkins: [],
    createdAt: todayKey(),
    streak: 0,
    bestStreak: 0,
    freezes: 0,
    lastFreezeAward: 0,
    lastCheckin: null,
  }));
  save();
  renderHabits();
}

let pendingCheckinId = null;

function checkinHabit(id) {
  const h = state.habits.find(x => x.id === id);
  const today = todayKey();
  if (!h || h.lastCheckin === today) return;
  // habits with a "why" note show the reasons first (unless the user opted out)
  if (h.note && h.showNoteOnCheckin !== false) {
    pendingCheckinId = id;
    document.getElementById("why-habit-name").textContent = h.name;
    document.getElementById("why-note-text").textContent = h.note;
    document.getElementById("why-show-again").checked = true;
    document.getElementById("why-overlay").classList.remove("hidden");
    return;
  }
  doCheckin(h);
}

function doCheckin(h) {
  const today = todayKey();
  if (h.lastCheckin === today) return;
  h.streak += 1;
  h.bestStreak = Math.max(h.bestStreak, h.streak);
  h.lastCheckin = today;
  if (!h.checkins) h.checkins = [];
  if (!h.checkins.includes(today)) h.checkins.push(today);
  // earn a freeze at each 7-day milestone (max banked)
  if (h.streak > 0 && h.streak % FREEZE_EVERY === 0 && h.lastFreezeAward !== h.streak) {
    if (h.freezes < MAX_FREEZES) h.freezes += 1;
    h.lastFreezeAward = h.streak;
  }
  touch(h);
  save();
  renderHabits();
}

function deleteHabit(id) {
  const h = state.habits.find(x => x.id === id);
  if (!h) return;
  if (!confirm(`Delete habit "${h.name}"? Your streak history for it will be lost.`)) return;
  rememberDeletion("habits", id);
  state.habits = state.habits.filter(x => x.id !== id);
  save();
  renderHabits();
}

function editHabitNote(id) {
  const h = state.habits.find(x => x.id === id);
  if (!h) return;
  const card = document.querySelector(`.habit-card[data-habit="${id}"]`);
  const noteArea = card.querySelector(".habit-note-area");
  noteArea.innerHTML = "";
  const editor = document.createElement("div");
  editor.className = "note-editor";
  const ta = document.createElement("textarea");
  ta.rows = 4;
  ta.maxLength = 1000;
  ta.placeholder = "Why do you want this habit? The reasons you'll need on hard days.";
  ta.value = h.note || "";
  const btns = document.createElement("div");
  btns.className = "editor-btns";
  const cancel = document.createElement("button");
  cancel.className = "btn ghost";
  cancel.textContent = "Cancel";
  cancel.onclick = () => renderHabits();
  const saveBtn = document.createElement("button");
  saveBtn.className = "btn primary";
  saveBtn.textContent = "Save note";
  saveBtn.onclick = () => {
    const newNote = ta.value.trim();
    if (newNote !== h.note) delete h.showNoteOnCheckin; // fresh reasons re-enable the check-in gate
    h.note = newNote;
    touch(h);
    save();
    renderHabits();
  };
  btns.append(cancel, saveBtn);
  editor.append(ta, btns);
  noteArea.appendChild(editor);
  ta.focus();
}

function renderHabits() {
  const list = document.getElementById("habit-list");
  const empty = document.getElementById("habits-empty");
  const today = todayKey();
  list.innerHTML = "";
  empty.classList.toggle("hidden", state.habits.length > 0);

  for (const h of state.habits) {
    const doneToday = h.lastCheckin === today;
    const card = document.createElement("div");
    card.className = "habit-card";
    card.dataset.habit = h.id;
    card.innerHTML = `
      <div class="habit-info">
        <div class="habit-name"></div>
        <div class="habit-meta">
          <span class="streak-flame">🔥 ${h.streak} day streak</span>
          <span>🏆 Best: ${h.bestStreak}</span>
          <span class="freeze-badge">🧊 ${h.freezes} freeze${h.freezes === 1 ? "" : "s"}</span>
        </div>
        <div class="habit-note-area"></div>
      </div>
      <div class="habit-actions">
        ${doneToday
          ? `<span class="done-today">✓ Done today</span>`
          : `<button class="btn success" data-checkin="${h.id}">${h.streak === 0 && !h.lastCheckin ? "🌱 Start habit" : "Continue streak"}</button>`}
        <button class="btn ghost" data-delete="${h.id}" title="Delete habit">🗑</button>
      </div>`;
    card.querySelector(".habit-name").textContent = h.name;

    const noteArea = card.querySelector(".habit-note-area");
    if (h.note) {
      const details = document.createElement("details");
      details.className = "habit-note";
      const summary = document.createElement("summary");
      summary.textContent = "📝 Why I'm doing this";
      const text = document.createElement("div");
      text.className = "note-text";
      text.textContent = h.note;
      const actions = document.createElement("div");
      actions.className = "note-actions";
      actions.innerHTML = `<button class="btn ghost" data-edit-note="${h.id}">✎ Edit note</button>`;
      details.append(summary, text, actions);
      noteArea.appendChild(details);
    } else {
      noteArea.innerHTML = `<div class="note-actions"><button class="btn ghost add-note-btn" data-edit-note="${h.id}">＋ Add a "why" note</button></div>`;
    }

    list.appendChild(card);
  }

  // stacking nudge: every habit has a 7+ day streak
  const nudge = document.getElementById("stack-nudge");
  const ready = state.habits.length > 0 && state.habits.every(h => h.streak >= FREEZE_EVERY);
  nudge.classList.toggle("hidden", !ready);

  // one habit per day: lock the form once today's habit is planted
  const locked = habitCreatedToday();
  document.getElementById("habit-name").disabled = locked;
  document.getElementById("habit-note").disabled = locked;
  document.querySelector("#habit-form button").disabled = locked;
  document.getElementById("habit-limit-msg").classList.toggle("hidden", !locked);

  renderHeatmap();
}

/* ---------- journey heatmap ---------- */

const HEATMAP_WEEKS = 16;

function renderHeatmap() {
  const card = document.getElementById("journey-card");
  card.classList.toggle("hidden", state.habits.length === 0);
  if (!state.habits.length) return;

  // per-day data: check-in counts and habits created
  const days = {};
  const dayInfo = key => (days[key] ??= { count: 0, created: [] });
  let firstDay = todayKey();
  for (const h of state.habits) {
    if (h.createdAt) {
      dayInfo(h.createdAt).created.push(h.name);
      if (h.createdAt < firstDay) firstDay = h.createdAt;
    }
    for (const d of h.checkins || []) {
      dayInfo(d).count++;
      if (d < firstDay) firstDay = d;
    }
  }

  const dayNumber = daysBetween(firstDay, todayKey()) + 1;
  document.getElementById("journey-day").textContent = `— Day ${dayNumber}`;

  // grid: HEATMAP_WEEKS full weeks ending with the current week, columns = weeks
  const grid = document.getElementById("heatmap");
  grid.innerHTML = "";
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const gridStart = new Date(today);
  gridStart.setDate(gridStart.getDate() - gridStart.getDay() - (HEATMAP_WEEKS - 1) * 7);
  const totalCells = HEATMAP_WEEKS * 7;

  for (let i = 0; i < totalCells; i++) {
    const d = new Date(gridStart);
    d.setDate(d.getDate() + i);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    const cell = document.createElement("span");
    if (d > today) {
      cell.className = "hm-cell future";
    } else {
      const info = days[key];
      const c = info ? info.count : 0;
      const level = c === 0 ? 0 : c === 1 ? 1 : c === 2 ? 2 : c <= 4 ? 3 : 4;
      cell.className = `hm-cell l${level}` + (info && info.created.length ? " created" : "");
      const label = d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
      let tip = `${label}: ${c} check-in${c === 1 ? "" : "s"}`;
      if (info && info.created.length) tip += ` · 🌱 planted "${info.created.join('", "')}"`;
      cell.title = tip;
    }
    grid.appendChild(cell);
  }
  grid.scrollLeft = grid.scrollWidth; // keep the current week in view
}

/* ============================================================
   PLANNER
   ============================================================ */

function todaysTasks() {
  const key = todayKey();
  if (!state.tasksByDate[key]) state.tasksByDate[key] = [];
  return state.tasksByDate[key];
}

// task: { id, name, startMin, durMin, aux: false|true, done }
function addPlannedTask({ name, durMin, startMin, before, after }) {
  const tasks = todaysTasks();
  const gid = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const now = Date.now();
  if (before) tasks.push(touch({ id: gid + "-b", name: before.label, startMin: startMin - before.min, durMin: before.min, aux: true, done: false }, now));
  tasks.push(touch({ id: gid + "-m", name, startMin, durMin, aux: false, done: false }, now));
  if (after) tasks.push(touch({ id: gid + "-a", name: after.label, startMin: startMin + durMin, durMin: after.min, aux: true, done: false }, now));
  save();
  renderTimeline();
}

function toggleTaskDone(id) {
  const t = todaysTasks().find(x => x.id === id);
  if (t) { t.done = !t.done; touch(t); save(); renderTimeline(); }
}
function deleteTask(id) {
  const key = todayKey();
  rememberDeletion("tasks", id);
  state.tasksByDate[key] = todaysTasks().filter(x => x.id !== id);
  save();
  renderTimeline();
}

// "Gym starts in 1h 20m" banner above the timeline
function renderNextUp() {
  const el = document.getElementById("next-up");
  const now = new Date();
  const nowMin = now.getHours() * 60 + now.getMinutes();
  const upcoming = todaysTasks()
    .filter(t => !t.done && t.startMin > nowMin)
    .sort((a, b) => a.startMin - b.startMin)[0];
  const current = todaysTasks()
    .filter(t => !t.done && t.startMin <= nowMin && t.startMin + t.durMin > nowMin)
    .sort((a, b) => b.startMin - a.startMin)[0];

  const parts = [];
  if (current) {
    const left = current.startMin + current.durMin - nowMin;
    parts.push(`Now: <strong></strong> (${fmtDuration(left)} left)`);
  }
  if (upcoming) {
    const until = upcoming.startMin - nowMin;
    parts.push(`Next: <strong></strong> in <strong>${fmtDuration(until)}</strong> (${fmtTime(upcoming.startMin)})`);
  }
  el.classList.toggle("hidden", parts.length === 0);
  if (!parts.length) return;
  el.innerHTML = "⏳ " + parts.join(" · ");
  const strongs = el.querySelectorAll("strong");
  let i = 0;
  if (current) strongs[i++].textContent = current.name;
  if (upcoming) strongs[i].textContent = upcoming.name;
}

function renderTimeline() {
  renderNextUp();
  const timeline = document.getElementById("timeline");
  const empty = document.getElementById("tasks-empty");
  const tasks = todaysTasks().slice().sort((a, b) => a.startMin - b.startMin);

  empty.classList.toggle("hidden", tasks.length > 0);
  timeline.classList.toggle("empty", tasks.length === 0);
  timeline.innerHTML = "";
  if (!tasks.length) return;

  // expand visible range if a task falls outside default hours
  let startHour = DAY_START_HOUR, endHour = DAY_END_HOUR;
  for (const t of tasks) {
    startHour = Math.min(startHour, Math.floor(t.startMin / 60));
    endHour = Math.max(endHour, Math.ceil((t.startMin + t.durMin) / 60));
  }
  startHour = Math.max(0, startHour);
  endHour = Math.min(24, endHour);

  for (let m = startHour * 60; m < endHour * 60; m += rowMinutes()) {
    const row = document.createElement("div");
    row.className = "hour-row" + (m % 60 !== 0 ? " half" : "");
    row.innerHTML = `<div class="hour-label">${fmtTime(m)}</div>`;
    timeline.appendChild(row);
  }

  // overlapping events share the width side-by-side (Google Calendar style):
  // cluster mutually-overlapping blocks, then greedily assign columns
  const clusters = [];
  let cluster = null, clusterEnd = -1;
  for (const t of tasks) { // already sorted by startMin
    if (!cluster || t.startMin >= clusterEnd) {
      cluster = [];
      clusters.push(cluster);
      clusterEnd = -1;
    }
    cluster.push(t);
    clusterEnd = Math.max(clusterEnd, t.startMin + t.durMin);
  }
  const layout = new Map(); // task id -> { col, cols }
  for (const c of clusters) {
    const colEnds = []; // end time of the last block in each column
    for (const t of c) {
      let col = colEnds.findIndex(end => t.startMin >= end);
      if (col === -1) { col = colEnds.length; colEnds.push(0); }
      colEnds[col] = t.startMin + t.durMin;
      layout.set(t.id, { col, cols: 0 });
    }
    for (const t of c) layout.get(t.id).cols = colEnds.length;
  }

  const layer = document.createElement("div");
  layer.className = "blocks-layer";
  layer.style.height = `${(endHour - startHour) * pxPerHour()}px`;
  for (const t of tasks) {
    const top = ((t.startMin - startHour * 60) / 60) * pxPerHour();
    const height = Math.max(22, (t.durMin / 60) * pxPerHour() - 2);
    const block = document.createElement("div");
    block.className = "time-block" + (t.aux ? " aux" : "") + (t.done ? " done" : "");
    block.style.top = `${top}px`;
    block.style.height = `${height}px`;
    const { col, cols } = layout.get(t.id);
    if (cols > 1) {
      block.style.left = `${(col / cols) * 100}%`;
      block.style.right = `${(1 - (col + 1) / cols) * 100}%`;
    }
    block.innerHTML = `
      <div>
        <span class="block-title"></span>
        <span class="block-time">${fmtTime(t.startMin)} – ${fmtTime(t.startMin + t.durMin)} · ${fmtDuration(t.durMin)}</span>
      </div>
      <div class="block-actions">
        <button data-toggle="${t.id}" title="Mark done">${t.done ? "↩" : "✓"}</button>
        <button data-remove="${t.id}" title="Remove">✕</button>
      </div>`;
    block.querySelector(".block-title").textContent = t.name + " ";
    layer.appendChild(block);
  }
  timeline.appendChild(layer);

  // "you are here" line, like Google Calendar's red now-indicator
  const now = new Date();
  const nowMin = now.getHours() * 60 + now.getMinutes();
  if (nowMin >= startHour * 60 && nowMin <= endHour * 60) {
    const line = document.createElement("div");
    line.className = "now-line";
    line.style.top = `${((nowMin - startHour * 60) / 60) * pxPerHour()}px`;
    line.innerHTML = `<span class="now-label">${fmtTime(nowMin)}</span>`;
    timeline.appendChild(line);
  }
}

// scroll the timeline panel so the current time sits mid-view; runs on
// planner open and zoom change, never on re-renders (don't fight the user)
function centerTimelineOnNow() {
  const timeline = document.getElementById("timeline");
  const line = timeline.querySelector(".now-line");
  if (!line) return;
  timeline.scrollTop = Math.max(0, line.offsetTop - timeline.clientHeight / 2);
}

// keep the now-line moving while the planner is visible
setInterval(() => {
  if (document.getElementById("tab-planner").classList.contains("active")) renderTimeline();
}, 60000);

/* ============================================================
   TIME TRACKER
   ============================================================ */

const FALLBACK_CATEGORY = { id: "uncategorized", name: "Uncategorized", color: "#778196", archived: true };

function categoryById(id) {
  return state.categories.find(category => category.id === id) || FALLBACK_CATEGORY;
}

function activeCategories() {
  return state.categories.filter(category => !category.archived);
}

function categorySignature() {
  return state.categories.map(category =>
    `${category.id}:${category.name}:${category.color}:${category.archived}`).join("|");
}

function refreshCategorySelect(select, preferredId) {
  const categories = activeCategories();
  const previous = preferredId || select.value;
  const preferred = state.categories.find(category => category.id === previous);
  if (preferred?.archived) categories.push(preferred);
  const signature = categorySignature() + "|include:" + (preferred?.archived ? preferred.id : "");
  if (select.dataset.categorySignature !== signature) {
    select.innerHTML = "";
    for (const category of categories) {
      const option = document.createElement("option");
      option.value = category.id;
      option.textContent = category.name;
      select.appendChild(option);
    }
    select.dataset.categorySignature = signature;
  }
  if (categories.some(category => category.id === previous)) select.value = previous;
  else if (categories.length) select.value = categories[0].id;
  if (select.catSelectSync) select.catSelectSync();
}

/* ---------- custom category dropdown (drives a hidden native <select>) ---------- */
function enhanceCategorySelect(select) {
  const wrap = document.createElement("div");
  wrap.className = "cat-select";
  select.parentNode.insertBefore(wrap, select);
  wrap.appendChild(select);
  select.tabIndex = -1;
  select.setAttribute("aria-hidden", "true");

  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "cat-select-btn";
  btn.setAttribute("aria-haspopup", "listbox");
  btn.setAttribute("aria-expanded", "false");
  btn.setAttribute("aria-label", select.getAttribute("aria-label") || "Category");
  btn.innerHTML = `<span class="label-dot"></span><span class="cat-select-name"></span>
    <svg class="cat-select-chevron" width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><path d="M2.5 4.5 6 8l3.5-3.5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
  const menu = document.createElement("div");
  menu.className = "cat-select-menu hidden";
  menu.setAttribute("role", "listbox");
  wrap.append(btn, menu);

  function close() {
    menu.classList.add("hidden");
    wrap.classList.remove("open");
    btn.setAttribute("aria-expanded", "false");
  }
  function open() {
    sync();
    menu.classList.remove("hidden");
    wrap.classList.add("open");
    btn.setAttribute("aria-expanded", "true");
  }

  function sync() {
    const current = categoryById(select.value);
    btn.querySelector(".cat-select-name").textContent = current ? current.name : "Category";
    btn.style.setProperty("--category-color", current ? current.color : "#778196");
    if (!menu.classList.contains("hidden")) return; // don't rebuild under an open menu
    menu.innerHTML = "";
    for (const option of select.options) {
      const category = categoryById(option.value);
      const item = document.createElement("button");
      item.type = "button";
      item.className = "cat-select-option" + (option.value === select.value ? " selected" : "");
      item.setAttribute("role", "option");
      item.setAttribute("aria-selected", String(option.value === select.value));
      item.style.setProperty("--category-color", category ? category.color : "#778196");
      item.innerHTML = `<span class="label-dot"></span><span class="cat-select-option-name"></span>
        <svg class="cat-select-check" width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><path d="M2.5 6.5 5 9l4.5-5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
      item.querySelector(".cat-select-option-name").textContent = option.textContent;
      item.addEventListener("click", () => {
        select.value = option.value;
        select.dispatchEvent(new Event("change", { bubbles: true }));
        close();
        sync();
        btn.focus();
      });
      menu.appendChild(item);
    }
  }

  btn.addEventListener("click", () => menu.classList.contains("hidden") ? open() : close());
  btn.addEventListener("keydown", event => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      open();
      const items = menu.querySelectorAll(".cat-select-option");
      (menu.querySelector(".cat-select-option.selected") || items[0])?.focus();
    }
  });
  menu.addEventListener("keydown", event => {
    const items = [...menu.querySelectorAll(".cat-select-option")];
    const index = items.indexOf(document.activeElement);
    if (event.key === "ArrowDown") { event.preventDefault(); (items[index + 1] || items[0]).focus(); }
    else if (event.key === "ArrowUp") { event.preventDefault(); (items[index - 1] || items[items.length - 1]).focus(); }
    else if (event.key === "Escape") { close(); btn.focus(); }
  });
  document.addEventListener("click", event => { if (!wrap.contains(event.target)) close(); });

  select.catSelectSync = sync;
  sync();
}

function applyCategoryColor(element, category) {
  element.style.setProperty("--category-color", category.color);
}

// entry: { id, name, categoryId, start (ms), end (ms|null) }
// Always the NEWEST running entry — duplicates from sync races must not
// steer the tracking bar or activity editor.
function runningEntry() {
  let r = null;
  for (const e of state.entries) {
    if (e.end === null && (!r || e.start > r.start)) r = e;
  }
  return r;
}

// There must never be more than one running entry: close all but the newest,
// each older one ending where the next began. Repairs states produced by
// sync races or multiple open tabs.
function normalizeRunning(s) {
  const running = s.entries.filter(e => e.end === null).sort((a, b) => a.start - b.start);
  for (let i = 0; i < running.length - 1; i++) {
    running[i].end = Math.max(running[i].start, running[i + 1].start);
  }
}

function startActivity(name, categoryId) {
  const category = activeCategories().find(item => item.id === categoryId) || activeCategories()[0];
  if (!category) return;
  const now = Date.now();
  // End + start is one atomic local transition. Other tabs/devices never see
  // the misleading in-between state where nothing is running.
  endRunning(now, false);
  state.entries.push(touch({
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    name, categoryId: category.id,
    start: now,
    end: null,
  }, now));
  save();
  renderTracker();
}

// internal only — no UI stop button exists; called when a new activity starts.
// Ends every running entry, not just the newest, so duplicates can't linger.
function endRunning(at = Date.now(), persist = true) {
  const running = state.entries.filter(e => e.end === null);
  if (!running.length) return;
  normalizeRunning(state); // closes all but the newest
  const r = runningEntry();
  r.end = Math.max(r.start, at);
  touch(r, at);
  if (persist) save();
}

function deleteEntry(id) {
  rememberDeletion("entries", id);
  state.entries = state.entries.filter(e => e.id !== id);
  save();
  renderTracker();
}

function dayStartMs() {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  return start.getTime();
}
// entries overlapping today (a running entry started yesterday still counts)
function entriesToday() {
  const start = dayStartMs();
  return state.entries.filter(e => (e.end === null ? Date.now() : e.end) > start);
}

function fmtElapsed(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  if (h) return `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
  return `${m}:${String(sec).padStart(2, "0")}`;
}
function fmtClock(ms) {
  const d = new Date(ms);
  return fmtTime(d.getHours() * 60 + d.getMinutes());
}

function renderTracker() {
  const running = runningEntry();
  refreshCategorySelect(document.getElementById("track-category"));

  // persistent bar (visible on every tab)
  const bar = document.getElementById("running-bar");
  bar.classList.toggle("hidden", !running);
  if (running) {
    const category = categoryById(running.categoryId);
    document.getElementById("running-bar-name").textContent = running.name;
    document.getElementById("running-bar-category").textContent = category.name;
    document.getElementById("running-bar-elapsed").textContent = fmtElapsed(Date.now() - running.start);
    applyCategoryColor(bar, category);
  }

  // recent chips: latest unique activity/category combos, running one excluded
  const chipsBox = document.getElementById("recent-chips");
  chipsBox.innerHTML = "";
  const seen = new Set();
  const recents = [];
  for (let i = state.entries.length - 1; i >= 0 && recents.length < 6; i--) {
    const e = state.entries[i];
    const category = categoryById(e.categoryId);
    if (category.archived) continue;
    const key = e.name.toLowerCase() + "|" + e.categoryId;
    if (seen.has(key)) continue;
    seen.add(key);
    if (running && running.name.toLowerCase() === e.name.toLowerCase() && running.categoryId === e.categoryId) continue;
    recents.push(e);
  }
  // Starter suggestions until the user has their own recent activities.
  const starters = [
    { name: "Down time", categoryId: "entertainment" },
    { name: "Morning routine", categoryId: "personal" },
    { name: "Sleep", categoryId: "personal" },
  ];
  for (const s of starters) {
    if (recents.length >= 6) break;
    if (categoryById(s.categoryId).archived) continue;
    const key = s.name.toLowerCase() + "|" + s.categoryId;
    if (seen.has(key)) continue;
    if (running && running.name.toLowerCase() === s.name.toLowerCase() && running.categoryId === s.categoryId) continue;
    seen.add(key);
    recents.push(s);
  }
  for (const e of recents) {
    const category = categoryById(e.categoryId);
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "chip";
    chip.dataset.restartName = e.name;
    chip.dataset.restartCategory = e.categoryId;
    chip.title = category.name;
    applyCategoryColor(chip, category);
    chip.innerHTML = `<span class="label-dot"></span>`;
    chip.append("▶ " + e.name);
    chipsBox.appendChild(chip);
  }

  // today's entries (newest first)
  const list = document.getElementById("entry-list");
  const today = entriesToday().slice().sort((a, b) => b.start - a.start);
  document.getElementById("entries-empty").classList.toggle("hidden", today.length > 0);
  list.innerHTML = "";
  for (const e of today) {
    const isRunning = e.end === null;
    const dur = (isRunning ? Date.now() : e.end) - e.start;
    const category = categoryById(e.categoryId);
    const row = document.createElement("div");
    row.className = "entry-row";
    applyCategoryColor(row, category);
    row.innerHTML = `
      <span class="entry-label-dot"></span>
      <span class="entry-main">
        <span class="entry-name-line"><span class="entry-name"></span><button class="entry-edit-icon" data-edit-entry="${e.id}" aria-label="Edit activity" title="Edit activity">✎</button></span>
        <span class="entry-category"></span>
      </span>
      <span class="entry-timing"><span class="entry-time">${fmtClock(e.start)} – ${isRunning ? "now" : fmtClock(e.end)}</span><span class="entry-dur">${fmtElapsed(dur)}</span></span>
      <span class="entry-actions">
        ${isRunning ? "" : `<button class="btn ghost" data-del-entry="${e.id}" title="Delete entry">✕</button>`}
      </span>`;
    const nameEl = row.querySelector(".entry-name");
    nameEl.textContent = e.name + " ";
    if (isRunning) nameEl.innerHTML += `<span class="entry-running">● tracking</span>`;
    row.querySelector(".entry-category").textContent = category.name;
    list.appendChild(row);
  }

  // Summary: total per category.
  const totals = {};
  let grand = 0;
  const dayStart = dayStartMs();
  for (const e of today) {
    // only count the portion that falls within today
    const dur = Math.max(0, (e.end === null ? Date.now() : e.end) - Math.max(e.start, dayStart));
    totals[e.categoryId] = (totals[e.categoryId] || 0) + dur;
    grand += dur;
  }
  const barEl = document.getElementById("summary-bar");
  const legend = document.getElementById("summary-legend");
  document.getElementById("summary-total").textContent = fmtElapsed(grand);
  document.getElementById("summary-empty").classList.toggle("hidden", grand > 0);
  barEl.classList.toggle("hidden", grand === 0);
  barEl.innerHTML = "";
  legend.innerHTML = "";
  if (grand > 0) {
    const ranked = Object.entries(totals).sort((a, b) => b[1] - a[1]);
    for (const [categoryId, totalMs] of ranked) {
      const category = categoryById(categoryId);
      const percent = Math.round((totalMs / grand) * 100);
      const seg = document.createElement("div");
      seg.className = "summary-seg";
      seg.style.flex = String(totalMs / grand);
      seg.style.background = category.color;
      seg.title = `${category.name}: ${fmtElapsed(totalMs)}`;
      barEl.appendChild(seg);

      const item = document.createElement("span");
      item.className = "legend-item";
      applyCategoryColor(item, category);
      item.innerHTML = `<span class="label-dot"></span><span class="legend-copy"><span class="legend-name"></span><strong>${fmtElapsed(totalMs)}</strong></span><span class="legend-percent">${percent}%</span>`;
      item.querySelector(".legend-name").textContent = category.name;
      legend.appendChild(item);
    }
  }
}

// preset palette for new categories — distinct hues that fit the app;
// the "custom" swatch opens the native picker for anything else
const CATEGORY_PALETTE = [
  "#5B5BD6", "#2563EB", "#0EA5A4", "#22A06B", "#65A30D", "#EAB308",
  "#F59E0B", "#F97360", "#E5484D", "#EC4899", "#A855F7", "#8B5E3C", "#64748B",
];
let newCategoryColor = CATEGORY_PALETTE[0];

function renderCategorySwatches() {
  const wrap = document.getElementById("category-swatches");
  const customInput = document.getElementById("category-color");
  wrap.innerHTML = "";
  const isPreset = CATEGORY_PALETTE.includes(newCategoryColor);
  for (const color of CATEGORY_PALETTE) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "category-swatch" + (color === newCategoryColor ? " selected" : "");
    btn.style.background = color;
    btn.setAttribute("role", "radio");
    btn.setAttribute("aria-checked", String(color === newCategoryColor));
    btn.setAttribute("aria-label", "Color " + color);
    btn.addEventListener("click", () => {
      newCategoryColor = color;
      renderCategorySwatches();
    });
    wrap.appendChild(btn);
  }
  const custom = document.createElement("button");
  custom.type = "button";
  custom.className = "category-swatch custom" + (isPreset ? "" : " selected");
  custom.setAttribute("role", "radio");
  custom.setAttribute("aria-checked", String(!isPreset));
  custom.setAttribute("aria-label", "Custom color");
  custom.title = "Custom color";
  if (!isPreset) custom.style.background = newCategoryColor;
  custom.addEventListener("click", () => {
    customInput.value = newCategoryColor;
    customInput.click();
  });
  wrap.appendChild(custom);
}

document.getElementById("category-color").addEventListener("input", event => {
  newCategoryColor = event.target.value;
  renderCategorySwatches();
});

let archivedSectionOpen = false; // "Archived (n)" section state in the manager

function categoryRow(category) {
  const row = document.createElement("div");
  row.className = "category-row" + (category.archived ? " archived" : "");
  row.dataset.categoryId = category.id;
  row.innerHTML = `
    <input type="color" class="category-color-input" aria-label="Category color">
    <input type="text" class="category-name-input" maxlength="32" aria-label="Category name">
    <button type="button" class="btn category-save-btn" data-category-save>Save</button>
    <div class="category-more">
      <button type="button" class="btn ghost category-more-btn" data-category-menu aria-haspopup="menu" aria-label="More options">⋯</button>
      <div class="category-menu hidden" role="menu">
        <button type="button" class="category-menu-item" role="menuitem" data-category-archive>${category.archived ? "Restore" : "Archive"}</button>
        <button type="button" class="category-menu-item danger" role="menuitem" data-category-delete>Delete…</button>
      </div>
    </div>`;
  row.querySelector(".category-color-input").value = category.color;
  row.querySelector(".category-name-input").value = category.name;
  return row;
}

function renderCategoryManager() {
  renderCategorySwatches();
  const list = document.getElementById("category-list");
  list.innerHTML = "";
  const ordered = [...state.categories].sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
  for (const category of ordered.filter(item => !item.archived)) list.appendChild(categoryRow(category));

  const archived = ordered.filter(item => item.archived);
  if (!archived.length) return;
  const toggle = document.createElement("button");
  toggle.type = "button";
  toggle.className = "category-archived-toggle" + (archivedSectionOpen ? " open" : "");
  toggle.dataset.archivedToggle = "";
  toggle.setAttribute("aria-expanded", String(archivedSectionOpen));
  toggle.innerHTML = `<svg width="10" height="10" viewBox="0 0 12 12" aria-hidden="true"><path d="M4.5 2.5 8 6l-3.5 3.5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg> Archived (${archived.length})`;
  list.appendChild(toggle);
  if (archivedSectionOpen) for (const category of archived) list.appendChild(categoryRow(category));
}

function saveCategoryRow(row) {
  const category = state.categories.find(item => item.id === row.dataset.categoryId);
  if (!category) return;
  const name = row.querySelector(".category-name-input").value.trim();
  const color = row.querySelector(".category-color-input").value;
  if (!name) { alert("Give the category a name."); return; }
  if (state.categories.some(item => item.id !== category.id && item.name.toLowerCase() === name.toLowerCase())) {
    alert("A category with that name already exists.");
    return;
  }
  category.name = name.slice(0, 32);
  category.color = /^#[0-9a-f]{6}$/i.test(color) ? color : category.color;
  touch(category);
  save();
  renderCategoryManager();
  renderTracker();
}

function toggleCategoryArchive(id) {
  const category = state.categories.find(item => item.id === id);
  if (!category) return;
  if (!category.archived && activeCategories().length === 1) {
    alert("Keep at least one active category for tracking.");
    return;
  }
  category.archived = !category.archived;
  if (category.archived) archivedSectionOpen = true; // show where the row went
  touch(category);
  save();
  renderCategoryManager();
  renderTracker();
}

let deleteCategoryId = null; // category the delete-confirm modal is about

function openCategoryDelete(id) {
  const category = state.categories.find(item => item.id === id);
  if (!category) return;
  if (!category.archived && activeCategories().length === 1) {
    alert("Keep at least one active category for tracking.");
    return;
  }
  const targets = activeCategories().filter(item => item.id !== id);
  if (!targets.length) {
    alert("Keep at least one active category for tracking.");
    return;
  }
  deleteCategoryId = id;
  const count = state.entries.filter(entry => entry.categoryId === id).length;
  document.getElementById("category-delete-name").textContent = category.name;
  document.getElementById("category-delete-count").textContent =
    count === 0 ? "It has no tracked activities."
      : count === 1 ? "It has 1 tracked activity."
      : `It has ${count} tracked activities.`;
  document.getElementById("category-delete-move-row").classList.toggle("hidden", count === 0);
  document.getElementById("category-delete-wipe").textContent =
    count === 0 ? "Delete category" : "Delete category and its activities";

  const select = document.getElementById("category-delete-target");
  select.innerHTML = "";
  for (const target of targets) {
    const option = document.createElement("option");
    option.value = target.id;
    option.textContent = target.name;
    select.appendChild(option);
  }
  if (select.catSelectSync) select.catSelectSync();
  document.getElementById("category-delete-overlay").classList.remove("hidden");
}

function confirmCategoryDelete(mode) {
  const id = deleteCategoryId;
  const category = state.categories.find(item => item.id === id);
  if (!category) return;
  const now = Date.now();
  if (mode === "move") {
    const targetId = document.getElementById("category-delete-target").value;
    if (!targetId || targetId === id) return;
    for (const entry of state.entries) {
      if (entry.categoryId !== id) continue;
      entry.categoryId = targetId;
      touch(entry, now);
    }
  } else {
    for (const entry of state.entries) {
      if (entry.categoryId === id) rememberDeletion("entries", entry.id);
    }
    state.entries = state.entries.filter(entry => entry.categoryId !== id);
  }
  rememberDeletion("categories", id);
  state.categories = state.categories.filter(item => item.id !== id);
  deleteCategoryId = null;
  document.getElementById("category-delete-overlay").classList.add("hidden");
  save();
  renderCategoryManager();
  renderTracker();
}

function addCategory(name, color) {
  if (state.categories.length >= 20) {
    alert("You can have up to 20 categories. Rename or restore an existing category instead.");
    return false;
  }
  if (state.categories.some(category => category.name.toLowerCase() === name.toLowerCase())) {
    alert("A category with that name already exists.");
    return false;
  }
  const now = Date.now();
  state.categories.push(touch({
    id: "cat-" + now.toString(36) + Math.random().toString(36).slice(2, 6),
    name: name.slice(0, 32), color, archived: false, createdAt: now,
  }, now));
  save();
  renderCategoryManager();
  renderTracker();
  return true;
}

// live tick while a timer runs (updates bar, entry durations, summary)
setInterval(() => { if (runningEntry()) renderTracker(); }, 1000);

/* ---------- activity editor ---------- */

let editingEntryId = null;
let editingOriginalStart = null;
let editingOriginalEnd = null;

function dateInputValue(ms) {
  const date = new Date(ms);
  const part = value => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${part(date.getMonth() + 1)}-${part(date.getDate())}`;
}

function timeInputValue(ms) {
  const date = new Date(ms);
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

function readEditedDateTime(prefix, originalMs) {
  const date = document.getElementById(`activity-edit-${prefix}-date`).value;
  const time = document.getElementById(`activity-edit-${prefix}-time`).value;
  if (!date || !time) return NaN;
  if (originalMs !== null && date === dateInputValue(originalMs) && time === timeInputValue(originalMs)) return originalMs;
  return new Date(`${date}T${time}:00`).getTime();
}

function closeActivityEditor() {
  editingEntryId = null;
  editingOriginalStart = null;
  editingOriginalEnd = null;
  document.getElementById("activity-edit-overlay").classList.add("hidden");
}

function openActivityEditor(id) {
  const entry = state.entries.find(item => item.id === id);
  if (!entry) return;
  editingEntryId = id;
  editingOriginalStart = entry.start;
  editingOriginalEnd = entry.end;
  const running = entry.end === null;
  document.getElementById("activity-edit-kind").textContent = running ? "Currently tracking" : "Completed activity";
  document.getElementById("activity-edit-name").value = entry.name;
  const categorySelect = document.getElementById("activity-edit-category");
  refreshCategorySelect(categorySelect, entry.categoryId);
  document.getElementById("activity-edit-start-date").value = dateInputValue(entry.start);
  document.getElementById("activity-edit-start-time").value = timeInputValue(entry.start);
  document.getElementById("activity-edit-end-row").classList.toggle("hidden", running);
  document.getElementById("activity-edit-end-date").value = running ? "" : dateInputValue(entry.end);
  document.getElementById("activity-edit-end-time").value = running ? "" : timeInputValue(entry.end);
  document.getElementById("activity-edit-overlay").classList.remove("hidden");
  document.getElementById("activity-edit-name").focus();
}

function saveActivityEdit() {
  const entry = state.entries.find(item => item.id === editingEntryId);
  if (!entry) { closeActivityEditor(); return; }
  const name = document.getElementById("activity-edit-name").value.trim();
  const categoryId = document.getElementById("activity-edit-category").value;
  const start = readEditedDateTime("start", editingOriginalStart);
  const running = entry.end === null;
  const end = running ? null : readEditedDateTime("end", editingOriginalEnd);
  const now = Date.now();
  if (!name) { alert("Give the activity a name."); return; }
  if (!Number.isFinite(start) || (!running && !Number.isFinite(end))) {
    alert("Choose valid start and end times.");
    return;
  }
  if (start >= (running ? now : end)) {
    alert(running ? "The start time must be before now." : "The start time must be before the end time.");
    return;
  }
  if (!running && end > now) { alert("An activity cannot end in the future."); return; }

  const ordered = [...state.entries].sort((a, b) => a.start - b.start || a.id.localeCompare(b.id));
  const index = ordered.findIndex(item => item.id === entry.id);
  const previous = index > 0 ? ordered[index - 1] : null;
  const next = index >= 0 && index < ordered.length - 1 ? ordered[index + 1] : null;
  if (previous && start <= previous.start) {
    alert(`The start must stay after “${previous.name}” began.`);
    return;
  }
  if (!running && next) {
    const nextEnd = next.end === null ? now : next.end;
    if (end >= nextEnd) {
      alert(`The end must stay before “${next.name}” finishes.`);
      return;
    }
  }

  const editedAt = Date.now();
  entry.name = name.slice(0, 80);
  entry.categoryId = categoryId;
  entry.start = start;
  if (!running) entry.end = end;
  entry.editedAt = editedAt;
  touch(entry, editedAt);
  if (previous) {
    previous.end = start;
    previous.editedAt = editedAt;
    touch(previous, editedAt);
  }
  if (!running && next) {
    next.start = end;
    next.editedAt = editedAt;
    touch(next, editedAt);
  }
  save();
  renderTracker();
  closeActivityEditor();
}

/* ============================================================
   TASK WIZARD (multi-step modal)
   ============================================================ */

const wizard = {
  step: 1,
  total: 4,
  overlay: document.getElementById("wizard-overlay"),
  open() {
    this.step = 1;
    document.getElementById("task-name").value = "";
    document.getElementById("task-duration-h").value = 1;
    document.getElementById("task-duration-m").value = 0;
    document.getElementById("need-before").checked = false;
    document.getElementById("need-after").checked = false;
    document.getElementById("before-fields").classList.add("hidden");
    document.getElementById("after-fields").classList.add("hidden");
    document.getElementById("before-label").value = "";
    document.getElementById("after-label").value = "";
    this.overlay.classList.remove("hidden");
    this.show();
    document.getElementById("task-name").focus();
  },
  close() { this.overlay.classList.add("hidden"); },
  show() {
    document.querySelectorAll(".wizard-step").forEach(el =>
      el.classList.toggle("hidden", Number(el.dataset.step) !== this.step));
    document.getElementById("wizard-back").classList.toggle("hidden", this.step === 1);
    document.getElementById("wizard-next").textContent = this.step === this.total ? "Add to plan" : "Next";
    if (this.step === 4) {
      const before = this.beforeData();
      document.getElementById("start-hint").textContent = before
        ? `Heads up: "${before.label}" (${before.min} min) will be scheduled right before this start time.`
        : "";
    }
  },
  beforeData() {
    if (!document.getElementById("need-before").checked) return null;
    return {
      label: document.getElementById("before-label").value.trim() || "Prep / travel",
      min: Math.max(5, Number(document.getElementById("before-min").value) || 20),
    };
  },
  afterData() {
    if (!document.getElementById("need-after").checked) return null;
    return {
      label: document.getElementById("after-label").value.trim() || "Wrap-up / travel back",
      min: Math.max(5, Number(document.getElementById("after-min").value) || 20),
    };
  },
  validate() {
    if (this.step === 1 && !document.getElementById("task-name").value.trim()) {
      alert("Give the task a name first.");
      return false;
    }
    if (this.step === 2) {
      const h = Number(document.getElementById("task-duration-h").value) || 0;
      const m = Number(document.getElementById("task-duration-m").value) || 0;
      if (h * 60 + m < 5) { alert("Give it at least a 5-minute estimate."); return false; }
    }
    return true;
  },
  next() {
    if (!this.validate()) return;
    if (this.step < this.total) { this.step++; this.show(); return; }
    // finish
    const name = document.getElementById("task-name").value.trim();
    const durMin = (Number(document.getElementById("task-duration-h").value) || 0) * 60
                 + (Number(document.getElementById("task-duration-m").value) || 0);
    const [hh, mm] = document.getElementById("task-start").value.split(":").map(Number);
    const startMin = hh * 60 + mm;
    const before = this.beforeData();
    if (before && startMin - before.min < 0) {
      alert("The 'before' block would start before midnight — pick a later start time.");
      return;
    }
    addPlannedTask({ name, durMin, startMin, before, after: this.afterData() });
    this.close();
  },
  back() { if (this.step > 1) { this.step--; this.show(); } },
};

/* ============================================================
   WIRING
   ============================================================ */

document.querySelectorAll(".tab-btn").forEach(btn =>
  btn.addEventListener("click", () => {
    document.querySelectorAll(".tab-btn").forEach(b => b.classList.toggle("active", b === btn));
    document.querySelectorAll(".tab-panel").forEach(p =>
      p.classList.toggle("active", p.id === "tab-" + btn.dataset.tab));
    if (btn.dataset.tab === "planner") {
      renderTimeline(); // fresh now-line on open
      centerTimelineOnNow();
    }
  }));

document.getElementById("habit-form").addEventListener("submit", e => {
  e.preventDefault();
  const input = document.getElementById("habit-name");
  const noteInput = document.getElementById("habit-note");
  const name = input.value.trim();
  if (!name) return;
  addHabit(name, noteInput.value.trim());
  input.value = "";
  noteInput.value = "";
});

document.getElementById("habit-list").addEventListener("click", e => {
  const checkin = e.target.closest("[data-checkin]");
  const del = e.target.closest("[data-delete]");
  const editNote = e.target.closest("[data-edit-note]");
  if (checkin) checkinHabit(checkin.dataset.checkin);
  if (del) deleteHabit(del.dataset.delete);
  if (editNote) {
    e.preventDefault(); // keep the <details> from toggling
    editHabitNote(editNote.dataset.editNote);
  }
});

document.getElementById("timeline").addEventListener("click", e => {
  const toggle = e.target.closest("[data-toggle]");
  const remove = e.target.closest("[data-remove]");
  if (toggle) toggleTaskDone(toggle.dataset.toggle);
  if (remove) deleteTask(remove.dataset.remove);
});

function setZoom(z) {
  timelineZoom = z;
  localStorage.setItem("opb-zoom", String(z));
  document.getElementById("zoom-in").disabled = z === 1;
  document.getElementById("zoom-out").disabled = z === 0;
  document.getElementById("zoom-label").textContent = z === 1 ? "30m" : "1h";
  renderTimeline();
  centerTimelineOnNow();
}
document.getElementById("zoom-in").addEventListener("click", () => setZoom(1));
document.getElementById("zoom-out").addEventListener("click", () => setZoom(0));

document.getElementById("open-task-wizard").addEventListener("click", () => wizard.open());
document.getElementById("wizard-close").addEventListener("click", () => wizard.close());
document.getElementById("wizard-next").addEventListener("click", () => wizard.next());
document.getElementById("wizard-back").addEventListener("click", () => wizard.back());
document.getElementById("wizard-overlay").addEventListener("click", e => {
  if (e.target === wizard.overlay) wizard.close();
});
document.getElementById("need-before").addEventListener("change", e =>
  document.getElementById("before-fields").classList.toggle("hidden", !e.target.checked));
document.getElementById("need-after").addEventListener("change", e =>
  document.getElementById("after-fields").classList.toggle("hidden", !e.target.checked));

enhanceCategorySelect(document.getElementById("track-category"));
enhanceCategorySelect(document.getElementById("activity-edit-category"));
enhanceCategorySelect(document.getElementById("category-delete-target"));

document.getElementById("track-form").addEventListener("submit", e => {
  e.preventDefault();
  const name = document.getElementById("track-name").value.trim();
  if (!name) return;
  startActivity(name, document.getElementById("track-category").value);
  document.getElementById("track-name").value = "";
});

document.getElementById("recent-chips").addEventListener("click", e => {
  const chip = e.target.closest("[data-restart-name]");
  if (chip) startActivity(chip.dataset.restartName, chip.dataset.restartCategory);
});

document.getElementById("manage-categories-btn").addEventListener("click", () => {
  renderCategoryManager();
  document.getElementById("categories-overlay").classList.remove("hidden");
});
document.getElementById("categories-close").addEventListener("click", () =>
  document.getElementById("categories-overlay").classList.add("hidden"));
document.getElementById("categories-overlay").addEventListener("click", event => {
  if (event.target.id === "categories-overlay") event.target.classList.add("hidden");
});
document.getElementById("category-list").addEventListener("click", event => {
  if (event.target.closest("[data-archived-toggle]")) {
    archivedSectionOpen = !archivedSectionOpen;
    renderCategoryManager();
    return;
  }
  const row = event.target.closest(".category-row");
  if (!row) return;
  if (event.target.closest("[data-category-menu]")) {
    const menu = row.querySelector(".category-menu");
    const wasHidden = menu.classList.contains("hidden");
    for (const open of document.querySelectorAll(".category-menu")) open.classList.add("hidden");
    if (wasHidden) menu.classList.remove("hidden");
    return;
  }
  if (event.target.closest("[data-category-save]")) saveCategoryRow(row);
  if (event.target.closest("[data-category-archive]")) toggleCategoryArchive(row.dataset.categoryId);
  if (event.target.closest("[data-category-delete]")) openCategoryDelete(row.dataset.categoryId);
});
document.addEventListener("click", event => {
  if (!event.target.closest(".category-more")) {
    for (const open of document.querySelectorAll(".category-menu")) open.classList.add("hidden");
  }
});
document.getElementById("category-delete-wipe").addEventListener("click", () => confirmCategoryDelete("wipe"));
document.getElementById("category-delete-move").addEventListener("click", () => confirmCategoryDelete("move"));
document.getElementById("category-delete-cancel").addEventListener("click", () => {
  deleteCategoryId = null;
  document.getElementById("category-delete-overlay").classList.add("hidden");
});
document.getElementById("category-delete-overlay").addEventListener("click", event => {
  if (event.target.id === "category-delete-overlay") {
    deleteCategoryId = null;
    event.target.classList.add("hidden");
  }
});
document.getElementById("category-form").addEventListener("submit", event => {
  event.preventDefault();
  const nameInput = document.getElementById("category-name");
  const name = nameInput.value.trim();
  if (!name) return;
  if (addCategory(name, newCategoryColor)) {
    nameInput.value = "";
    const used = new Set(state.categories.map(category => category.color.toUpperCase()));
    newCategoryColor = CATEGORY_PALETTE.find(color => !used.has(color)) || CATEGORY_PALETTE[0];
    renderCategorySwatches();
  }
});

document.getElementById("entry-list").addEventListener("click", e => {
  const edit = e.target.closest("[data-edit-entry]");
  const del = e.target.closest("[data-del-entry]");
  if (edit) openActivityEditor(edit.dataset.editEntry);
  if (del) deleteEntry(del.dataset.delEntry);
});

document.getElementById("activity-edit-close").addEventListener("click", closeActivityEditor);
document.getElementById("activity-edit-cancel").addEventListener("click", closeActivityEditor);
document.getElementById("activity-edit-save").addEventListener("click", saveActivityEdit);
document.getElementById("activity-edit-overlay").addEventListener("click", event => {
  if (event.target.id === "activity-edit-overlay") closeActivityEditor();
});

// no stop button — switching activities is the only way to end tracking
document.getElementById("why-continue").addEventListener("click", () => {
  const h = state.habits.find(x => x.id === pendingCheckinId);
  if (h) {
    if (!document.getElementById("why-show-again").checked) h.showNoteOnCheckin = false;
    doCheckin(h);
  }
  pendingCheckinId = null;
  document.getElementById("why-overlay").classList.add("hidden");
});
document.getElementById("why-close").addEventListener("click", () => {
  // closing without confirming does NOT check in — reading the reasons is the deal
  pendingCheckinId = null;
  document.getElementById("why-overlay").classList.add("hidden");
});

document.getElementById("running-bar-switch").addEventListener("click", () => {
  document.querySelector('[data-tab="tracker"]').click();
  document.getElementById("track-name").focus();
});
document.getElementById("running-bar-edit").addEventListener("click", () => {
  const running = runningEntry();
  if (running) openActivityEditor(running.id);
});

document.getElementById("today-date").textContent =
  new Date().toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });

/* ---------- settings ---------- */

document.getElementById("settings-btn").addEventListener("click", () =>
  document.getElementById("settings-overlay").classList.remove("hidden"));
document.getElementById("settings-close").addEventListener("click", () =>
  document.getElementById("settings-overlay").classList.add("hidden"));
document.getElementById("settings-overlay").addEventListener("click", e => {
  if (e.target.id === "settings-overlay") e.target.classList.add("hidden");
});

document.getElementById("reset-account-btn").addEventListener("click", () => {
  const answer = prompt(
    'This erases ALL your habits, streaks, plans, and tracked time — including your cloud copy if signed in. It cannot be undone.\n\nType "reset" to confirm:'
  );
  if (answer === null) return;
  if (answer.trim().toLowerCase() !== "reset") {
    alert("Not reset — you must type exactly: reset");
    return;
  }
  state = { ...emptyState(), resetAt: Date.now() };
  save(); // also pushes the empty state to the cloud when signed in
  renderHabits();
  renderTimeline();
  renderTracker();
  document.getElementById("freeze-notice").classList.add("hidden");
  document.getElementById("settings-overlay").classList.add("hidden");
  alert("Fresh slate. Day 1 starts now — one small habit. 🌱");
});

/* ---------- init ---------- */
reconcileHabits();
renderHabits();
setZoom(timelineZoom); // also renders the timeline
renderTracker();
