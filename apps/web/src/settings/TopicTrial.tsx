import type { TopicTrial, TopicTrialChange, TopicTrialRequest, TopicTrialStart } from "@smarternews/core/api";
import { ApiError } from "@smarternews/client";
import { useQuery } from "@tanstack/react-query";
import { useId, useState, type ReactNode } from "react";
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

/**
 * The trial's results. The status that reads out the waiting and the one sentence at the end is there, empty, from
 * before the trial starts, and only its text changes: a status that appears with its text may not be read out.
 * The rest of the results are left for the reader to go through.
 */
export function TopicTrialResults({ trial: view }: { trial: ReturnType<typeof useTopicTrial> }) {
  const headingId = useId();
  const idle = view.state.kind === "idle";
  const { before, said, after } = idle ? {} : trialParts(view);
  return (
    <section aria-labelledby={idle ? undefined : headingId} className={idle ? "contents" : "flex flex-col gap-sm rounded-md border border-outline px-md py-sm"}>
      {idle ? null : (
        <h3 id={headingId} className="type-label-md">
          試しの結果
        </h3>
      )}
      {before}
      {/* Out of the flow while empty, so that it adds no gap; not hidden, so that what comes into it is read out. */}
      <div role="status" className={said ? undefined : "sr-only"}>
        {said}
      </div>
      {after}
    </section>
  );
}

/** What comes before the status, what it reads out, and what comes after it. */
function trialParts(view: ReturnType<typeof useTopicTrial>): { before?: ReactNode; said?: ReactNode; after?: ReactNode } {
  if (view.state.kind === "refused") return { said: <p className="type-body-md text-warning">{REFUSED[view.state.status]}</p> };
  if (view.error) {
    // An error notice is read out as an alert already.
    return view.error instanceof ApiError && view.error.kind === "not_found"
      ? { said: <p className="type-body-md text-on-surface-muted">試しの結果がありません。もう一度試してください。</p> }
      : { after: <ErrorNotice error={view.error} /> };
  }
  if (view.running || !view.trial) return { said: <p className="type-body-md text-on-surface-muted">試しています…</p> };
  const { trial } = view;
  if (trial.status === "stopped_by_limit") return { said: <p className="type-body-md text-warning">{STOPPED}</p> };
  if (trial.status === "failed" || !trial.result) {
    return { said: <p className="type-body-md text-error">試せませんでした。{trial.error ?? ""}</p> };
  }
  const { result } = trial;
  return {
    before: <TrialWording result={result} />,
    said: (
      <p className="type-body-md">
        {result.tried}件を試し、{result.changes.length}件の結論が入れ替わりました。
      </p>
    ),
    after:
      result.changes.length === 0 ? (
        <p className="type-body-md text-on-surface-muted">入れ替わる候補はありません。</p>
      ) : (
        <ul className="flex flex-col">
          {result.changes.map((change) => (
            <ChangeItem key={change.candidateId} change={change} minImportance={result.minImportance} />
          ))}
        </ul>
      ),
  };
}

function TrialWording({ result }: { result: NonNullable<TopicTrial["result"]> }) {
  return (
    <>
      <p className="type-label-sm text-on-surface-muted">保存していない文章での結果です。保存はしていません。</p>
      <dl className="grid grid-cols-[auto_1fr] gap-x-md gap-y-xs type-label-sm">
        <dt className="text-on-surface-muted">検索語</dt>
        <dd className="break-words">{result.queries.join(" / ")}</dd>
        <dt className="text-on-surface-muted">判定基準</dt>
        <dd className="break-words">{result.criteria}</dd>
      </dl>
    </>
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
