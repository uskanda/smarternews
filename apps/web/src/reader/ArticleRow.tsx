import type { ArticleSummary } from "@smarternews/core/api";
import { Link } from "react-router";
import { formatShort } from "../lib/time.ts";
import { Badge } from "../ui/controls.tsx";

/**
 * One line of the list. Importance four gets a highlighter stroke in the margin and five has its headline
 * marked; both are also said in words for people who cannot see the mark.
 */
export function ArticleRow({
  article,
  to,
  selected,
  categoryName,
  timeZone,
  now,
}: {
  article: ArticleSummary;
  to: string;
  selected: boolean;
  categoryName: string;
  timeZone: string;
  now: Date;
}) {
  const marked = article.importance >= 4;
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
            {article.title}
          </span>
        </span>
        <span className="line-clamp-1 type-body-md text-on-surface-muted">{article.summary}</span>
        <span className="flex flex-wrap items-center gap-x-md gap-y-xs type-label-sm text-on-surface-muted">
          <span>{categoryName}</span>
          <span className="tabular-nums">{formatShort(article.updatedAt, timeZone, now)}</span>
          <span>出典{article.refCount}件</span>
          {article.revision > 0 ? <Badge>更新</Badge> : null}
          {article.unconfirmed ? <Badge tone="warning">未確認</Badge> : null}
          {article.starred ? <span>スター</span> : null}
        </span>
      </Link>
    </li>
  );
}
