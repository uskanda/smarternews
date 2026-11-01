import type { Feed } from "@smarternews/core/api";
import { useQueryClient } from "@tanstack/react-query";
import { useId, useState, type FormEvent } from "react";
import { useApp } from "../app/context.ts";
import { AutoSummarize, FetchFullContent, Translate } from "../settings/FeedSwitches.tsx";
import { useToast } from "../shell/toast.tsx";
import { Button, ErrorNotice } from "../ui/controls.tsx";
import { FormDialog } from "../ui/FormDialog.tsx";

/**
 * The three switches of a feed, from its own list. They start from the feed each time the dialog opens, and only
 * they are sent, so the name, the category, the interval and the rest stay as they are.
 */
function FeedOptionsForm({ feed, onDone }: { feed: Feed; onDone: () => void }) {
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
    <form onSubmit={save} className="flex flex-col gap-md">
      <AutoSummarize id={`${id}-summarize-hint`} checked={autoSummarize} onChange={setAutoSummarize} />
      <Translate id={`${id}-translate-hint`} checked={translate} onChange={setTranslate} />
      <FetchFullContent id={`${id}-full-content-hint`} checked={fetchFullContent} onChange={setFetchFullContent} page={feed.format === "page"} />
      {error ? <ErrorNotice error={error} /> : null}
      <div className="flex flex-wrap justify-end gap-sm">
        <Button type="submit" variant="primary" disabled={busy}>
          保存する
        </Button>
        <Button onClick={onDone}>やめる</Button>
      </div>
    </form>
  );
}

/** The button above a feed's list and the dialog of that feed's switches it opens. */
export function FeedOptionsDialog({ feed }: { feed: Feed }) {
  const [open, setOpen] = useState(false);
  return (
    <FormDialog open={open} onOpenChange={setOpen} trigger={<Button>フィードの設定</Button>} title="フィードの設定">
      <FeedOptionsForm feed={feed} onDone={() => setOpen(false)} />
    </FormDialog>
  );
}
