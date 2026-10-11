import * as ContextMenu from "@radix-ui/react-context-menu";
import {
  applyMove,
  dropAt,
  DWELL_MS,
  edgeScroll,
  groupAt,
  listKey,
  movableOf,
  parseListKey,
  stepMove,
  type Movable,
  type Move,
  type NavEntry,
  type NavModel,
  type Row,
} from "@smarternews/client";
import type { Category, Feed } from "@smarternews/core/api";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type PointerEvent as ReactPointerEvent, type ReactElement, type RefObject } from "react";
import { useApp } from "../app/context.ts";
import { useToast } from "./toast.tsx";

/** A drag starts once the pointer has moved this far; before that the press is a click on the entry. */
const DRAG_START_PX = 4;
/** How far to the side of the list the pointer may stray while the entry can still be put down. */
const SIDE_SLACK_PX = 48;

const idsOf = (list: Array<{ id: number }>) => list.map((entry) => entry.id).join(",");

/**
 * Applies a move: the list changes at once, then the server is told. When the server refuses or cannot be
 * reached, the list goes back to what is stored and a notice says so.
 */
export function useNavMoves(): (move: Move) => void {
  const { api } = useApp();
  const client = useQueryClient();
  const toast = useToast();
  return useCallback(
    (move: Move) => {
      const before = { categories: client.getQueryData<Category[]>(["categories"]) ?? [], feeds: client.getQueryData<Feed[]>(["feeds"]) ?? [] };
      const after = applyMove(before, move);
      const sameCategory = move.kind === "category" || before.feeds.find((feed) => feed.id === move.id)?.categoryId === move.categoryId;
      if (sameCategory && idsOf(after.categories) === idsOf(before.categories) && idsOf(after.feeds) === idsOf(before.feeds)) return;
      client.setQueryData(["categories"], after.categories);
      client.setQueryData(["feeds"], after.feeds);
      const sent =
        move.kind === "category"
          ? api.moveCategory(move.id, move.before).then((categories) => client.setQueryData(["categories"], categories))
          : api.moveFeed(move.id, { categoryId: move.categoryId, before: move.before }).then((feeds) => client.setQueryData(["feeds"], feeds));
      sent
        .then(() => {
          // The articles of a feed follow it into its new category.
          if (!sameCategory) for (const key of ["counts", "articles"]) void client.invalidateQueries({ queryKey: [key] });
        })
        .catch(() => {
          client.setQueryData(["categories"], before.categories);
          client.setQueryData(["feeds"], before.feeds);
          for (const key of ["categories", "feeds"]) void client.invalidateQueries({ queryKey: [key] });
          toast({ message: "並べ替えられませんでした。もう一度試してください。" });
        });
    },
    [api, client, toast],
  );
}

export interface DragState {
  /** `listKey` of the entry that is being dragged. */
  key: string;
  /** Where the line that shows the place is, from the top of the scrolled list. Null where the entry cannot go. */
  lineTop: number | null;
  /** The group a feed may be put into after it stayed over it. */
  armed: string | null;
}

function measure(nav: HTMLElement): Row[] {
  return [...nav.querySelectorAll<HTMLElement>("[data-nav-key]")].map((row) => {
    const box = row.getBoundingClientRect();
    return { key: row.dataset.navKey!, top: box.top, bottom: box.bottom };
  });
}

/**
 * Dragging categories and feeds with a mouse or a pen. Touch is left alone, so that the list still scrolls
 * under a finger; the menu of an entry moves it there.
 */
export function useNavDrag(options: {
  nav: RefObject<HTMLElement | null>;
  model: NavModel;
  onMove: (move: Move) => void;
  /** Opens a folded group that a feed stays over. */
  unfold: (groupKey: string) => void;
}): { drag: DragState | null; onPointerDown: (event: ReactPointerEvent) => void } {
  const [drag, setDrag] = useState<DragState | null>(null);
  const latest = useRef(options);
  latest.current = options;
  const stop = useRef<(() => void) | null>(null);
  useEffect(() => () => stop.current?.(), []);

  const onPointerDown = useCallback((event: ReactPointerEvent) => {
    if (event.button !== 0 || event.pointerType === "touch" || stop.current) return;
    const row = (event.target as Element).closest<HTMLElement>("[data-nav-key]");
    // The fold button beside a category is not a handle.
    if (!row || (event.target as Element).closest("button")) return;
    const key = row.dataset.navKey!;
    const target = parseListKey(key);
    const item: Movable | null = target ? movableOf(target) : null;
    if (!item) return;

    const start = { x: event.clientX, y: event.clientY };
    let dragging = false;
    let y = start.y;
    let hovered: string | null = null;
    let armed: string | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;

    let x = start.x;
    let frame = 0;
    const current = () => {
      const { nav, model } = latest.current;
      if (!nav.current) return null;
      const box = nav.current.getBoundingClientRect();
      // Far to the side of the list is nowhere: letting go there leaves the entry where it was.
      const inside = x >= box.left - SIDE_SLACK_PX && x <= box.right + SIDE_SLACK_PX;
      return { nav: nav.current, drop: inside ? dropAt({ model, rows: measure(nav.current), dragged: item, y, armed }) : null };
    };
    const show = () => {
      const now = current();
      if (!now) return;
      const lineTop = now.drop ? now.drop.lineY - now.nav.getBoundingClientRect().top + now.nav.scrollTop : null;
      setDrag({ key, lineTop, armed });
    };
    /** A feed over another category waits there; the category is armed when the wait is over. */
    const watch = () => {
      const { nav, model } = latest.current;
      if (item.kind !== "feed" || !nav.current) return;
      const over = groupAt(model, measure(nav.current), y);
      if (over === hovered) return;
      hovered = over;
      armed = null;
      clearTimeout(timer);
      const group = model.groups.find((candidate) => listKey(candidate.entry.target) === over);
      const own = group?.children.some((child) => listKey(child.target) === key) ?? false;
      if (!group || own || !group.acceptsFeeds) return;
      timer = setTimeout(() => {
        armed = over;
        latest.current.unfold(over!);
        show();
      }, DWELL_MS);
    };
    /** Near the top or the bottom edge the list scrolls under the pointer, one step per frame. */
    const scrollAtEdge = () => {
      frame = requestAnimationFrame(scrollAtEdge);
      const nav = latest.current.nav.current;
      if (!dragging || !nav) return;
      const box = nav.getBoundingClientRect();
      const by = edgeScroll({ y, top: box.top, height: box.height, offset: nav.scrollTop, max: nav.scrollHeight - nav.clientHeight });
      if (by !== 0) nav.scrollTop += by;
    };
    const refresh = () => {
      if (!dragging) return;
      watch();
      show();
    };
    const swallowClick = (click: MouseEvent) => {
      click.preventDefault();
      click.stopPropagation();
    };
    const noMenu = (event: MouseEvent) => {
      if (dragging) event.preventDefault();
    };
    const end = () => {
      clearTimeout(timer);
      cancelAnimationFrame(frame);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", end);
      window.removeEventListener("blur", end);
      window.removeEventListener("keydown", keydown, true);
      window.removeEventListener("contextmenu", noMenu, true);
      latest.current.nav.current?.removeEventListener("scroll", refresh);
      document.body.style.removeProperty("user-select");
      document.body.style.removeProperty("cursor");
      stop.current = null;
      setDrag(null);
    };
    const move = (next: PointerEvent) => {
      // The button came up somewhere this page did not see.
      if (next.buttons === 0 && next.pointerType === "mouse" && dragging) return end();
      x = next.clientX;
      y = next.clientY;
      if (!dragging) {
        if (Math.hypot(next.clientX - start.x, next.clientY - start.y) < DRAG_START_PX) return;
        dragging = true;
        document.body.style.setProperty("user-select", "none");
        document.body.style.setProperty("cursor", "grabbing");
      }
      watch();
      show();
    };
    const up = (next: PointerEvent) => {
      if (!dragging) return end();
      x = next.clientX;
      y = next.clientY;
      const drop = current()?.drop;
      // The button came up over a link: the click that follows must not open it.
      window.addEventListener("click", swallowClick, { capture: true, once: true });
      setTimeout(() => window.removeEventListener("click", swallowClick, { capture: true }), 0);
      end();
      if (drop) latest.current.onMove(drop.move);
    };
    const keydown = (pressed: globalThis.KeyboardEvent) => {
      if (pressed.key !== "Escape" || !dragging) return;
      // Escape gives up the drag and nothing else: a dialog the list sits in stays open.
      pressed.preventDefault();
      pressed.stopPropagation();
      end();
      // The button is still down over a link; letting it go must not open that link.
      const release = () => {
        window.addEventListener("click", swallowClick, { capture: true, once: true });
        setTimeout(() => window.removeEventListener("click", swallowClick, { capture: true }), 0);
      };
      window.addEventListener("pointerup", release, { once: true });
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", end);
    window.addEventListener("blur", end);
    window.addEventListener("keydown", keydown, true);
    window.addEventListener("contextmenu", noMenu, true);
    latest.current.nav.current?.addEventListener("scroll", refresh);
    frame = requestAnimationFrame(scrollAtEdge);
    stop.current = end;
  }, []);

  return { drag, onPointerDown };
}

const MENU = "z-50 min-w-40 rounded-md border border-outline-strong bg-surface p-xs type-body-md text-on-surface";
const MENU_ITEM =
  "tap flex cursor-default items-center rounded-sm px-md py-xs outline-none data-[disabled]:text-on-surface-muted data-[highlighted]:bg-selected data-[highlighted]:outline-2 data-[highlighted]:-outline-offset-2 data-[highlighted]:outline-primary";

/**
 * Opens the menu of the entry from the keyboard: the menu key, or Shift+F10. Put on the whole row, so that it
 * also works from the fold button beside a category.
 */
export function openEntryMenu(event: KeyboardEvent<HTMLElement>): void {
  if (event.key !== "ContextMenu" && !(event.key === "F10" && event.shiftKey)) return;
  const link = event.currentTarget.querySelector("a");
  if (!link) return;
  event.preventDefault();
  const box = link.getBoundingClientRect();
  link.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: box.left + box.width / 2, clientY: box.bottom }));
}

/**
 * The menu of a category or a feed: one place up, one place down, and for a feed the way out. It is how the
 * order is changed without dragging. An entry that stays in place is returned as it is, without a menu.
 */
export function EntryMenu({
  entry,
  model,
  onMove,
  onUnsubscribe,
  children,
}: {
  entry: NavEntry;
  model: NavModel;
  onMove: (move: Move) => void;
  onUnsubscribe: (feedId: number) => void;
  /** The link of the entry. */
  children: ReactElement;
}) {
  const trigger = useRef<HTMLSpanElement>(null);
  const item = movableOf(entry.target);
  if (!item) return children;
  const up = stepMove(model, item, -1);
  const down = stepMove(model, item, 1);
  const focusEntry = () => trigger.current?.querySelector("a")?.focus();
  const run = (move: Move | null) => {
    if (!move) return;
    onMove(move);
    // The row is put elsewhere in the document, which takes the focus off it.
    setTimeout(focusEntry, 0);
  };
  return (
    <ContextMenu.Root>
      <ContextMenu.Trigger asChild>
        <span ref={trigger} className="flex min-w-0 flex-1">
          {children}
        </span>
      </ContextMenu.Trigger>
      <ContextMenu.Portal>
        <ContextMenu.Content
          className={MENU}
          aria-label={`${entry.label}の操作`}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            focusEntry();
          }}
        >
          <ContextMenu.Item className={MENU_ITEM} disabled={!up} onSelect={() => run(up)}>
            上へ移動
          </ContextMenu.Item>
          <ContextMenu.Item className={MENU_ITEM} disabled={!down} onSelect={() => run(down)}>
            下へ移動
          </ContextMenu.Item>
          {item.kind === "feed" ? (
            <>
              <ContextMenu.Separator className="my-xs border-t border-outline" />
              <ContextMenu.Item className={MENU_ITEM} onSelect={() => onUnsubscribe(item.id)}>
                登録を解除
              </ContextMenu.Item>
            </>
          ) : null}
        </ContextMenu.Content>
      </ContextMenu.Portal>
    </ContextMenu.Root>
  );
}
