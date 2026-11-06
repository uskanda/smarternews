// What a subscribed feed's fetches came to, as the screens show it: on the list of the feed, in the left pane,
// in the settings. One state at a time, the strongest; a healthy feed has none.
import type { Feed } from "@smarternews/core/api";

/** The last fetch failed; no new item came for longer than the settings allow; or the reader paused the feed. */
export type FeedState = "failed" | "stale" | "paused";

/** Strongest first. */
const ORDER: readonly FeedState[] = ["failed", "stale", "paused"];

/** The words for each state, the same as the badges of the settings screen. */
export const FEED_STATE_LABEL: Record<FeedState, string> = {
  failed: "取得に失敗",
  stale: "更新が止まっています",
  paused: "一時停止中",
};

/** The strongest state of the feed, or null when its fetches are fine. */
export function feedState(feed: Pick<Feed, "lastError" | "stale" | "enabled">): FeedState | null {
  if (feed.lastError !== null) return "failed";
  if (feed.stale) return "stale";
  if (!feed.enabled) return "paused";
  return null;
}

/** The strongest of the states, or null without any: what a folded group shows for the feeds below it. */
export function strongestFeedState(states: ReadonlyArray<FeedState | null | undefined>): FeedState | null {
  return ORDER.find((state) => states.includes(state)) ?? null;
}
