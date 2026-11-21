import type { Article, ArticleSummary } from "@smarternews/core/api";
import { formatShort } from "@smarternews/client";
import { useEffect, useRef, type ReactNode } from "react";
import { useArticle } from "../api/queries.ts";
import { HeadlineButton } from "./ArticleView.tsx";
import { SelectedMark } from "./SelectedMark.tsx";

/**
 * One article of the expanded list. Until it first comes into view it shows its headline, its details and its
 * summary: the article is not fetched, and nothing an open article asks for, a summary, a translation, the full
 * content or the record of its opening, is asked for. Once in view it shows what the article pane shows, given as
 * `children`, and `onShown` hears of the article once it has arrived.
 */
export function ExpandedArticle({
  summary,
  seen,
  target,
  root,
  sourceName,
  timeZone,
  now,
  onSeen,
  onShown,
  onHeadline,
  children,
}: {
  summary: ArticleSummary;
  /** Whether the article has been in view since the list was read. */
  seen: boolean;
  /** Whether the keys work on this article: the one at the top of the view. */
  target: boolean;
  /** The element the list scrolls in, which the article comes into view of. */
  root: HTMLElement | null;
  sourceName: string;
  timeZone: string;
  /** The time of now in milliseconds, to the minute. */
  now: number;
  onSeen: (id: number) => void;
  onShown: (article: Article) => void;
  onHeadline: () => void;
  children: ReactNode;
}) {
  const item = useRef<HTMLLIElement>(null);
  const latest = useRef({ onSeen, onShown });
  latest.current = { onSeen, onShown };
  const id = summary.id;

  useEffect(() => {
    const element = item.current;
    if (seen || !element || !root) return;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) latest.current.onSeen(id);
    }, { root });
    observer.observe(element);
    return () => observer.disconnect();
  }, [seen, root, id]);

  const article = useArticle(seen ? id : null).data;
  const shownId = article?.id;
  useEffect(() => {
    if (article) latest.current.onShown(article);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once for each article that arrives
  }, [shownId]);

  const headline = summary.translatedTitle ?? summary.title;
  return (
    <li ref={item} data-expanded-article data-article-id={id} data-read={summary.isRead} className="relative border-b border-outline">
      {target ? <SelectedMark /> : null}
      {seen ? (
        children
      ) : (
        // Room for the article to come, so that the articles below it do not come into view all at once.
        <div className="mx-auto flex min-h-[50vh] w-full max-w-measure-article flex-col gap-sm px-lg py-xl md:px-2xl">
          <p className="flex flex-wrap gap-x-md type-label-sm text-on-surface-muted">
            <span>{sourceName}</span>
            <span className="tabular-nums">{formatShort(summary.updatedAt, timeZone, new Date(now))}</span>
          </p>
          <h2 className="type-headline-lg">
            <HeadlineButton onClick={onHeadline}>{headline}</HeadlineButton>
          </h2>
          <p className="type-body-md text-on-surface-muted">{summary.summary}</p>
        </div>
      )}
    </li>
  );
}
