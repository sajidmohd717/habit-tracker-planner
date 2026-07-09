/* ============ 1% Better — Habit Tracker & Planner ============ */

const STORAGE_KEY = "one-percent-better";
const MAX_FREEZES = 2;
const FREEZE_EVERY = 7; // earn a freeze every 7-day streak milestone
const DAY_START_HOUR = 6;  // timeline shows 6:00 – 23:00
const DAY_END_HOUR = 23;
const PX_PER_HOUR = 56;

let state = load();

function load() {
  let s = null;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) s = JSON.parse(raw);
  } catch (e) { /* corrupted storage — start fresh */ }
  if (!s) s = { habits: [], tasksByDate: {} };
  if (!s.entries) s.entries = []; // time-tracker entries (migration for older saves)
  return s;
}
function save() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

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
  for (const h of state.habits) {
    if (!h.lastCheckin) continue; // never checked in — nothing to break yet
    const gap = daysBetween(h.lastCheckin, today);
    const missed = gap - 1; // days with no check-in between last check-in and today
    if (missed <= 0) continue;
    if (missed <= h.freezes) {
      h.freezes -= missed;
      // pretend the streak carried through the missed days
      h.lastCheckin = today === h.lastCheckin ? h.lastCheckin : addDays(h.lastCheckin, missed);
      messages.push(`🧊 Used ${missed} streak freeze${missed > 1 ? "s" : ""} to protect "${h.name}" — your ${h.streak}-day streak is safe!`);
    } else {
      messages.push(`💔 Streak for "${h.name}" reset (missed ${missed} day${missed > 1 ? "s" : ""}). Best streak stays at ${Math.max(h.bestStreak, h.streak)} days — start again today!`);
      h.bestStreak = Math.max(h.bestStreak, h.streak);
      h.streak = 0;
      h.freezes = 0;
      h.lastFreezeAward = 0;
      h.lastCheckin = null;
    }
  }
  save();
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

function addHabit(name) {
  state.habits.push({
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    name,
    createdAt: todayKey(),
    streak: 0,
    bestStreak: 0,
    freezes: 0,
    lastFreezeAward: 0,
    lastCheckin: null,
  });
  save();
  renderHabits();
}

function checkinHabit(id) {
  const h = state.habits.find(x => x.id === id);
  const today = todayKey();
  if (!h || h.lastCheckin === today) return;
  h.streak += 1;
  h.bestStreak = Math.max(h.bestStreak, h.streak);
  h.lastCheckin = today;
  // earn a freeze at each 7-day milestone (max banked)
  if (h.streak > 0 && h.streak % FREEZE_EVERY === 0 && h.lastFreezeAward !== h.streak) {
    if (h.freezes < MAX_FREEZES) h.freezes += 1;
    h.lastFreezeAward = h.streak;
  }
  save();
  renderHabits();
}

function deleteHabit(id) {
  const h = state.habits.find(x => x.id === id);
  if (!h) return;
  if (!confirm(`Delete habit "${h.name}"? Your streak history for it will be lost.`)) return;
  state.habits = state.habits.filter(x => x.id !== id);
  save();
  renderHabits();
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
    card.innerHTML = `
      <div class="habit-info">
        <div class="habit-name"></div>
        <div class="habit-meta">
          <span class="streak-flame">🔥 ${h.streak} day streak</span>
          <span>🏆 Best: ${h.bestStreak}</span>
          <span class="freeze-badge">🧊 ${h.freezes} freeze${h.freezes === 1 ? "" : "s"}</span>
        </div>
      </div>
      <div class="habit-actions">
        ${doneToday
          ? `<span class="done-today">✓ Done today</span>`
          : `<button class="btn success" data-checkin="${h.id}">Continue streak</button>`}
        <button class="btn ghost" data-delete="${h.id}" title="Delete habit">🗑</button>
      </div>`;
    card.querySelector(".habit-name").textContent = h.name;
    list.appendChild(card);
  }

  // stacking nudge: every habit has a 7+ day streak
  const nudge = document.getElementById("stack-nudge");
  const ready = state.habits.length > 0 && state.habits.every(h => h.streak >= FREEZE_EVERY);
  nudge.classList.toggle("hidden", !ready);
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
  const gid = Date.now().toString(36);
  if (before) tasks.push({ id: gid + "-b", name: before.label, startMin: startMin - before.min, durMin: before.min, aux: true, done: false });
  tasks.push({ id: gid + "-m", name, startMin, durMin, aux: false, done: false });
  if (after) tasks.push({ id: gid + "-a", name: after.label, startMin: startMin + durMin, durMin: after.min, aux: true, done: false });
  save();
  renderTimeline();
}

function toggleTaskDone(id) {
  const t = todaysTasks().find(x => x.id === id);
  if (t) { t.done = !t.done; save(); renderTimeline(); }
}
function deleteTask(id) {
  const key = todayKey();
  state.tasksByDate[key] = todaysTasks().filter(x => x.id !== id);
  save();
  renderTimeline();
}

function renderTimeline() {
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

  for (let h = startHour; h < endHour; h++) {
    const row = document.createElement("div");
    row.className = "hour-row";
    row.innerHTML = `<div class="hour-label">${fmtTime(h * 60)}</div>`;
    timeline.appendChild(row);
  }

  const layer = document.createElement("div");
  layer.className = "blocks-layer";
  for (const t of tasks) {
    const top = ((t.startMin - startHour * 60) / 60) * PX_PER_HOUR;
    const height = Math.max(22, (t.durMin / 60) * PX_PER_HOUR - 2);
    const block = document.createElement("div");
    block.className = "time-block" + (t.aux ? " aux" : "") + (t.done ? " done" : "");
    block.style.top = `${top}px`;
    block.style.height = `${height}px`;
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
}

/* ============================================================
   TIME TRACKER
   ============================================================ */

const LABELS = ["necessary", "normal", "unnecessary", "bad"];
const LABEL_TITLES = { necessary: "Necessary", normal: "Normal", unnecessary: "Unnecessary", bad: "Bad" };

// entry: { id, name, label, start (ms), end (ms|null) }
function runningEntry() {
  return state.entries.find(e => e.end === null) || null;
}

function startActivity(name, label) {
  stopRunning(); // one timer at a time — starting a new one stops the old
  state.entries.push({
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    name, label,
    start: Date.now(),
    end: null,
  });
  save();
  renderTracker();
}

function stopRunning() {
  const r = runningEntry();
  if (!r) return;
  r.end = Date.now();
  if (r.end - r.start < 1000) r.end = r.start + 1000; // keep at least 1s
  save();
  renderTracker();
}

function deleteEntry(id) {
  state.entries = state.entries.filter(e => e.id !== id);
  save();
  renderTracker();
}

function entriesToday() {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  return state.entries.filter(e => e.start >= start.getTime());
}

function fmtElapsed(ms) {
  const s = Math.floor(ms / 1000);
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

  // persistent bar (visible on every tab)
  const bar = document.getElementById("running-bar");
  bar.classList.toggle("hidden", !running);
  if (running) {
    document.getElementById("running-bar-name").textContent = running.name;
    document.getElementById("running-bar-elapsed").textContent = fmtElapsed(Date.now() - running.start);
  }

  // recent chips: latest unique name+label combos, running one excluded
  const chipsBox = document.getElementById("recent-chips");
  chipsBox.innerHTML = "";
  const seen = new Set();
  const recents = [];
  for (let i = state.entries.length - 1; i >= 0 && recents.length < 6; i--) {
    const e = state.entries[i];
    const key = e.name.toLowerCase() + "|" + e.label;
    if (seen.has(key)) continue;
    seen.add(key);
    if (running && running.name.toLowerCase() === e.name.toLowerCase() && running.label === e.label) continue;
    recents.push(e);
  }
  for (const e of recents) {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = `chip label-${e.label}`;
    chip.dataset.restartName = e.name;
    chip.dataset.restartLabel = e.label;
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
    const row = document.createElement("div");
    row.className = "entry-row";
    row.innerHTML = `
      <span class="entry-label-dot label-${e.label}" title="${LABEL_TITLES[e.label]}"></span>
      <span class="entry-name"></span>
      <span class="entry-time">${fmtClock(e.start)} – ${isRunning ? "now" : fmtClock(e.end)}</span>
      <span class="entry-dur">${fmtElapsed(dur)}</span>
      ${isRunning
        ? `<button class="btn stop-btn" data-stop>■ Stop</button>`
        : `<button class="btn ghost" data-del-entry="${e.id}" title="Delete entry">✕</button>`}`;
    const nameEl = row.querySelector(".entry-name");
    nameEl.textContent = e.name + " ";
    if (isRunning) nameEl.innerHTML += `<span class="entry-running">● tracking</span>`;
    list.appendChild(row);
  }

  // summary: total per label
  const totals = {};
  let grand = 0;
  for (const e of today) {
    const dur = (e.end === null ? Date.now() : e.end) - e.start;
    totals[e.label] = (totals[e.label] || 0) + dur;
    grand += dur;
  }
  const barEl = document.getElementById("summary-bar");
  const legend = document.getElementById("summary-legend");
  document.getElementById("summary-empty").classList.toggle("hidden", grand > 0);
  barEl.classList.toggle("hidden", grand === 0);
  barEl.innerHTML = "";
  legend.innerHTML = "";
  if (grand > 0) {
    for (const label of LABELS) {
      if (!totals[label]) continue;
      const seg = document.createElement("div");
      seg.className = `summary-seg label-${label}`;
      seg.style.flex = String(totals[label] / grand);
      seg.title = `${LABEL_TITLES[label]}: ${fmtElapsed(totals[label])}`;
      barEl.appendChild(seg);
      const item = document.createElement("span");
      item.className = `legend-item label-${label}`;
      item.innerHTML = `<span class="label-dot"></span>${LABEL_TITLES[label]}: <strong>${fmtElapsed(totals[label])}</strong> (${Math.round((totals[label] / grand) * 100)}%)`;
      legend.appendChild(item);
    }
    const total = document.createElement("span");
    total.className = "legend-item";
    total.innerHTML = `Total tracked: <strong>${fmtElapsed(grand)}</strong>`;
    legend.appendChild(total);
  }
}

// live tick while a timer runs (updates bar, entry durations, summary)
setInterval(() => { if (runningEntry()) renderTracker(); }, 1000);

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
  }));

document.getElementById("habit-form").addEventListener("submit", e => {
  e.preventDefault();
  const input = document.getElementById("habit-name");
  const name = input.value.trim();
  if (!name) return;
  addHabit(name);
  input.value = "";
});

document.getElementById("habit-list").addEventListener("click", e => {
  const checkin = e.target.closest("[data-checkin]");
  const del = e.target.closest("[data-delete]");
  if (checkin) checkinHabit(checkin.dataset.checkin);
  if (del) deleteHabit(del.dataset.delete);
});

document.getElementById("timeline").addEventListener("click", e => {
  const toggle = e.target.closest("[data-toggle]");
  const remove = e.target.closest("[data-remove]");
  if (toggle) toggleTaskDone(toggle.dataset.toggle);
  if (remove) deleteTask(remove.dataset.remove);
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

document.getElementById("track-form").addEventListener("submit", e => {
  e.preventDefault();
  const name = document.getElementById("track-name").value.trim();
  if (!name) return;
  startActivity(name, document.getElementById("track-label").value);
  document.getElementById("track-name").value = "";
});

document.getElementById("recent-chips").addEventListener("click", e => {
  const chip = e.target.closest("[data-restart-name]");
  if (chip) startActivity(chip.dataset.restartName, chip.dataset.restartLabel);
});

document.getElementById("entry-list").addEventListener("click", e => {
  if (e.target.closest("[data-stop]")) stopRunning();
  const del = e.target.closest("[data-del-entry]");
  if (del) deleteEntry(del.dataset.delEntry);
});

document.getElementById("running-bar-stop").addEventListener("click", stopRunning);

document.getElementById("today-date").textContent =
  new Date().toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });

/* ---------- init ---------- */
reconcileHabits();
renderHabits();
renderTimeline();
renderTracker();
