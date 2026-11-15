import type { Category, Feed, Filter, FilterAction, FilterCondition, FilterField, FilterMatch, FilterScope } from "@smarternews/core/api";
import { MAX_FILTER_CONDITIONS } from "@smarternews/core/api";
import { useQueryClient } from "@tanstack/react-query";
import { useId, useRef, useState, type FormEvent } from "react";
import { ApiError, describeProblem, type FieldProblem } from "@smarternews/client";
import { useCategories, useFeeds } from "../api/queries.ts";
import { useApp } from "../app/context.ts";
import { useToast } from "../shell/toast.tsx";
import { Button, messageFor } from "../ui/controls.tsx";
import { useUnsaved } from "./unsaved.tsx";

// The inputs of a filter, shared by the settings of filters and the dialog that makes one from a selection.

const SELECT = "rounded-md border border-outline-strong bg-surface px-sm py-xs type-body-md text-on-surface aria-invalid:border-error";
const INPUT = "w-full rounded-md border border-outline-strong bg-surface px-sm py-xs type-body-md text-on-surface aria-invalid:border-error";

export const ACTION_LABEL: Record<FilterAction, string> = { hide: "隠すフィルター", keep: "残すフィルター" };
const FIELDS: FilterField[] = ["title", "content", "author", "url"];
const FIELD_LABEL: Record<FilterField, string> = { title: "タイトル", content: "内容", author: "著者", url: "URL" };
const MATCH_LABEL: Record<FilterMatch, string> = { contains: "部分一致", regex: "正規表現" };

/** The scope as the select holds it: "all", "c:<category id>", "f:<feed id>", or "" while none is chosen. */
type ScopeKey = string;

export function scopeKey(scope: FilterScope): ScopeKey {
  return scope.type === "category" ? `c:${scope.categoryId}` : scope.type === "feed" ? `f:${scope.feedId}` : "all";
}

function scopeOf(key: ScopeKey): FilterScope | null {
  if (key === "all") return { type: "all" };
  const [kind, id] = key.split(":");
  if (kind === "c") return { type: "category", categoryId: Number(id) };
  if (kind === "f") return { type: "feed", feedId: Number(id) };
  return null;
}

export function scopeLabel(scope: FilterScope, categories: Category[], feeds: Feed[]): string {
  if (scope.type === "category") return `カテゴリ「${categories.find((entry) => entry.id === scope.categoryId)?.name ?? "…"}」`;
  if (scope.type === "feed") return `購読フィード「${feeds.find((entry) => entry.id === scope.feedId)?.title ?? "…"}」`;
  return "全体";
}

function conditionLabel(condition: FilterCondition): string {
  const fields = condition.fields.map((field) => FIELD_LABEL[field]).join("か");
  return condition.match === "regex" ? `${fields}が正規表現「${condition.value}」に合う` : `${fields}に「${condition.value}」を含む`;
}

/** What the filter matches, in one line. */
export function conditionsLabel(filter: Pick<Filter, "conditions">): string {
  return filter.conditions.map(conditionLabel).join("、かつ");
}

export function useRefresh() {
  const client = useQueryClient();
  // A filter changes which articles the lists hold and what the counts say.
  return () => {
    for (const key of ["filters", "filter-articles", "articles", "counts"]) void client.invalidateQueries({ queryKey: [key] });
  };
}

/** The name a refusal of the server gives a field, as the form shows it: 条件2 for `conditions.1`. */
function labelOf(path: string): string {
  const condition = /^conditions\.(\d+)/.exec(path);
  if (condition) return `条件${Number(condition[1]) + 1}`;
  if (path.startsWith("scope")) return "範囲";
  if (path.startsWith("conditions")) return "条件";
  return "フィルター";
}

/** Why the server refused a condition or the scope, in the app's words. */
function problemText(problem: FieldProblem): string {
  if (problem.code === "format" && /^conditions\.\d+\.value$/.test(problem.path)) return "正規表現として読めません。かっこや記号の対応を確かめてください。";
  if (problem.code === "no_such_item" && problem.path.startsWith("scope")) return "この範囲はもうありません。選び直してください。";
  if (problem.code === "not_allowed" && problem.path === "scope") return "残すフィルターには全体を選べません。";
  return describeProblem(problem, labelOf(problem.path));
}

interface DraftCondition {
  key: number;
  fields: FilterField[];
  match: FilterMatch;
  value: string;
}

interface Draft {
  action: FilterAction;
  scope: ScopeKey;
  conditions: DraftCondition[];
}

let conditionSerial = 0;
function newCondition(from?: FilterCondition): DraftCondition {
  conditionSerial += 1;
  return { key: conditionSerial, fields: from ? [...from.fields] : ["title"], match: from?.match ?? "contains", value: from?.value ?? "" };
}

/** What a new filter starts from: its kind, scope and conditions. */
export type FilterStart = Pick<Filter, "action" | "scope" | "conditions">;

function draftOf(filter?: FilterStart): Draft {
  return filter
    ? { action: filter.action, scope: scopeKey(filter.scope), conditions: filter.conditions.map(newCondition) }
    : { action: "hide", scope: "all", conditions: [newCondition()] };
}

/** What a draft says, without the keys its conditions are rendered by, for telling whether it changed. */
function contentOf(draft: Pick<Draft, "action" | "scope"> & { conditions: FilterCondition[] }): string {
  return JSON.stringify([draft.action, draft.scope, draft.conditions.map(({ fields, match, value }) => [fields, match, value])]);
}

function ConditionInput({
  index,
  condition,
  error,
  onChange,
  onRemove,
}: {
  index: number;
  condition: DraftCondition;
  error: string | null;
  onChange: (next: DraftCondition) => void;
  onRemove: (() => void) | null;
}) {
  const id = useId();
  const name = `条件${index + 1}`;
  return (
    <fieldset className="flex flex-col gap-sm rounded-md border border-outline p-md">
      <legend className="px-xs type-label-md">{name}</legend>
      <div className="flex flex-wrap items-center gap-x-lg gap-y-xs type-body-md" role="group" aria-label={`${name}の欄`}>
        {FIELDS.map((field) => (
          <label key={field} className="inline-flex cursor-pointer items-center gap-xs">
            <input
              type="checkbox"
              className="accent-primary"
              checked={condition.fields.includes(field)}
              onChange={(event) =>
                onChange({
                  ...condition,
                  fields: event.target.checked ? FIELDS.filter((each) => each === field || condition.fields.includes(each)) : condition.fields.filter((each) => each !== field),
                })
              }
            />
            {FIELD_LABEL[field]}
          </label>
        ))}
      </div>
      <div className="flex flex-wrap items-start gap-sm">
        <label className="flex flex-col gap-xs">
          <span className="type-label-sm text-on-surface-muted">方法</span>
          <select
            aria-label={`${name}の方法`}
            value={condition.match}
            onChange={(event) => onChange({ ...condition, match: event.target.value as FilterMatch })}
            className={SELECT}
          >
            {(["contains", "regex"] as const).map((match) => (
              <option key={match} value={match}>
                {MATCH_LABEL[match]}
              </option>
            ))}
          </select>
        </label>
        <label className="flex min-w-0 flex-1 basis-48 flex-col gap-xs">
          <span className="type-label-sm text-on-surface-muted">値</span>
          <input
            id={`${id}-value`}
            aria-label={`${name}の値`}
            value={condition.value}
            maxLength={200}
            onChange={(event) => onChange({ ...condition, value: event.target.value })}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? `${id}-error` : undefined}
            className={INPUT}
          />
        </label>
        {onRemove ? (
          <Button className="self-end" aria-label={`${name}を外す`} onClick={onRemove}>
            外す
          </Button>
        ) : null}
      </div>
      {condition.fields.length === 0 ? <p className="type-label-sm text-error">欄を1つ以上選んでください。</p> : null}
      {error ? (
        <p id={`${id}-error`} className="type-label-sm text-error">
          {error}
        </p>
      ) : null}
    </fieldset>
  );
}

/**
 * The inputs of a filter: kind, scope and conditions, with a count before saving. Used to add and to edit.
 * `initial` is what a new filter starts from. `preferred` are scopes put first, after 全体, as この記事.
 * `onCreated` takes over once a new filter is added; without it the inputs are emptied and a notice says so.
 * `label` names the form when the settings page asks before leaving changes that are not saved.
 */
export function FilterForm({
  filter,
  initial,
  preferred = [],
  label,
  onDone,
  onCreated,
}: {
  filter?: Filter;
  initial?: FilterStart;
  preferred?: FilterScope[];
  label?: string;
  onDone?: () => void;
  onCreated?: (saved: Filter) => void;
}) {
  const { api } = useApp();
  const refresh = useRefresh();
  const toast = useToast();
  const categories = useCategories().data ?? [];
  const feeds = useFeeds().data ?? [];
  const [draft, setDraft] = useState<Draft>(() => draftOf(filter ?? initial));
  const [problems, setProblems] = useState<FieldProblem[]>([]);
  const [general, setGeneral] = useState<string | null>(null);
  const [preview, setPreview] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  // Counts the changes to the draft, so that a count asked for before one can be told apart and dropped.
  const version = useRef(0);
  const scopeId = useId();
  // A new filter counts once a value is written: the kind, scope and fields alone are quickly chosen again.
  useUnsaved(
    label ?? (filter ? "フィルターの編集" : "新しいフィルター"),
    filter
      ? contentOf(draft) !== contentOf({ ...filter, scope: scopeKey(filter.scope) })
      : draft.conditions.some((condition) => condition.value.trim() !== ""),
  );

  const scope = scopeOf(draft.scope);
  const complete = scope !== null && draft.conditions.every((condition) => condition.fields.length > 0 && condition.value.trim().length > 0);
  const body = () => ({
    action: draft.action,
    scope: scope!,
    conditions: draft.conditions.map((condition) => ({ fields: condition.fields, match: condition.match, value: condition.value.trim() })),
  });
  const problemAt = (path: string) => {
    const found = problems.find((problem) => problem.path === path || problem.path.startsWith(`${path}.`));
    return found ? problemText(found) : null;
  };

  function change(next: Partial<Draft>) {
    version.current += 1;
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
      setGeneral("同じフィルターがすでにあります。");
    } else {
      setGeneral(messageFor(error));
    }
  }

  async function check() {
    const asked = version.current;
    setBusy(true);
    try {
      const result = await api.previewFilter({ ...body(), ...(filter ? { id: filter.id } : {}) });
      // An answer about conditions that have changed since would show the old count beside the new ones.
      if (version.current !== asked) return;
      setProblems([]);
      setGeneral(null);
      setPreview(result.hiddenCount);
    } catch (error) {
      if (version.current !== asked) return;
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
    try {
      if (filter) {
        const saved = await api.updateFilter(filter.id, body());
        refresh();
        toast({ message: `フィルターを保存しました。${saved.hiddenCount > 0 ? `${saved.hiddenCount}件を隠しています。` : "いま隠している記事はありません。"}` });
        onDone?.();
      } else {
        const saved = await api.createFilter(body());
        refresh();
        if (onCreated) {
          onCreated(saved);
          return;
        }
        version.current += 1;
        setDraft(draftOf());
        setPreview(null);
        toast({ message: `フィルターを追加しました。${saved.hiddenCount > 0 ? `${saved.hiddenCount}件を隠しています。` : "いま隠している記事はありません。"}` });
      }
    } catch (error) {
      refused(error);
    } finally {
      setBusy(false);
    }
  }

  const scopeProblem = problemAt("scope");
  // Feeds may belong to news categories only, so only those can hold feed articles.
  const preferredKeys = preferred.map(scopeKey);
  const newsCategories = categories.filter((category) => category.kind === "news" && !preferredKeys.includes(`c:${category.id}`));
  const otherFeeds = feeds.filter((feed) => !preferredKeys.includes(`f:${feed.id}`));
  return (
    <form noValidate onSubmit={save} className="flex max-w-measure-article flex-col gap-md" aria-label={filter ? "フィルターの編集" : undefined}>
      <fieldset className="flex flex-wrap gap-lg type-body-md">
        <legend className="pb-xs type-label-md">種類</legend>
        {(["hide", "keep"] as const).map((action) => (
          <label key={action} className="inline-flex cursor-pointer items-center gap-xs">
            <input
              type="radio"
              name={`${scopeId}-action`}
              className="accent-primary"
              checked={draft.action === action}
              // A keep filter over everything would hide every feed article it does not match.
              onChange={() => change({ action, ...(action === "keep" && draft.scope === "all" ? { scope: "" } : {}) })}
            />
            {ACTION_LABEL[action]}
          </label>
        ))}
      </fieldset>
      <p className="type-label-sm text-on-surface-muted">
        {draft.action === "hide"
          ? "すべての条件に合う記事を隠します。"
          : "範囲の記事のうち、すべての条件に合うものだけを残し、ほかを隠します。同じ範囲に残すフィルターが複数あれば、どれかに合う記事を残します。"}
      </p>
      <div className="flex flex-col gap-xs">
        <label htmlFor={scopeId} className="type-label-md">
          範囲
        </label>
        <select
          id={scopeId}
          value={draft.scope}
          onChange={(event) => change({ scope: event.target.value })}
          aria-invalid={scopeProblem ? true : undefined}
          className={`${SELECT} max-w-measure`}
        >
          {draft.action === "keep" ? (
            <option value="" disabled>
              選んでください
            </option>
          ) : (
            <option value="all">全体</option>
          )}
          {preferred.length > 0 ? (
            <optgroup label="この記事">
              {preferred.map((each) => (
                <option key={scopeKey(each)} value={scopeKey(each)}>
                  {scopeLabel(each, categories, feeds)}
                </option>
              ))}
            </optgroup>
          ) : null}
          {newsCategories.length > 0 ? (
            <optgroup label="カテゴリ">
              {newsCategories.map((category) => (
                <option key={category.id} value={`c:${category.id}`}>
                  {category.name}
                </option>
              ))}
            </optgroup>
          ) : null}
          {otherFeeds.length > 0 ? (
            <optgroup label="購読フィード">
              {otherFeeds.map((feed) => (
                <option key={feed.id} value={`f:${feed.id}`}>
                  {feed.title}
                </option>
              ))}
            </optgroup>
          ) : null}
        </select>
        {scopeProblem ? <p className="type-label-sm text-error">{scopeProblem}</p> : null}
      </div>
      <div className="flex flex-col gap-sm">
        <p className="type-label-md">条件（すべてに合う記事が対象）</p>
        {draft.conditions.map((condition, index) => (
          <ConditionInput
            key={condition.key}
            index={index}
            condition={condition}
            error={problemAt(`conditions.${index}`)}
            onChange={(next) => change({ conditions: draft.conditions.map((each) => (each.key === condition.key ? next : each)) })}
            onRemove={draft.conditions.length > 1 ? () => change({ conditions: draft.conditions.filter((each) => each.key !== condition.key) }) : null}
          />
        ))}
        <div>
          <Button onClick={() => change({ conditions: [...draft.conditions, newCondition()] })} disabled={draft.conditions.length >= MAX_FILTER_CONDITIONS}>
            条件を足す
          </Button>
        </div>
        <p className="type-label-sm text-on-surface-muted">
          大文字と小文字、全角と半角は区別しません。部分一致は記号もそのまま探します。内容は、リンク先のURLを除いた本文です。
        </p>
      </div>
      {general ? (
        <p role="alert" className="type-label-sm text-error">
          {general}
        </p>
      ) : null}
      {preview !== null ? (
        <p role="status" className="type-body-md">
          保存すると、{preview}件が隠れます。
        </p>
      ) : null}
      <div className="flex flex-wrap gap-sm">
        <Button type="submit" variant="primary" disabled={!complete || busy}>
          {filter ? "保存する" : "フィルターを追加"}
        </Button>
        <Button onClick={() => void check()} disabled={!complete || busy}>
          隠れる件数を確かめる
        </Button>
        {onDone ? <Button onClick={onDone}>やめる</Button> : null}
      </div>
    </form>
  );
}
