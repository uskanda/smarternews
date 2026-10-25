import { formatShort } from "@smarternews/client";
import type { AnnotationListItem } from "@smarternews/core/api";
import { useLayoutEffect, useRef } from "react";
import { Link, useNavigate } from "react-router";
import { useAnnotationList } from "../api/queries.ts";
import { followScroll } from "../lib/follow.ts";
import { useHotkeys } from "../lib/keys.ts";
import { Button, ErrorNotice, Loading } from "../ui/controls.tsx";

/** Where a row of the list leads: the article, brought to the annotation. */
export const annotationPath = (item: Pick<AnnotationListItem, "articleId" | "id">): string => `/annotations/${item.articleId}?annotation=${item.id}`;

/** One annotation: the article it is on, the highlighted text or that it is a note on the article, the note, and when it was made. */
function AnnotationRow({ item, selected, timeZone, now }: { item: AnnotationListItem; selected: boolean; timeZone: string; now: Date }) {
  return (
    <li className={`border-b border-outline ${selected ? "bg-selected" : ""}`}>
      <Link to={annotationPath(item)} aria-current={selected ? "true" : undefined} className="flex flex-col gap-xs py-md pr-lg pl-lg">
        <span data-title className="type-label-md">
          {item.translatedTitle ?? item.title}
        </span>
        {item.kind === "highlight" ? (
          <span data-quote className="annotation-list-quote line-clamp-2 break-words type-body-md">
            {item.quote}
          </span>
        ) : (
          <span data-article-note className="type-label-sm text-on-surface-muted">
            記事へのメモ
          </span>
        )}
        {item.note !== null ? (
          <span data-note className="line-clamp-2 break-words type-body-md text-on-surface-muted">
            {item.note}
          </span>
        ) : null}
        <span className="tabular-nums type-label-sm text-on-surface-muted">{formatShort(item.createdAt, timeZone, now)}</span>
      </Link>
    </li>
  );
}

/**
 * The list of the reader's annotations, the last made first, one row per annotation: an article with several
 * has several rows. It offers none of the controls of an article list. `j` and `k` move through the rows.
 */
export function AnnotationList({ selected, timeZone, now }: { selected: number | null; timeZone: string; now: Date }) {
  const list = useAnnotationList();
  const navigate = useNavigate();
  const items = list.data?.pages.flatMap((page) => page.items) ?? [];
  const index = items.findIndex((item) => item.id === selected);
  const pane = useRef<HTMLDivElement>(null);
  const keyStep = useRef(0);
  const move = (step: 1 | -1) => {
    const target = items[index === -1 ? (step > 0 ? 0 : items.length - 1) : index + step];
    if (!target) return;
    keyStep.current = step;
    void navigate(annotationPath(target));
  };
  useHotkeys({ j: () => move(1), k: () => move(-1) });
  // A move with a key takes the list along, as in the article list.
  useLayoutEffect(() => {
    const step = keyStep.current;
    keyStep.current = 0;
    const row = pane.current?.querySelector('[aria-current="true"]')?.closest("li");
    if (step === 0 || !pane.current || !row) return;
    const view = pane.current.getBoundingClientRect();
    const box = row.getBoundingClientRect();
    const rowTop = box.top - view.top + pane.current.scrollTop;
    const to = followScroll({ top: pane.current.scrollTop, height: pane.current.clientHeight || view.height, rowTop, rowBottom: rowTop + box.height, step });
    if (to !== null) pane.current.scrollTop = to;
  }, [selected]);

  return (
    <section aria-label="注釈の一覧" className="flex h-full min-h-0 flex-col bg-surface">
      <header className="flex items-center justify-between gap-sm border-b border-outline px-lg py-md">
        <h1 className="min-w-0 truncate type-headline-md">注釈</h1>
        <Button onClick={() => void list.refetch()}>更新</Button>
      </header>
      <div ref={pane} data-list-scroll className="min-h-0 flex-1 overflow-y-auto">
        {list.isError ? <ErrorNotice error={list.error} onRetry={() => void list.refetch()} /> : null}
        {list.isPending ? <Loading /> : null}
        {list.isSuccess && items.length === 0 ? (
          <div className="flex flex-col items-start gap-sm p-lg type-body-md">
            <p>注釈はまだありません。</p>
            <p className="text-on-surface-muted">記事の本文の文字を選ぶと、ハイライトを付けたり、メモを書いたりできます。</p>
          </div>
        ) : null}
        <ul>
          {items.map((item) => (
            <AnnotationRow key={item.id} item={item} selected={item.id === selected} timeZone={timeZone} now={now} />
          ))}
        </ul>
        {list.hasNextPage ? (
          <div className="flex justify-center p-lg">
            <Button onClick={() => void list.fetchNextPage()} disabled={list.isFetchingNextPage}>
              さらに読み込む
            </Button>
          </div>
        ) : null}
      </div>
    </section>
  );
}
