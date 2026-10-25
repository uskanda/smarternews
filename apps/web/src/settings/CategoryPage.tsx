import type { Category, CategoryUpdate, Topic, TopicUpdate } from "@smarternews/core/api";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { Link, useBlocker, useNavigate, useParams } from "react-router";
import { ApiError } from "@smarternews/client";
import { useCategories, useCounts, useFeeds, useProviders, useRuns, useTopics } from "../api/queries.ts";
import { useApp } from "../app/context.ts";
import { useToast } from "../shell/toast.tsx";
import { ConfirmDialog } from "../ui/ConfirmDialog.tsx";
import { ScopedFiltersNote } from "./ScopedFiltersNote.tsx";
import { Badge, Button, Checkbox, ErrorNotice, Field, Loading } from "../ui/controls.tsx";
import { KIND_LABEL, refusal } from "./SettingsPage.tsx";

const SECTION = "flex flex-col gap-md border-b border-outline px-lg py-xl md:px-2xl";
const lines = (text: string) =>
  text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

function generalError(error: unknown) {
  return error && !(error instanceof ApiError && error.kind === "invalid") ? <ErrorNotice error={error} /> : null;
}

// ---- category form -----------------------------------------------------------------------------

function CategoryForm({ category, onDirty }: { category: Category; onDirty: (dirty: boolean) => void }) {
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
  const [error, setError] = useState<unknown>(null);
  const dirty = JSON.stringify(form) !== JSON.stringify(initial);
  useEffect(() => onDirty(dirty), [dirty, onDirty]);
  const set = (name: keyof typeof form) => (event: { target: { value: string } }) => setForm({ ...form, [name]: event.target.value });

  async function save(event: FormEvent) {
    event.preventDefault();
    const patch: CategoryUpdate = {
      name: form.name,
      schedule: form.schedule.split(/[\s,、]+/).filter((time) => time.length > 0),
      minImportance: Number(form.minImportance),
      maxArticlesPerRun: Number(form.maxArticlesPerRun),
      ...(isEvent ? { windowDays: Number(form.window) } : { windowHours: Number(form.window) }),
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
    <form onSubmit={save} className="grid max-w-measure grid-cols-1 gap-md sm:grid-cols-2">
      <div className="sm:col-span-2">
        <Field label="名前" value={form.name} onChange={set("name")} error={refusal(error, "name")} />
      </div>
      <dl className="flex gap-md type-body-md sm:col-span-2">
        <dt className="text-on-surface-muted">種別</dt>
        <dd>{KIND_LABEL[category.kind]}</dd>
      </dl>
      <div className="sm:col-span-2">
        <Field
          label="実行時刻"
          value={form.schedule}
          onChange={set("schedule")}
          error={refusal(error, "schedule")}
          hint="24時間表記の時刻を、コンマで区切って並べます。例は 05:00, 12:00, 18:00。全体設定のタイムゾーンで実行します。"
        />
      </div>
      <Field
        label="最低重要度"
        type="number"
        min={1}
        max={5}
        value={form.minImportance}
        onChange={set("minImportance")}
        error={refusal(error, "minImportance")}
        hint="1から5。これより低い話題は記事にしません。"
      />
      <Field
        label="件数上限"
        type="number"
        min={1}
        value={form.maxArticlesPerRun}
        onChange={set("maxArticlesPerRun")}
        error={refusal(error, "maxArticlesPerRun")}
        hint="1回の実行で新しく作る記事の数。"
      />
      {isEvent ? (
        <Field
          label="対象期間（今後の日数）"
          type="number"
          min={1}
          value={form.window}
          onChange={set("window")}
          error={refusal(error, "windowDays")}
          hint="この日数以内に開催されるイベントを集めます。"
        />
      ) : (
        <Field
          label="対象期間（時間）"
          type="number"
          min={1}
          value={form.window}
          onChange={set("window")}
          error={refusal(error, "windowHours")}
          hint="この時間以内に公開されたページを集めます。"
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

function TopicEditor({ topic, canSearch, onClose }: { topic: Topic; canSearch: boolean; onClose: () => void }) {
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
  const [error, setError] = useState<unknown>(null);
  const [confirming, setConfirming] = useState(false);
  const text = (name: "text" | "feeds" | "queries" | "language" | "region") => (event: { target: { value: string } }) =>
    setForm({ ...form, [name]: event.target.value });

  async function save(event: FormEvent) {
    event.preventDefault();
    // Only what the user changed is sent: sending the sources marks them as chosen by the user for good.
    const patch: TopicUpdate = {};
    if (form.text !== initial.text) patch.text = form.text;
    if (form.enabled !== initial.enabled) patch.enabled = form.enabled;
    if (form.feeds !== initial.feeds || form.newsSearch !== initial.newsSearch || form.llmSearch !== initial.llmSearch) {
      patch.sources = { feeds: lines(form.feeds), newsSearch: form.newsSearch, llmSearch: form.llmSearch };
    }
    if (form.queries !== initial.queries) patch.queries = lines(form.queries);
    if (form.language !== initial.language || form.region !== initial.region) {
      patch.search = form.language.trim() || form.region.trim() ? { language: form.language.trim(), region: form.region.trim() } : null;
    }
    try {
      await api.updateTopic(topic.id, patch);
      await client.invalidateQueries({ queryKey: ["topics", topic.categoryId] });
      toast({ message: "トピックを保存しました" });
      onClose();
    } catch (caught) {
      setError(caught);
    }
  }

  async function remove() {
    try {
      await api.deleteTopic(topic.id);
      await client.invalidateQueries({ queryKey: ["topics", topic.categoryId] });
      toast({ message: "トピックを削除しました" });
    } catch (caught) {
      setConfirming(false);
      setError(caught);
    }
  }

  return (
    <form onSubmit={save} className="flex flex-col gap-md pt-sm">
      <Field label="トピックの文章" multiline value={form.text} onChange={text("text")} error={refusal(error, "text")} />
      <Checkbox label="有効" checked={form.enabled} onChange={(event) => setForm({ ...form, enabled: event.target.checked })} />
      <Field
        label="フィードのURL"
        multiline
        rows={3}
        value={form.feeds}
        onChange={text("feeds")}
        error={refusal(error, "sources.feeds")}
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
        label="検索語"
        multiline
        rows={3}
        value={form.queries}
        onChange={text("queries")}
        error={refusal(error, "queries")}
        hint="ニュース検索に使う語を、1行に1つ書きます。文章を変えると、次の実行で作り直されます。"
      />
      <div className="grid grid-cols-2 gap-md">
        <Field label="検索の言語" value={form.language} onChange={text("language")} error={refusal(error, "search.language")} hint="空なら全体設定に従います。" />
        <Field label="検索の地域" value={form.region} onChange={text("region")} error={refusal(error, "search.region")} />
      </div>
      {generalError(error)}
      <div className="flex flex-wrap gap-sm">
        <Button type="submit" variant="primary">
          トピックを保存
        </Button>
        <Button onClick={onClose}>閉じる</Button>
        <Button onClick={() => setConfirming(true)}>トピックを削除</Button>
      </div>
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

function TopicItem({ topic, canSearch }: { topic: Topic; canSearch: boolean }) {
  const [editing, setEditing] = useState(false);
  const sources = [
    topic.sources.feeds.length > 0 ? `フィード ${topic.sources.feeds.length}` : null,
    topic.sources.newsSearch ? "ニュース検索" : null,
    topic.sources.llmSearch ? "LLM検索" : null,
  ].filter(Boolean);
  return (
    <li className="flex flex-col gap-xs border-b border-outline py-md">
      <div className="flex items-start justify-between gap-md">
        <p className={`min-w-0 break-words ${topic.enabled ? "type-label-md" : "type-body-md text-on-surface-muted"}`}>{topic.text}</p>
        {editing ? null : (
          <Button aria-label={`${topic.text} を編集`} onClick={() => setEditing(true)}>
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
      {editing ? <TopicEditor topic={topic} canSearch={canSearch} onClose={() => setEditing(false)} /> : null}
    </li>
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
  const [error, setError] = useState<unknown>(null);

  async function add(event: FormEvent) {
    event.preventDefault();
    try {
      await api.createTopic(category.id, { text });
      setText("");
      setError(null);
      await client.invalidateQueries({ queryKey: ["topics", category.id] });
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
      <form onSubmit={add} className="flex max-w-measure flex-col gap-sm">
        <Field label="新しいトピック" multiline rows={2} value={text} onChange={(event) => setText(event.target.value)} error={refusal(error, "text")} />
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

function DeleteCategory({ category, onLeave }: { category: Category; onLeave: () => void }) {
  const { api } = useApp();
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
      onLeave();
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

/** One category: its settings, its topics, running it now, and deleting it. */
export function CategoryPage() {
  const params = useParams();
  const categories = useCategories();
  const category = categories.data?.find((entry) => String(entry.id) === params.categoryId);
  const [dirty, setDirty] = useState(false);
  const leaving = useRef(false);
  const blocker = useBlocker(() => dirty && !leaving.current);

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
    <div className="h-full overflow-y-auto bg-surface">
      <header className="flex flex-col gap-xs border-b border-outline px-lg py-md md:px-2xl">
        <Link to="/settings" className="tap type-label-sm text-primary underline underline-offset-4">
          設定へ戻る
        </Link>
        <h1 className="type-headline-md">{category.name}</h1>
      </header>
      <section aria-label="カテゴリの設定" className={SECTION}>
        <CategoryForm key={`${category.id}:${JSON.stringify(category)}`} category={category} onDirty={setDirty} />
      </section>
      <Topics category={category} />
      <RunNow category={category} />
      <DeleteCategory
        category={category}
        onLeave={() => {
          leaving.current = true;
        }}
      />
      <ConfirmDialog
        open={blocker.state === "blocked"}
        title="保存していない変更があります"
        onDismiss={() => blocker.reset?.()}
        actions={
          <>
            <Button onClick={() => blocker.proceed?.()}>破棄して移動</Button>
            <Button variant="primary" onClick={() => blocker.reset?.()}>
              編集を続ける
            </Button>
          </>
        }
      >
        <p>このまま移動すると、カテゴリの設定に加えた変更は保存されません。</p>
      </ConfirmDialog>
    </div>
  );
}
