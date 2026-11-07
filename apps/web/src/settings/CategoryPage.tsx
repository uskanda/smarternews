import {
  CATEGORY_NAME_MAX_CHARS,
  IMPORTANCE_MAX,
  IMPORTANCE_MIN,
  MAX_ARTICLES_PER_RUN,
  SCHEDULE_MAX_TIMES,
  TOPIC_FEEDS_MAX,
  TOPIC_QUERIES_MAX,
  TOPIC_QUERY_MAX_CHARS,
  TOPIC_TEXT_MAX_CHARS,
  WINDOW_DAYS_MAX,
  WINDOW_HOURS_MAX,
  type Category,
  type CategoryUpdate,
  type SearchLocale,
  type Topic,
  type TopicUpdate,
} from "@smarternews/core/api";
import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router";
import { ApiError, checkText, checkTimes, checkWholeNumber, describeProblem, fieldMessage, linesOf } from "@smarternews/client";
import { useCategories, useCounts, useFeeds, useProviders, useRuns, useTopics } from "../api/queries.ts";
import { useApp } from "../app/context.ts";
import { useToast } from "../shell/toast.tsx";
import { ConfirmDialog } from "../ui/ConfirmDialog.tsx";
import { ScopedFiltersNote } from "./ScopedFiltersNote.tsx";
import { TopicRewrite } from "./TopicRewrite.tsx";
import { TopicStatsSection } from "./TopicStats.tsx";
import { TopicTrialResults, useTopicTrial } from "./TopicTrial.tsx";
import { useInlineEditFocus } from "./inline-edit-focus.ts";
import { Badge, Button, Checkbox, ErrorNotice, Field, Loading } from "../ui/controls.tsx";
import { LANGUAGE_FORMAT_HINT, problemsOf, REGION_FORMAT_HINT, TIME_FORMAT_HINT, type Problems } from "./checks.ts";
import { KIND_LABEL } from "./SettingsPage.tsx";
import { UnsavedGuard, useUnsaved, useUnsavedLeaving } from "./unsaved.tsx";

const SECTION = "flex flex-col gap-md border-b border-outline px-lg py-xl md:px-2xl";

// The number fields of a category: their names and ranges, for the hints, the checks and the server's refusals.
const SCHEDULE = { label: "実行時刻", formatHint: TIME_FORMAT_HINT };
const MIN_IMPORTANCE = { label: "最低重要度", min: IMPORTANCE_MIN, max: IMPORTANCE_MAX };
const MAX_ARTICLES = { label: "件数上限", min: 1, max: MAX_ARTICLES_PER_RUN };
const WINDOW_DAYS = { label: "対象期間（今後の日数）", min: 1, max: WINDOW_DAYS_MAX };
const WINDOW_HOURS = { label: "対象期間（時間）", min: 1, max: WINDOW_HOURS_MAX };

// The fields of a topic.
const TOPIC_TEXT = { label: "トピックの文章" };
const NEW_TOPIC = { label: "新しいトピック" };
const TOPIC_FEEDS = { label: "フィードのURL", formatHint: "https:// で始まるURLを書いてください。" };
const TOPIC_QUERIES = { label: "検索語" };
const TOPIC_LANGUAGE = { label: "検索の言語", formatHint: LANGUAGE_FORMAT_HINT };
const TOPIC_REGION = { label: "検索の地域", formatHint: REGION_FORMAT_HINT };

/** Why the feed URLs of a topic cannot be sent, or null. */
function feedsProblem(feeds: string[]): string | null {
  const isWebUrl = (url: string) => {
    try {
      return /^https?:$/.test(new URL(url).protocol);
    } catch {
      return false;
    }
  };
  const wrong = feeds.findIndex((url) => !isWebUrl(url));
  if (wrong >= 0) return describeProblem({ code: "format" }, TOPIC_FEEDS, wrong + 1);
  return feeds.length > TOPIC_FEEDS_MAX ? describeProblem({ code: "too_big", maximum: TOPIC_FEEDS_MAX, unit: "items" }, TOPIC_FEEDS) : null;
}

/** Why the search words of a topic cannot be sent, or null. */
function queriesProblem(queries: string[]): string | null {
  const long = queries.findIndex((query) => query.length > TOPIC_QUERY_MAX_CHARS);
  if (long >= 0) return describeProblem({ code: "too_big", maximum: TOPIC_QUERY_MAX_CHARS, unit: "chars" }, TOPIC_QUERIES, long + 1);
  return queries.length > TOPIC_QUERIES_MAX ? describeProblem({ code: "too_big", maximum: TOPIC_QUERIES_MAX, unit: "items" }, TOPIC_QUERIES) : null;
}

function generalError(error: unknown) {
  return error && !(error instanceof ApiError && error.kind === "invalid") ? <ErrorNotice error={error} /> : null;
}

// ---- category form -----------------------------------------------------------------------------

function CategoryForm({ category }: { category: Category }) {
  const { api } = useApp();
  const client = useQueryClient();
  const toast = useToast();
  const isEvent = category.kind === "event";
  const initial = {
    name: category.name,
    schedule: category.schedule.join(", "),
    minImportance: String(category.minImportance),
    maxArticlesPerRun: String(category.maxArticlesPerRun),
    window: String(isEvent ? category.windowDays : category.windowHours),
    enabled: category.enabled,
  };
  const [form, setForm] = useState(initial);
  const [problems, setProblems] = useState<Problems>({});
  const [error, setError] = useState<unknown>(null);
  useUnsaved("カテゴリの設定", JSON.stringify(form) !== JSON.stringify(initial));
  const set = (name: keyof typeof form) => (event: { target: { value: string } }) => {
    setForm({ ...form, [name]: event.target.value });
    setProblems((shown) => ({ ...shown, [name]: undefined }));
  };

  async function save(event: FormEvent) {
    event.preventDefault();
    const schedule = checkTimes(form.schedule, { label: SCHEDULE.label, max: SCHEDULE_MAX_TIMES, formatHint: TIME_FORMAT_HINT });
    const minImportance = checkWholeNumber(form.minImportance, MIN_IMPORTANCE);
    const maxArticlesPerRun = checkWholeNumber(form.maxArticlesPerRun, MAX_ARTICLES);
    const span = checkWholeNumber(form.window, isEvent ? WINDOW_DAYS : WINDOW_HOURS);
    const found = problemsOf({
      name: checkText(form.name, { label: "名前", max: CATEGORY_NAME_MAX_CHARS }),
      schedule: schedule.ok ? null : schedule.message,
      minImportance: minImportance.ok ? null : minImportance.message,
      maxArticlesPerRun: maxArticlesPerRun.ok ? null : maxArticlesPerRun.message,
      window: span.ok ? null : span.message,
    });
    setProblems(found ?? {});
    if (found !== null || !schedule.ok || !minImportance.ok || !maxArticlesPerRun.ok || !span.ok) return;
    const patch: CategoryUpdate = {
      name: form.name,
      schedule: schedule.value,
      minImportance: minImportance.value,
      maxArticlesPerRun: maxArticlesPerRun.value,
      ...(isEvent ? { windowDays: span.value } : { windowHours: span.value }),
      enabled: form.enabled,
    };
    try {
      await api.updateCategory(category.id, patch);
      setError(null);
      await client.invalidateQueries({ queryKey: ["categories"] });
      toast({ message: "保存しました" });
    } catch (caught) {
      setError(caught);
    }
  }

  return (
    <form noValidate onSubmit={save} className="grid max-w-measure grid-cols-1 gap-md sm:grid-cols-2">
      <div className="sm:col-span-2">
        <Field label="名前" value={form.name} onChange={set("name")} error={problems.name ?? fieldMessage(error, "name", "名前")} />
      </div>
      <dl className="flex gap-md type-body-md sm:col-span-2">
        <dt className="text-on-surface-muted">種別</dt>
        <dd>{KIND_LABEL[category.kind]}</dd>
      </dl>
      <div className="sm:col-span-2">
        <Field
          label={SCHEDULE.label}
          value={form.schedule}
          onChange={set("schedule")}
          error={problems.schedule ?? fieldMessage(error, "schedule", SCHEDULE)}
          hint="24時間表記の時刻を、コンマで区切って並べます。例は 05:00, 12:00, 18:00。全体設定のタイムゾーンで実行します。"
        />
      </div>
      <Field
        label={MIN_IMPORTANCE.label}
        type="number"
        min={MIN_IMPORTANCE.min}
        max={MIN_IMPORTANCE.max}
        value={form.minImportance}
        onChange={set("minImportance")}
        error={problems.minImportance ?? fieldMessage(error, "minImportance", MIN_IMPORTANCE)}
        hint={`${MIN_IMPORTANCE.min}から${MIN_IMPORTANCE.max}。これより低い話題は記事にしません。`}
      />
      <Field
        label={MAX_ARTICLES.label}
        type="number"
        min={MAX_ARTICLES.min}
        max={MAX_ARTICLES.max}
        value={form.maxArticlesPerRun}
        onChange={set("maxArticlesPerRun")}
        error={problems.maxArticlesPerRun ?? fieldMessage(error, "maxArticlesPerRun", MAX_ARTICLES)}
        hint={`1回の実行で新しく作る記事の数。${MAX_ARTICLES.min}から${MAX_ARTICLES.max}まで。`}
      />
      {isEvent ? (
        <Field
          label={WINDOW_DAYS.label}
          type="number"
          min={WINDOW_DAYS.min}
          max={WINDOW_DAYS.max}
          value={form.window}
          onChange={set("window")}
          error={problems.window ?? fieldMessage(error, "windowDays", WINDOW_DAYS)}
          hint={`この日数以内に開催されるイベントを集めます。${WINDOW_DAYS.min}から${WINDOW_DAYS.max}まで。`}
        />
      ) : (
        <Field
          label={WINDOW_HOURS.label}
          type="number"
          min={WINDOW_HOURS.min}
          max={WINDOW_HOURS.max}
          value={form.window}
          onChange={set("window")}
          error={problems.window ?? fieldMessage(error, "windowHours", WINDOW_HOURS)}
          hint={`この時間以内に公開されたページを集めます。${WINDOW_HOURS.min}から${WINDOW_HOURS.max}まで。`}
        />
      )}
      <div className="flex items-end">
        <Checkbox label="有効" checked={form.enabled} onChange={(event) => setForm({ ...form, enabled: event.target.checked })} />
      </div>
      <div className="sm:col-span-2">{generalError(error)}</div>
      <div className="sm:col-span-2">
        <Button type="submit" variant="primary">
          保存する
        </Button>
      </div>
    </form>
  );
}

// ---- topics ------------------------------------------------------------------------------------

/** After a topic of the category was added, changed or removed: its list and its stats are stale. */
async function refreshTopics(client: QueryClient, categoryId: number): Promise<void> {
  void client.invalidateQueries({ queryKey: ["topic-stats", categoryId] });
  await client.invalidateQueries({ queryKey: ["topics", categoryId] });
}

function TopicEditor({
  topic,
  canSearch,
  focusText = false,
  onClose,
}: {
  topic: Topic;
  canSearch: boolean;
  /** Puts the focus in the text when the editor opens: when a link to the topic opened it. */
  focusText?: boolean;
  onClose: () => void;
}) {
  const { api } = useApp();
  const client = useQueryClient();
  const toast = useToast();
  const warningId = useId();
  const initial = {
    text: topic.text,
    enabled: topic.enabled,
    feeds: topic.sources.feeds.join("\n"),
    newsSearch: topic.sources.newsSearch,
    llmSearch: topic.sources.llmSearch,
    queries: topic.queries.join("\n"),
    language: topic.search?.language ?? "",
    region: topic.search?.region ?? "",
  };
  const [form, setForm] = useState(initial);
  const [problems, setProblems] = useState<Problems>({});
  const [error, setError] = useState<unknown>(null);
  const [confirming, setConfirming] = useState(false);
  const [closing, setClosing] = useState(false);
  const dirty = JSON.stringify(form) !== JSON.stringify(initial);
  useUnsaved(`トピック『${topic.text}』の編集`, dirty);
  const text = (name: "text" | "feeds" | "queries" | "language" | "region") => (event: { target: { value: string } }) => {
    setForm({ ...form, [name]: event.target.value });
    setProblems((shown) => ({ ...shown, [name]: undefined }));
  };
  // 閉じる reads like "save and close" to some, so changes are only dropped once the user says so.
  const close = () => (dirty ? setClosing(true) : onClose());
  const searchOf = (): SearchLocale | null =>
    form.language.trim() || form.region.trim() ? { language: form.language.trim(), region: form.region.trim() } : null;
  const trial = useTopicTrial(topic.id);
  // Tries the text and search locale being edited. Nothing is saved, so the changes stay unsaved.
  const tryText = () => {
    const found = problemsOf({
      text: checkText(form.text, { label: TOPIC_TEXT.label, max: TOPIC_TEXT_MAX_CHARS }),
      language: form.region.trim() && !form.language.trim() ? describeProblem({ code: "required" }, TOPIC_LANGUAGE) : null,
      region: form.language.trim() && !form.region.trim() ? describeProblem({ code: "required" }, TOPIC_REGION) : null,
    });
    setProblems(found ?? {});
    if (found !== null) return;
    setError(null);
    void trial.start({ text: form.text, search: searchOf() }, setError);
  };

  async function save(event: FormEvent) {
    event.preventDefault();
    const found = problemsOf({
      text: checkText(form.text, { label: TOPIC_TEXT.label, max: TOPIC_TEXT_MAX_CHARS }),
      feeds: feedsProblem(linesOf(form.feeds)),
      queries: queriesProblem(linesOf(form.queries)),
      // A search locale has both a language and a region, or neither.
      language: form.region.trim() && !form.language.trim() ? describeProblem({ code: "required" }, TOPIC_LANGUAGE) : null,
      region: form.language.trim() && !form.region.trim() ? describeProblem({ code: "required" }, TOPIC_REGION) : null,
    });
    setProblems(found ?? {});
    if (found !== null) return;
    // Only what the user changed is sent: sending the sources marks them as chosen by the user for good.
    const patch: TopicUpdate = {};
    if (form.text !== initial.text) patch.text = form.text;
    if (form.enabled !== initial.enabled) patch.enabled = form.enabled;
    if (form.feeds !== initial.feeds || form.newsSearch !== initial.newsSearch || form.llmSearch !== initial.llmSearch) {
      patch.sources = { feeds: linesOf(form.feeds), newsSearch: form.newsSearch, llmSearch: form.llmSearch };
    }
    if (form.queries !== initial.queries) patch.queries = linesOf(form.queries);
    if (form.language !== initial.language || form.region !== initial.region) patch.search = searchOf();
    try {
      await api.updateTopic(topic.id, patch);
      await refreshTopics(client, topic.categoryId);
      toast({ message: "トピックを保存しました" });
      onClose();
    } catch (caught) {
      setError(caught);
    }
  }

  async function remove() {
    try {
      await api.deleteTopic(topic.id);
      await refreshTopics(client, topic.categoryId);
      toast({ message: "トピックを削除しました" });
    } catch (caught) {
      setConfirming(false);
      setError(caught);
    }
  }

  return (
    <form noValidate onSubmit={save} className="flex flex-col gap-md pt-sm">
      <Field
        label={TOPIC_TEXT.label}
        multiline
        autoFocus={focusText}
        value={form.text}
        onChange={text("text")}
        error={problems.text ?? fieldMessage(error, "text", TOPIC_TEXT)}
      />
      <Checkbox label="有効" checked={form.enabled} onChange={(event) => setForm({ ...form, enabled: event.target.checked })} />
      <Field
        label={TOPIC_FEEDS.label}
        multiline
        rows={3}
        value={form.feeds}
        onChange={text("feeds")}
        error={problems.feeds ?? fieldMessage(error, "sources.feeds", TOPIC_FEEDS)}
        hint="RSSまたはAtomのURLを、1行に1つ書きます。"
      />
      <div className="flex flex-col gap-xs">
        <Checkbox label="ニュース検索" checked={form.newsSearch} onChange={(event) => setForm({ ...form, newsSearch: event.target.checked })} />
        <Checkbox
          label="LLM検索"
          checked={form.llmSearch}
          aria-describedby={canSearch ? undefined : warningId}
          onChange={(event) => setForm({ ...form, llmSearch: event.target.checked })}
        />
        {canSearch ? null : (
          <p id={warningId} className="type-label-sm text-warning">
            検索のタスクに割り当てたプロバイダーが検索できないため、いまの設定では使われません。
          </p>
        )}
      </div>
      <Field
        label={TOPIC_QUERIES.label}
        multiline
        rows={3}
        value={form.queries}
        onChange={text("queries")}
        error={problems.queries ?? fieldMessage(error, "queries", TOPIC_QUERIES)}
        hint="ニュース検索に使う語を、1行に1つ書きます。文章を変えると、次の実行で作り直されます。"
      />
      <div className="grid grid-cols-2 gap-md">
        <Field
          label={TOPIC_LANGUAGE.label}
          value={form.language}
          onChange={text("language")}
          error={problems.language ?? fieldMessage(error, "search.language", TOPIC_LANGUAGE)}
          hint="空なら全体設定に従います。"
        />
        <Field
          label={TOPIC_REGION.label}
          value={form.region}
          onChange={text("region")}
          error={problems.region ?? fieldMessage(error, "search.region", TOPIC_REGION)}
        />
      </div>
      {generalError(error)}
      <div className="flex flex-wrap gap-sm">
        <Button type="submit" variant="primary">
          保存する
        </Button>
        <Button onClick={tryText} disabled={trial.running}>
          試す
        </Button>
        <Button onClick={close}>閉じる</Button>
        <Button onClick={() => setConfirming(true)}>トピックを削除</Button>
      </div>
      <p className="type-label-sm text-on-surface-muted">
        「試す」は、編集中の文章で保存してある候補を判定し直し、結論の入れ替わる候補を示します。何も保存せず、LLMを約3回呼びます。
      </p>
      <TopicTrialResults trial={trial} />
      <TopicRewrite
        topicId={topic.id}
        dirty={dirty}
        onUse={(proposed) => {
          setForm({ ...form, text: proposed });
          setProblems((shown) => ({ ...shown, text: undefined }));
        }}
      />
      <ConfirmDialog
        open={closing}
        title="保存していない変更があります"
        onDismiss={() => setClosing(false)}
        actions={
          <>
            <Button onClick={onClose}>破棄して閉じる</Button>
            <Button variant="primary" onClick={() => setClosing(false)}>
              編集を続ける
            </Button>
          </>
        }
      >
        <p>このトピックに加えた変更は保存されません。</p>
      </ConfirmDialog>
      <ConfirmDialog
        open={confirming}
        title="トピックを削除しますか"
        onDismiss={() => setConfirming(false)}
        actions={
          <>
            <Button variant="danger" onClick={() => void remove()}>
              削除する
            </Button>
            <Button onClick={() => setConfirming(false)}>やめる</Button>
          </>
        }
      >
        <p>このトピックでの収集を止めます。すでに作られた記事は残ります。</p>
      </ConfirmDialog>
    </form>
  );
}

/**
 * One topic. A link to `#topic-<id>` opens its editor with the focus in its text, both when the page opens with
 * that hash and when the hash changes to it later. The editor opened with the button takes the focus to its first
 * field too, and when the editor closes, the focus goes back to the button.
 */
function TopicItem({ topic, canSearch }: { topic: Topic; canSearch: boolean }) {
  const { hash } = useLocation();
  const anchor = `topic-${topic.id}`;
  const targeted = hash === `#${anchor}`;
  const [editing, setEditing] = useState(targeted);
  const [focusText, setFocusText] = useState(targeted);
  const [seenHash, setSeenHash] = useState(hash);
  if (hash !== seenHash) {
    setSeenHash(hash);
    if (targeted) {
      setEditing(true);
      setFocusText(true);
    }
  }
  const item = useRef<HTMLLIElement>(null);
  useEffect(() => {
    if (targeted) item.current?.scrollIntoView?.({ block: "start" });
  }, [targeted]);
  const close = () => {
    setEditing(false);
    setFocusText(false);
  };
  const focus = useInlineEditFocus(editing);
  const sources = [
    topic.sources.feeds.length > 0 ? `フィード ${topic.sources.feeds.length}` : null,
    topic.sources.newsSearch ? "ニュース検索" : null,
    topic.sources.llmSearch ? "LLM検索" : null,
  ].filter(Boolean);
  return (
    <li ref={item} id={anchor} className="flex flex-col gap-xs border-b border-outline py-md">
      <div className="flex items-start justify-between gap-md">
        <p className={`min-w-0 break-words ${topic.enabled ? "type-label-md" : "type-body-md text-on-surface-muted"}`}>{topic.text}</p>
        {editing ? null : (
          <Button ref={focus.opener} aria-label={`${topic.text} を編集`} onClick={() => setEditing(true)}>
            編集
          </Button>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-x-md gap-y-xs type-label-sm text-on-surface-muted">
        {topic.enabled ? null : <Badge>無効</Badge>}
        {sources.length > 0 ? sources.map((source) => <span key={source}>{source}</span>) : <span>取得元は未設定</span>}
      </div>
      {topic.interpreted ? (
        <dl className="grid grid-cols-[auto_1fr] gap-x-md gap-y-xs type-label-sm">
          <dt className="text-on-surface-muted">検索語</dt>
          <dd className="break-words">{topic.queries.join(" / ")}</dd>
          <dt className="text-on-surface-muted">判定基準</dt>
          <dd className="break-words">{topic.criteria}</dd>
        </dl>
      ) : (
        <p className="type-label-sm text-on-surface-muted">次の実行で解釈されます。検索語と判定基準は、そのとき作られます。</p>
      )}
      <TopicMisses topic={topic} />
      {editing ? (
        <div ref={focus.region}>
          <TopicEditor topic={topic} canSearch={canSearch} focusText={focusText} onClose={close} />
        </div>
      ) : null}
    </li>
  );
}

/**
 * How many articles of the topic were marked as misses after its last interpretation, and a way to interpret it
 * again so that the criteria leave such articles out. Nothing while there are none.
 */
function TopicMisses({ topic }: { topic: Topic }) {
  const { api } = useApp();
  const client = useQueryClient();
  const toast = useToast();
  const [sending, setSending] = useState(false);
  const count = topic.missesSinceInterpretation;
  if (count === 0) return null;

  async function interpret() {
    setSending(true);
    try {
      await api.interpretTopic(topic.id);
      await refreshTopics(client, topic.categoryId);
      toast({ message: "次の実行で解釈し直します。" });
    } catch {
      toast({ message: "解釈し直す予定を入れられませんでした。もう一度試してください。" });
    } finally {
      setSending(false);
    }
  }

  return topic.interpreted ? (
    <div className="flex flex-wrap items-center gap-x-md gap-y-xs">
      <p className="type-label-sm text-on-surface-muted">
        前の解釈のあとに、外れの印を付けた記事が{count}件あります。解釈し直すと、判定基準に反映されます。
      </p>
      <Button disabled={sending} onClick={() => void interpret()}>
        解釈し直す
      </Button>
    </div>
  ) : (
    <p className="type-label-sm text-on-surface-muted">外れの印を付けた記事が{count}件あります。次の解釈で、判定基準に反映されます。</p>
  );
}

function Topics({ category }: { category: Category }) {
  const { api } = useApp();
  const client = useQueryClient();
  const toast = useToast();
  const topics = useTopics(category.id);
  const providers = useProviders().data;
  const canSearch = providers ? (providers.providers.find((provider) => provider.name === providers.tasks.search)?.webSearch ?? false) : true;
  const [text, setText] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  useUnsaved("新しいトピック", text.trim() !== "");

  async function add(event: FormEvent) {
    event.preventDefault();
    const found = checkText(text, { label: NEW_TOPIC.label, max: TOPIC_TEXT_MAX_CHARS });
    setProblem(found);
    if (found !== null) return;
    try {
      await api.createTopic(category.id, { text });
      setText("");
      setError(null);
      await refreshTopics(client, category.id);
      toast({ message: "追加しました。次の実行で解釈されます。" });
    } catch (caught) {
      setError(caught);
    }
  }

  return (
    <section aria-label="トピック" className={SECTION}>
      <h2 className="type-headline-md">トピック</h2>
      <p className="max-w-measure type-body-md text-on-surface-muted">
        追いたい話題を、キーワードか文章で書きます。何を拾い、何を除くかを文章で書くほど、外れが減ります。
      </p>
      {topics.isError ? <ErrorNotice error={topics.error} onRetry={() => void topics.refetch()} /> : null}
      {topics.data?.length === 0 ? <p className="type-body-md text-on-surface-muted">トピックはまだありません。</p> : null}
      <ul className="max-w-measure">{topics.data?.map((topic) => <TopicItem key={topic.id} topic={topic} canSearch={canSearch} />)}</ul>
      <form noValidate onSubmit={add} className="flex max-w-measure flex-col gap-sm">
        <Field
          label={NEW_TOPIC.label}
          multiline
          rows={2}
          value={text}
          onChange={(event) => {
            setText(event.target.value);
            setProblem(null);
          }}
          error={problem ?? fieldMessage(error, "text", NEW_TOPIC)}
        />
        {generalError(error)}
        <div>
          <Button type="submit" variant="primary" disabled={text.trim().length === 0}>
            トピックを追加
          </Button>
        </div>
      </form>
    </section>
  );
}

// ---- running and deleting ----------------------------------------------------------------------

function RunNow({ category }: { category: Category }) {
  const { api } = useApp();
  const client = useQueryClient();
  const toast = useToast();
  const runs = useRuns(category.id);
  const active = runs.data?.some((run) => run.status === "queued" || run.status === "running") ?? false;

  async function run() {
    try {
      await api.runCategory(category.id);
    } catch (error) {
      toast({
        message: error instanceof ApiError && error.kind === "conflict" ? "このカテゴリはすでに実行中です。" : "実行を始められませんでした。",
      });
    }
    await client.invalidateQueries({ queryKey: ["runs"] });
  }

  return (
    <section aria-label="実行" className={SECTION}>
      <h2 className="type-headline-md">実行</h2>
      <div className="flex flex-wrap items-center gap-md">
        <Button onClick={() => void run()} disabled={active}>
          いますぐ実行
        </Button>
        {active ? <span className="type-body-md">実行中です。終わると記事が一覧に並びます。</span> : null}
        <Link to={`/runs?category=${category.id}`} className="tap type-body-md text-primary underline underline-offset-4">
          このカテゴリの実行履歴
        </Link>
      </div>
    </section>
  );
}

function DeleteCategory({ category }: { category: Category }) {
  const { api } = useApp();
  const leave = useUnsavedLeaving();
  const client = useQueryClient();
  const navigate = useNavigate();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const topicCount = useTopics(category.id).data?.length;
  // Only generated articles go with the category; the articles of its feeds stay.
  const articleCount = useCounts().data?.categories.find((entry) => entry.categoryId === category.id)?.generatedTotal;
  const feedCount = useFeeds().data?.filter((feed) => feed.categoryId === category.id).length ?? 0;

  async function refreshLists() {
    await client.invalidateQueries({ queryKey: ["categories"] });
    void client.invalidateQueries({ queryKey: ["counts"] });
    void client.invalidateQueries({ queryKey: ["articles"] });
    void client.invalidateQueries({ queryKey: ["feeds"] });
    void client.invalidateQueries({ queryKey: ["filters"] });
  }
  async function remove() {
    try {
      await api.deleteCategory(category.id);
      // What was being edited is gone with the category, so there is nothing left to ask about.
      leave();
      await refreshLists();
      toast({ message: "カテゴリを削除しました" });
      void navigate("/settings");
    } catch {
      setOpen(false);
      toast({ message: "削除できませんでした。もう一度試してください。" });
    }
  }
  async function disable() {
    try {
      await api.updateCategory(category.id, { enabled: false });
      await refreshLists();
      toast({ message: "カテゴリを無効にしました" });
    } catch {
      toast({ message: "無効にできませんでした。もう一度試してください。" });
    }
    setOpen(false);
  }

  return (
    <section aria-label="削除" className={SECTION}>
      <h2 className="type-headline-md">削除</h2>
      <div>
        <Button onClick={() => setOpen(true)}>カテゴリを削除</Button>
      </div>
      <ConfirmDialog
        open={open}
        title="カテゴリを削除しますか"
        onDismiss={() => setOpen(false)}
        actions={
          <>
            <Button variant="danger" onClick={() => void remove()}>
              削除する
            </Button>
            <Button onClick={() => void disable()}>無効にする</Button>
            <Button onClick={() => setOpen(false)}>やめる</Button>
          </>
        }
      >
        <p>
          「{category.name}」と、トピック{topicCount ?? "…"}件と記事{articleCount ?? "…"}件が消えます。実行履歴も消え、元に戻せません。
        </p>
        {feedCount > 0 ? <p>購読フィード{feedCount}件は消えず、「未分類」へ移ります。その配信記事も残ります。</p> : null}
        <ScopedFiltersNote target={{ categoryId: category.id }} />
        <p>記事を残したまま収集だけを止めるには、無効にしてください。</p>
      </ConfirmDialog>
    </section>
  );
}

// ---- page --------------------------------------------------------------------------------------

/** One category: its settings, its topics and their stats, running it now, and deleting it. */
export function CategoryPage() {
  const params = useParams();
  const categories = useCategories();
  const category = categories.data?.find((entry) => String(entry.id) === params.categoryId);

  if (categories.isError) return <ErrorNotice error={categories.error} onRetry={() => void categories.refetch()} />;
  if (!categories.data) return <Loading />;
  if (!category) {
    return (
      <div className="flex flex-col items-start gap-md p-xl type-body-md">
        <p>このカテゴリはありません。削除された可能性があります。</p>
        <Link to="/settings" className="text-primary underline underline-offset-4">
          設定へ戻る
        </Link>
      </div>
    );
  }

  return (
    <UnsavedGuard>
      <div className="h-full overflow-y-auto bg-surface">
        <header className="flex flex-col gap-xs border-b border-outline px-lg py-md md:px-2xl">
          <Link to="/settings" className="tap type-label-sm text-primary underline underline-offset-4">
            設定へ戻る
          </Link>
          <h1 className="type-headline-md">{category.name}</h1>
        </header>
        <section aria-label="カテゴリの設定" className={SECTION}>
          <CategoryForm key={`${category.id}:${JSON.stringify(category)}`} category={category} />
        </section>
        <Topics category={category} />
        <TopicStatsSection category={category} />
        <RunNow category={category} />
        <DeleteCategory category={category} />
      </div>
    </UnsavedGuard>
  );
}
