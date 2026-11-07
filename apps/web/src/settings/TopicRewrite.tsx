import type { TopicRewriteProposal, TopicRewriteResult } from "@smarternews/core/api";
import { ApiError } from "@smarternews/client";
import { useId, useState } from "react";
import { useApp } from "../app/context.ts";
import { Button, ErrorNotice } from "../ui/controls.tsx";

const REFUSED: Record<Exclude<TopicRewriteResult["status"], "proposed">, string> = {
  limit: "今日の書き直しの案の上限に達したため、案を出せません。",
  day: "今日のLLMの呼び出しの上限に達したため、案を出せません。",
  budget: "月の予算に達したため、案を出せません。",
  uninterpreted: "トピックの解釈が済んでいないため、案を出せません。次の実行のあとで試してください。",
};

type State =
  | { kind: "idle" }
  | { kind: "asking" }
  | { kind: "proposed"; proposals: TopicRewriteProposal[] }
  | { kind: "refused"; status: keyof typeof REFUSED }
  | { kind: "failed"; error: unknown };

/**
 * Proposals of a new wording for the topic, from its saved text and relevance test. Asked only while the editor
 * holds no unsaved change, so that what the model read is what the editor shows. Choosing a proposal puts it into
 * the editor; nothing is saved until the reader saves.
 */
export function TopicRewrite({ topicId, dirty, onUse }: { topicId: number; dirty: boolean; onUse: (text: string) => void }) {
  const { api } = useApp();
  const headingId = useId();
  const hintId = useId();
  const [state, setState] = useState<State>({ kind: "idle" });

  async function ask() {
    setState({ kind: "asking" });
    try {
      const result = await api.proposeTopicRewrite(topicId);
      setState(result.status === "proposed" ? { kind: "proposed", proposals: result.proposals } : { kind: "refused", status: result.status });
    } catch (caught) {
      setState({ kind: "failed", error: caught });
    }
  }

  return (
    <div className="flex flex-col gap-sm">
      <div>
        <Button onClick={() => void ask()} disabled={dirty || state.kind === "asking"} aria-describedby={hintId}>
          書き直しの案を出す
        </Button>
      </div>
      <p id={hintId} className="type-label-sm text-on-surface-muted">
        {dirty
          ? "保存していない変更があります。保存してから案を出してください。"
          : "保存してある文章と判定基準に、開いた記事、スターの記事、外れの印、判定で除外した候補を合わせて、文章の書き直しの案をLLMに出させます。何も保存せず、LLMを1回呼びます。"}
      </p>
      {state.kind === "idle" ? null : (
        <section aria-labelledby={headingId} className="flex flex-col gap-sm rounded-md border border-outline px-md py-sm">
          <h3 id={headingId} className="type-label-md">
            書き直しの案
          </h3>
          <RewriteBody state={state} onUse={onUse} />
        </section>
      )}
    </div>
  );
}

function RewriteBody({ state, onUse }: { state: Exclude<State, { kind: "idle" }>; onUse: (text: string) => void }) {
  if (state.kind === "asking") return <p className="type-body-md text-on-surface-muted">案を出しています…</p>;
  if (state.kind === "refused") return <p className="type-body-md text-warning">{REFUSED[state.status]}</p>;
  if (state.kind === "failed") {
    return state.error instanceof ApiError && state.error.kind === "unavailable" ? (
      <p className="type-body-md text-error">案を出せませんでした。時間をおいて、もう一度試してください。</p>
    ) : (
      <ErrorNotice error={state.error} />
    );
  }
  return (
    <div className="flex flex-col gap-sm">
      <p className="type-label-sm text-on-surface-muted">「この案を使う」を押すと、編集欄の文章が置き換わります。保存するまで、トピックは変わりません。</p>
      <ul className="flex flex-col">
        {state.proposals.map((proposal, index) => (
          <li key={index} className="flex flex-col gap-xs border-t border-outline py-sm">
            <p className="whitespace-pre-wrap break-words type-body-md">{proposal.text}</p>
            <p className="whitespace-pre-wrap break-words type-label-sm text-on-surface-muted">{proposal.explanation}</p>
            <div>
              <Button onClick={() => onUse(proposal.text)}>この案を使う</Button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
