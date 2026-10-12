// Moving categories and feeds in the drawer: a long press picks an entry up, and it goes where it is let go.
import { applyMove, dropAt, DWELL_MS, edgeScroll, groupAt, listKey, movableOf, parseListKey, type Move, type NavModel, type Row } from "@smarternews/client";
import type { Category, Feed } from "@smarternews/core/api";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement, type RefObject } from "react";
import type { ScrollView } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import { useApp } from "../api/AppProvider";
import { useToast } from "../ui/toast";

/** How long a finger rests on an entry before it is picked up. */
export const LONG_PRESS_MS = 400;
const FRAME_MS = 16;

const idsOf = (list: Array<{ id: number }>) => list.map((entry) => entry.id).join(",");

/**
 * Applies a move: the drawer changes at once, then the server is told. When the server refuses or cannot be
 * reached, the drawer goes back to what is stored and a notice says so.
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
  /** `listKey` of the entry that is held. */
  key: string;
  /** Where the finger is, from the top of the scrolled content. */
  y: number;
  /** Where the line that shows the place is, from the top of the content. Null where the entry cannot go. */
  lineY: number | null;
  /** The group a feed may be put into after it stayed over it. */
  armed: string | null;
}

export interface DragHandlers {
  start: (key: string, absoluteY: number) => void;
  move: (absoluteY: number) => void;
  /** `absoluteY` is null when the gesture was taken away instead of ending. */
  end: (absoluteY: number | null) => void;
}

/** What the drawer knows about its own place on screen, kept up to date by its layout and scroll events. */
export interface DrawerGeometry {
  /** Rows by `listKey`: top and height within the scrolled content. */
  rows: Map<string, { y: number; height: number }>;
  /** The top of the list on screen, how much of it shows, how far it is scrolled and how far it can be. */
  top: number;
  height: number;
  offset: number;
  contentHeight: number;
}

export function useDrawerDrag(options: {
  scroll: RefObject<ScrollView | null>;
  geometry: RefObject<DrawerGeometry>;
  model: NavModel;
  onMove: (move: Move) => void;
  /** Opens a folded group that a feed stays over. */
  unfold: (groupKey: string) => void;
}): { drag: DragState | null; handlers: DragHandlers } {
  const [drag, setDrag] = useState<DragState | null>(null);
  const latest = useRef(options);
  latest.current = options;
  const held = useRef<{ key: string; absoluteY: number; hovered: string | null; armed: string | null; timer?: ReturnType<typeof setTimeout>; ticker?: ReturnType<typeof setInterval> } | null>(null);

  const handlers = useMemo<DragHandlers>(() => {
    const rows = (): Row[] => [...latest.current.geometry.current.rows].map(([key, box]) => ({ key, top: box.y, bottom: box.y + box.height }));
    const contentY = (absoluteY: number) => absoluteY - latest.current.geometry.current.top + latest.current.geometry.current.offset;
    const drop = () => {
      const now = held.current;
      const target = now ? parseListKey(now.key) : null;
      const item = target ? movableOf(target) : null;
      return now && item ? dropAt({ model: latest.current.model, rows: rows(), dragged: item, y: contentY(now.absoluteY), armed: now.armed }) : null;
    };
    const show = () => {
      const now = held.current;
      if (now) setDrag({ key: now.key, y: contentY(now.absoluteY), lineY: drop()?.lineY ?? null, armed: now.armed });
    };
    /** A feed over another category waits there; the category is armed when the wait is over. */
    const watch = () => {
      const now = held.current;
      if (!now || !now.key.startsWith("feed-")) return;
      const { model } = latest.current;
      const over = groupAt(model, rows(), contentY(now.absoluteY));
      if (over === now.hovered) return;
      now.hovered = over;
      now.armed = null;
      clearTimeout(now.timer);
      const group = model.groups.find((candidate) => listKey(candidate.entry.target) === over);
      const own = group?.children.some((child) => listKey(child.target) === now.key) ?? false;
      if (!group || own || !group.acceptsFeeds) return;
      now.timer = setTimeout(() => {
        if (held.current !== now) return;
        now.armed = over;
        latest.current.unfold(over!);
        show();
      }, DWELL_MS);
    };
    /** While the finger is near the top or the bottom, the drawer scrolls under it. */
    const tick = () => {
      const now = held.current;
      if (!now) return;
      const geometry = latest.current.geometry.current;
      const by = edgeScroll({ y: now.absoluteY, top: geometry.top, height: geometry.height, offset: geometry.offset, max: Math.max(0, geometry.contentHeight - geometry.height) });
      if (by === 0) return;
      geometry.offset += by;
      latest.current.scroll.current?.scrollTo({ y: geometry.offset, animated: false });
      watch();
      show();
    };
    const stop = () => {
      clearTimeout(held.current?.timer);
      clearInterval(held.current?.ticker);
      held.current = null;
      setDrag(null);
    };
    return {
      start(key, absoluteY) {
        stop();
        held.current = { key, absoluteY, hovered: null, armed: null };
        held.current.ticker = setInterval(tick, FRAME_MS);
        watch();
        show();
      },
      move(absoluteY) {
        if (!held.current) return;
        held.current.absoluteY = absoluteY;
        watch();
        show();
      },
      end(absoluteY) {
        if (!held.current) return;
        if (absoluteY !== null) held.current.absoluteY = absoluteY;
        const result = absoluteY === null ? null : drop();
        stop();
        if (result) latest.current.onMove(result.move);
      },
    };
  }, []);

  useEffect(() => () => handlers.end(null), [handlers]);
  return { drag, handlers };
}

/** A row that a long press picks up. A row that stays in place is returned as it is. */
export function DragRow({ dragKey, handlers, children }: { dragKey: string; handlers: DragHandlers; children: ReactElement }) {
  const target = parseListKey(dragKey);
  const movable = target !== null && movableOf(target) !== null;
  const gesture = useMemo(
    () =>
      Gesture.Pan()
        .activateAfterLongPress(LONG_PRESS_MS)
        .runOnJS(true)
        .withTestId(`drag-${dragKey}`)
        .onStart((event) => handlers.start(dragKey, event.absoluteY))
        .onUpdate((event) => handlers.move(event.absoluteY))
        .onFinalize((event, success) => handlers.end(success ? event.absoluteY : null)),
    [dragKey, handlers],
  );
  return movable ? <GestureDetector gesture={gesture}>{children}</GestureDetector> : children;
}
