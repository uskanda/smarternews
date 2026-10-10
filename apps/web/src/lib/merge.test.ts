import type { ArticleSummary } from "@smarternews/core/api";
import { describe, expect, it } from "vitest";
import { mergeKept } from "./merge.ts";

const item = (id: number, updatedAt: string, isRead = false): ArticleSummary =>
  ({ id, updatedAt, isRead, title: `Article ${id}` }) as ArticleSummary;

describe("mergeKept", () => {
  it("puts an article the user just read back into a list that no longer returns it", () => {
    const fetched = [item(3, "2026-03-01T12:02:00Z"), item(1, "2026-03-01T12:00:00Z")];
    const kept = [item(2, "2026-03-01T12:01:00Z", true)];
    expect(mergeKept(fetched, kept).map((entry) => entry.id)).toEqual([3, 2, 1]);
  });

  it("uses the kept copy when the list still returns the article, so its read state shows", () => {
    const fetched = [item(2, "2026-03-01T12:01:00Z", false)];
    const kept = [item(2, "2026-03-01T12:01:00Z", true)];
    expect(mergeKept(fetched, kept)).toEqual([item(2, "2026-03-01T12:01:00Z", true)]);
  });

  it("orders articles with the same update time by identifier, newest first", () => {
    const fetched = [item(5, "2026-03-01T12:00:00Z"), item(3, "2026-03-01T12:00:00Z")];
    const kept = [item(4, "2026-03-01T12:00:00Z", true)];
    expect(mergeKept(fetched, kept).map((entry) => entry.id)).toEqual([5, 4, 3]);
  });

  it("returns the fetched list unchanged when nothing is kept", () => {
    const fetched = [item(2, "2026-03-01T12:01:00Z"), item(1, "2026-03-01T12:00:00Z")];
    expect(mergeKept(fetched, [])).toEqual(fetched);
  });
});
