/* ============ Habitloom — Habit Tracker & Planner ============ */

// historical key from before the Habitloom rename — do not change, or existing users lose their data
const STORAGE_KEY = "one-percent-better";
const MAX_FREEZES = 2;
const FREEZE_EVERY = 7; // earn a freeze every 7-day streak milestone
const DAY_START_HOUR = 6;  // timeline shows 6:00 – 23:00
const DAY_END_HOUR = 23;
const PX_PER_ROW = 56;
const ensureCategoryState = window.__ensureCategoryState;
// zoom: 0 = 1-hour rows, 1 = 30-minute rows, 2 = 15-minute rows
// (a device preference, not synced)
let timelineZoom = Math.min(2, Math.max(0, Number(localStorage.getItem("opb-zoom")) || 0));
let timelineView = ["day", "three", "week"].includes(localStorage.getItem("opb-timeline-view"))
  ? localStorage.getItem("opb-timeline-view") : "day";
function rowMinutes() { return [60, 30, 15][timelineZoom]; }
function pxPerHour() { return (60 / rowMinutes()) * PX_PER_ROW; }
function timelineDayCount() { return timelineView === "week" ? 7 : timelineView === "three" ? 3 : 1; }

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

let toastTimer = null;
function showToast(message) {
  const toast = document.getElementById("toast");
  clearTimeout(toastTimer);
  toast.textContent = message;
  toast.classList.remove("hidden");
  toastTimer = setTimeout(() => toast.classList.add("hidden"), 3200);
}

function escapeAttr(value) {
  return String(value).replace(/[&<>"']/g, character => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[character]);
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
let renderedDayKey = todayKey();
let viewDayKey = todayKey(); // day currently shown on the Day tab
function viewingToday() { return viewDayKey === todayKey(); }
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
        <button class="btn ghost" data-delete="${h.id}" title="Delete habit" aria-label="Delete ${escapeAttr(h.name)}">🗑</button>
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

function dayTasks(key = viewDayKey) {
  return state.tasksByDate[key] || [];
}

// task: { id, name, startMin, durMin, aux: false|true, done }
function addPlannedTask({ name, durMin, startMin, before, after }) {
  const tasks = (state.tasksByDate[viewDayKey] ??= []);
  const gid = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const now = Date.now();
  if (before) tasks.push(touch({ id: gid + "-b", name: before.label, startMin: startMin - before.min, durMin: before.min, aux: true, done: false }, now));
  tasks.push(touch({ id: gid + "-m", name, startMin, durMin, aux: false, done: false }, now));
  if (after) tasks.push(touch({ id: gid + "-a", name: after.label, startMin: startMin + durMin, durMin: after.min, aux: true, done: false }, now));
  save();
  renderTimeline();
}

function toggleTaskDone(id) {
  const t = dayTasks().find(x => x.id === id);
  if (t) { t.done = !t.done; touch(t); save(); renderTimeline(); }
}
function deleteTask(id) {
  rememberDeletion("tasks", id);
  state.tasksByDate[viewDayKey] = dayTasks().filter(x => x.id !== id);
  save();
  renderTimeline();
}

// "Gym starts in 1h 20m" banner above the timeline
function renderNextUp() {
  const el = document.getElementById("next-up");
  if (!viewingToday()) { el.classList.add("hidden"); return; }
  const now = new Date();
  const nowMin = now.getHours() * 60 + now.getMinutes();
  const tasksToday = dayTasks(todayKey());
  const upcoming = tasksToday
    .filter(t => !t.done && t.startMin > nowMin)
    .sort((a, b) => a.startMin - b.startMin)[0];
  const current = tasksToday
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

function timelineDataForDay(key) {
  const tasks = (state.tasksByDate[key] || []).slice().sort((a, b) => a.startMin - b.startMin);
  const dayStart = dayStartMs(key);
  const dayEnd = dayStartMs(addDays(key, 1));
  const actual = entriesForDay(key).map(entry => {
    const start = Math.max(entry.start, dayStart);
    const end = Math.min(entry.end === null ? Date.now() : entry.end, dayEnd);
    return {
      entry, start, end,
      startMin: start === dayStart ? 0 : localMinuteOfDay(start),
      endMin: end === dayEnd ? 1440 : localMinuteOfDay(end),
    };
  }).filter(item => item.end > item.start).sort((a, b) => a.start - b.start);
  return { key, tasks, actual };
}

function renderMultiDayTimeline() {
  renderNextUp();
  const timeline = document.getElementById("timeline");
  const empty = document.getElementById("tasks-empty");
  const laneHead = document.querySelector(".timeline-lane-head");
  const count = timelineDayCount();
  const days = Array.from({ length: count }, (_, index) => timelineDataForDay(addDays(viewDayKey, index)));
  const hasTimeline = days.some(day => day.tasks.length || day.actual.length);

  empty.textContent = `Nothing planned or tracked in this ${count === 7 ? "week" : "range"}.`;
  empty.classList.toggle("hidden", hasTimeline);
  timeline.classList.remove("empty");
  timeline.classList.add("multi-day");
  laneHead.classList.remove("hidden");
  laneHead.classList.add("multi-day-head");
  laneHead.style.setProperty("--day-count", count);
  laneHead.innerHTML = "<span></span>";
  for (const day of days) {
    const date = new Date(day.key + "T00:00:00");
    const button = document.createElement("button");
    button.type = "button";
    button.className = "multi-day-label" + (day.key === todayKey() ? " today" : "");
    button.dataset.openDay = day.key;
    button.innerHTML = `<span>${date.toLocaleDateString(undefined, { weekday: "short" })}</span><strong>${date.getDate()}</strong>`;
    button.setAttribute("aria-label", `Open ${date.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })} day view`);
    laneHead.appendChild(button);
  }
  timeline.innerHTML = "";

  let startHour = DAY_START_HOUR, endHour = DAY_END_HOUR;
  for (const day of days) {
    for (const task of day.tasks) {
      startHour = Math.min(startHour, Math.floor(task.startMin / 60));
      endHour = Math.max(endHour, Math.ceil((task.startMin + task.durMin) / 60));
    }
    for (const item of day.actual) {
      startHour = Math.min(startHour, Math.floor(item.startMin / 60));
      endHour = Math.max(endHour, Math.ceil(item.endMin / 60));
    }
  }
  startHour = Math.max(0, startHour);
  endHour = Math.min(24, endHour);

  for (let minutes = startHour * 60; minutes < endHour * 60; minutes += rowMinutes()) {
    const row = document.createElement("div");
    row.className = "hour-row" + (minutes % 60 === 0 ? "" : minutes % 30 === 0 ? " half" : " quarter");
    row.innerHTML = `<div class="hour-label">${fmtTime(minutes)}</div>`;
    timeline.appendChild(row);
  }

  const layer = document.createElement("div");
  layer.className = "multi-blocks-layer";
  layer.style.height = `${(endHour - startHour) * pxPerHour()}px`;
  days.forEach((day, index) => {
    const column = document.createElement("div");
    column.className = "multi-day-column" + (day.key === todayKey() ? " today" : "");
    column.style.left = `${(index / count) * 100}%`;
    column.style.width = `${100 / count}%`;

    for (const task of day.tasks) {
      const block = document.createElement("div");
      block.className = "time-block multi-plan-block" + (task.aux ? " aux" : "") + (task.done ? " done" : "");
      block.style.top = `${((task.startMin - startHour * 60) / 60) * pxPerHour()}px`;
      block.style.height = `${Math.max(22, (task.durMin / 60) * pxPerHour() - 2)}px`;
      block.innerHTML = `<span class="block-title"></span><span class="block-time">${fmtTime(task.startMin)}</span><span class="block-actions"><button data-toggle="${task.id}" aria-label="${task.done ? "Mark not done" : "Mark done"}: ${escapeAttr(task.name)}">${task.done ? "â†©" : "âœ“"}</button><button data-remove="${task.id}" aria-label="Remove ${escapeAttr(task.name)}">âœ•</button></span>`;
      block.title = `${task.name} · ${fmtTime(task.startMin)} - ${fmtTime(task.startMin + task.durMin)}`;
      block.querySelector(".block-title").textContent = task.name;
      column.appendChild(block);
    }

    for (const item of day.actual) {
      const { entry } = item;
      const category = categoryById(entry.categoryId);
      const block = document.createElement("div");
      block.className = "time-block actual-block multi-actual-block" + (entry.end === null ? " running" : "") + (item.endMin - item.startMin < 35 ? " compact" : "");
      block.style.top = `${((item.startMin - startHour * 60) / 60) * pxPerHour()}px`;
      block.style.height = `${Math.max(22, ((item.endMin - item.startMin) / 60) * pxPerHour() - 2)}px`;
      applyCategoryColor(block, category);
      block.innerHTML = `<button type="button" class="block-main" data-edit-timeline-entry="${entry.id}"><span class="block-title"></span><span class="block-time">${fmtClock(item.start)}</span></button>`
        + (entry.end === null ? "" : `<button type="button" class="block-play" data-restart-entry="${entry.id}" title="Start this activity again now" aria-label="Start ${escapeAttr(entry.name)} again now">▶</button>`);
      block.querySelector(".block-title").textContent = entry.name;
      block.querySelector(".block-main").setAttribute("aria-label", `Edit tracked activity ${entry.name}`);
      block.title = `${entry.name} · ${fmtClock(item.start)} - ${entry.end === null ? "now" : fmtClock(item.end)}`;
      column.appendChild(block);
    }
    layer.appendChild(column);
  });
  timeline.appendChild(layer);

  const now = new Date();
  const nowMin = now.getHours() * 60 + now.getMinutes();
  if (days.some(day => day.key === todayKey()) && nowMin >= startHour * 60 && nowMin <= endHour * 60) {
    const line = document.createElement("div");
    line.className = "now-line";
    line.style.top = `${((nowMin - startHour * 60) / 60) * pxPerHour()}px`;
    line.innerHTML = `<span class="now-label">${fmtTime(nowMin)}</span>`;
    timeline.appendChild(line);
  }
}

function renderTimeline() {
  if (timelineView !== "day") {
    renderMultiDayTimeline();
    return;
  }
  renderNextUp();
  const timeline = document.getElementById("timeline");
  const empty = document.getElementById("tasks-empty");
  const dayDelta = daysBetween(todayKey(), viewDayKey);
  timeline.classList.remove("multi-day");
  const laneHead = document.querySelector(".timeline-lane-head");
  laneHead.classList.remove("multi-day-head");
  laneHead.removeAttribute("style");
  laneHead.innerHTML = "<span></span><strong>Plan</strong><strong>Actual</strong>";
  empty.textContent =
    dayDelta === 0 ? "Your day is still open. Add a plan or start tracking to build the timeline."
    : dayDelta < 0 ? "Nothing was planned or tracked on this day."
      : "Nothing planned here yet. Add a plan and get ahead of the day.";
  const tasks = dayTasks().slice().sort((a, b) => a.startMin - b.startMin);
  const dayStart = dayStartMs();
  const dayEnd = dayStartMs(addDays(viewDayKey, 1));
  const actual = entriesForDay().map(entry => {
    const start = Math.max(entry.start, dayStart);
    const end = Math.min(entry.end === null ? Date.now() : entry.end, dayEnd);
    return {
      entry,
      start,
      end,
      startMin: start === dayStart ? 0 : localMinuteOfDay(start),
      endMin: end === dayEnd ? 1440 : localMinuteOfDay(end),
    };
  }).filter(item => item.end > item.start).sort((a, b) => a.start - b.start);
  const hasTimeline = tasks.length > 0 || actual.length > 0;

  empty.classList.toggle("hidden", hasTimeline);
  timeline.classList.toggle("empty", !hasTimeline);
  document.querySelector(".timeline-lane-head")?.classList.toggle("hidden", !hasTimeline);
  timeline.innerHTML = "";
  if (!hasTimeline) return;

  // Expand the visible range when either a plan or real activity falls outside
  // the default day. Both lanes always share the same vertical time scale.
  let startHour = DAY_START_HOUR, endHour = DAY_END_HOUR;
  for (const t of tasks) {
    startHour = Math.min(startHour, Math.floor(t.startMin / 60));
    endHour = Math.max(endHour, Math.ceil((t.startMin + t.durMin) / 60));
  }
  for (const item of actual) {
    startHour = Math.min(startHour, Math.floor(item.startMin / 60));
    endHour = Math.max(endHour, Math.ceil(item.endMin / 60));
  }
  startHour = Math.max(0, startHour);
  endHour = Math.min(24, endHour);

  for (let m = startHour * 60; m < endHour * 60; m += rowMinutes()) {
    const row = document.createElement("div");
    row.className = "hour-row" + (m % 60 === 0 ? "" : m % 30 === 0 ? " half" : " quarter");
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
  layer.className = "blocks-layer plan-layer";
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
        <button data-toggle="${t.id}" title="${t.done ? "Mark not done" : "Mark done"}" aria-label="${t.done ? "Mark not done" : "Mark done"}: ${escapeAttr(t.name)}">${t.done ? "↩" : "✓"}</button>
        <button data-remove="${t.id}" title="Remove" aria-label="Remove ${escapeAttr(t.name)}">✕</button>
      </div>`;
    block.querySelector(".block-title").textContent = t.name + " ";
    layer.appendChild(block);
  }
  timeline.appendChild(layer);

  const actualLayer = document.createElement("div");
  actualLayer.className = "blocks-layer actual-layer";
  actualLayer.style.height = `${(endHour - startHour) * pxPerHour()}px`;
  for (const item of actual) {
    const { entry } = item;
    const top = ((item.startMin - startHour * 60) / 60) * pxPerHour();
    const height = Math.max(22, ((item.endMin - item.startMin) / 60) * pxPerHour() - 2);
    const category = categoryById(entry.categoryId);
    const block = document.createElement("div");
    block.className = "time-block actual-block" + (entry.end === null ? " running" : "") + (height < 38 ? " compact" : "");
    block.style.top = `${top}px`;
    block.style.height = `${height}px`;
    applyCategoryColor(block, category);
    block.innerHTML = `<button type="button" class="block-main" data-edit-timeline-entry="${entry.id}"><span class="block-title"></span><span class="block-time"></span></button>`
      + (entry.end === null ? "" : `<button type="button" class="block-play" data-restart-entry="${entry.id}" title="Start this activity again now">▶</button>`);
    const main = block.querySelector(".block-main");
    main.setAttribute("aria-label", `Edit tracked activity ${entry.name}, ${fmtClock(item.start)} to ${entry.end === null ? "now" : fmtClock(item.end)}`);
    block.querySelector(".block-play")?.setAttribute("aria-label", `Start ${entry.name} again now`);
    block.querySelector(".block-title").textContent = entry.name;
    block.querySelector(".block-time").textContent = `${fmtClock(item.start)} – ${entry.end === null ? "now" : fmtClock(item.end)}`;
    actualLayer.appendChild(block);
  }
  timeline.appendChild(actualLayer);

  // "you are here" line, like Google Calendar's red now-indicator (today only)
  const now = new Date();
  const nowMin = now.getHours() * 60 + now.getMinutes();
  if (viewingToday() && nowMin >= startHour * 60 && nowMin <= endHour * 60) {
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
  const nextDay = todayKey();
  if (nextDay !== renderedDayKey) {
    if (viewDayKey === renderedDayKey) viewDayKey = nextDay; // follow midnight only if the user was on today
    renderedDayKey = nextDay;
    reconcileHabits();
    renderHabits();
    renderTracker();
    renderDayHeading();
  }
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

/* ---------- Track tab: two-tap start (category → past activity) ---------- */
let selectedTrackCategoryId = null;

// Unique activity names previously tracked in a category, newest first.
function categoryActivityNames(categoryId, cap = 12) {
  const seen = new Set();
  const names = [];
  const ordered = [...state.entries].sort((a, b) => b.start - a.start);
  for (const entry of ordered) {
    if (entry.categoryId !== categoryId) continue;
    const key = entry.name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    names.push(entry.name);
    if (names.length >= cap) break;
  }
  return names;
}

function renderTrackHub() {
  const grid = document.getElementById("track-category-grid");
  const panel = document.getElementById("track-activity-panel");
  if (!grid || !panel) return;
  const categories = activeCategories();
  if (selectedTrackCategoryId && !categories.some(category => category.id === selectedTrackCategoryId)) {
    selectedTrackCategoryId = null; // selected category was archived or deleted
  }
  const selected = selectedTrackCategoryId ? categoryById(selectedTrackCategoryId) : null;
  grid.classList.toggle("hidden", !!selected);
  panel.classList.toggle("hidden", !selected);

  if (!selected) {
    grid.innerHTML = "";
    for (const category of categories) {
      const count = categoryActivityNames(category.id, 99).length;
      const tile = document.createElement("button");
      tile.type = "button";
      tile.className = "track-cat-tile";
      tile.dataset.trackCategory = category.id;
      applyCategoryColor(tile, category);
      tile.innerHTML = `<span class="label-dot"></span><span class="track-cat-name"></span><span class="track-cat-count"></span>`;
      tile.querySelector(".track-cat-name").textContent = category.name;
      tile.querySelector(".track-cat-count").textContent =
        count === 0 ? "nothing yet" : count === 1 ? "1 activity" : `${count} activities`;
      grid.appendChild(tile);
    }
    const add = document.createElement("button");
    add.type = "button";
    add.className = "track-cat-tile track-cat-new";
    add.dataset.newCategory = "1";
    add.textContent = "+ New category";
    grid.appendChild(add);
    return;
  }

  applyCategoryColor(panel, selected);
  document.getElementById("track-panel-name").textContent = selected.name;
  const running = runningEntry();
  const list = document.getElementById("track-activity-list");
  list.innerHTML = "";
  const names = categoryActivityNames(selected.id);
  for (const name of names) {
    const isRunning = running && running.categoryId === selected.id
      && running.name.toLowerCase() === name.toLowerCase();
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "chip track-activity-btn";
    btn.dataset.restartName = name;
    btn.dataset.restartCategory = selected.id;
    btn.disabled = !!isRunning;
    applyCategoryColor(btn, selected);
    btn.innerHTML = `<span class="label-dot"></span>`;
    btn.append((isRunning ? "● " : "▶ ") + name);
    list.appendChild(btn);
  }
  document.getElementById("track-activity-empty").classList.toggle("hidden", names.length > 0);
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

// Restart a past activity from its timeline block or history row: same name
// and category, starting now. Viewing another day jumps back to today so the
// freshly started activity is visible.
function restartEntry(id) {
  const entry = state.entries.find(e => e.id === id);
  if (!entry) return;
  startActivity(entry.name, entry.categoryId);
  if (!viewingToday()) {
    setViewDay(todayKey());
    showToast(`▶ Started "${entry.name}" — jumped back to today.`);
  }
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

function dayStartMs(key = viewDayKey) {
  return new Date(key + "T00:00:00").getTime();
}
// entries overlapping the given day (a running entry started yesterday still counts)
function entriesForDay(key = viewDayKey) {
  const start = dayStartMs(key);
  const end = dayStartMs(addDays(key, 1));
  return state.entries.filter(e => e.start < end && (e.end === null ? Date.now() : e.end) > start);
}
function entriesForCurrentView() {
  if (timelineView === "day") return entriesForDay();
  const start = dayStartMs(viewDayKey);
  const end = dayStartMs(addDays(viewDayKey, timelineDayCount()));
  return state.entries.filter(entry => entry.start < end && (entry.end === null ? Date.now() : entry.end) > start);
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
function localMinuteOfDay(ms) {
  const d = new Date(ms);
  return d.getHours() * 60 + d.getMinutes() + d.getSeconds() / 60;
}

function renderTracker() {
  const running = runningEntry();
  renderTrackHub();

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
    { name: "Focused work", categoryId: "work" },
    { name: "Family time", categoryId: "family" },
    { name: "Study session", categoryId: "studies" },
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

  // the viewed day's entries (newest first)
  const list = document.getElementById("entry-list");
  const shown = entriesForCurrentView().slice().sort((a, b) => b.start - a.start);
  document.getElementById("entries-empty").classList.toggle("hidden", shown.length > 0);
  list.innerHTML = "";
  for (const e of shown) {
    const isRunning = e.end === null;
    const dur = (isRunning ? Date.now() : e.end) - e.start;
    const category = categoryById(e.categoryId);
    const datePrefix = timelineView === "day" ? "" :
      new Date(e.start).toLocaleDateString(undefined, { weekday: "short" }) + " · ";
    const row = document.createElement("div");
    row.className = "entry-row";
    row.dataset.entryId = e.id;
    applyCategoryColor(row, category);
    row.innerHTML = `
      <span class="entry-label-dot"></span>
      <span class="entry-main">
        <span class="entry-name-line"><span class="entry-name"></span><button class="entry-edit-icon" data-edit-entry="${e.id}" aria-label="Edit activity" title="Edit activity">✎</button></span>
        <span class="entry-category"></span>
      </span>
      <span class="entry-timing"><span class="entry-time">${datePrefix}${fmtClock(e.start)} – ${isRunning ? "now" : fmtClock(e.end)}</span><span class="entry-dur">${fmtElapsed(dur)}</span></span>
      <span class="entry-actions">
        ${isRunning ? "" : `<button class="btn ghost entry-play" data-restart-entry="${e.id}" title="Start this activity again now" aria-label="Start ${escapeAttr(e.name)} again now">▶</button>
        <button class="btn ghost" data-del-entry="${e.id}" title="Delete entry" aria-label="Delete ${escapeAttr(e.name)}">✕</button>`}
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
  const dayEnd = dayStartMs(addDays(viewDayKey, timelineDayCount()));
  for (const e of shown) {
    // only count the portion that falls within the viewed day
    const dur = Math.max(0, Math.min(e.end === null ? Date.now() : e.end, dayEnd) - Math.max(e.start, dayStart));
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
      seg.dataset.summaryCategory = categoryId;
      seg.style.flex = String(totalMs / grand);
      seg.style.background = category.color;
      seg.title = `${category.name}: ${fmtElapsed(totalMs)}`;
      barEl.appendChild(seg);

      const item = document.createElement("span");
      item.className = "legend-item";
      item.dataset.summaryCategory = categoryId;
      applyCategoryColor(item, category);
      item.innerHTML = `<span class="label-dot"></span><span class="legend-copy"><span class="legend-name"></span><strong>${fmtElapsed(totalMs)}</strong></span><span class="legend-percent">${percent}%</span>`;
      item.querySelector(".legend-name").textContent = category.name;
      legend.appendChild(item);
    }
  }
  renderTimeline();
}

// Update only live numbers while tracking. Rebuilding the whole tracker every
// second detached buttons and form controls in the middle of user interactions.
function tickTracker() {
  const running = runningEntry();
  if (!running) return;
  const now = Date.now();
  document.getElementById("running-bar-elapsed").textContent = fmtElapsed(now - running.start);

  for (const row of document.querySelectorAll(".entry-row[data-entry-id]")) {
    if (row.dataset.entryId === running.id) {
      const duration = row.querySelector(".entry-dur");
      if (duration) duration.textContent = fmtElapsed(now - running.start);
      break;
    }
  }

  const totals = {};
  let grand = 0;
  const dayStart = dayStartMs();
  const dayEnd = dayStartMs(addDays(viewDayKey, timelineDayCount()));
  for (const entry of entriesForCurrentView()) {
    const duration = Math.max(0, Math.min(entry.end === null ? now : entry.end, dayEnd) - Math.max(entry.start, dayStart));
    totals[entry.categoryId] = (totals[entry.categoryId] || 0) + duration;
    grand += duration;
  }
  document.getElementById("summary-total").textContent = fmtElapsed(grand);
  for (const item of document.querySelectorAll(".legend-item[data-summary-category]")) {
    const total = totals[item.dataset.summaryCategory] || 0;
    const strong = item.querySelector("strong");
    const percent = item.querySelector(".legend-percent");
    if (strong) strong.textContent = fmtElapsed(total);
    if (percent) percent.textContent = grand ? `${Math.round((total / grand) * 100)}%` : "0%";
  }
  for (const segment of document.querySelectorAll(".summary-seg[data-summary-category]")) {
    const total = totals[segment.dataset.summaryCategory] || 0;
    segment.style.flex = grand ? String(total / grand) : "0";
    segment.title = `${categoryById(segment.dataset.summaryCategory).name}: ${fmtElapsed(total)}`;
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
setInterval(tickTracker, 1000);

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
    document.getElementById("wizard-title").textContent =
      viewingToday() ? "New task" : `New task for ${dayLabel(viewDayKey)}`;
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

const tabButtons = [...document.querySelectorAll(".tab-btn")];
function activateTab(btn, moveFocus = false) {
  for (const candidate of tabButtons) {
    const selected = candidate === btn;
    candidate.classList.toggle("active", selected);
    candidate.setAttribute("aria-selected", String(selected));
    candidate.tabIndex = selected ? 0 : -1;
  }
  document.querySelectorAll(".tab-panel").forEach(panel =>
    panel.classList.toggle("active", panel.id === "tab-" + btn.dataset.tab));
  if (moveFocus) btn.focus();
  if (btn.dataset.tab === "planner") {
    renderTimeline(); // fresh now-line on open
    centerTimelineOnNow();
  }
}
for (const btn of tabButtons) {
  btn.addEventListener("click", () => activateTab(btn));
  btn.addEventListener("keydown", event => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const index = tabButtons.indexOf(btn);
    const next = event.key === "Home" ? tabButtons[0]
      : event.key === "End" ? tabButtons.at(-1)
      : tabButtons[(index + (event.key === "ArrowRight" ? 1 : -1) + tabButtons.length) % tabButtons.length];
    activateTab(next, true);
  });
}

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
  const restart = e.target.closest("[data-restart-entry]");
  const tracked = e.target.closest("[data-edit-timeline-entry]");
  if (toggle) toggleTaskDone(toggle.dataset.toggle);
  if (remove) deleteTask(remove.dataset.remove);
  if (restart) restartEntry(restart.dataset.restartEntry);
  else if (tracked) openActivityEditor(tracked.dataset.editTimelineEntry);
});

function setZoom(z) {
  timelineZoom = Math.min(2, Math.max(0, z));
  localStorage.setItem("opb-zoom", String(timelineZoom));
  document.getElementById("zoom-in").disabled = timelineZoom === 2;
  document.getElementById("zoom-out").disabled = timelineZoom === 0;
  document.getElementById("zoom-label").textContent = ["1 hour", "30 min", "15 min"][timelineZoom];
  renderTimeline();
  centerTimelineOnNow();
}
document.getElementById("zoom-in").addEventListener("click", () => setZoom(timelineZoom + 1));
document.getElementById("zoom-out").addEventListener("click", () => setZoom(timelineZoom - 1));
document.querySelector(".timeline-lane-head").addEventListener("click", event => {
  const button = event.target.closest("[data-open-day]");
  if (button) setTimelineView("day", button.dataset.openDay);
});

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

enhanceCategorySelect(document.getElementById("activity-edit-category"));
enhanceCategorySelect(document.getElementById("category-delete-target"));

document.getElementById("track-category-grid").addEventListener("click", e => {
  if (e.target.closest("[data-new-category]")) {
    renderCategoryManager();
    document.getElementById("categories-overlay").classList.remove("hidden");
    return;
  }
  const tile = e.target.closest("[data-track-category]");
  if (!tile) return;
  selectedTrackCategoryId = tile.dataset.trackCategory;
  renderTrackHub();
});
document.getElementById("track-panel-back").addEventListener("click", () => {
  selectedTrackCategoryId = null;
  renderTrackHub();
});
document.getElementById("track-activity-list").addEventListener("click", e => {
  const btn = e.target.closest("[data-restart-name]");
  if (btn) startActivity(btn.dataset.restartName, btn.dataset.restartCategory);
});
document.getElementById("track-new-form").addEventListener("submit", e => {
  e.preventDefault();
  const input = document.getElementById("track-new-name");
  const name = input.value.trim();
  if (!name || !selectedTrackCategoryId) return;
  startActivity(name, selectedTrackCategoryId);
  input.value = "";
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
  const restart = e.target.closest("[data-restart-entry]");
  if (edit) openActivityEditor(edit.dataset.editEntry);
  if (del) deleteEntry(del.dataset.delEntry);
  if (restart) restartEntry(restart.dataset.restartEntry);
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

function openActivitySwitcher() {
  activateTab(document.getElementById("tab-button-track"));

  const card = document.querySelector(".track-hub-card");
  card.scrollIntoView({ behavior: "smooth", block: "start" });

  // Switching tabs alone is easy to miss when Switch is pressed elsewhere.
  // Replay a short visual cue so the destination is obvious every time.
  card.classList.remove("switch-target");
  void card.offsetWidth;
  card.classList.add("switch-target");
  window.setTimeout(() => card.classList.remove("switch-target"), 1200);
}

document.getElementById("running-bar-switch").addEventListener("click", openActivitySwitcher);
document.getElementById("running-bar-edit").addEventListener("click", () => {
  const running = runningEntry();
  if (running) openActivityEditor(running.id);
});

/* ---------- day navigation (Day tab) ---------- */
// "today" / "tomorrow" / "yesterday", otherwise the weekday-and-date
function dayLabel(key) {
  const delta = daysBetween(todayKey(), key);
  if (delta === 0) return "today";
  if (delta === 1) return "tomorrow";
  if (delta === -1) return "yesterday";
  return new Date(key + "T00:00:00").toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });
}

function renderRangeHeading() {
  const count = timelineDayCount();
  const endKey = addDays(viewDayKey, count - 1);
  const start = new Date(viewDayKey + "T00:00:00");
  const end = new Date(endKey + "T00:00:00");
  const containsToday = daysBetween(viewDayKey, todayKey()) >= 0 && daysBetween(todayKey(), endKey) >= 0;
  const startText = start.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  const endText = end.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
  const rangeLabel = timelineView === "week" ? "Week" : "Three-day";

  document.getElementById("today-date").textContent = `${startText} - ${endText}`;
  document.getElementById("day-title-word").textContent = timelineView === "week" ? "Your week" : "Your next days";
  document.getElementById("timeline-title").textContent = timelineView === "week" ? "Week at a glance" : "Three-day timeline";
  const atDefaultRange = timelineView === "week" ? containsToday : viewDayKey === addDays(todayKey(), -1);
  document.getElementById("back-to-today").classList.toggle("hidden", atDefaultRange);
  document.getElementById("open-task-wizard").classList.add("hidden");
  document.getElementById("balance-kicker").textContent = `${rangeLabel} balance`;
  document.getElementById("summary-empty").textContent = `Nothing tracked in this ${timelineView === "week" ? "week" : "range"}.`;
  document.getElementById("day-prev").setAttribute("aria-label", `Previous ${timelineView === "week" ? "week" : "three days"}`);
  document.getElementById("day-next").setAttribute("aria-label", `Next ${timelineView === "week" ? "week" : "three days"}`);
}

function renderDayHeading() {
  if (timelineView !== "day") {
    renderRangeHeading();
    return;
  }
  document.getElementById("day-prev").setAttribute("aria-label", "Previous day");
  document.getElementById("day-next").setAttribute("aria-label", "Next day");
  document.getElementById("open-task-wizard").classList.remove("hidden");
  const delta = daysBetween(todayKey(), viewDayKey);
  const d = new Date(viewDayKey + "T00:00:00");
  const dateText = d.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });
  document.getElementById("today-date").textContent =
    delta === 0 ? dateText : delta === 1 ? `Tomorrow · ${dateText}` : delta === -1 ? `Yesterday · ${dateText}` : dateText;
  document.getElementById("day-title-word").textContent =
    delta === 0 ? "Your day" : delta < 0 ? "Looking back" : "Planning ahead";
  document.getElementById("back-to-today").classList.toggle("hidden", delta === 0);
  const cap = s => s.charAt(0).toUpperCase() + s.slice(1);
  document.getElementById("timeline-title").textContent =
    delta === 0 ? "Today's timeline" : `${cap(dayLabel(viewDayKey))} — timeline`;
  document.getElementById("balance-kicker").textContent =
    delta === 0 ? "Today's balance" : `${cap(dayLabel(viewDayKey))} — balance`;
  document.getElementById("summary-empty").textContent =
    delta === 0 ? "Nothing tracked yet today. Start an activity and find out where your day goes."
      : "Nothing tracked on this day.";
}

function weekStart(key) {
  const date = new Date(key + "T00:00:00");
  return addDays(key, -((date.getDay() + 6) % 7));
}

function setTimelineView(view, key = viewDayKey) {
  timelineView = view;
  if (view === "week") key = weekStart(key);
  if (view === "three") key = addDays(todayKey(), -1);
  localStorage.setItem("opb-timeline-view", view);
  const timelineCard = document.querySelector(".timeline-card");
  timelineCard.classList.toggle("range-expanded", view !== "day");
  timelineCard.dataset.rangeView = view;
  for (const button of document.querySelectorAll("[data-timeline-view]")) {
    const active = button.dataset.timelineView === view;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
  }
  setViewDay(key);
}

function setViewDay(key) {
  viewDayKey = key;
  renderDayHeading();
  renderTracker(); // re-renders entries, summary, and the timeline
  if (viewingToday()) centerTimelineOnNow();
  else document.getElementById("timeline").scrollTop = 0;
}

function timelineNavigationStep() { return timelineView === "week" ? 7 : 1; }
document.getElementById("day-prev").addEventListener("click", () => setViewDay(addDays(viewDayKey, -timelineNavigationStep())));
document.getElementById("day-next").addEventListener("click", () => setViewDay(addDays(viewDayKey, timelineNavigationStep())));
document.getElementById("back-to-today").addEventListener("click", () => setViewDay(
  timelineView === "week" ? weekStart(todayKey()) : timelineView === "three" ? addDays(todayKey(), -1) : todayKey()
));
for (const button of document.querySelectorAll("[data-timeline-view]")) {
  button.addEventListener("click", () => {
    if (button.dataset.timelineView !== timelineView) setTimelineView(button.dataset.timelineView);
  });
}

setTimelineView(timelineView);

/* ---------- settings ---------- */

document.getElementById("settings-btn").addEventListener("click", () =>
  document.getElementById("settings-overlay").classList.remove("hidden"));
document.getElementById("settings-close").addEventListener("click", () =>
  document.getElementById("settings-overlay").classList.add("hidden"));
document.getElementById("settings-overlay").addEventListener("click", e => {
  if (e.target.id === "settings-overlay") e.target.classList.add("hidden");
});

document.getElementById("export-data-btn").addEventListener("click", () => {
  const backup = JSON.stringify({
    app: "Habitloom",
    version: 1,
    exportedAt: new Date().toISOString(),
    state,
  }, null, 2);
  const url = URL.createObjectURL(new Blob([backup], { type: "application/json" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = `habitloom-backup-${todayKey()}.json`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
  showToast("Backup exported.");
});

document.getElementById("import-data-btn").addEventListener("click", () =>
  document.getElementById("import-data-file").click());
document.getElementById("import-data-file").addEventListener("change", async event => {
  const input = event.currentTarget;
  const file = input.files?.[0];
  input.value = "";
  if (!file) return;
  try {
    const parsed = JSON.parse(await file.text());
    const imported = parsed?.state || parsed;
    const valid = imported && typeof imported === "object"
      && Array.isArray(imported.habits)
      && Array.isArray(imported.entries || [])
      && imported.tasksByDate && typeof imported.tasksByDate === "object"
      && Object.values(imported.tasksByDate).every(Array.isArray);
    if (!valid) throw new Error("This file is not a valid Habitloom backup.");
    if (!confirm("Importing this backup will replace the data currently in Habitloom on this account. Continue?")) return;
    const restored = JSON.parse(JSON.stringify(imported));
    restored.resetAt = Date.now(); // the restored snapshot must win the next cloud merge
    adoptExternalState(restored, true);
    document.getElementById("settings-overlay").classList.add("hidden");
    showToast("Backup restored and queued for sync.");
  } catch (error) {
    alert(error.message || "Habitloom could not read that backup.");
  }
});

// Escape closes the top-most dialog, matching normal desktop and mobile-web expectations.
document.addEventListener("keydown", event => {
  if (event.key !== "Escape") return;
  const overlays = [...document.querySelectorAll(".overlay:not(.hidden)")];
  const overlay = overlays.at(-1);
  if (!overlay) return;
  const closeButtons = {
    "activity-edit-overlay": "activity-edit-close",
    "category-delete-overlay": "category-delete-cancel",
    "categories-overlay": "categories-close",
    "settings-overlay": "settings-close",
    "why-overlay": "why-close",
    "wizard-overlay": "wizard-close",
  };
  document.getElementById(closeButtons[overlay.id])?.click();
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
