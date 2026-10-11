import type { Article } from "@smarternews/core/api";
import { useEffect, useRef } from "react";
import { Link } from "react-router";
import { ApiError, eventTime, formatDay, formatFull, registrationLabel } from "@smarternews/client";
import { useArticle } from "../api/queries.ts";
import { Badge, Button, ErrorNotice, Loading } from "../ui/controls.tsx";
import { Markdown } from "./Markdown.tsx";

function EventDetails({ article, timeZone }: { article: Article; timeZone: string }) {
  const event = article.event!;
  const registration = registrationLabel(event.registration);
  const day = formatDay(event.startsAt, timeZone);
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-lg gap-y-xs type-body-md">
      <dt className="text-on-surface-muted">日時</dt>
      <dd>
        {day.date} {day.weekday} {eventTime(event, timeZone)}
      </dd>
      {event.venue ? (
        <>
          <dt className="text-on-surface-muted">会場</dt>
          <dd>{event.venue}</dd>
        </>
      ) : null}
      {event.fee ? (
        <>
          <dt className="text-on-surface-muted">料金</dt>
          <dd>{event.fee}</dd>
        </>
      ) : null}
      {registration ? (
        <>
          <dt className="text-on-surface-muted">申込</dt>
          <dd>{registration}</dd>
        </>
      ) : null}
    </dl>
  );
}

/** The article pane: what the story is, what it means for the reader, the text, and where it came from. */
export function ArticleView({
  id,
  categoryName,
  feedName,
  timeZone,
  backTo,
  articlePath,
  onToggleStar,
  onToggleRead,
}: {
  id: number;
  categoryName: (categoryId: number | null) => string;
  feedName: (feedId: number | null) => string;
  timeZone: string;
  /** Set on a narrow screen, where the list is on another pane. */
  backTo: string | null;
  articlePath: (id: number) => string;
  onToggleStar: (article: Article) => void;
  onToggleRead: (article: Article) => void;
}) {
  const query = useArticle(id);
  const article = query.data;
  const previous = useArticle(article?.previousArticleId ?? null).data;

  // On a narrow screen the article replaces the list, and the link that was activated is gone:
  // the focus moves to the headline so that keyboard and screen reader users land in the article.
  const heading = useRef<HTMLHeadingElement>(null);
  const narrow = backTo !== null;
  const loadedId = article?.id;
  useEffect(() => {
    if (narrow && loadedId !== undefined) heading.current?.focus();
  }, [narrow, loadedId]);

  const back = backTo ? (
    <Link to={backTo} className="tap type-body-md text-primary underline underline-offset-4">
      一覧へ戻る
    </Link>
  ) : null;

  if (query.isError) {
    const missing = query.error instanceof ApiError && query.error.kind === "not_found";
    return (
      <div className="flex flex-col gap-md p-xl">
        {back}
        {missing ? (
          <p className="type-body-md">この記事はありません。保存期間を過ぎて削除された可能性があります。</p>
        ) : (
          <ErrorNotice error={query.error} onRetry={() => void query.refetch()} />
        )}
      </div>
    );
  }
  if (!article) return <Loading />;
  // A feed article is what another site delivered: no importance, no sources; the way to its page instead.
  const delivered = article.origin === "feed";

  return (
    <article aria-label="記事" className="min-w-0 px-lg py-xl md:px-2xl">
      {/* One column, at most `measure-article` wide in characters of the body text, in the middle of the pane. */}
      <div className="mx-auto flex w-full max-w-measure-article flex-col gap-lg type-body-lg">
        {back}
        <div className="flex flex-wrap items-center gap-x-md gap-y-xs type-label-sm text-on-surface-muted">
          {delivered ? (
            <>
              <span>{feedName(article.feedId)}</span>
              {article.author ? <span>{article.author}</span> : null}
              <span>{formatFull(article.updatedAt, timeZone)} に公開</span>
            </>
          ) : (
            <>
              <span>{categoryName(article.categoryId)}</span>
              <span>{formatFull(article.updatedAt, timeZone)} に更新</span>
              <span>重要度 {article.importance}</span>
            </>
          )}
          {article.revision > 0 ? <span>更新 {article.revision}回</span> : null}
          {article.starred ? <span>スター</span> : null}
        </div>
        <h2 ref={heading} tabIndex={-1} className="text-balance type-headline-lg focus:outline-none">
          {article.title}
        </h2>
        {article.unconfirmed ? (
          <p className="flex items-baseline gap-sm type-body-md">
            <Badge tone="warning">未確認</Badge>
            <span>噂や非公式の情報に基づいています。</span>
          </p>
        ) : null}
        {article.impact ? (
          <section aria-label="読み手への影響" className="border-l-4 border-mark pl-md">
            <h3 className="type-label-sm text-on-surface-muted">読み手への影響</h3>
            <p className="type-body-md">{article.impact}</p>
          </section>
        ) : null}
        {article.event ? <EventDetails article={article} timeZone={timeZone} /> : null}
        {delivered && article.primaryUrl ? (
          <p className="type-body-md">
            <a href={article.primaryUrl} target="_blank" rel="noopener noreferrer" className="tap text-primary underline underline-offset-4">
              元のページを開く
            </a>
          </p>
        ) : null}
        <div className="article-body type-body-lg">
          <Markdown text={article.body} images={delivered} />
        </div>
        {previous ? (
          <p className="type-body-md">
            <span className="text-on-surface-muted">この話題の前の記事 </span>
            <Link to={articlePath(previous.id)} className="text-primary underline underline-offset-4">
              {previous.title}
            </Link>
          </p>
        ) : null}
        {delivered ? null : (
        <section aria-label="出典" className="flex flex-col gap-xs">
          <h3 className="type-label-sm text-on-surface-muted">出典</h3>
          {article.snippetOnly ? (
            <p className="type-label-sm text-on-surface-muted">出典のページを読めなかったため、抜粋から書いています。</p>
          ) : null}
          <ul className="flex flex-col gap-xs type-body-md">
            {article.refs.map((ref) => (
              <li key={ref.url} className="min-w-0">
                <a href={ref.url} target="_blank" rel="noopener noreferrer" className="tap break-words text-primary underline underline-offset-4">
                  {ref.title || ref.url}
                </a>
                {ref.siteName ? <span className="pl-sm text-on-surface-muted">{ref.siteName}</span> : null}
              </li>
            ))}
          </ul>
        </section>
        )}
        <div className="flex flex-wrap gap-sm">
          <Button aria-pressed={article.starred} onClick={() => onToggleStar(article)}>
            {article.starred ? "スターを外す" : "スターを付ける"}
          </Button>
          <Button onClick={() => onToggleRead(article)}>{article.isRead ? "未読に戻す" : "既読にする"}</Button>
        </div>
      </div>
    </article>
  );
}
