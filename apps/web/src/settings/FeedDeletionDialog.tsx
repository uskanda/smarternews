import type { Feed } from "@smarternews/core/api";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useApp } from "../app/context.ts";
import { useToast } from "../shell/toast.tsx";
import { ConfirmDialog } from "../ui/ConfirmDialog.tsx";
import { Button } from "../ui/controls.tsx";
import { feedDeletionText } from "./feed-deletion.ts";
import { ScopedFiltersNote } from "./ScopedFiltersNote.tsx";

/**
 * The question before unsubscribing from a feed, and the unsubscribing itself. The menu of the left pane, the
 * settings page and the settings of a feed from its list all ask it, so that they say and do the same.
 */
export function FeedDeletionDialog({
  feed,
  pauseWhere,
  onDone,
  onDeleted,
  returnFocus,
}: {
  /** The feed asked about; the dialog is closed while there is none. */
  feed: Feed | null | undefined;
  /** Where the feed can be paused instead, as the pause hint names it. */
  pauseWhere: string;
  /** Called when the dialog closes, whether the feed went or not. */
  onDone: () => void;
  /** Called once the feed is gone, before the dialog closes. */
  onDeleted?: (feed: Feed) => void;
  returnFocus?: () => HTMLElement | null | undefined;
}) {
  const { api } = useApp();
  const client = useQueryClient();
  const toast = useToast();
  const [removing, setRemoving] = useState(false);

  async function unsubscribe(target: Feed) {
    if (removing) return;
    setRemoving(true);
    try {
      await api.deleteFeed(target.id);
      for (const key of ["feeds", "counts", "articles", "filters"]) void client.invalidateQueries({ queryKey: [key] });
      toast({ message: "購読フィードの登録を解除しました" });
      onDeleted?.(target);
    } catch {
      toast({ message: "登録を解除できませんでした。もう一度試してください。" });
    }
    setRemoving(false);
    onDone();
  }

  return (
    <ConfirmDialog
      open={Boolean(feed)}
      title="購読フィードの登録を解除しますか"
      onDismiss={onDone}
      returnFocus={returnFocus}
      actions={
        <>
          <Button variant="danger" disabled={removing} onClick={() => feed && void unsubscribe(feed)}>
            登録を解除する
          </Button>
          <Button onClick={onDone}>やめる</Button>
        </>
      }
    >
      {feed ? (
        <>
          <p>{feedDeletionText(feed)}</p>
          <ScopedFiltersNote target={{ feedId: feed.id }} />
          <p>記事を残したまま取得だけを止めるには、{pauseWhere}で一時停止にしてください。</p>
        </>
      ) : null}
    </ConfirmDialog>
  );
}
