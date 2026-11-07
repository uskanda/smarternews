import { ApiError } from "@smarternews/client";
import type { Category } from "@smarternews/core/api";
import { useQueryClient } from "@tanstack/react-query";
import { useId, useState, type FormEvent, type ReactNode } from "react";
import { Link, useNavigate } from "react-router";
import { useCategories, useTopics } from "../api/queries.ts";
import { useApp } from "../app/context.ts";
import { topicEditPath } from "../lib/paths.ts";
import { useToast } from "../shell/toast.tsx";
import { Button, ErrorNotice, Field, fieldError } from "../ui/controls.tsx";
import { FormDialog } from "../ui/FormDialog.tsx";

// Adding a topic while reading, from the articles of a name or from a selection: a category and the text, as on
// the page of the category, with the same defaults for the rest. The next run interprets it; adding starts none.

const SELECT = "w-full rounded-md border border-outline-strong bg-surface px-sm py-xs type-body-md text-on-surface";
/** The most characters a topic's text holds, as the API takes it. */
const MAX_TOPIC_CHARS = 2000;

/** The categories that hold topics, news and events, in the order of the left pane. */
export function useTopicCategories(): Category[] {
  const categories = useCategories().data ?? [];
  return categories.filter((category) => category.kind === "news" || category.kind === "event");
}

/** A topic's text as compared for sameness: width and case folded, spaces around it dropped. */
const comparable = (text: string) => text.normalize("NFKC").toLowerCase().trim();

/**
 * The dialog. `draft` is the text it starts with; the category it starts in is the article's, `categoryId`, when
 * that holds topics, else the first one the left pane lists. `trigger`, when given, is the button that opens it.
 */
export function AddTopicDialog({
  draft,
  categoryId,
  open,
  onOpenChange,
  trigger,
}: {
  draft: string;
  categoryId: number | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  trigger?: ReactNode;
}) {
  return (
    <FormDialog open={open} onOpenChange={onOpenChange} trigger={trigger} title="トピックを足す">
      {/* Drawn only while open, so each opening starts from the draft. */}
      <AddTopicForm draft={draft} categoryId={categoryId} onDone={() => onOpenChange(false)} />
    </FormDialog>
  );
}

/** The button above the articles of a name and the dialog it opens. None while no category holds topics. */
export function AddTopicButton({ draft, categoryId }: { draft: string; categoryId: number | null }) {
  const [open, setOpen] = useState(false);
  const choices = useTopicCategories();
  if (choices.length === 0) return null;
  return <AddTopicDialog draft={draft} categoryId={categoryId} open={open} onOpenChange={setOpen} trigger={<Button>トピックを足す…</Button>} />;
}

function AddTopicForm({ draft, categoryId, onDone }: { draft: string; categoryId: number | null; onDone: () => void }) {
  const { api } = useApp();
  const client = useQueryClient();
  const toast = useToast();
  const navigate = useNavigate();
  const choices = useTopicCategories();
  const initial = choices.find((category) => category.id === categoryId) ?? choices.find((category) => category.enabled) ?? choices[0];
  const [chosen, setChosen] = useState<number | null>(null);
  const target = chosen ?? initial?.id ?? null;
  const [text, setText] = useState(draft);
  const [error, setError] = useState<unknown>(null);
  const [saving, setSaving] = useState(false);
  const selectId = useId();
  const topics = useTopics(target).data ?? [];
  const same = text.trim() === "" ? undefined : topics.find((topic) => comparable(topic.text) === comparable(text));

  async function add(event: FormEvent) {
    event.preventDefault();
    if (target === null) return;
    setSaving(true);
    try {
      const topic = await api.createTopic(target, { text });
      void client.invalidateQueries({ queryKey: ["topics", target] });
      onDone();
      toast({
        message: "追加しました。次の実行で解釈されます。",
        action: { label: "編集する", run: () => void navigate(topicEditPath(target, topic.id)) },
      });
    } catch (caught) {
      setError(caught);
      setSaving(false);
    }
  }

  const reason = fieldError(error, "text");
  return (
    <form onSubmit={(event) => void add(event)} className="flex flex-col gap-md">
      <div className="flex flex-col gap-xs">
        <label htmlFor={selectId} className="type-label-md">
          カテゴリ
        </label>
        <select id={selectId} value={target ?? ""} onChange={(event) => setChosen(Number(event.target.value))} className={SELECT}>
          {choices.map((category) => (
            <option key={category.id} value={category.id}>
              {category.name}
            </option>
          ))}
        </select>
      </div>
      <Field
        label="文章"
        multiline
        rows={3}
        maxLength={MAX_TOPIC_CHARS}
        value={text}
        onChange={(event) => setText(event.target.value)}
        autoFocus
        error={reason ? `この値は保存できません（${reason}）` : null}
      />
      {same && target !== null ? (
        <p className="flex flex-wrap gap-x-sm type-body-md">
          <span>同じ文章のトピックがあります。</span>
          <Link to={topicEditPath(target, same.id)} onClick={onDone} className="text-primary underline underline-offset-4">
            そのトピックを編集する
          </Link>
        </p>
      ) : null}
      {error && !(error instanceof ApiError && error.kind === "invalid") ? <ErrorNotice error={error} /> : null}
      <div className="flex flex-wrap justify-end gap-sm">
        <Button type="submit" variant="primary" disabled={saving || target === null || text.trim().length === 0}>
          追加する
        </Button>
        <Button onClick={onDone}>やめる</Button>
      </div>
    </form>
  );
}
