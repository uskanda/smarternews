import { rankTopicStats, TOPIC_STATS_DAYS, type Category, type SourceKind, type TopicStatsEntry } from "@smarternews/core/api";
import { formatDay } from "@smarternews/client";
import { useEffect, useRef, useState } from "react";
import { Link, useLocation } from "react-router";
import { useTimeZone, useTopicStats } from "../api/queries.ts";
import { topicEditPath } from "../lib/paths.ts";
import { Checkbox, ErrorNotice, Loading } from "../ui/controls.tsx";

const LINK = "tap text-primary underline underline-offset-4";

const SOURCE_LABEL: Record<SourceKind, string> = {
  feed: "フィード",
  "news-search": "ニュース検索",
  "llm-search": "LLM検索",
};

/** "1/4件（25%）": a part of the articles the topic made, and its share rounded to a whole percent. */
function ofCreated(count: number, created: number): string {
  return created === 0 ? `${count}件` : `${count}/${created}件（${Math.round((count / created) * 100)}%）`;
}

function rowsOf(entry: TopicStatsEntry): Array<[string, string]> {
  const sources = (Object.keys(SOURCE_LABEL) as SourceKind[])
    .filter((kind) => entry.collected.bySource[kind] > 0)
    .map((kind) => `${SOURCE_LABEL[kind]} ${entry.collected.bySource[kind]}`);
  return [
    ["集めた候補", `${entry.collected.total}件${sources.length > 0 ? `（${sources.join("、")}）` : ""}`],
    ["判定での除外", `${entry.rejectedByJudge}件`],
    ["基準未満", `${entry.belowMinimum}件`],
    ["件数上限", `${entry.overLimit}件`],
    ["日付で外れた候補", `${entry.rejectedByDate}件`],
    ["作った記事", `${entry.created}件`],
    ["更新した記事", `${entry.updated}件`],
    ["開いた記事", ofCreated(entry.opened, entry.created)],
    ["スター", ofCreated(entry.starred, entry.created)],
    ["外れ", ofCreated(entry.missed, entry.created)],
    [
      "よく除外されるサイト",
      entry.topRejectedSites.length > 0 ? entry.topRejectedSites.map((site) => `${site.siteName} ${site.count}件`).join("、") : "なし",
    ],
  ];
}

/** One topic's row. A link to `#topic-stats-<id>` scrolls to it once the stats are in. */
function TopicStatsRow({ entry, categoryId }: { entry: TopicStatsEntry; categoryId: number }) {
  const { hash } = useLocation();
  const anchor = `topic-stats-${entry.topicId}`;
  const targeted = hash === `#${anchor}`;
  const item = useRef<HTMLLIElement>(null);
  useEffect(() => {
    if (targeted) item.current?.scrollIntoView?.({ block: "start" });
  }, [targeted]);
  return (
    <li ref={item} id={anchor} className="flex flex-col gap-xs border-b border-outline py-md">
      <Link to={topicEditPath(categoryId, entry.topicId)} className={`min-w-0 break-words type-label-md ${LINK}`}>
        {entry.text}
      </Link>
      {entry.collected.total === 0 ? (
        <p className="type-label-sm text-warning">直近{TOPIC_STATS_DAYS}日に集めた候補がありません。取得元と検索語を確かめてください。</p>
      ) : null}
      <dl className="grid grid-cols-[auto_1fr] gap-x-lg gap-y-xs type-label-sm sm:grid-cols-[auto_1fr_auto_1fr]">
        {rowsOf(entry).map(([term, value]) => (
          <div key={term} className="contents">
            <dt className="text-on-surface-muted">{term}</dt>
            <dd className="break-words tabular-nums">{value}</dd>
          </div>
        ))}
      </dl>
    </li>
  );
}

/**
 * What each topic of the category brought in the last 30 days, in the order of the topics or with the topics that
 * need attention first. Each row leads to the topic's editor.
 */
export function TopicStatsSection({ category }: { category: Category }) {
  const stats = useTopicStats(category.id);
  const timeZone = useTimeZone();
  const [ranked, setRanked] = useState(false);
  const entries = stats.data ? (ranked ? rankTopicStats(stats.data.topics) : stats.data.topics) : [];
  return (
    <section aria-label="トピックの成績" className="flex flex-col gap-md border-b border-outline px-lg py-xl md:px-2xl">
      <div className="flex flex-wrap items-center justify-between gap-md">
        <h2 className="type-headline-md">トピックの成績</h2>
        <Checkbox label="問題のあるトピックを先頭へ" checked={ranked} onChange={(event) => setRanked(event.target.checked)} />
      </div>
      <p className="max-w-measure type-body-md text-on-surface-muted">
        {stats.data ? `${formatDay(stats.data.since, timeZone).date}から今日まで、` : `直近${TOPIC_STATS_DAYS}日に、`}
        各トピックが集めた候補と作った記事です。外れが多いトピックは、名前から編集へ進んで直せます。
      </p>
      {stats.isError ? <ErrorNotice error={stats.error} onRetry={() => void stats.refetch()} /> : null}
      {stats.isPending && !stats.isError ? <Loading /> : null}
      {stats.data?.topics.length === 0 ? <p className="type-body-md text-on-surface-muted">トピックはまだありません。</p> : null}
      <ul className="max-w-measure">
        {entries.map((entry) => (
          <TopicStatsRow key={entry.topicId} entry={entry} categoryId={category.id} />
        ))}
      </ul>
      <p className="max-w-measure type-label-sm text-on-surface-muted">
        候補は集めた日から、記事は作った日から{TOPIC_STATS_DAYS}日以内のものを数えます。開いた記事、スター、外れは、作った記事のうちの数です。「問題のあるトピックを先頭へ」は、候補のないトピック、外れの割合の大きいトピック、記事にならなかった候補の割合の大きいトピックの順に並べます。
      </p>
    </section>
  );
}
