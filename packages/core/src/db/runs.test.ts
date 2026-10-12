import { describe, expect, it } from "vitest";
import { createTestDb, fakeClock } from "../testing/db.ts";
import { createCategory } from "./categories.ts";
import { createRun, getRun, listRuns, setRetry } from "./runs.ts";

function setup() {
  const db = createTestDb();
  const clock = fakeClock("2026-03-01T05:00:00.000Z");
  const category = createCategory(db, { name: "News", kind: "news" }, clock);
  return { db, clock, category };
}

describe("what a run says about retries", () => {
  it("is a first attempt with nothing planned when it is created as an ordinary run", () => {
    const { db, clock, category } = setup();
    const run = createRun(db, { categoryId: category.id, trigger: "schedule", slot: "2026-03-01T05:00" }, clock);
    expect(run).toMatchObject({ attempt: 0, retryOf: null, retryAt: null, retrySkipped: null });
  });

  it("carries which retry it is and the run it retries", () => {
    const { db, clock, category } = setup();
    const first = createRun(db, { categoryId: category.id, trigger: "schedule", slot: "2026-03-01T05:00" }, clock);
    const retry = createRun(db, { categoryId: category.id, trigger: "schedule", slot: null, retry: { attempt: 2, of: first.id } }, clock);
    expect(listRuns(db)[0]).toMatchObject({ id: retry.id, attempt: 2, retryOf: first.id, slot: null });
  });

  it("holds either the time of the planned retry or the reason there is none", () => {
    const { db, clock, category } = setup();
    const run = createRun(db, { categoryId: category.id, trigger: "schedule", slot: "2026-03-01T05:00" }, clock);

    setRetry(db, run.id, { at: "2026-03-01T05:13:00.000Z" });
    expect(getRun(db, run.id)).toMatchObject({ retryAt: "2026-03-01T05:13:00.000Z", retrySkipped: null });

    setRetry(db, run.id, { skipped: "superseded" });
    expect(getRun(db, run.id)).toMatchObject({ retryAt: null, retrySkipped: "superseded" });

    setRetry(db, run.id, null);
    expect(getRun(db, run.id)).toMatchObject({ retryAt: null, retrySkipped: null });
  });
});
