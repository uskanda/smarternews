import type { ArticleSummary } from "@smarternews/core/api";
import { describe, expect, it } from "vitest";
import { mergeKept, sortKeyFor } from "./merge.ts";

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

  it("orders by the key it is given, keeping an article put back to unread where it was", () => {
    const read = (id: number, readAt: string | null) => ({ ...item(id, "2026-03-01T00:00:00Z", readAt !== null), readAt });
    const fetched = [read(3, "2026-03-01T12:03:00Z"), read(1, "2026-03-01T12:01:00Z")];
    // Article 2 was read at 12:02 and put back to unread: the server no longer lists it, the kept copy keeps the time.
    const kept = [{ ...read(2, "2026-03-01T12:02:00Z"), isRead: false }];
    const merged = mergeKept(fetched, kept, (entry) => entry.readAt ?? "");
    expect(merged.map((entry) => entry.id)).toEqual([3, 2, 1]);
    expect(merged[1]).toMatchObject({ isRead: false, readAt: "2026-03-01T12:02:00Z" });
  });

  it("orders the recently read articles by read time, and every other list by update", () => {
    const entry = { ...item(1, "2026-03-01T12:00:00Z"), readAt: "2026-03-02T08:00:00Z" };
    expect(sortKeyFor({ type: "recentlyRead" })(entry)).toBe("2026-03-02T08:00:00Z");
    expect(sortKeyFor({ type: "unread" })(entry)).toBe("2026-03-01T12:00:00Z");
  });
});

describe("mergeKept oldest first", () => {
  it("puts an article read during the visit back in its place among the oldest first", () => {
    const fetched = [item(1, "2026-03-01T12:00:00Z"), item(3, "2026-03-01T12:02:00Z"), item(5, "2026-03-01T12:02:00Z")];
    const kept = [item(2, "2026-03-01T12:01:00Z", true), item(4, "2026-03-01T12:02:00Z", true)];
    expect(mergeKept(fetched, kept, undefined, "oldest").map((entry) => entry.id)).toEqual([1, 2, 3, 4, 5]);
    expect(mergeKept(fetched, kept).map((entry) => entry.id)).toEqual([5, 4, 3, 2, 1]);
  });
});
