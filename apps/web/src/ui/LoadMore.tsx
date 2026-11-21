import { useEffect, useRef, type RefObject } from "react";
import { Button, Loading } from "./controls.tsx";

/** What `LoadMore` reads of a list fetched a page at a time (`useInfiniteQuery`). */
export interface PagedList {
  data?: { pages: readonly unknown[] } | undefined;
  hasNextPage: boolean;
  isFetching: boolean;
  isFetchingNextPage: boolean;
  isError: boolean;
  isFetchNextPageError: boolean;
  fetchNextPage: () => Promise<unknown>;
}

/** How far before the end of a list the next page is asked for: a list's height. */
export const LOAD_MORE_MARGIN = "0px 0px 100% 0px";

/**
 * The end of a list fetched a page at a time. A mark right after the last row asks for the next page once it
 * comes within a list's height of the visible part of `scroller`. While the page is on its way it says so;
 * when it could not be had, it says that and offers a button to try again, and asks for nothing by itself until
 * the button is pressed, the list is fetched again or another list is shown.
 */
export function LoadMore({ list, scroller }: { list: PagedList; scroller: RefObject<HTMLElement | null> }) {
  const mark = useRef<HTMLDivElement>(null);
  const fetchNext = useRef(list.fetchNextPage);
  fetchNext.current = list.fetchNextPage;
  const pages = list.data?.pages.length ?? 0;
  // Watching starts anew after each page and when an error clears: an observer tells once when it starts,
  // so a mark still in range after 50 rows were added asks for the next page at once.
  const watching = list.hasNextPage && !list.isFetching && !list.isError;
  useEffect(() => {
    const target = mark.current;
    const root = scroller.current;
    if (!watching || !target || !root) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          observer.disconnect();
          void fetchNext.current();
        }
      },
      { root, rootMargin: LOAD_MORE_MARGIN },
    );
    observer.observe(target);
    return () => observer.disconnect();
  }, [watching, pages, scroller]);

  if (!list.hasNextPage) return null;
  return (
    <>
      <div ref={mark} data-load-more aria-hidden="true" />
      {list.isFetchingNextPage ? <Loading /> : null}
      {list.isFetchNextPageError ? (
        <div role="alert" className="flex flex-col items-center gap-sm p-lg type-body-md">
          <p className="text-error">続きを読み込めませんでした</p>
          <Button onClick={() => void list.fetchNextPage()}>さらに読み込む</Button>
        </div>
      ) : null}
    </>
  );
}
