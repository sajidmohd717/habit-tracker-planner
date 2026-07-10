const assert = require("node:assert/strict");
const { defaultCategories, ensureCategoryState } = require("../category-model.js");

const defaults = defaultCategories();
assert.deepEqual(defaults.map(category => category.name), [
  "Work", "Family", "Studies", "Personal", "Entertainment", "Time wasters",
]);

const legacy = {
  entries: [
    { id: "a", label: "necessary", updatedAt: 1 },
    { id: "b", label: "normal", updatedAt: 1 },
    { id: "c", label: "unnecessary", updatedAt: 1 },
    { id: "d", label: "bad", updatedAt: 1 },
  ],
};
ensureCategoryState(legacy, 100);
assert.deepEqual(legacy.entries.map(entry => entry.categoryId), [
  "essentials", "personal", "time-wasters", "bad-habits",
]);
assert.ok(legacy.entries.every(entry => !("label" in entry)));
assert.equal(legacy.categories.find(category => category.id === "essentials").name, "Essentials");
assert.equal(legacy.categories.find(category => category.id === "bad-habits").name, "Bad habits");

const invalid = { entries: [], categories: [{ id: "x", name: "", color: "red" }] };
ensureCategoryState(invalid, 100);
assert.equal(invalid.categories[0].name, "Untitled");
assert.equal(invalid.categories[0].color, "#778196");

console.log("✓ category defaults and legacy migration");
