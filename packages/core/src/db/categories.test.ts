import { describe, expect, it } from "vitest";
import { createTestDb, fakeClock } from "../testing/db.ts";
import { createCategory, deleteCategory, getCategory, listCategories, updateCategory } from "./categories.ts";

const clock = fakeClock("2026-03-01T00:00:00.000Z");

describe("createCategory", () => {
  it("fills the defaults of a news category", () => {
    const db = createTestDb();
    const category = createCategory(db, { name: "Security", kind: "news" }, clock);
    expect(category).toMatchObject({
      slug: "security",
      kind: "news",
      schedule: ["05:00"],
      minImportance: 3,
      maxArticlesPerRun: 5,
      windowHours: 24,
      windowDays: null,
      enabled: true,
    });
  });

  it("gives an event category a seven-day window", () => {
    const db = createTestDb();
    const category = createCategory(db, { name: "Local events", kind: "event" }, clock);
    expect(category).toMatchObject({ slug: "local-events", windowDays: 7, windowHours: null });
  });

  it("refuses a slug that is already taken", () => {
    const db = createTestDb();
    createCategory(db, { name: "Security", slug: "security", kind: "news" }, clock);
    expect(() => createCategory(db, { name: "Other", slug: "security", kind: "news" }, clock)).toThrow(
      expect.objectContaining({ code: "conflict" }),
    );
    expect(listCategories(db)).toHaveLength(1);
  });

  it("refuses the reserved kind and says it is not available yet", () => {
    const db = createTestDb();
    expect(() => createCategory(db, { name: "Weather", kind: "status" }, clock)).toThrow(
      expect.objectContaining({ code: "invalid", message: expect.stringContaining("not available yet") }),
    );
  });

  it("derives a unique slug when the name has no ASCII letters or repeats", () => {
    const db = createTestDb();
    expect(createCategory(db, { name: "自動車", kind: "news" }, clock).slug).toBe("category");
    expect(createCategory(db, { name: "自転車", kind: "news" }, clock).slug).toBe("category-2");
  });
});

describe("updateCategory", () => {
  it("changes only the given fields", () => {
    const db = createTestDb();
    const created = createCategory(db, { name: "Security", kind: "news" }, clock);
    const updated = updateCategory(db, created.id, { minImportance: 4, schedule: ["06:00", "18:00"] });
    expect(updated).toMatchObject({ name: "Security", minImportance: 4, schedule: ["06:00", "18:00"], maxArticlesPerRun: 5 });
  });

  it("reports a missing category", () => {
    const db = createTestDb();
    expect(() => updateCategory(db, 99, { enabled: false })).toThrow(expect.objectContaining({ code: "not_found" }));
  });
});

describe("deleteCategory", () => {
  it("removes the category", () => {
    const db = createTestDb();
    const created = createCategory(db, { name: "Security", kind: "news" }, clock);
    deleteCategory(db, created.id);
    expect(() => getCategory(db, created.id)).toThrow(expect.objectContaining({ code: "not_found" }));
  });
});
