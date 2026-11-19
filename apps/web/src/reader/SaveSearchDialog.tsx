import { ApiError } from "@smarternews/client";
import { SAVED_SEARCH_NAME_MAX_CHARS, type SavedSearch, type SavedSearchCreate } from "@smarternews/core/api";
import { useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { useApp } from "../app/context.ts";
import { useToast } from "../shell/toast.tsx";
import { Button, ErrorNotice, Field, fieldError } from "../ui/controls.tsx";
import { FormDialog } from "../ui/FormDialog.tsx";

/**
 * A form that asks for the name of a saved search: when a search is saved, and when a saved one is renamed.
 * Drawn only while its dialog is open, so each opening starts from `initial`.
 */
export function SavedSearchNameForm({
  initial,
  onSave,
  onDone,
}: {
  initial: string;
  onSave: (name: string) => Promise<void>;
  onDone: () => void;
}) {
  const [name, setName] = useState(initial);
  const [error, setError] = useState<unknown>(null);
  const [saving, setSaving] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (name.trim().length === 0) return;
    setSaving(true);
    try {
      await onSave(name.trim());
      onDone();
    } catch (caught) {
      setError(caught);
      setSaving(false);
    }
  }

  const reason = fieldError(error, "name");
  return (
    <form onSubmit={(event) => void submit(event)} className="flex flex-col gap-md">
      <Field
        label="名前"
        value={name}
        maxLength={SAVED_SEARCH_NAME_MAX_CHARS}
        onChange={(event) => setName(event.target.value)}
        autoFocus
        error={reason ? `この値は保存できません（${reason}）` : null}
      />
      {error && !(error instanceof ApiError && error.kind === "invalid" && reason) ? <ErrorNotice error={error} /> : null}
      <div className="flex flex-wrap justify-end gap-sm">
        <Button type="submit" variant="primary" disabled={saving || name.trim().length === 0}>
          保存する
        </Button>
        <Button onClick={onDone}>やめる</Button>
      </div>
    </form>
  );
}

/**
 * The button above search results that saves the search: its words and its narrowing to a category or a
 * feed, under a name that is the words unless the reader gives another. Whether only unread articles are
 * shown is not saved: a saved search opens unread only. Without words there is nothing to save.
 */
export function SaveSearchButton({ search }: { search: Omit<SavedSearchCreate, "name"> }) {
  const { api } = useApp();
  const client = useQueryClient();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const words = search.query.trim();

  async function save(name: string) {
    const saved = await api.createSavedSearch({ ...search, query: words, name });
    client.setQueryData<SavedSearch[]>(["saved-searches"], (current) => [...(current ?? []), saved]);
    void client.invalidateQueries({ queryKey: ["saved-searches"] });
    void client.invalidateQueries({ queryKey: ["counts"] });
    toast({ message: `検索「${saved.name}」を保存しました` });
  }

  return (
    <FormDialog
      open={open}
      onOpenChange={setOpen}
      title="検索を保存"
      trigger={<Button disabled={words.length === 0}>検索を保存</Button>}
    >
      <SavedSearchNameForm initial={words} onSave={save} onDone={() => setOpen(false)} />
    </FormDialog>
  );
}
