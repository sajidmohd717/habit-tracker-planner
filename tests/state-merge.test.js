const assert = require("node:assert/strict");
const { emptyState, stableStringify, mergeStates } = require("../state-merge.js");

function test(name, run) {
  try {
    run();
    console.log(`✓ ${name}`);
  } catch (error) {
    console.error(`✗ ${name}`);
    throw error;
  }
}

test("simultaneous switches converge to one running entry", () => {
  const deviceA = emptyState(), deviceB = emptyState();
  deviceA.entries = [
    { id: "old", name: "Work", label: "normal", start: 100, end: 200, updatedAt: 200 },
    { id: "a", name: "Lunch", label: "necessary", start: 200, end: null, updatedAt: 200 },
  ];
  deviceB.entries = [
    { id: "old", name: "Work", label: "normal", start: 100, end: 250, updatedAt: 250 },
    { id: "b", name: "Meeting", label: "normal", start: 250, end: null, updatedAt: 250 },
  ];

  const merged = mergeStates(deviceA, deviceB);
  assert.equal(merged.entries.filter(entry => entry.end === null).length, 1);
  assert.equal(merged.entries.find(entry => entry.end === null).name, "Meeting");
  assert.ok(merged.entries.every((entry, index, list) =>
    index === list.length - 1 || entry.end === null || entry.end <= list[index + 1].start));
  assert.equal(stableStringify(merged), stableStringify(mergeStates(deviceB, deviceA)));
});

test("three-device switches converge regardless of merge grouping", () => {
  const switched = (id, start) => {
    const state = emptyState();
    state.entries = [
      { id: "old", start: 100, end: start, updatedAt: start },
      { id, start, end: null, updatedAt: start },
    ];
    return state;
  };
  const a = switched("a", 200), b = switched("b", 250), c = switched("c", 225);
  const results = [
    mergeStates(mergeStates(a, b), c),
    mergeStates(mergeStates(a, c), b),
    mergeStates(a, mergeStates(b, c)),
    mergeStates(c, mergeStates(b, a)),
  ].map(stableStringify);
  assert.equal(new Set(results).size, 1);
});

test("a deletion is not resurrected by a stale device", () => {
  const stale = emptyState(), removed = emptyState();
  stale.entries = [{ id: "gone", name: "Old", label: "normal", start: 1, end: 2, updatedAt: 100 }];
  removed.deleted.entries.gone = 200;
  assert.equal(mergeStates(stale, removed).entries.length, 0);
  assert.equal(mergeStates(removed, stale).entries.length, 0);
});

test("an ended entry beats a stale running copy despite clock skew", () => {
  const aheadClock = emptyState(), actualSwitch = emptyState();
  aheadClock.entries = [{ id: "same", start: 1, end: null, updatedAt: 5000 }];
  actualSwitch.entries = [{ id: "same", start: 1, end: 100, updatedAt: 200 }];
  assert.equal(mergeStates(aheadClock, actualSwitch).entries[0].end, 100);
  assert.equal(mergeStates(actualSwitch, aheadClock).entries[0].end, 100);
});

test("the newest task state can be checked or unchecked", () => {
  const old = emptyState(), fresh = emptyState();
  old.tasksByDate.today = [{ id: "task", startMin: 10, done: true, updatedAt: 100 }];
  fresh.tasksByDate.today = [{ id: "task", startMin: 10, done: false, updatedAt: 200 }];
  assert.equal(mergeStates(old, fresh).tasksByDate.today[0].done, false);
  assert.equal(mergeStates(fresh, old).tasksByDate.today[0].done, false);
});

test("category renames, colors, and archive state use the latest revision", () => {
  const old = emptyState(), fresh = emptyState();
  old.categories = [{ id: "work", name: "Work", color: "#112233", archived: false, updatedAt: 100 }];
  fresh.categories = [{ id: "work", name: "Deep work", color: "#445566", archived: true, updatedAt: 200 }];
  const category = mergeStates(old, fresh).categories[0];
  assert.deepEqual(
    { name: category.name, color: category.color, archived: category.archived },
    { name: "Deep work", color: "#445566", archived: true },
  );
  assert.equal(stableStringify(mergeStates(old, fresh)), stableStringify(mergeStates(fresh, old)));
});

test("legacy records without revision metadata remain readable", () => {
  const legacy = { habits: [], tasksByDate: {}, entries: [{ id: "legacy", start: 1, end: 2 }], resetAt: 0 };
  assert.equal(mergeStates(legacy, emptyState()).entries.length, 1);
});

test("the newest account reset wins wholesale", () => {
  const old = emptyState(), reset = emptyState();
  old.entries = [{ id: "old", start: 1, end: null, updatedAt: 1 }];
  reset.resetAt = 300;
  assert.equal(mergeStates(old, reset).entries.length, 0);
  assert.equal(mergeStates(reset, old).resetAt, 300);
});
