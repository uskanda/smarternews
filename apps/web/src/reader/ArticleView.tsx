import type { Article, ArticleRef, ArticleTranslation } from "@smarternews/core/api";
import { useEffect, useRef } from "react";
import { Link } from "react-router";
import { ApiError, type TermMatcher, eventTime, formatDate, formatDay, formatFull, fullContentErrorLabel, registrationLabel } from "@smarternews/client";
import { useArticle, useArticleTranslation, useSummaryRequest, useTermMatcher } from "../api/queries.ts";
import { Badge, Button, ErrorNotice, Loading, StarMark } from "../ui/controls.tsx";
import { listPathOf, topicEditPath } from "../lib/paths.ts";
import { AnnotatedBody, ArticleNoteSection, FILTER_SOURCE_ATTRIBUTE, SEGMENT_ATTRIBUTE } from "./Annotations.tsx";
import { Highlighted, type AnnotationMarks } from "./highlight.tsx";
import { Markdown } from "./Markdown.tsx";
import { Attachments } from "./Attachments.tsx";
import { Mentions } from "./Mentions.tsx";

/** The attribute that makes an element an original part of the body, in which a selection can be highlighted. */
const segmentAttribute = (index: number) => ({ [SEGMENT_ATTRIBUTE]: String(index) });

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

/**
 * The content of a translated feed article: segment by segment, the translation as the text to read and the
 * original right under it. The pairs come from the server as they are shown; nothing is matched up here.
 * A segment without a translation, and one whose translation says the same in the same words, is shown once.
 * Only the originals carry the reader's highlights: `marksFor` gives each its marks.
 */
function TranslatedBody({
  translation,
  terms,
  groups,
  marksFor,
}: {
  translation: ArticleTranslation;
  terms?: readonly string[];
  groups: TermMatcher;
  marksFor: (index: number) => AnnotationMarks | undefined;
}) {
  const lang = translation.sourceLanguage ?? undefined;
  const lastTranslated = translation.segments.findLastIndex((segment) => segment.translated !== null);
  return (
    <div className="article-body type-body-lg">
      {translation.segments.flatMap((segment, index) => {
        const paired = segment.translated !== null && segment.translated.trim() !== segment.original.trim();
        const shown = paired ? (
          <div key={index} className="segment">
            <div>
              <Markdown text={segment.translated!} images highlight={terms} groups={groups} />
            </div>
            <div className="segment-original" lang={lang} {...segmentAttribute(index)}>
              <Markdown text={segment.original} images plainHeadings highlight={terms} groups={groups} annotations={marksFor(index)} />
            </div>
          </div>
        ) : (
          <div key={index} className="segment-alone" {...segmentAttribute(index)}>
            <Markdown text={segment.original} images highlight={terms} groups={groups} annotations={marksFor(index)} />
          </div>
        );
        return translation.truncated && index === lastTranslated
          ? [
              shown,
              <p key="rest" role="note" className="type-label-sm text-on-surface-muted">
                長い記事のため、ここから先は翻訳していません。
              </p>,
            ]
          : [shown];
      })}
    </div>
  );
}

/** What the reader can do with the full content of a feed article, and what is shown of it now. */
export interface FullContentControl {
  /** The page is being fetched for this article. */
  fetching: boolean;
  /** The last request for this article got no answer. */
  requestFailed: boolean;
  /** The reader switched to what the feed delivered. Held for this visit to the article only. */
  showDelivered: boolean;
  onFetch: () => void;
  onToggle: () => void;
}

/**
 * The line before the content of a feed article: which content is shown and the switch between the two, the
 * fetch under way, or the way to fetch the full content with the reason an earlier fetch failed.
 */
function FullContentBar({ article, control }: { article: Article; control: FullContentControl }) {
  if (article.fullContent !== null) {
    return (
      <div className="flex flex-wrap items-center gap-x-md gap-y-xs">
        <p className="type-label-sm text-on-surface-muted">
          {control.showDelivered ? "配信された内容を表示しています。" : "元のページから取得した全文を表示しています。"}
        </p>
        <Button onClick={control.onToggle}>{control.showDelivered ? "全文を表示" : "配信された内容を表示"}</Button>
      </div>
    );
  }
  if (control.fetching) {
    return (
      <p role="status" className="type-label-sm text-on-surface-muted">
        全文を取得しています。
      </p>
    );
  }
  const failure = control.requestFailed
    ? "全文を取得できませんでした。通信に失敗しました。"
    : article.fullContentError
      ? `全文を取得できませんでした。${fullContentErrorLabel(article.fullContentError)}`
      : null;
  return (
    <div className="flex flex-wrap items-center gap-x-md gap-y-xs">
      {failure ? (
        <p role="status" className="type-body-md">
          {failure}
        </p>
      ) : null}
      <Button onClick={control.onFetch}>{failure ? "全文を取得し直す" : "全文を取得"}</Button>
    </div>
  );
}

/** An article beside the one open, in the order of the list. */
export interface ArticleNeighbor {
  title: string;
  to: string;
}

/** The articles before and after the one open, offered at the end of the body on a narrow screen. */
export interface ArticleNeighbors {
  previous: ArticleNeighbor | null;
  next: ArticleNeighbor | null;
  /** Past the last article loaded while the list has more: loads the next page and opens its first article. */
  more: (() => void) | null;
}

/**
 * Why the judgement chose a source of a generated article: its importance and its reason, on one quiet line.
 * The reason is text a model wrote, so it is shown as plain words and never as markup.
 */
function SourceReason({ source }: { source: ArticleRef }) {
  const parts = [source.importance === null ? null : `重要度 ${source.importance}`, source.reason].filter((part) => part);
  if (parts.length === 0) return null;
  return <p className="break-words type-label-sm text-on-surface-muted">{parts.join("・")}</p>;
}

const MOVE = "tap flex min-w-0 flex-col gap-px rounded-md border border-outline px-lg py-sm text-left";

/** The way to the article before and after this one, each with its headline on one line. */
function NeighborLinks({ neighbors }: { neighbors: ArticleNeighbors }) {
  const { previous, next, more } = neighbors;
  if (!previous && !next && !more) return null;
  const line = (title: string) => (
    <span className="truncate type-body-md text-primary" title={title}>
      {title}
    </span>
  );
  return (
    <nav aria-label="記事の移動" className="flex flex-col gap-sm">
      {previous ? (
        <Link to={previous.to} className={MOVE}>
          <span className="type-label-sm text-on-surface-muted">前の記事</span>
          {line(previous.title)}
        </Link>
      ) : null}
      {next ? (
        <Link to={next.to} className={MOVE}>
          <span className="type-label-sm text-on-surface-muted">次の記事</span>
          {line(next.title)}
        </Link>
      ) : more ? (
        <button type="button" onClick={more} className={MOVE}>
          <span className="type-label-sm text-on-surface-muted">次の記事</span>
          <span className="type-body-md text-primary">続きを読み込んで開きます</span>
        </button>
      ) : null}
    </nav>
  );
}

/** What stands in the place of the summary while there is none yet. */
const SUMMARY_NOTES = {
  waiting: "AIによる要約を作っています。",
  limit: "今日の要約の上限に達しました。この記事の要約は、明日以降に作ります。",
  late: "要約に時間がかかっています。あとでこの記事を開き直してください。",
} as const;

/** The article pane: what the story is, what it means for the reader, the text, and where it came from. */
export function ArticleView({
  id,
  categoryName,
  feedName,
  timeZone,
  backTo,
  articlePath,
  neighbors = null,
  onToggleStar,
  onToggleRead,
  onToggleMiss,
  fullContent,
  terms,
  focusAnnotation = null,
}: {
  id: number;
  categoryName: (categoryId: number | null) => string;
  feedName: (feedId: number | null) => string;
  timeZone: string;
  /** Set on a narrow screen, where the list is on another pane. */
  backTo: string | null;
  articlePath: (id: number) => string;
  /** Set on a narrow screen, where the list is out of sight: the articles before and after this one. */
  neighbors?: ArticleNeighbors | null;
  onToggleStar: (article: Article) => void;
  onToggleRead: (article: Article) => void;
  /** Marks a generated article as a miss, or takes the mark away. Not offered for a feed article. */
  onToggleMiss: (article: Article) => void;
  /** The full content of a feed article: fetching it and switching to what the feed delivered. */
  fullContent: FullContentControl;
  /** The words of the search the article was opened from, marked in its headline and text. */
  terms?: readonly string[];
  /** The annotation chosen in the list of annotations: the body is brought to it. */
  focusAnnotation?: number | null;
}) {
  const query = useArticle(id);
  const article = query.data;
  const translating = useArticleTranslation(article);
  const summaryState = useSummaryRequest(article);
  const groups = useTermMatcher();

  // On a narrow screen the article replaces the list, and the link that was activated is gone:
  // the focus moves to the headline so that keyboard and screen reader users land in the article.
  const heading = useRef<HTMLHeadingElement>(null);
  const pane = useRef<HTMLElement>(null);
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
  // The full content stands in the place of what the feed delivered, unless the reader switched back to that.
  const fullShown = article.fullContent !== null && !fullContent.showDelivered;
  const translated = article.translation !== null && (fullShown || article.fullContent === null);
  // The title as the site wrote it, which a filter matches: the line under a translated title, or the headline.
  const originalTitleShown = article.translatedTitle !== null && article.translatedTitle !== article.title;
  const filterSource = (original: boolean) => (delivered && original ? { [FILTER_SOURCE_ATTRIBUTE]: "" } : {});

  return (
    <article ref={pane} aria-label="記事" className="min-w-0 px-lg py-xl md:px-2xl">
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
          {article.starred ? <StarMark /> : null}
        </div>
        {!delivered && article.categoryId !== null && article.topics.length > 0 ? (
          // The topics that chose this article, each a way to the editor of that topic: where a miss is fixed.
          // A long topic is cut to two lines on the screen; the whole of it stays in the link, to be read out.
          <section aria-label="トピック" className="flex flex-col gap-xs">
            <h3 className="type-label-sm text-on-surface-muted">トピック</h3>
            <ul className="flex flex-col gap-xs type-body-md">
              {article.topics.map((topic) => (
                <li key={topic.id} className="min-w-0">
                  <Link
                    to={topicEditPath(article.categoryId!, topic.id)}
                    title={topic.text}
                    className="tap line-clamp-2 break-words text-primary underline underline-offset-4"
                  >
                    {topic.text}
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
        <div className="flex flex-col gap-xs">
          <h2 ref={heading} tabIndex={-1} className="text-balance type-headline-lg focus:outline-none" {...filterSource(!originalTitleShown)}>
            <Highlighted text={article.translatedTitle ?? article.title} terms={terms} groups={groups} />
          </h2>
          {originalTitleShown ? (
            // The title as the site wrote it, marked with its language so that it is read out in that language.
            <p lang={article.sourceLanguage ?? undefined} className="type-body-md text-on-surface-muted" {...filterSource(true)}>
              <Highlighted text={article.title} terms={terms} groups={groups} />
            </p>
          ) : null}
        </div>
        {article.unconfirmed ? (
          <p className="flex items-baseline gap-sm type-body-md">
            <Badge tone="warning">未確認</Badge>
            <span>噂や非公式の情報に基づいています。</span>
          </p>
        ) : null}
        {article.revision > 0 && article.updateNote ? (
          // What the last follow-up added, in the model's words: before the impact, so that a reader who read the
          // article before sees first what is new. The line is not the impact's mark colour, to tell the two apart.
          <section aria-label="今回の更新で加わったこと" className="border-l-4 border-outline-strong pl-md">
            <h3 className="type-label-sm text-on-surface-muted">今回の更新で加わったこと</h3>
            <p className="type-body-md">
              <Highlighted text={article.updateNote} terms={terms} />
            </p>
          </section>
        ) : null}
        {article.impact ? (
          <section aria-label="読み手への影響" className="border-l-4 border-mark pl-md">
            <h3 className="type-label-sm text-on-surface-muted">読み手への影響</h3>
            <p className="type-body-md">
              <Highlighted text={article.impact} terms={terms} />
            </p>
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
        {article.otherFeeds.length > 0 ? (
          // The same story as other feeds delivered it; each name opens that copy in the list of its feed. That
          // list includes read articles: the copy was most likely marked read with this article.
          <section aria-label="ほかに配信した購読フィード" className="flex flex-col gap-xs">
            <h3 className="type-label-sm text-on-surface-muted">ほかに配信した購読フィード</h3>
            <ul className="flex flex-wrap gap-x-md gap-y-xs type-body-md">
              {article.otherFeeds.map((other) => (
                <li key={other.articleId} className="min-w-0">
                  <Link to={`${listPathOf({ type: "feed", feedId: other.feedId }, () => undefined)}/${other.articleId}?read=1`} className="tap break-words text-primary underline underline-offset-4">
                    {other.feedTitle}
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
        {article.autoSummary ? (
          // Text a model wrote: shown as plain words, never as markup, and marked as the model's by its heading.
          <section aria-label="AIによる要約" className="flex flex-col gap-xs border-l-4 border-outline-strong pl-md">
            <h3 className="type-label-sm text-on-surface-muted">AIによる要約</h3>
            <p className="break-words whitespace-pre-line type-body-md">
              <Highlighted text={article.autoSummary.text} terms={terms} groups={groups} />
            </p>
            {article.autoSummary.source === "feed" ? (
              <p className="type-label-sm text-on-surface-muted">元のページを読めなかったため、配信された内容だけをもとにしています。</p>
            ) : null}
          </section>
        ) : summaryState !== "none" ? (
          <p role="status" className="type-label-sm text-on-surface-muted">
            {SUMMARY_NOTES[summaryState]}
          </p>
        ) : null}
        {translating.isFetching ? (
          <p role="status" className="type-label-sm text-on-surface-muted">
            翻訳しています。
          </p>
        ) : translating.isError ? (
          <div className="flex flex-wrap items-center gap-x-md gap-y-xs type-body-md">
            <p role="alert">翻訳できませんでした。原文を表示しています。</p>
            <Button onClick={() => void translating.refetch()}>翻訳をやり直す</Button>
          </div>
        ) : null}
        {delivered ? <FullContentBar article={article} control={fullContent} /> : null}
        <ArticleNoteSection article={article} />
        {/* Highlights are on the full content when there is one: while what the feed delivered is shown instead, none is. */}
        <AnnotatedBody
          key={`${fullShown}-${translated ? "translated" : "original"}`}
          article={article}
          count={translated ? article.translation!.segments.length : 1}
          enabled={article.fullContent === null || fullShown}
          focusId={focusAnnotation}
          scope={pane}
          render={(marksFor) =>
            translated ? (
              // The translation is of the full content when there is one: what the feed delivered is then shown without one.
              <TranslatedBody translation={article.translation!} terms={terms} groups={groups} marksFor={marksFor} />
            ) : (
              <div className="article-body type-body-lg" {...segmentAttribute(0)}>
                <Markdown
                  text={fullShown ? article.fullContent!.body : article.body}
                  images={delivered}
                  highlight={terms}
                  groups={groups}
                  annotations={marksFor(0)}
                />
              </div>
            )
          }
        />
        {/* Below the content, whichever content is shown: the full content, what the feed delivered, or the translation. */}
        <Attachments article={article} />
        <Mentions article={article} />
        {article.previousArticles.length > 0 ? (
          // The earlier articles of the story, newest first, each with the day it was first published.
          <section aria-label="この話題の前の記事" className="flex flex-col gap-xs">
            <h3 className="type-label-sm text-on-surface-muted">この話題の前の記事</h3>
            <ul className="flex flex-col gap-xs type-body-md">
              {article.previousArticles.map((earlier) => (
                <li key={earlier.id} className="min-w-0">
                  <Link to={articlePath(earlier.id)} className="tap break-words text-primary underline underline-offset-4">
                    {earlier.title}
                  </Link>
                  <span className="pl-sm text-on-surface-muted tabular-nums">{formatDate(earlier.firstPublishedAt, timeZone)}</span>
                </li>
              ))}
            </ul>
          </section>
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
                {ref.isNew ? (
                  <span className="pl-sm">
                    <Badge>新しい出典</Badge>
                  </span>
                ) : null}
                <SourceReason source={ref} />
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
          {delivered ? null : (
            <Button aria-pressed={article.missed} onClick={() => onToggleMiss(article)}>
              {article.missed ? "外れの印を外す" : "外れの印を付ける"}
            </Button>
          )}
        </div>
        {neighbors ? <NeighborLinks neighbors={neighbors} /> : null}
      </div>
    </article>
  );
}
