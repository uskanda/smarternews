import type { Feed, FeedFetchAllResult } from "@smarternews/core/api";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { awaitsFetch, useFeeds } from "../api/queries.ts";
import { useApp } from "../app/context.ts";
import { useToast } from "../shell/toast.tsx";
import { messageFor } from "../ui/controls.tsx";

/**
 * "いま取得" of a subscribed feed, from the settings and from the feed's list alike: fetches it, puts the feed
 * as it is now into the list of feeds, reads the counts and the articles again, and says what came of it.
 * `failed` is what the toast says when the fetch failed: each screen says where the reason is shown.
 */
export function useFetchFeedNow(feed: Pick<Feed, "id">, failed: string) {
  const { api } = useApp();
  const client = useQueryClient();
  const toast = useToast();
  const [fetching, setFetching] = useState(false);

  async function fetchNow() {
    setFetching(true);
    try {
      const result = await api.fetchFeed(feed.id);
      // The answer holds the feed as it is now, so what shows its state changes without waiting for the next refresh.
      client.setQueryData<Feed[]>(["feeds"], (list) => list?.map((entry) => (entry.id === feed.id ? result.feed : entry)));
      for (const key of ["counts", "articles", "feed-stats"]) void client.invalidateQueries({ queryKey: [key] });
      toast({
        message:
          result.status === "failed"
            ? failed
            : result.created > 0
              ? `新しい記事を${result.created}件取得しました`
              : "新しい記事はありませんでした",
      });
    } catch (error) {
      toast({ message: messageFor(error) });
    } finally {
      setFetching(false);
    }
  }

  return { fetching, fetchNow };
}

/**
 * The fetch of all that this page asked for and whose end it has not announced yet. It lives in the query cache,
 * so that the button of either screen can start it and the shell, which stays, announces its end. It is not
 * kept over a reload: the buttons still say that feeds wait, but nothing is announced.
 */
const FETCH_ALL_KEY = ["feeds-fetch-all"];

/** What the feeds a fetch of all passed by adds to a message: their site asked to wait, with a Retry-After. */
const skippedNote = (skipped: number) => (skipped > 0 ? `。サイトの指定で待っている${skipped}件は飛ばしました。` : "");

/**
 * "いま取得" of every feed, from the settings and from the list of entries alike. The server answers at once
 * and fetches the feeds afterwards, so `fetching` is read from the feeds: it is true while one of them waits,
 * on both buttons, and after a reload too. `useFetchAllCompletion` says how it ended.
 */
export function useFetchAllFeedsNow() {
  const { api } = useApp();
  const client = useQueryClient();
  const toast = useToast();
  const feeds = useFeeds().data;
  const [starting, setStarting] = useState(false);

  async function fetchAll() {
    setStarting(true);
    try {
      const result = await api.fetchAllFeeds();
      if (result.requested === 0) {
        toast({ message: `取得する購読フィードはありません${skippedNote(result.skipped)}` });
        return;
      }
      // The feeds as they are after the request, before its end is watched for: the list from before the
      // request has no feed that waits, which would read as a fetch that has ended.
      await client.refetchQueries({ queryKey: ["feeds"] });
      client.setQueryData<FeedFetchAllResult>(FETCH_ALL_KEY, result);
    } catch (error) {
      toast({ message: messageFor(error) });
    } finally {
      setStarting(false);
    }
  }

  return { fetching: starting || (feeds?.some(awaitsFetch) ?? false), fetchAll };
}

/**
 * Announces the end of a fetch of all this page asked for: once no feed waits any more, it says whether all
 * were fetched or how many failed, and reads the counts, the articles and the stats of the feeds again. Called
 * in one place, the shell, so that the end is announced once whichever button started it.
 */
export function useFetchAllCompletion(): void {
  const client = useQueryClient();
  const toast = useToast();
  const feeds = useFeeds().data;
  const asked = useQuery<FeedFetchAllResult | null>({ queryKey: FETCH_ALL_KEY, queryFn: () => null, enabled: false, initialData: null, staleTime: Infinity, gcTime: Infinity }).data;

  useEffect(() => {
    if (!asked || !feeds || feeds.some(awaitsFetch)) return;
    client.setQueryData<FeedFetchAllResult | null>(FETCH_ALL_KEY, null);
    for (const key of ["counts", "articles", "feed-stats"]) void client.invalidateQueries({ queryKey: [key] });
    // A fetch since the request that left its reason: both times are the server's, so they compare as they are.
    const failed = feeds.filter((feed) => feed.lastError !== null && feed.lastFetchedAt !== null && feed.lastFetchedAt >= asked.requestedAt).length;
    const outcome = failed > 0 ? `${failed}件の取得に失敗しました` : asked.skipped > 0 ? "購読フィードを取得しました" : "すべての購読フィードを取得しました";
    toast({ message: `${outcome}${skippedNote(asked.skipped)}` });
  }, [asked, feeds, client, toast]);
}
