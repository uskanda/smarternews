import type { ArticleSummary } from "@smarternews/core/api";
import { Link } from "react-router";
import { formatShort } from "@smarternews/client";
import { Badge } from "../ui/controls.tsx";
import { Highlighted } from "./highlight.tsx";

/**
 * One line of the list. Importance four gets a highlighter stroke in the margin and five has its headline
 * marked; both are also said in words for people who cannot see the mark.
 */
export function ArticleRow({
  article,
  to,
  selected,
  sourceName,
  timeZone,
  now,
  time = "updated",
  excerpt = null,
  terms,
}: {
  article: ArticleSummary;
  to: string;
  selected: boolean;
  /** The category of a generated article, the feed of a feed article. */
  sourceName: string;
  timeZone: string;
  now: Date;
  /** Which time the row shows: when the article was last updated, or, in the recently read articles, when it was read. */
  time?: "updated" | "read";
  /** In search results: the text around the match, shown in place of the summary when there is one. */
  excerpt?: string | null;
  /** In search results: the words to mark in the headline and the excerpt. */
  terms?: readonly string[];
}) {
  // A feed article has no importance, and so no mark.
  const marked = (article.importance ?? 0) >= 4;
  return (
    <li
      data-read={article.isRead}
      data-importance={marked ? article.importance : undefined}
      className={`relative border-b border-outline ${selected ? "bg-selected" : ""}`}
    >
      {marked ? (
        <span
          aria-hidden="true"
          className={`absolute left-xs w-xs rounded-sm bg-mark ${article.importance === 5 ? "inset-y-md" : "top-md h-lg"}`}
        />
      ) : null}
      <Link to={to} aria-current={selected ? "true" : undefined} className="flex flex-col gap-px py-md pr-lg pl-lg">
        <span className={article.isRead ? "type-body-md text-on-surface-muted" : "type-label-md"}>
          {marked ? <span className="sr-only">重要度{article.importance}。</span> : null}
          <span data-title className={article.importance === 5 ? "headline-mark" : ""}>
            <Highlighted text={article.translatedTitle ?? article.title} terms={terms} />
          </span>
        </span>
        {excerpt !== null ? (
          <span data-excerpt className="line-clamp-2 type-body-md text-on-surface-muted">
            <Highlighted text={excerpt} terms={terms} />
          </span>
        ) : (
          <span className="line-clamp-1 type-body-md text-on-surface-muted">
            <Highlighted text={article.summary} terms={terms} />
          </span>
        )}
        <span className="flex flex-wrap items-center gap-x-md gap-y-xs type-label-sm text-on-surface-muted">
          <span>{sourceName}</span>
          <span className="tabular-nums">{formatShort(time === "read" ? (article.readAt ?? article.updatedAt) : article.updatedAt, timeZone, now)}</span>
          {article.origin === "generated" ? <span>出典{article.refCount}件</span> : null}
          {article.revision > 0 ? <Badge>更新</Badge> : null}
          {article.unconfirmed ? <Badge tone="warning">未確認</Badge> : null}
          {article.starred ? <span>スター</span> : null}
        </span>
      </Link>
    </li>
  );
}
