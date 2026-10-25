import type { Category, Feed, Filter, FilterAction, FilterCondition, FilterField, FilterMatch, FilterScope } from "@smarternews/core/api";
import { MAX_FILTER_CONDITIONS } from "@smarternews/core/api";
import { useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import { useId, useRef, useState, type FormEvent } from "react";
import { Link } from "react-router";
import { ApiError, formatFull } from "@smarternews/client";
import { useCategories, useFeeds, useFilters, useTimeZone } from "../api/queries.ts";
import { useApp } from "../app/context.ts";
import { useToast } from "../shell/toast.tsx";
import { Button, ErrorNotice, Loading, messageFor } from "../ui/controls.tsx";

const SECTION = "flex flex-col gap-md border-b border-outline px-lg py-xl md:px-2xl";
const SELECT = "rounded-md border border-outline-strong bg-surface px-sm py-xs type-body-md text-on-surface aria-invalid:border-error";
const INPUT = "w-full rounded-md border border-outline-strong bg-surface px-sm py-xs type-body-md text-on-surface aria-invalid:border-error";

const ACTION_LABEL: Record<FilterAction, string> = { hide: "隠すフィルター", keep: "残すフィルター" };
const FIELDS: FilterField[] = ["title", "content", "author", "url"];
const FIELD_LABEL: Record<FilterField, string> = { title: "タイトル", content: "内容", author: "著者", url: "URL" };
const MATCH_LABEL: Record<FilterMatch, string> = { contains: "部分一致", regex: "正規表現" };

/** The scope as the select holds it: "all", "c:<category id>", "f:<feed id>", or "" while none is chosen. */
type ScopeKey = string;

function scopeKey(scope: FilterScope): ScopeKey {
  return scope.type === "category" ? `c:${scope.categoryId}` : scope.type === "feed" ? `f:${scope.feedId}` : "all";
}

function scopeOf(key: ScopeKey): FilterScope | null {
  if (key === "all") return { type: "all" };
  const [kind, id] = key.split(":");
  if (kind === "c") return { type: "category", categoryId: Number(id) };
  if (kind === "f") return { type: "feed", feedId: Number(id) };
  return null;
}

function scopeLabel(scope: FilterScope, categories: Category[], feeds: Feed[]): string {
  if (scope.type === "category") return `カテゴリ「${categories.find((entry) => entry.id === scope.categoryId)?.name ?? "…"}」`;
  if (scope.type === "feed") return `購読フィード「${feeds.find((entry) => entry.id === scope.feedId)?.title ?? "…"}」`;
  return "全体";
}

function conditionLabel(condition: FilterCondition): string {
  const fields = condition.fields.map((field) => FIELD_LABEL[field]).join("か");
  return condition.match === "regex" ? `${fields}が正規表現「${condition.value}」に合う` : `${fields}に「${condition.value}」を含む`;
}

/** What the filter matches, in one line. */
function conditionsLabel(filter: Pick<Filter, "conditions">): string {
  return filter.conditions.map(conditionLabel).join("、かつ");
}

function useRefresh() {
  const client = useQueryClient();
  // A filter changes which articles the lists hold and what the counts say.
  return () => {
    for (const key of ["filters", "filter-articles", "articles", "counts"]) void client.invalidateQueries({ queryKey: [key] });
  };
}

/** Why the server refused a condition or the scope, in the app's words. */
function problemText(message: string): string {
  if (/regular expression/.test(message)) return "正規表現として読めません。かっこや記号の対応を確かめてください。";
  if (/no such (feed|category)/.test(message)) return "この範囲はもうありません。選び直してください。";
  if (/keep filter cannot apply to everything/.test(message)) return "残すフィルターには全体を選べません。";
  return message;
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

function draftOf(filter?: Filter): Draft {
  return filter
    ? { action: filter.action, scope: scopeKey(filter.scope), conditions: filter.conditions.map(newCondition) }
    : { action: "hide", scope: "all", conditions: [newCondition()] };
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

/** The inputs of a filter: kind, scope and conditions, with a count before saving. Used to add and to edit. */
function FilterForm({ filter, onDone }: { filter?: Filter; onDone?: () => void }) {
  const { api } = useApp();
  const refresh = useRefresh();
  const toast = useToast();
  const categories = useCategories().data ?? [];
  const feeds = useFeeds().data ?? [];
  const [draft, setDraft] = useState<Draft>(() => draftOf(filter));
  const [problems, setProblems] = useState<Array<{ path: string; message: string }>>([]);
  const [general, setGeneral] = useState<string | null>(null);
  const [preview, setPreview] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const scopeId = useId();

  const scope = scopeOf(draft.scope);
  const complete = scope !== null && draft.conditions.every((condition) => condition.fields.length > 0 && condition.value.trim().length > 0);
  const body = () => ({
    action: draft.action,
    scope: scope!,
    conditions: draft.conditions.map((condition) => ({ fields: condition.fields, match: condition.match, value: condition.value.trim() })),
  });
  const problemAt = (path: string) => {
    const found = problems.find((problem) => problem.path === path || problem.path.startsWith(`${path}.`));
    return found ? problemText(found.message) : null;
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
      setGeneral(shown ? null : problemText(error.fields[0]!.message));
    } else if (error instanceof ApiError && error.kind === "conflict") {
      setGeneral("同じフィルターがすでにあります。");
    } else {
      setGeneral(messageFor(error));
    }
  }

  async function check() {
    setBusy(true);
    try {
      const result = await api.previewFilter({ ...body(), ...(filter ? { id: filter.id } : {}) });
      setProblems([]);
      setGeneral(null);
      setPreview(result.hiddenCount);
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
    try {
      if (filter) {
        const saved = await api.updateFilter(filter.id, body());
        refresh();
        toast({ message: `フィルターを保存しました。${saved.hiddenCount > 0 ? `${saved.hiddenCount}件を隠しています。` : "いま隠している記事はありません。"}` });
        onDone?.();
      } else {
        const saved = await api.createFilter(body());
        refresh();
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
  const newsCategories = categories.filter((category) => category.kind === "news");
  return (
    <form onSubmit={save} className="flex max-w-measure-article flex-col gap-md" aria-label={filter ? "フィルターの編集" : undefined}>
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
          {newsCategories.length > 0 ? (
            <optgroup label="カテゴリ">
              {newsCategories.map((category) => (
                <option key={category.id} value={`c:${category.id}`}>
                  {category.name}
                </option>
              ))}
            </optgroup>
          ) : null}
          {feeds.length > 0 ? (
            <optgroup label="購読フィード">
              {feeds.map((feed) => (
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
          {filter ? "保存" : "フィルターを追加"}
        </Button>
        <Button onClick={() => void check()} disabled={!complete || busy}>
          隠れる件数を確かめる
        </Button>
        {onDone ? <Button onClick={onDone}>やめる</Button> : null}
      </div>
    </form>
  );
}

function HiddenArticles({ filter }: { filter: Filter }) {
  const { api } = useApp();
  const timeZone = useTimeZone();
  const feeds = useFeeds().data ?? [];
  const list = useInfiniteQuery({
    queryKey: ["filter-articles", filter.id],
    queryFn: ({ pageParam }) => api.filterArticles(filter.id, { limit: 50, ...(pageParam ? { cursor: pageParam } : {}) }),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
  });
  const items = list.data?.pages.flatMap((page) => page.items) ?? [];
  return (
    <section aria-label="隠している記事" className="flex flex-col gap-xs border-l border-outline-strong pl-md">
      {list.isError ? <ErrorNotice error={list.error} onRetry={() => void list.refetch()} /> : null}
      {list.isPending && !list.isError ? <Loading /> : null}
      {list.data && items.length === 0 ? <p className="type-body-md text-on-surface-muted">隠している記事はありません。</p> : null}
      <ul className="flex flex-col">
        {items.map((item) => (
          <li key={item.id} className="border-b border-outline py-xs">
            {/* The reader opens an article by its id, even one that no list holds. */}
            <Link to={`/f/${item.feedId}/${item.id}`} className="tap type-label-md text-primary underline underline-offset-4">
              {item.title}
            </Link>
            <p className="type-label-sm text-on-surface-muted">
              {feeds.find((feed) => feed.id === item.feedId)?.title ?? ""} ・ <time dateTime={item.updatedAt}>{formatFull(item.updatedAt, timeZone)}</time>
            </p>
          </li>
        ))}
      </ul>
      {list.hasNextPage ? (
        <div>
          <Button onClick={() => void list.fetchNextPage()} disabled={list.isFetchingNextPage}>
            さらに表示
          </Button>
        </div>
      ) : null}
    </section>
  );
}

function FilterRow({ filter, categories, feeds }: { filter: Filter; categories: Category[]; feeds: Feed[] }) {
  const { api } = useApp();
  const refresh = useRefresh();
  const toast = useToast();
  const [editing, setEditing] = useState(false);
  const [showing, setShowing] = useState(false);
  const editButton = useRef<HTMLButtonElement>(null);
  const summary = `${ACTION_LABEL[filter.action]}（${scopeLabel(filter.scope, categories, feeds)}）`;

  async function toggle() {
    try {
      const changed = await api.updateFilter(filter.id, { enabled: !filter.enabled });
      refresh();
      toast({
        message: changed.enabled
          ? `フィルターを有効にしました。${changed.hiddenCount > 0 ? `${changed.hiddenCount}件を隠しています。` : ""}`
          : `フィルターを無効にしました。${changed.restored > 0 ? `${changed.restored}件が一覧に戻りました。` : ""}`,
      });
    } catch (error) {
      toast({ message: messageFor(error) });
    }
  }

  async function remove() {
    try {
      const { restored } = await api.deleteFilter(filter.id);
      refresh();
      toast({ message: `フィルターを削除しました。${restored > 0 ? `${restored}件が一覧に戻りました。` : ""}` });
    } catch {
      toast({ message: "削除できませんでした。もう一度試してください。" });
    }
  }

  return (
    <li className="flex flex-col gap-xs border-b border-outline py-md type-body-md">
      <div className="flex flex-wrap items-baseline gap-x-lg gap-y-xs">
        <span className="type-label-md">{summary}</span>
        {filter.enabled ? null : <span className="rounded-sm border border-current px-xs type-label-sm text-on-surface-muted">無効</span>}
        <span className="tabular-nums text-on-surface-muted">
          {filter.enabled ? (filter.hiddenCount > 0 ? `${filter.hiddenCount}件を隠しています` : "隠している記事はありません") : "いまは隠していません"}
        </span>
      </div>
      <p className="break-all">{conditionsLabel(filter)}</p>
      {editing ? (
        <FilterForm
          filter={filter}
          onDone={() => {
            setEditing(false);
            editButton.current?.focus();
          }}
        />
      ) : (
        <div className="flex flex-wrap gap-sm pt-xs">
          <Button aria-expanded={showing} aria-label={`${summary}が隠している記事`} onClick={() => setShowing(!showing)} disabled={!filter.enabled}>
            隠している記事
          </Button>
          <Button ref={editButton} aria-label={`${summary}を編集`} onClick={() => setEditing(true)}>
            編集
          </Button>
          <Button aria-label={`${summary}を${filter.enabled ? "無効にする" : "有効にする"}`} onClick={() => void toggle()}>
            {filter.enabled ? "無効にする" : "有効にする"}
          </Button>
          <Button aria-label={`${summary}を削除`} onClick={() => void remove()}>
            削除
          </Button>
        </div>
      )}
      {showing && filter.enabled && !editing ? <HiddenArticles filter={filter} /> : null}
    </li>
  );
}

/** Filters that hide feed articles, or keep only some of them. */
export function FiltersPage() {
  const filters = useFilters();
  const categories = useCategories().data ?? [];
  const feeds = useFeeds().data ?? [];
  return (
    <div className="h-full overflow-y-auto bg-surface">
      <header className="flex flex-col gap-xs border-b border-outline px-lg py-md md:px-2xl">
        <Link to="/settings" className="tap type-body-md text-primary underline underline-offset-4">
          設定へ戻る
        </Link>
        <h1 className="type-headline-md">フィルター</h1>
      </header>
      <section aria-label="フィルターの追加" className={SECTION}>
        <h2 className="type-headline-md">追加</h2>
        <ul aria-label="フィルターの適用先" className="flex max-w-measure-article list-disc flex-col gap-xs pl-lg type-label-sm text-on-surface-muted">
          <li>購読フィードの配信記事だけを隠します。AI生成の記事は隠しません。</li>
          <li>スターまたは注釈のある記事は隠しません。</li>
          <li>隠すフィルターと残すフィルターの両方に当たる記事は隠します。</li>
        </ul>
        <FilterForm />
      </section>
      <section aria-label="フィルターの一覧" className={SECTION}>
        <h2 className="type-headline-md">一覧</h2>
        {filters.isError ? <ErrorNotice error={filters.error} onRetry={() => void filters.refetch()} /> : null}
        {filters.isPending && !filters.isError ? <Loading /> : null}
        {filters.data?.length === 0 ? <p className="type-body-md text-on-surface-muted">フィルターはまだありません。</p> : null}
        <ul className="max-w-measure-article">
          {filters.data?.map((filter) => <FilterRow key={filter.id} filter={filter} categories={categories} feeds={feeds} />)}
        </ul>
        <p className="max-w-measure-article type-label-sm text-on-surface-muted">
          隠した記事は消えません。フィルターを無効にするか削除すると、隠す前の既読とスターのまま一覧に戻ります。
        </p>
      </section>
    </div>
  );
}
