import * as ContextMenu from "@radix-ui/react-context-menu";
import type { NavEntry } from "@smarternews/client";
import type { SavedSearch } from "@smarternews/core/api";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useRef, useState, type ReactElement } from "react";
import { useLocation, useNavigate } from "react-router";
import { useApp } from "../app/context.ts";
import { isOnList } from "../lib/paths.ts";
import { SavedSearchNameForm } from "../reader/SaveSearchDialog.tsx";
import { Button, messageFor } from "../ui/controls.tsx";
import { ConfirmDialog } from "../ui/ConfirmDialog.tsx";
import { FormDialog } from "../ui/FormDialog.tsx";
import { MENU, MENU_ITEM } from "./order.tsx";
import { useToast } from "./toast.tsx";

const KEY = ["saved-searches"];

/**
 * Moves a saved search before another one, or last: the list changes at once, then the server is told. When
 * the server refuses or cannot be reached, the list goes back to what is stored and a notice says so.
 */
function useSavedSearchMove(): (id: number, before: number | null) => void {
  const { api } = useApp();
  const client = useQueryClient();
  const toast = useToast();
  return useCallback(
    (id: number, before: number | null) => {
      const stored = client.getQueryData<SavedSearch[]>(KEY) ?? [];
      const moved = stored.find((saved) => saved.id === id);
      if (!moved) return;
      const others = stored.filter((saved) => saved.id !== id);
      const at = before === null ? others.length : others.findIndex((saved) => saved.id === before);
      client.setQueryData(KEY, [...others.slice(0, at), moved, ...others.slice(at)]);
      api
        .moveSavedSearch(id, before)
        .then((saved) => client.setQueryData(KEY, saved))
        .catch(() => {
          client.setQueryData(KEY, stored);
          void client.invalidateQueries({ queryKey: KEY });
          toast({ message: "並べ替えられませんでした。もう一度試してください。" });
        });
    },
    [api, client, toast],
  );
}

/**
 * The menu of a saved search in the left pane, around its link: its name changed, one place up or down among
 * the saved searches shown, and its deletion once asked. `shown` is the ids of the saved searches the pane
 * shows, in their order: hidden ones are passed by, as Shift+J passes them.
 */
export function SavedSearchMenu({ entry, shown, children }: { entry: NavEntry; shown: number[]; children: ReactElement }) {
  const { api } = useApp();
  const client = useQueryClient();
  const toast = useToast();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const move = useSavedSearchMove();
  const trigger = useRef<HTMLSpanElement>(null);
  const [renaming, setRenaming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  if (entry.target.type !== "savedSearch") return children;
  const id = entry.target.savedSearchId;
  const index = shown.indexOf(id);
  const above = index > 0 ? shown[index - 1]! : null;
  const below = index !== -1 && index + 1 < shown.length ? shown[index + 1]! : null;
  const focusEntry = () => trigger.current?.querySelector("a")?.focus();

  /** One place down: after the next one shown, before whatever followed it in the stored order. */
  function moveDown() {
    if (below === null) return;
    const stored = (client.getQueryData<SavedSearch[]>(KEY) ?? []).map((saved) => saved.id);
    move(id, stored[stored.indexOf(below) + 1] ?? null);
    setTimeout(focusEntry, 0);
  }
  function moveUp() {
    if (above === null) return;
    move(id, above);
    setTimeout(focusEntry, 0);
  }

  async function rename(name: string) {
    const saved = await api.updateSavedSearch(id, { name });
    client.setQueryData<SavedSearch[]>(KEY, (current) => current?.map((candidate) => (candidate.id === id ? saved : candidate)));
    void client.invalidateQueries({ queryKey: KEY });
  }

  async function remove() {
    try {
      await api.deleteSavedSearch(id);
    } catch (error) {
      toast({ message: messageFor(error) });
      return;
    }
    setDeleting(false);
    client.setQueryData<SavedSearch[]>(KEY, (current) => current?.filter((candidate) => candidate.id !== id));
    void client.invalidateQueries({ queryKey: KEY });
    void client.invalidateQueries({ queryKey: ["counts"] });
    // The list that was open is gone with the search.
    if (isOnList(`/s/${id}`, pathname)) void navigate("/unread");
    toast({ message: `保存した検索「${entry.label}」を削除しました` });
  }

  return (
    <>
      <ContextMenu.Root>
        <ContextMenu.Trigger asChild>
          <span ref={trigger} className="flex min-w-0 flex-1">
            {children}
          </span>
        </ContextMenu.Trigger>
        <ContextMenu.Portal>
          <ContextMenu.Content
            // The menu takes its keys from the list behind it, which would move under the open menu.
            data-hotkeys="off"
            className={MENU}
            aria-label={`${entry.label}の操作`}
            onCloseAutoFocus={(event) => {
              event.preventDefault();
              focusEntry();
            }}
          >
            <ContextMenu.Item className={MENU_ITEM} onSelect={() => setRenaming(true)}>
              名前を変更
            </ContextMenu.Item>
            <ContextMenu.Item className={MENU_ITEM} disabled={above === null} onSelect={moveUp}>
              上へ移動
            </ContextMenu.Item>
            <ContextMenu.Item className={MENU_ITEM} disabled={below === null} onSelect={moveDown}>
              下へ移動
            </ContextMenu.Item>
            <ContextMenu.Separator className="my-xs border-t border-outline" />
            <ContextMenu.Item className={MENU_ITEM} onSelect={() => setDeleting(true)}>
              削除
            </ContextMenu.Item>
          </ContextMenu.Content>
        </ContextMenu.Portal>
      </ContextMenu.Root>
      <FormDialog open={renaming} onOpenChange={setRenaming} title="名前を変更">
        <SavedSearchNameForm initial={entry.label} onSave={rename} onDone={() => setRenaming(false)} />
      </FormDialog>
      <ConfirmDialog
        open={deleting}
        title="保存した検索を削除しますか"
        onDismiss={() => setDeleting(false)}
        returnFocus={() => trigger.current?.querySelector("a") ?? document.querySelector<HTMLElement>('nav[aria-label="項目"] a')}
        actions={
          <>
            <Button variant="danger" onClick={() => void remove()}>
              削除する
            </Button>
            <Button onClick={() => setDeleting(false)}>やめる</Button>
          </>
        }
      >
        <p>保存した検索「{entry.label}」が左のペインから消えます。記事は消えません。</p>
      </ConfirmDialog>
    </>
  );
}
