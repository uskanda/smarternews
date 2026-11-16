import type { Rule, RuleAction } from "@smarternews/core/api";
import { RULE_ACTIONS } from "@smarternews/core/api";
import { useQueryClient } from "@tanstack/react-query";
import { useId, useState, type FormEvent } from "react";
import { ApiError, type FieldProblem } from "@smarternews/client";
import { useApp } from "../app/context.ts";
import { useToast } from "../shell/toast.tsx";
import { Button, messageFor } from "../ui/controls.tsx";
import { conditionsComplete, ConditionsInput, conditionsOf, newCondition, problemText, ScopeSelect, scopeKey, scopeOf, type DraftCondition, type ScopeKey } from "./FilterForm.tsx";
import { useUnsaved } from "../ui/unsaved.tsx";

// The inputs of a rule: the scope and conditions of a filter, and the actions.

export const RULE_ACTION_LABEL: Record<RuleAction, string> = {
  star: "スターを付ける",
  read: "既読にする",
  notify: "通知する",
  summarize: "要約を頼む",
};

/** What the rule does, in one line. */
export function actionsLabel(rule: Pick<Rule, "actions">): string {
  return rule.actions.map((action) => RULE_ACTION_LABEL[action]).join("、");
}

export function useRuleRefresh() {
  const client = useQueryClient();
  return () => void client.invalidateQueries({ queryKey: ["rules"] });
}

interface Draft {
  scope: ScopeKey;
  conditions: DraftCondition[];
  actions: RuleAction[];
}

function draftOf(rule?: Rule): Draft {
  return rule
    ? { scope: scopeKey(rule.scope), conditions: rule.conditions.map(newCondition), actions: [...rule.actions] }
    : { scope: "all", conditions: [newCondition()], actions: [] };
}

/** What a draft says, without the keys its conditions are rendered by, for telling whether it changed. */
function contentOf(draft: Draft): string {
  return JSON.stringify([draft.scope, conditionsOf(draft.conditions), RULE_ACTIONS.filter((action) => draft.actions.includes(action))]);
}

/** Used to add a rule and, with `rule`, to change one. */
export function RuleForm({ rule, onDone }: { rule?: Rule; onDone?: () => void }) {
  const { api } = useApp();
  const refresh = useRuleRefresh();
  const toast = useToast();
  const [draft, setDraft] = useState<Draft>(() => draftOf(rule));
  const [problems, setProblems] = useState<FieldProblem[]>([]);
  const [general, setGeneral] = useState<string | null>(null);
  const [preview, setPreview] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const id = useId();
  // A new rule counts once a value is written: the scope and the actions alone are quickly chosen again.
  useUnsaved(rule ? "ルールの編集" : "新しいルール", rule ? contentOf(draft) !== contentOf(draftOf(rule)) : draft.conditions.some((condition) => condition.value.trim() !== ""));

  const scope = scopeOf(draft.scope);
  const matchable = scope !== null && conditionsComplete(draft.conditions);
  const complete = matchable && draft.actions.length > 0;
  const problemAt = (path: string) => {
    const found = problems.find((problem) => problem.path === path || problem.path.startsWith(`${path}.`));
    return found ? problemText(found) : null;
  };

  function change(next: Partial<Draft>) {
    setDraft((current) => ({ ...current, ...next }));
    setProblems([]);
    setGeneral(null);
    setPreview(null);
  }

  function refused(error: unknown) {
    if (error instanceof ApiError && error.kind === "invalid" && error.fields.length > 0) {
      setProblems(error.fields);
      const shown = error.fields.some((field) => /^(conditions\.\d+|scope)/.test(field.path));
      setGeneral(shown ? null : problemText(error.fields[0]!));
    } else if (error instanceof ApiError && error.kind === "conflict") {
      setGeneral("同じルールがすでにあります。");
    } else {
      setGeneral(messageFor(error));
    }
  }

  async function check() {
    setBusy(true);
    try {
      const result = await api.previewRule({ scope: scope!, conditions: conditionsOf(draft.conditions) });
      setProblems([]);
      setGeneral(null);
      setPreview(result.matchCount);
    } catch (error) {
      setPreview(null);
      refused(error);
    } finally {
      setBusy(false);
    }
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!complete) return;
    setBusy(true);
    const body = { scope: scope!, conditions: conditionsOf(draft.conditions), actions: RULE_ACTIONS.filter((action) => draft.actions.includes(action)) };
    try {
      if (rule) {
        await api.updateRule(rule.id, body);
        refresh();
        toast({ message: "ルールを保存しました。" });
        onDone?.();
      } else {
        await api.createRule(body);
        refresh();
        setDraft(draftOf());
        setPreview(null);
        toast({ message: "ルールを追加しました。新しく届く記事に働きます。" });
      }
    } catch (error) {
      refused(error);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form noValidate onSubmit={save} className="flex max-w-measure-article flex-col gap-md" aria-label={rule ? "ルールの編集" : undefined}>
      <ScopeSelect id={`${id}-scope`} value={draft.scope} onChange={(next) => change({ scope: next })} problem={problemAt("scope")} />
      <ConditionsInput conditions={draft.conditions} onChange={(conditions) => change({ conditions })} problemAt={problemAt} />
      <fieldset className="flex flex-col gap-xs">
        <legend className="pb-xs type-label-md">操作（合った記事に行うこと）</legend>
        <div className="flex flex-wrap gap-x-lg gap-y-xs type-body-md">
          {RULE_ACTIONS.map((action) => (
            <label key={action} className="inline-flex cursor-pointer items-center gap-xs">
              <input
                type="checkbox"
                className="accent-primary"
                checked={draft.actions.includes(action)}
                onChange={(event) =>
                  change({ actions: event.target.checked ? [...draft.actions, action] : draft.actions.filter((each) => each !== action) })
                }
              />
              {RULE_ACTION_LABEL[action]}
            </label>
          ))}
        </div>
        {draft.actions.length === 0 ? <p className="type-label-sm text-error">操作を1つ以上選んでください。</p> : null}
        <p className="type-label-sm text-on-surface-muted">
          通知は、Androidアプリの通知の設定が「出さない」以外のときに出ます。既読にした記事は通知しません。要約は、自動の要約をしない購読フィードの記事にも作り、1日の要約の上限に数えます。
        </p>
      </fieldset>
      {general ? (
        <p role="alert" className="type-label-sm text-error">
          {general}
        </p>
      ) : null}
      {preview !== null ? (
        <p role="status" className="type-body-md">
          保存済みの記事のうち{preview}件が条件に合います。ルールは、保存のあとに届く記事にだけ働きます。
        </p>
      ) : null}
      <div className="flex flex-wrap gap-sm">
        <Button type="submit" variant="primary" disabled={!complete || busy}>
          {rule ? "保存する" : "ルールを追加"}
        </Button>
        <Button onClick={() => void check()} disabled={!matchable || busy}>
          合う件数を確かめる
        </Button>
        {onDone ? <Button onClick={onDone}>やめる</Button> : null}
      </div>
    </form>
  );
}
