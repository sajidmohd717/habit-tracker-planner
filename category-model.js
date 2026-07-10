(function exposeCategoryModel(root) {
  const DEFAULT_CATEGORIES = [
    { id: "work", name: "Work", color: "#5B5BD6" },
    { id: "family", name: "Family", color: "#F97360" },
    { id: "studies", name: "Studies", color: "#0EA5A4" },
    { id: "personal", name: "Personal", color: "#22A06B" },
    { id: "entertainment", name: "Entertainment", color: "#A855F7" },
    { id: "time-wasters", name: "Time wasters", color: "#E5484D" },
  ];
  const LEGACY_CATEGORY_IDS = {
    necessary: "essentials",
    normal: "personal",
    unnecessary: "time-wasters",
    bad: "bad-habits",
  };

  function defaultCategories() {
    return DEFAULT_CATEGORIES.map((category, index) => ({
      ...category, archived: false, createdAt: index + 1, updatedAt: 1,
    }));
  }

  function ensureCategoryState(target, now = Date.now()) {
    const usedCategoryIds = new Set();
    for (const entry of target.entries || []) {
      if (!entry.categoryId) {
        entry.categoryId = LEGACY_CATEGORY_IDS[entry.label] || entry.label || "personal";
        entry.updatedAt = Math.max(entry.updatedAt || 0, now);
        delete entry.label;
      }
      usedCategoryIds.add(entry.categoryId);
    }

    if (!Array.isArray(target.categories) || !target.categories.length) {
      target.categories = defaultCategories();
    }
    const known = new Set(target.categories.map(category => category.id));
    const legacyDefinitions = {
      essentials: { name: "Essentials", color: "#2F9E6F" },
      "bad-habits": { name: "Bad habits", color: "#C73E4D" },
    };
    for (const id of usedCategoryIds) {
      if (known.has(id)) continue;
      const definition = legacyDefinitions[id] || {
        name: id.split("-").map(part => part.charAt(0).toUpperCase() + part.slice(1)).join(" "),
        color: "#778196",
      };
      target.categories.push({ id, ...definition, archived: false, createdAt: now, updatedAt: now });
      known.add(id);
    }
    for (const category of target.categories) {
      if (!/^#[0-9a-f]{6}$/i.test(category.color || "")) category.color = "#778196";
      category.name = String(category.name || "Untitled").trim().slice(0, 32) || "Untitled";
      category.archived = !!category.archived;
    }
    return target;
  }

  root.__defaultCategories = defaultCategories;
  root.__ensureCategoryState = ensureCategoryState;
  if (typeof module !== "undefined" && module.exports) {
    module.exports = { defaultCategories, ensureCategoryState };
  }
})(typeof window !== "undefined" ? window : globalThis);
