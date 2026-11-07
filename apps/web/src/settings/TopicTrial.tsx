import type { TopicTrial, TopicTrialChange, TopicTrialRequest, TopicTrialStart } from "@smarternews/core/api";
import { ApiError } from "@smarternews/client";
import { useQuery } from "@tanstack/react-query";
import { useId, useState } from "react";
import { useApp } from "../app/context.ts";
import { ErrorNotice } from "../ui/controls.tsx";

/** How often a running trial is asked about. */
const POLL_MS = 2000;

const REFUSED: Record<Exclude<TopicTrialStart["status"], "started">, string> = {
  limit: "今日の試しの上限に達したため、試せません。",
  day: "今日のLLMの呼び出しの上限に達したため、試せません。",
  budget: "月の予算に達したため、試せません。",
};

const STOPPED = "LLMの呼び出しの上限に達したため、試しを途中で止めました。";

type State = { kind: "idle" } | { kind: "refused"; status: keyof typeof REFUSED } | { kind: "started"; id: string };

/**
 * A trial of the topic's text being edited: it starts on the server and is asked about every two seconds until it
 * ends. Nothing is saved, so the editor keeps its unsaved changes. `start` hands a refused request to `onError`.
 */
export function useTopicTrial(topicId: number) {
  const { api } = useApp();
  const [state, setState] = useState<State>({ kind: "idle" });
  const id = state.kind === "started" ? state.id : null;
  const query = useQuery({
    queryKey: ["topic-trial", id],
    queryFn: () => api.topicTrial(id!),
    enabled: id !== null,
    retry: false,
    refetchInterval: (current) => (current.state.data?.status === "running" ? POLL_MS : false),
  });
  const running = state.kind === "started" && (query.isPending || query.data?.status === "running");

  async function start(draft: TopicTrialRequest, onError: (error: unknown) => void) {
    try {
      const started = await api.startTopicTrial(topicId, draft);
      setState(started.status === "started" && started.id !== null ? { kind: "started", id: started.id } : { kind: "refused", status: started.status as keyof typeof REFUSED });
    } catch (caught) {
      setState({ kind: "idle" });
      onError(caught);
    }
  }

  return { state, running, trial: query.data ?? null, error: query.error, start };
}

export function TopicTrialResults({ trial: view }: { trial: ReturnType<typeof useTopicTrial> }) {
  const headingId = useId();
  if (view.state.kind === "idle") return null;
  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-sm rounded-md border border-outline px-md py-sm">
      <h3 id={headingId} className="type-label-md">
        試しの結果
      </h3>
      <TrialBody view={view} />
    </section>
  );
}

function TrialBody({ view }: { view: ReturnType<typeof useTopicTrial> }) {
  if (view.state.kind === "refused") return <p className="type-body-md text-warning">{REFUSED[view.state.status]}</p>;
  if (view.error) {
    return view.error instanceof ApiError && view.error.kind === "not_found" ? (
      <p className="type-body-md text-on-surface-muted">試しの結果がありません。もう一度試してください。</p>
    ) : (
      <ErrorNotice error={view.error} />
    );
  }
  if (view.running || !view.trial) return <p className="type-body-md text-on-surface-muted">試しています…</p>;
  const { trial } = view;
  if (trial.status === "stopped_by_limit") return <p className="type-body-md text-warning">{STOPPED}</p>;
  if (trial.status === "failed" || !trial.result) {
    return <p className="type-body-md text-error">試せませんでした。{trial.error ?? ""}</p>;
  }
  return <TrialResult result={trial.result} />;
}

function TrialResult({ result }: { result: NonNullable<TopicTrial["result"]> }) {
  return (
    <div className="flex flex-col gap-sm">
      <p className="type-label-sm text-on-surface-muted">保存していない文章での結果です。保存はしていません。</p>
      <dl className="grid grid-cols-[auto_1fr] gap-x-md gap-y-xs type-label-sm">
        <dt className="text-on-surface-muted">検索語</dt>
        <dd className="break-words">{result.queries.join(" / ")}</dd>
        <dt className="text-on-surface-muted">判定基準</dt>
        <dd className="break-words">{result.criteria}</dd>
      </dl>
      <p className="type-body-md">
        {result.tried}件を試し、{result.changes.length}件の結論が入れ替わりました。
      </p>
      {result.changes.length === 0 ? (
        <p className="type-body-md text-on-surface-muted">入れ替わる候補はありません。</p>
      ) : (
        <ul className="flex flex-col">
          {result.changes.map((change) => (
            <ChangeItem key={change.candidateId} change={change} minImportance={result.minImportance} />
          ))}
        </ul>
      )}
    </div>
  );
}

const VERDICT = { accepted: "採用", rejected: "除外" } as const;

function ChangeItem({ change, minImportance }: { change: TopicTrialChange; minImportance: number }) {
  return (
    <li className="flex flex-col gap-xs border-t border-outline py-sm">
      <p className="min-w-0 break-words type-label-md">
        <a href={change.url} target="_blank" rel="noreferrer" className="tap break-words text-primary underline underline-offset-4">
          {change.title}
        </a>
        {change.siteName ? <span className="ml-sm type-label-sm text-on-surface-muted">{change.siteName}</span> : null}
      </p>
      <dl className="grid grid-cols-[auto_auto_1fr] items-baseline gap-x-sm gap-y-xs type-label-sm">
        <dt className="text-on-surface-muted">前</dt>
        <dd className="type-label-md">{VERDICT[change.before.verdict]}</dd>
        <dd className="break-words">
          {change.before.byProgram ? `判定では採用。そのあと「${change.before.reason}」で除外` : change.before.reason}
        </dd>
        <dt className="text-on-surface-muted">試し</dt>
        <dd className="type-label-md">{VERDICT[change.after.verdict]}</dd>
        <dd className="break-words">
          {change.after.reason}（重要度 {change.after.importance}）
        </dd>
      </dl>
      {change.belowMinimum ? (
        <p className="type-label-sm text-warning">重要度がカテゴリの最低（{minImportance}）を下回るため、記事になりません。</p>
      ) : null}
    </li>
  );
}
