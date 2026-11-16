import { useLayoutEffect, useRef, useState } from "react";
import { useLocation } from "react-router";

/** How many places are kept. The oldest go first; a session rarely goes back this far. */
const LIMIT = 200;

/** Where each region was scrolled to, by the history entry and the region's name. Gone on a reload. */
const positions = new Map<string, number>();

function remember(id: string, top: number): void {
  positions.delete(id);
  positions.set(id, top);
  if (positions.size > LIMIT) positions.delete(positions.keys().next().value!);
}

/** Forgets every place. For tests. */
export function resetScrollMemory(): void {
  positions.clear();
}

/**
 * Keeps where a scrolling region of the page was left, for each entry of the history, and puts it back when the
 * browser comes back to that entry. The browser does this for the document, but not for a region of its own.
 *
 * `name` tells apart the regions of one page. `ready` says the region's content is all there: until then the
 * region is not moved, and its scrolling is not taken for the reader's, so a short page while loading does not
 * cut the place short. Returns the ref to put on the region.
 */
export function useScrollMemory(name: string, ready: boolean): (element: HTMLElement | null) => void {
  const { key } = useLocation();
  const id = `${key}\n${name}`;
  const [element, setElement] = useState<HTMLElement | null>(null);
  /** The entry whose place is still to be put back. */
  const pending = useRef<string | null>(null);

  useLayoutEffect(() => {
    if (!element) return;
    if (positions.has(id)) {
      pending.current = id;
    } else {
      // A new entry. When a replaced search parameter made it, the region is where the old entry had it.
      pending.current = null;
      remember(id, element.scrollTop);
    }
    const onScroll = () => {
      if (pending.current !== id) remember(id, element.scrollTop);
    };
    element.addEventListener("scroll", onScroll, { passive: true });
    return () => element.removeEventListener("scroll", onScroll);
  }, [element, id]);

  useLayoutEffect(() => {
    if (!element || !ready || pending.current !== id) return;
    pending.current = null;
    element.scrollTop = positions.get(id) ?? 0;
  }, [element, id, ready]);

  return setElement;
}
