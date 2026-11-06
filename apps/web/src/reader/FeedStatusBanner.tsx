import type { Feed } from "@smarternews/core/api";
import { feedErrorLabel, feedState } from "@smarternews/client";
import { Link } from "react-router";
import { useSettings } from "../api/queries.ts";
import { useFetchFeedNow } from "../lib/fetch-now.ts";
import { Button } from "../ui/controls.tsx";

const ROW = "flex flex-wrap items-center gap-x-md gap-y-xs rounded-md border bg-surface px-lg py-sm type-body-md";
const LINK = "underline underline-offset-2";

/**
 * One line at the top of the list of a feed whose fetches went wrong: the strongest of a failed fetch, no new
 * item for long, and a pause. A failed or stale feed gets "いま取得", the one action, and every state a link in
 * the text to the feed's row of the settings, where the address, the selectors and the pause are changed.
 * A healthy feed shows nothing.
 */
export function FeedStatusBanner({ feed }: { feed: Feed }) {
  const state = feedState(feed);
  const days = useSettings().data?.staleFeedDays;
  const { fetching, fetchNow } = useFetchFeedNow(feed, "取得できませんでした。理由は一覧の上に表示しています。");
  if (state === null) return null;
  const settings = `/settings/feeds#feed-${feed.id}`;
  const fetchButton = (
    <Button onClick={() => void fetchNow()} disabled={fetching} className="text-on-surface">
      {fetching ? "取得中…" : "いま取得"}
    </Button>
  );

  if (state === "failed") {
    return (
      <div role="status" aria-label="購読フィードの取得の状態" className={`${ROW} m-lg border-error text-error`}>
        <span className="min-w-0 break-all" title={feed.lastError ?? undefined}>
          取得に失敗しました。理由: {feedErrorLabel(feed.lastError ?? "")}。
          <Link to={settings} className={LINK}>
            設定で直す
          </Link>
        </span>
        {fetchButton}
      </div>
    );
  }
  return (
    <div role="status" aria-label="購読フィードの取得の状態" className={`${ROW} m-lg border-warning text-warning`}>
      <span className="min-w-0">
        {state === "stale" ? (days ? `更新が止まっています。${days}日より長く、新しい記事が届いていません。` : "更新が止まっています。") : "取得を一時停止しています。"}
        <Link to={settings} className={LINK}>
          {state === "stale" ? "設定を確かめる" : "設定で再開する"}
        </Link>
      </span>
      {state === "stale" ? fetchButton : null}
    </div>
  );
}
