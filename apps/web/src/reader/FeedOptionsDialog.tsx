import type { Feed } from "@smarternews/core/api";
import { useQueryClient } from "@tanstack/react-query";
import { useId, useRef, useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router";
import { useApp } from "../app/context.ts";
import { FeedDeletionDialog } from "../settings/FeedDeletionDialog.tsx";
import { AutoSummarize, FetchFullContent, Translate } from "../settings/FeedSwitches.tsx";
import { useToast } from "../shell/toast.tsx";
import { Button, ErrorNotice } from "../ui/controls.tsx";
import { FormDialog } from "../ui/FormDialog.tsx";

/**
 * The three switches of a feed, from its own list. They start from the feed each time the dialog opens, and only
 * they are sent, so the name, the category, the interval and the rest stay as they are.
 */
function FeedOptionsForm({ feed, onDone, onUnsubscribe }: { feed: Feed; onDone: () => void; onUnsubscribe: () => void }) {
  const { api } = useApp();
  const client = useQueryClient();
  const toast = useToast();
  const id = useId();
  const [autoSummarize, setAutoSummarize] = useState(feed.autoSummarize);
  const [translate, setTranslate] = useState(feed.translate);
  const [fetchFullContent, setFetchFullContent] = useState(feed.fetchFullContent);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  async function save(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.updateFeed(feed.id, { autoSummarize, translate, fetchFullContent });
      for (const key of ["feeds", "counts", "articles"]) void client.invalidateQueries({ queryKey: [key] });
      toast({ message: "購読フィードを保存しました" });
      onDone();
    } catch (caught) {
      setError(caught);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form noValidate onSubmit={save} className="flex flex-col gap-md">
      <AutoSummarize id={`${id}-summarize-hint`} checked={autoSummarize} onChange={setAutoSummarize} />
      <Translate id={`${id}-translate-hint`} checked={translate} onChange={setTranslate} />
      <FetchFullContent id={`${id}-full-content-hint`} checked={fetchFullContent} onChange={setFetchFullContent} page={feed.format === "page"} />
      {error ? <ErrorNotice error={error} /> : null}
      <div className="flex flex-wrap items-center justify-end gap-sm">
        {/* The rest of the feed's settings, in its form among the settings of feeds. What was switched here and not saved is dropped. */}
        <Link to={`/settings/feeds#feed-${feed.id}-edit`} onClick={onDone} className="tap mr-auto type-body-md text-primary underline underline-offset-4">
          ほかの設定
        </Link>
        {/* Not a setting but what is done to the feed: the question that follows holds the danger, not this button. */}
        <Button aria-label={`${feed.title}の登録を解除`} onClick={onUnsubscribe}>
          登録を解除
        </Button>
        <Button type="submit" variant="primary" disabled={busy}>
          保存する
        </Button>
        <Button onClick={onDone}>やめる</Button>
      </div>
    </form>
  );
}

/**
 * The button above a feed's list and the dialog of that feed's switches it opens. Unsubscribing from there closes
 * the dialog and asks the same question as the left pane and the settings page; once the feed is gone, so is its
 * list, and the unread articles open instead.
 */
export function FeedOptionsDialog({ feed }: { feed: Feed }) {
  const navigate = useNavigate();
  const trigger = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [leaving, setLeaving] = useState(false);
  return (
    <>
      <FormDialog open={open} onOpenChange={setOpen} trigger={<Button ref={trigger}>購読フィードの設定</Button>} title="購読フィードの設定">
        <FeedOptionsForm
          feed={feed}
          onDone={() => setOpen(false)}
          onUnsubscribe={() => {
            setOpen(false);
            setLeaving(true);
          }}
        />
      </FormDialog>
      <FeedDeletionDialog
        feed={leaving ? feed : null}
        pauseWhere="設定の購読フィード"
        onDone={() => setLeaving(false)}
        onDeleted={() => void navigate("/unread")}
        returnFocus={() => trigger.current}
      />
    </>
  );
}
