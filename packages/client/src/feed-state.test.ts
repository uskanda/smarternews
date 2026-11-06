import type { Feed } from "@smarternews/core/api";
import { describe, expect, it } from "vitest";
import { FEED_STATE_LABEL, feedState, strongestFeedState } from "./feed-state.ts";

const feed = (overrides: Partial<Feed> = {}): Feed => ({
  id: 1,
  url: "https://f.example.org/feed.xml",
  format: "feed",
  selectors: null,
  title: "Blog",
  siteUrl: null,
  categoryId: null,
  intervalMinutes: null,
  enabled: true,
  autoSummarize: false,
  translate: false,
  fetchFullContent: false,
  lastFetchedAt: null,
  lastSucceededAt: null,
  lastError: null,
  failureCount: 0,
  nextFetchAt: null,
  articleCount: 0,
  starredCount: 0,
  annotatedCount: 0,
  createdAt: "2026-03-01T00:00:00.000Z",
  lastNewItemAt: null,
  stale: false,
  recentArticleCount: 0,
  ...overrides,
});

describe("feedState", () => {
  it("is null for a healthy feed", () => {
    expect(feedState(feed())).toBeNull();
  });

  it("names a failed, a stale and a paused feed", () => {
    expect(feedState(feed({ lastError: "HTTP status 503: x" }))).toBe("failed");
    expect(feedState(feed({ stale: true }))).toBe("stale");
    expect(feedState(feed({ enabled: false }))).toBe("paused");
  });

  it("takes the strongest when states overlap: failed, then stale, then paused", () => {
    expect(feedState(feed({ lastError: "timed out", stale: true }))).toBe("failed");
    expect(feedState(feed({ lastError: "timed out", enabled: false }))).toBe("failed");
    expect(feedState(feed({ stale: true, enabled: false }))).toBe("stale");
  });

  it("has a label for each state, the words of the settings screen", () => {
    expect(FEED_STATE_LABEL).toEqual({ failed: "取得に失敗", stale: "更新が止まっています", paused: "一時停止中" });
  });
});

describe("strongestFeedState", () => {
  it("is the strongest of the states given, and null without any", () => {
    expect(strongestFeedState([])).toBeNull();
    expect(strongestFeedState([null, undefined])).toBeNull();
    expect(strongestFeedState(["paused", null, "stale"])).toBe("stale");
    expect(strongestFeedState(["paused", "failed", "stale"])).toBe("failed");
  });
});
