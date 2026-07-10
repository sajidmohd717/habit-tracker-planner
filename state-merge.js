(function exposeStateMerge(root) {
  function emptyState() {
    return {
      habits: [], tasksByDate: {}, entries: [], categories: [], resetAt: 0,
      deleted: { habits: {}, tasks: {}, entries: {}, categories: {} },
    };
  }

  function stableStringify(value) {
    if (value === null || typeof value !== "object") return JSON.stringify(value);
    if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
  }

  function newerCopy(a, b) {
    if (!a) return { ...b };
    if (!b) return { ...a };
    const at = a.updatedAt || 0, bt = b.updatedAt || 0;
    const winner = at !== bt ? (at > bt ? a : b)
      : (stableStringify(a) >= stableStringify(b) ? a : b);
    return { ...winner };
  }

  function mergedEntry(a, b) {
    if (!a) return { ...b };
    if (!b) return { ...a };
    // Ending an entry is monotonic. It must beat a stale running copy even if
    // the two devices' clocks disagree about updatedAt.
    if (a.end === null && b.end !== null) return { ...b };
    if (b.end === null && a.end !== null) return { ...a };
    if (a.end !== null && b.end !== null && a.end !== b.end) {
      return { ...(a.end < b.end ? a : b), end: Math.min(a.end, b.end) };
    }
    return newerCopy(a, b);
  }

  function mergedDeletionMaps(a = {}, b = {}) {
    const result = {};
    for (const id of new Set([...Object.keys(a), ...Object.keys(b)])) {
      result[id] = Math.max(a[id] || 0, b[id] || 0);
    }
    return result;
  }

  function normalizeRunning(entries) {
    const running = entries.filter(entry => entry.end === null)
      .sort((a, b) => a.start - b.start || a.id.localeCompare(b.id));
    for (let i = 0; i < running.length - 1; i++) {
      running[i].end = Math.max(running[i].start, running[i + 1].start);
    }
  }

  function mergeStates(a = emptyState(), b = emptyState()) {
    const ra = a.resetAt || 0, rb = b.resetAt || 0;
    if (ra !== rb) {
      const winner = ra > rb ? a : b;
      return {
        ...emptyState(), ...winner,
        habits: (winner.habits || []).map(h => ({ ...h, checkins: [...(h.checkins || [])] })),
        categories: (winner.categories || []).map(category => ({ ...category })),
        tasksByDate: Object.fromEntries(Object.entries(winner.tasksByDate || {}).map(([day, tasks]) => [day, tasks.map(t => ({ ...t }))])),
        entries: (winner.entries || []).map(e => ({ ...e })),
        deleted: {
          habits: { ...(winner.deleted?.habits || {}) },
          tasks: { ...(winner.deleted?.tasks || {}) },
          entries: { ...(winner.deleted?.entries || {}) },
          categories: { ...(winner.deleted?.categories || {}) },
        },
      };
    }

    const deleted = {
      habits: mergedDeletionMaps(a.deleted?.habits, b.deleted?.habits),
      tasks: mergedDeletionMaps(a.deleted?.tasks, b.deleted?.tasks),
      entries: mergedDeletionMaps(a.deleted?.entries, b.deleted?.entries),
      categories: mergedDeletionMaps(a.deleted?.categories, b.deleted?.categories),
    };
    const result = { ...emptyState(), resetAt: ra, deleted };

    const habits = new Map();
    for (const h of [...(a.habits || []), ...(b.habits || [])]) {
      const previous = habits.get(h.id);
      if (!previous) habits.set(h.id, { ...h, checkins: [...(h.checkins || [])] });
      else {
        const merged = newerCopy(previous, h);
        merged.checkins = [...new Set([...(previous.checkins || []), ...(h.checkins || [])])].sort();
        merged.bestStreak = Math.max(previous.bestStreak || 0, h.bestStreak || 0);
        habits.set(h.id, merged);
      }
    }
    result.habits = [...habits.values()]
      .filter(h => !deleted.habits[h.id])
      .sort((x, y) => (x.createdAt || "").localeCompare(y.createdAt || "") || x.id.localeCompare(y.id));

    const categories = new Map();
    for (const category of [...(a.categories || []), ...(b.categories || [])]) {
      categories.set(category.id, newerCopy(categories.get(category.id), category));
    }
    result.categories = [...categories.values()]
      .filter(category => !deleted.categories[category.id])
      .sort((x, y) => (x.createdAt || 0) - (y.createdAt || 0) || x.id.localeCompare(y.id));

    const entries = new Map();
    for (const entry of [...(a.entries || []), ...(b.entries || [])]) {
      entries.set(entry.id, mergedEntry(entries.get(entry.id), entry));
    }
    result.entries = [...entries.values()]
      .filter(entry => !deleted.entries[entry.id])
      .sort((x, y) => x.start - y.start || x.id.localeCompare(y.id));
    normalizeRunning(result.entries);
    for (let i = 0; i < result.entries.length - 1; i++) {
      const current = result.entries[i], next = result.entries[i + 1];
      if (current.end !== null && current.end > next.start) current.end = Math.max(current.start, next.start);
    }

    for (const day of new Set([...Object.keys(a.tasksByDate || {}), ...Object.keys(b.tasksByDate || {})])) {
      const tasks = new Map();
      for (const task of [...((a.tasksByDate || {})[day] || []), ...((b.tasksByDate || {})[day] || [])]) {
        tasks.set(task.id, newerCopy(tasks.get(task.id), task));
      }
      const kept = [...tasks.values()]
        .filter(task => !deleted.tasks[task.id])
        .sort((x, y) => x.startMin - y.startMin || x.id.localeCompare(y.id));
      if (kept.length) result.tasksByDate[day] = kept;
    }
    return result;
  }

  root.__emptyState = emptyState;
  root.__stableStringify = stableStringify;
  root.__mergeStates = mergeStates;
  if (typeof module !== "undefined" && module.exports) {
    module.exports = { emptyState, stableStringify, mergeStates };
  }
})(typeof window !== "undefined" ? window : globalThis);
