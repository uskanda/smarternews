import * as ContextMenu from "@radix-ui/react-context-menu";
import {
  applyMove,
  createMoveQueue,
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
  type MoveQueue,
  type NavEntry,
  type NavModel,
  type Row,
} from "@smarternews/client";
import type { Category, Feed } from "@smarternews/core/api";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type PointerEvent as ReactPointerEvent, type ReactElement, type RefObject } from "react";
import { useNavigate } from "react-router";
import { useApp } from "../app/context.ts";
import { categorySettingsPath } from "../lib/paths.ts";
import { useToast } from "./toast.tsx";

/** A drag starts once the pointer has moved this far; before that the press is a click on the entry. */
const DRAG_START_PX = 4;
/** How far to the side of the list the pointer may stray while the entry can still be put down. */
const SIDE_SLACK_PX = 48;

const idsOf = (list: Array<{ id: number }>) => list.map((entry) => entry.id).join(",");

/** The lists a move changes. A fetch of them that is under way would put back the order from before the move. */
const ORDERED = ["categories", "feeds"];

/**
 * Applies a move: the list changes at once, then the server is told. Moves are sent one at a time, and the
 * lists take the server's answer only when no move is left to send. Fetches of the lists are called off while
 * moves are under way. When the server refuses or cannot be reached, the moves still waiting are dropped,
 * the list goes back to what is stored and a notice says so.
 */
export function useNavMoves(): (move: Move) => void {
  const { api } = useApp();
  const client = useQueryClient();
  const toast = useToast();
  const latest = useRef({ client, toast });
  latest.current = { client, toast };
  /** A feed went into another category since the queue was last empty: its articles follow it. */
  const regrouped = useRef(false);
  /** The lists as the server stored them when the queue was last empty. */
  const stored = useRef<{ categories: Category[]; feeds: Feed[] }>({ categories: [], feeds: [] });
  const queue = useRef<MoveQueue | null>(null);
  queue.current ??= createMoveQueue({
    onSettled: (answer) => {
      const { client } = latest.current;
      if (answer.categories) client.setQueryData(["categories"], answer.categories);
      if (answer.feeds) client.setQueryData(["feeds"], answer.feeds);
      if (regrouped.current) for (const key of ["counts", "articles"]) void client.invalidateQueries({ queryKey: [key] });
      regrouped.current = false;
    },
    onFailed: (_error, answered) => {
      const { client, toast } = latest.current;
      // What the server stored: the order before these moves, with the ones it took before the failure. The
      // lists are asked for again as well, in case the server can still be reached.
      const back = { ...stored.current, ...answered };
      client.setQueryData(["categories"], back.categories);
      client.setQueryData(["feeds"], back.feeds);
      for (const key of regrouped.current ? [...ORDERED, "counts", "articles"] : ORDERED) void client.invalidateQueries({ queryKey: [key] });
      regrouped.current = false;
      toast({ message: "並べ替えられませんでした。もう一度試してください。" });
    },
  });

  // A fetch of the lists that starts while moves are under way, such as the one each minute, is called off.
  useEffect(
    () =>
      client.getQueryCache().subscribe((event) => {
        const key = event.query.queryKey[0];
        if (typeof key !== "string" || !ORDERED.includes(key) || event.query.state.fetchStatus !== "fetching" || !queue.current?.busy()) return;
        queueMicrotask(() => void client.cancelQueries({ queryKey: [key] }));
      }),
    [client],
  );

  return useCallback(
    (move: Move) => {
      const before = { categories: client.getQueryData<Category[]>(["categories"]) ?? [], feeds: client.getQueryData<Feed[]>(["feeds"]) ?? [] };
      const after = applyMove(before, move);
      const sameCategory = move.kind === "category" || before.feeds.find((feed) => feed.id === move.id)?.categoryId === move.categoryId;
      if (sameCategory && idsOf(after.categories) === idsOf(before.categories) && idsOf(after.feeds) === idsOf(before.feeds)) return;
      // A fetch that is under way would answer with the order from before the move. Calling it off puts back
      // what the list held when it started, at once, so the move is written over that.
      for (const key of ORDERED) void client.cancelQueries({ queryKey: [key] });
      if (!queue.current!.busy()) stored.current = before;
      client.setQueryData(["categories"], after.categories);
      client.setQueryData(["feeds"], after.feeds);
      if (!sameCategory) regrouped.current = true;
      queue.current!.push(() =>
        move.kind === "category"
          ? api.moveCategory(move.id, move.before).then((categories) => ({ categories }))
          : api.moveFeed(move.id, { categoryId: move.categoryId, before: move.before }).then((feeds) => ({ feeds })),
      );
    },
    [api, client],
  );
}

export interface DragState {
  /** `listKey` of the entry that is being dragged. */
  key: string;
  /** Its name, carried along under the pointer. */
  label: string;
  /** Where the pointer is in the window. */
  x: number;
  y: number;
  /** Where the line that shows the place is, from the top of the scrolled list. Null where the entry cannot go. */
  lineTop: number | null;
  /**
   * The category a dragged feed is over, when a feed can go into it. "ready" is its own category, which takes
   * it at once; "waiting" is another one that it has to stay over first; "flash" is that one once the wait
   * is over. Null for a dragged category, and over a category that holds no feeds.
   */
  over: { key: string; state: "ready" | "waiting" | "flash" } | null;
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
    /** What the group under the pointer is to the dragged feed: its own, another that takes feeds, or neither. */
    let hoveredKind: "own" | "other" | null = null;
    let armed: string | null = null;
    const label = [...latest.current.model.groups.map((group) => group.entry), ...latest.current.model.groups.flatMap((group) => group.children)].find(
      (entry) => listKey(entry.target) === key,
    )?.label ?? "";
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
      const box = now.nav.getBoundingClientRect();
      const lineTop = now.drop ? now.drop.lineY - box.top + now.nav.scrollTop : null;
      const beside = x >= box.left - SIDE_SLACK_PX && x <= box.right + SIDE_SLACK_PX;
      const over =
        hovered !== null && hoveredKind !== null && beside
          ? { key: hovered, state: hoveredKind === "own" ? ("ready" as const) : armed === hovered ? ("flash" as const) : ("waiting" as const) }
          : null;
      setDrag({ key, label, x, y, lineTop, over });
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
      hoveredKind = !group || !group.acceptsFeeds ? null : own ? "own" : "other";
      if (hoveredKind !== "other") return;
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

export const MENU = "z-50 min-w-40 rounded-md border border-outline-strong bg-surface p-xs type-body-md text-on-surface";
export const MENU_ITEM =
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
 * The menu of a category or a feed: one place up, one place down, then for a feed the way out and for a category
 * its settings. It is how the order is changed without dragging. An entry that stays in place is returned as it is, without a menu.
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
  const navigate = useNavigate();
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
          // The menu takes its keys from the list behind it, which would move under the open menu.
          data-hotkeys="off"
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
          <ContextMenu.Separator className="my-xs border-t border-outline" />
          {item.kind === "feed" ? (
            <ContextMenu.Item className={MENU_ITEM} onSelect={() => onUnsubscribe(item.id)}>
              登録を解除
            </ContextMenu.Item>
          ) : (
            <ContextMenu.Item className={MENU_ITEM} onSelect={() => void navigate(categorySettingsPath(item.id))}>
              カテゴリの設定
            </ContextMenu.Item>
          )}
        </ContextMenu.Content>
      </ContextMenu.Portal>
    </ContextMenu.Root>
  );
}
