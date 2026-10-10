import type { Candidate } from "@smarternews/core/api";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Link, useParams } from "react-router";
import { ApiError, formatFull, stageLabel, STATUS_LABEL, TRIGGER_LABEL } from "@smarternews/client";
import { useCategories, useRun, useTimeZone } from "../api/queries.ts";
import { useApp } from "../app/context.ts";
import { Checkbox, ErrorNotice, Loading } from "../ui/controls.tsx";

const SECTION = "flex flex-col gap-md border-b border-outline px-lg py-xl md:px-2xl";
const LINK = "tap text-primary underline underline-offset-4";

function CandidateItem({ candidate, showTopics }: { candidate: Candidate; showTopics: boolean }) {
  return (
    <li className="flex flex-col gap-px border-b border-outline py-sm">
      <span className="min-w-0">
        <a href={candidate.url} target="_blank" rel="noopener noreferrer" className={`break-words type-body-md ${LINK}`}>
          {candidate.title}
        </a>
      </span>
      <span className="type-body-md">{candidate.reason}</span>
      <span className="flex flex-wrap gap-x-md gap-y-xs type-label-sm text-on-surface-muted">
        {candidate.siteName ? <span>{candidate.siteName}</span> : null}
        {showTopics ? candidate.topics.map((topic) => <span key={topic.id}>{topic.text}</span>) : null}
      </span>
    </li>
  );
}

/** Rejected candidates under each topic they matched, the topic with the most rejections first. */
function byTopic(candidates: Candidate[]): Array<{ key: string; text: string; candidates: Candidate[] }> {
  const groups = new Map<string, { key: string; text: string; candidates: Candidate[] }>();
  for (const candidate of candidates) {
    const topics = candidate.topics.length > 0 ? candidate.topics : [{ id: 0, text: "トピックなし" }];
    for (const topic of topics) {
      const key = String(topic.id);
      const group = groups.get(key) ?? { key, text: topic.text, candidates: [] };
      group.candidates.push(candidate);
      groups.set(key, group);
    }
  }
  return [...groups.values()].sort((a, b) => b.candidates.length - a.candidates.length);
}

/** What one run did: its counts, what failed, and which candidates it rejected and why. */
export function RunPage() {
  const { api } = useApp();
  const params = useParams();
  const id = params.runId && /^\d+$/.test(params.runId) ? Number(params.runId) : null;
  const run = useRun(id);
  const candidates = useQuery({
    queryKey: ["run-candidates", id, run.data?.status],
    queryFn: () => api.runCandidates(id!, "rejected"),
    enabled: id !== null && run.isSuccess,
  });
  const categories = useCategories().data ?? [];
  const timeZone = useTimeZone();
  const [grouped, setGrouped] = useState(false);

  if (id === null || (run.isError && run.error instanceof ApiError && run.error.kind === "not_found")) {
    return (
      <div className="flex flex-col items-start gap-md p-xl type-body-md">
        <p>この実行の記録はありません。30日を過ぎて削除された可能性があります。</p>
        <Link to="/runs" className={LINK}>
          実行履歴へ戻る
        </Link>
      </div>
    );
  }
  if (run.isError) return <ErrorNotice error={run.error} onRetry={() => void run.refetch()} />;
  if (!run.data) return <Loading />;

  const data = run.data;
  const category = categories.find((entry) => entry.id === data.categoryId);
  const rejected = candidates.data ?? [];

  return (
    <div className="h-full overflow-y-auto bg-surface">
      <header className="flex flex-col gap-xs border-b border-outline px-lg py-md md:px-2xl">
        <Link to="/runs" className={`type-label-sm ${LINK}`}>
          実行履歴へ戻る
        </Link>
        <h1 className="type-headline-md">{category?.name ?? "カテゴリ"} の実行</h1>
      </header>
      <section aria-label="結果" className={SECTION}>
        <dl className="grid max-w-measure grid-cols-[auto_1fr] gap-x-lg gap-y-xs type-body-md">
          <dt className="text-on-surface-muted">状態</dt>
          <dd className="type-label-md">{STATUS_LABEL[data.status]}</dd>
          <dt className="text-on-surface-muted">契機</dt>
          <dd>{TRIGGER_LABEL[data.trigger]}</dd>
          <dt className="text-on-surface-muted">開始</dt>
          <dd className="tabular-nums">{formatFull(data.startedAt ?? data.queuedAt, timeZone)}</dd>
          {data.finishedAt ? (
            <>
              <dt className="text-on-surface-muted">終了</dt>
              <dd className="tabular-nums">{formatFull(data.finishedAt, timeZone)}</dd>
            </>
          ) : null}
          <dt className="text-on-surface-muted">集めた候補</dt>
          <dd className="tabular-nums">{data.collected}</dd>
          <dt className="text-on-surface-muted">除外した候補</dt>
          <dd className="tabular-nums">{data.rejected}</dd>
          <dt className="text-on-surface-muted">作った記事</dt>
          <dd className="tabular-nums">{data.articlesCreated}</dd>
          <dt className="text-on-surface-muted">更新した記事</dt>
          <dd className="tabular-nums">{data.articlesUpdated}</dd>
          <dt className="text-on-surface-muted">LLMの呼び出し</dt>
          <dd className="tabular-nums">{data.llmCalls}</dd>
        </dl>
        {data.status === "stopped_by_limit" ? (
          <p className="max-w-measure type-body-md">
            LLMの呼び出し回数の上限に達したため、途中で止まりました。完成した記事は保存済みで、残りは次の実行が続けます。上限はサーバーの設定で変えられます。
          </p>
        ) : null}
        {category ? (
          <Link to={`/settings/categories/${category.id}`} className={`type-body-md ${LINK}`}>
            このカテゴリの設定とトピック
          </Link>
        ) : null}
      </section>
      {data.failures.length > 0 ? (
        <section aria-label="失敗" className={SECTION}>
          <h2 className="type-headline-md">失敗</h2>
          <ul className="flex max-w-measure flex-col gap-sm type-body-md">
            {data.failures.map((failure, index) => (
              <li key={index} className="flex flex-col gap-px border-b border-outline pb-sm">
                <span className="type-label-md">{stageLabel(failure.stage)}</span>
                {failure.target ? <span className="break-all text-on-surface-muted">{failure.target}</span> : null}
                <span className="break-words">{failure.message}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      <section aria-label="除外した候補" className={SECTION}>
        <div className="flex flex-wrap items-center justify-between gap-md">
          <h2 className="type-headline-md">除外した候補</h2>
          <Checkbox label="トピックごとにまとめる" checked={grouped} onChange={(event) => setGrouped(event.target.checked)} />
        </div>
        <p className="max-w-measure type-label-sm text-on-surface-muted">
          記事にしなかったページと、その理由です。外れが多いトピックは、文章に拾いたいものと除きたいものを書き足すと減ります。
        </p>
        {candidates.isError ? <ErrorNotice error={candidates.error} onRetry={() => void candidates.refetch()} /> : null}
        {candidates.isSuccess && rejected.length === 0 ? <p className="type-body-md text-on-surface-muted">除外した候補はありません。</p> : null}
        {grouped ? (
          byTopic(rejected).map((group) => (
            <div key={group.key} role="group" aria-label={`${group.text}（${group.candidates.length}件）`} className="flex max-w-measure flex-col gap-xs">
              <div className="flex flex-wrap items-baseline justify-between gap-md">
                <h3 className="type-label-md">
                  {group.text}
                  <span className="pl-sm type-label-sm text-on-surface-muted tabular-nums">{group.candidates.length}件</span>
                </h3>
                {category && group.key !== "0" ? (
                  <Link to={`/settings/categories/${category.id}`} className={`type-label-sm ${LINK}`}>
                    このトピックを直す
                  </Link>
                ) : null}
              </div>
              <ul>
                {group.candidates.map((candidate) => (
                  <CandidateItem key={candidate.id} candidate={candidate} showTopics={false} />
                ))}
              </ul>
            </div>
          ))
        ) : (
          <ul className="max-w-measure">
            {rejected.map((candidate) => (
              <CandidateItem key={candidate.id} candidate={candidate} showTopics />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
