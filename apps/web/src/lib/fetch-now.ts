import type { Feed } from "@smarternews/core/api";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
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
