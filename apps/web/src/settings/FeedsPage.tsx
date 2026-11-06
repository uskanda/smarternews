import { FEED_INTERVAL_MINUTES_MAX, FEED_INTERVAL_MINUTES_MIN, FEED_TITLE_MAX_CHARS, type Category, type Feed, type FeedStats, type Settings } from "@smarternews/core/api";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link } from "react-router";
import { ApiError, checkText, conflictLabel, feedErrorLabel, fieldMessage, formatClock, formatDay, UNCATEGORIZED_LABEL } from "@smarternews/client";
import { useCategories, useFeeds, useSettings, useTimeZone, useTranslationStatus } from "../api/queries.ts";
import { useApp } from "../app/context.ts";
import { useToast } from "../shell/toast.tsx";
import { ConfirmDialog } from "../ui/ConfirmDialog.tsx";
import { ScopedFiltersNote } from "./ScopedFiltersNote.tsx";
import { feedDeletionText } from "./feed-deletion.ts";
import { AddFeedForm, CategorySelect, NO_CATEGORY } from "./AddFeedForm.tsx";
import { AutoSummarize, FetchFullContent, Translate } from "./FeedSwitches.tsx";
import { CandidateChoice, CandidateStatus, SelectorEditor, selectorsOf, textsOf, useCandidates, type SelectorTexts } from "./PageSelectors.tsx";
import { Badge, Button, Checkbox, ErrorNotice, Field, Loading, messageFor } from "../ui/controls.tsx";

const SECTION = "flex flex-col gap-md border-b border-outline px-lg py-xl md:px-2xl";
const RANGE = "5分から1440分（24時間）の範囲で入力してください。";

const INTERVAL = { label: "取得周期（分）", min: FEED_INTERVAL_MINUTES_MIN, max: FEED_INTERVAL_MINUTES_MAX };

/** A whole number of minutes within the allowed range, or null. */
function minutesOf(text: string): number | null {
  if (!/^\d+$/.test(text.trim())) return null;
  const value = Number(text.trim());
  return value >= FEED_INTERVAL_MINUTES_MIN && value <= FEED_INTERVAL_MINUTES_MAX ? value : null;
}

function useRefresh() {
  const client = useQueryClient();
  return (...keys: string[]) => {
    for (const key of keys) void client.invalidateQueries({ queryKey: [key] });
  };
}

// ---- adding ------------------------------------------------------------------------------------

function AddFeed({ categories }: { categories: Category[] }) {
  return (
    <section aria-label="購読フィードの追加" className={SECTION}>
      <h2 className="type-headline-md">追加</h2>
      <AddFeedForm categories={categories} />
    </section>
  );
}

// ---- the list ----------------------------------------------------------------------------------

/** "4件（40%）": a count and its share of what came, rounded to a whole percent. */
function share(count: number, received: number): string {
  return `${count}件（${Math.round((count / received) * 100)}%）`;
}

function StatsList({ stats, timeZone }: { stats: FeedStats; timeZone: string }) {
  const at = (iso: string) => `${formatDay(iso, timeZone).date} ${formatClock(iso, timeZone)}`;
  const rows: Array<[string, string]> = [
    ["届いた記事", `${stats.received}件`],
    ...(stats.received > 0
      ? ([
          ["開いた記事", share(stats.opened, stats.received)],
          ["スターを付けた記事", share(stats.starred, stats.received)],
        ] as Array<[string, string]>)
      : ([
          ["開いた記事", `${stats.opened}件`],
          ["スターを付けた記事", `${stats.starred}件`],
        ] as Array<[string, string]>)),
    ["フィルターで隠した記事", `${stats.hiddenByFilters}件`],
    ["重複として隠した記事", `${stats.hiddenAsDuplicates}件`],
    ["最後の新着", stats.lastNewItemAt ? at(stats.lastNewItemAt) : "まだありません"],
  ];
  return (
    <>
      {stats.received === 0 ? <p className="type-body-md">直近30日に届いた記事はありません。</p> : null}
      <dl className="grid grid-cols-[auto_1fr] gap-x-lg gap-y-xs type-body-md">
        {rows.map(([term, value]) => (
          <div key={term} className="contents">
            <dt className="text-on-surface-muted">{term}</dt>
            <dd className="tabular-nums">{value}</dd>
          </div>
        ))}
      </dl>
    </>
  );
}

/** What became of the articles the feed delivered in the last 30 days, counted by the server when the form opens. */
function FeedStatsSection({ feed }: { feed: Feed }) {
  const { api } = useApp();
  const timeZone = useTimeZone();
  const stats = useQuery({ queryKey: ["feed-stats", feed.id], queryFn: () => api.feedStats(feed.id) });
  const id = `feed-${feed.id}-stats`;
  return (
    <section aria-labelledby={id} className="flex flex-col gap-xs rounded-md border border-outline px-lg py-md">
      <h3 id={id} className="type-label-md">
        直近30日の統計
      </h3>
      {stats.isError ? <ErrorNotice error={stats.error} onRetry={() => void stats.refetch()} /> : null}
      {stats.isPending && !stats.isError ? <Loading /> : null}
      {stats.data ? <StatsList stats={stats.data} timeZone={timeZone} /> : null}
      <p className="type-label-sm text-on-surface-muted">
        保存した日から30日以内の記事を数えます。フィルターで隠した記事は、いまのフィルターで数えます。
      </p>
    </section>
  );
}

function EditFeed({ feed, categories, onDone }: { feed: Feed; categories: Category[]; onDone: () => void }) {
  const { api } = useApp();
  const refresh = useRefresh();
  const toast = useToast();
  const [title, setTitle] = useState(feed.title);
  const [category, setCategory] = useState(feed.categoryId === null ? NO_CATEGORY : String(feed.categoryId));
  const [ownInterval, setOwnInterval] = useState(feed.intervalMinutes !== null);
  const [minutes, setMinutes] = useState(feed.intervalMinutes === null ? "" : String(feed.intervalMinutes));
  const [paused, setPaused] = useState(!feed.enabled);
  const [autoSummarize, setAutoSummarize] = useState(feed.autoSummarize);
  const [translate, setTranslate] = useState(feed.translate);
  const [fetchFullContent, setFetchFullContent] = useState(feed.fetchFullContent);
  const [selectors, setSelectors] = useState<SelectorTexts>(textsOf(feed.selectors));
  const [intervalError, setIntervalError] = useState<string | null>(null);
  const [titleProblem, setTitleProblem] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  // The form takes the place of the buttons that opened it, so the focus is carried into it.
  const form = useRef<HTMLFormElement>(null);
  useEffect(() => {
    form.current?.querySelector("input")?.focus();
  }, []);

  async function save(event: FormEvent) {
    event.preventDefault();
    const intervalMinutes = ownInterval ? minutesOf(minutes) : null;
    const titleError = checkText(title, { label: "名前", max: FEED_TITLE_MAX_CHARS });
    setTitleProblem(titleError);
    if (ownInterval && intervalMinutes === null) setIntervalError(RANGE);
    if (titleError !== null || (ownInterval && intervalMinutes === null)) return;
    const chosenSelectors = feed.format === "page" ? selectorsOf(selectors) : null;
    try {
      await api.updateFeed(feed.id, {
        ...(title.trim() !== feed.title ? { title: title.trim() } : {}),
        // Only a web feed has selectors; they are sent when they changed, and apply from the next fetch.
        ...(chosenSelectors !== null && JSON.stringify(chosenSelectors) !== JSON.stringify(feed.selectors) ? { selectors: chosenSelectors } : {}),
        categoryId: category === NO_CATEGORY ? null : Number(category),
        intervalMinutes,
        enabled: !paused,
        autoSummarize,
        translate,
        fetchFullContent,
      });
      refresh("feeds", "counts", "articles", "filters");
      toast({ message: "購読フィードを保存しました" });
      onDone();
    } catch (caught) {
      setError(caught);
    }
  }

  const id = `feed-${feed.id}`;
  const categoryProblem = fieldMessage(error, "categoryId", "カテゴリ");
  // The form checks the range itself, so that the reason is shown in the app's words beside the field.
  return (
    <form ref={form} noValidate onSubmit={save} className="flex max-w-measure flex-col gap-md pt-sm">
      <FeedStatsSection feed={feed} />
      <Field
        label="名前"
        value={title}
        onChange={(event) => {
          setTitle(event.target.value);
          setTitleProblem(null);
        }}
        error={titleProblem ?? fieldMessage(error, "title", "名前")}
      />
      <div className="flex flex-col gap-xs">
        <label htmlFor={`${id}-category`} className="type-label-md">
          カテゴリ
        </label>
        <CategorySelect id={`${id}-category`} value={category} onChange={setCategory} categories={categories} />
        {categoryProblem ? <p className="type-label-sm text-error">{categoryProblem}</p> : null}
      </div>
      <fieldset className="flex flex-col gap-xs type-body-md">
        <legend className="pb-xs type-label-md">取得周期</legend>
        <label className="inline-flex cursor-pointer items-center gap-xs">
          <input type="radio" name={`${id}-interval`} className="accent-primary" checked={!ownInterval} onChange={() => setOwnInterval(false)} />
          基本の取得周期を使う
        </label>
        <label className="inline-flex cursor-pointer items-center gap-xs">
          <input type="radio" name={`${id}-interval`} className="accent-primary" checked={ownInterval} onChange={() => setOwnInterval(true)} />
          このフィードだけの周期にする
        </label>
      </fieldset>
      {ownInterval ? (
        <Field
          label="取得周期（分）"
          type="number"
          inputMode="numeric"
          min={5}
          max={1440}
          value={minutes}
          onChange={(event) => {
            setMinutes(event.target.value);
            setIntervalError(null);
          }}
          error={intervalError ?? fieldMessage(error, "intervalMinutes", INTERVAL)}
        />
      ) : null}
      <Checkbox label="取得を一時停止する" checked={paused} onChange={(event) => setPaused(event.target.checked)} />
      <AutoSummarize id={`${id}-summarize-hint`} checked={autoSummarize} onChange={setAutoSummarize} />
      <Translate id={`${id}-translate-hint`} checked={translate} onChange={setTranslate} />
      <FetchFullContent id={`${id}-full-content-hint`} checked={fetchFullContent} onChange={setFetchFullContent} page={feed.format === "page"} />
      {feed.format === "page" ? <PageSelectorsSection feed={feed} value={selectors} onChange={setSelectors} error={error} /> : null}
      {error && !(error instanceof ApiError && error.kind === "invalid") ? <ErrorNotice error={error} /> : null}
      <div className="flex flex-wrap gap-sm">
        <Button type="submit" variant="primary" disabled={title.trim().length === 0 || (feed.format === "page" && selectorsOf(selectors) === null)}>
          保存する
        </Button>
        <Button onClick={onDone}>やめる</Button>
      </div>
    </form>
  );
}

/**
 * The selectors of a web feed: written by hand and tried on the page, or taken from candidates asked for again,
 * for a page whose structure changed. What is chosen is saved with the rest of the form.
 */
function PageSelectorsSection({ feed, value, onChange, error }: { feed: Feed; value: SelectorTexts; onChange: (value: SelectorTexts) => void; error: unknown }) {
  const candidates = useCandidates();
  const [chosen, setChosen] = useState<number | null>(null);
  // The fields are made again when a candidate fills them, so that the preview of the old values goes.
  const [generation, setGeneration] = useState(0);
  const id = `feed-${feed.id}-selectors`;

  function choose(index: number) {
    if (candidates.state.status !== "ready") return;
    const candidate = candidates.state.result.candidates[index];
    if (!candidate) return;
    setChosen(index);
    onChange(textsOf(candidate.selectors));
    setGeneration((value) => value + 1);
  }

  return (
    <section aria-labelledby={id} className="flex flex-col gap-md rounded-md border border-outline px-lg py-md">
      <h3 id={id} className="type-label-md">
        記事の見つけ方
      </h3>
      <p className="type-label-sm text-on-surface-muted">ページの中の記事を、CSSセレクターで抜き出します。変えたセレクターは、次の取得から使います。</p>
      <SelectorEditor key={generation} url={feed.url} value={value} onChange={onChange} error={error} />
      <div className="flex flex-col gap-xs">
        <div>
          <Button
            onClick={() => {
              setChosen(null);
              void candidates.ask(feed.url);
            }}
            disabled={candidates.state.status === "loading"}
            aria-describedby={`${id}-again-hint`}
          >
            候補を出し直す
          </Button>
        </div>
        <p id={`${id}-again-hint`} className="type-label-sm text-on-surface-muted">
          ページの作りが変わって記事が見つからないときに使います。候補を出すときに、LLMを1回使います。選んだ候補は、保存するまで使いません。
        </p>
      </div>
      <CandidateStatus state={candidates.state} />
      {candidates.state.status === "ready" ? <CandidateChoice result={candidates.state.result} chosen={chosen ?? -1} onChoose={choose} /> : null}
    </section>
  );
}

/** What the last fetches did, in words: a colour alone would not tell a failing feed from a healthy one. */
function FetchState({ feed, timeZone }: { feed: Feed; timeZone: string }) {
  const at = (iso: string) => `${formatDay(iso, timeZone).date} ${formatClock(iso, timeZone)}`;
  const lastSuccess = feed.lastSucceededAt ? `最後の成功 ${at(feed.lastSucceededAt)}` : "まだ取得していません";
  return (
    <span className="flex flex-wrap items-baseline gap-x-md gap-y-xs">
      {feed.enabled ? null : <Badge>一時停止中</Badge>}
      {feed.autoSummarize ? <Badge>自動で要約</Badge> : null}
      {feed.translate ? <Badge>翻訳</Badge> : null}
      {feed.fetchFullContent ? <Badge>全文を取得</Badge> : null}
      {feed.lastError ? <Badge tone="error">取得に失敗</Badge> : null}
      {feed.stale ? <Badge tone="warning">更新が止まっています</Badge> : null}
      <span className="tabular-nums">{feed.lastError && !feed.lastSucceededAt ? "まだ成功していません" : lastSuccess}</span>
      <span className="tabular-nums">直近30日に{feed.recentArticleCount}件</span>
      <span className="tabular-nums">{feed.lastNewItemAt ? `最後の新着 ${at(feed.lastNewItemAt)}` : "新着はまだありません"}</span>
      {feed.lastError ? (
        <span className="break-all text-error" title={feed.lastError}>
          理由: {feedErrorLabel(feed.lastError)}
        </span>
      ) : null}
    </span>
  );
}

function FeedRow({ feed, categories, settings, timeZone }: { feed: Feed; categories: Category[]; settings: Settings | undefined; timeZone: string }) {
  const { api } = useApp();
  const client = useQueryClient();
  const refresh = useRefresh();
  const toast = useToast();
  const [editing, setEditing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [fetching, setFetching] = useState(false);
  // When the form closes, the focus goes back to the button that opened it.
  const editButton = useRef<HTMLButtonElement>(null);
  const wasEditing = useRef(false);
  useEffect(() => {
    if (wasEditing.current && !editing) editButton.current?.focus();
    wasEditing.current = editing;
  }, [editing]);
  const categoryName = categories.find((category) => category.id === feed.categoryId)?.name ?? UNCATEGORIZED_LABEL;
  const interval = feed.intervalMinutes === null ? `基本の取得周期（${settings?.feedIntervalMinutes ?? "…"}分）` : `${feed.intervalMinutes}分ごと`;

  async function fetchNow() {
    setFetching(true);
    try {
      const result = await api.fetchFeed(feed.id);
      // The answer holds the feed as it is now, so the row changes without waiting for the next refresh.
      client.setQueryData<Feed[]>(["feeds"], (list) => list?.map((entry) => (entry.id === feed.id ? result.feed : entry)));
      refresh("counts", "articles", "feed-stats");
      toast({
        message:
          result.status === "failed"
            ? "取得できませんでした。理由は一覧に表示しています。"
            : result.created > 0
              ? `新しい記事を${result.created}件取得しました`
              : "新しい記事はありませんでした",
      });
    } catch (error) {
      toast({ message: messageFor(error) });
    } finally {
      setFetching(false);
    }
  }

  async function remove() {
    try {
      await api.deleteFeed(feed.id);
      refresh("feeds", "counts", "articles", "filters");
      toast({ message: "購読フィードを削除しました" });
    } catch {
      toast({ message: "削除できませんでした。もう一度試してください。" });
    }
    setConfirming(false);
  }

  return (
    <li className="flex flex-col gap-xs border-b border-outline py-md type-body-md">
      <div className="flex flex-wrap items-baseline gap-x-lg gap-y-xs">
        <span className="type-label-md">{feed.title}</span>
        <span className="text-on-surface-muted">{categoryName}</span>
        <span className="tabular-nums text-on-surface-muted">{interval}</span>
      </div>
      <p className="break-all type-label-sm text-on-surface-muted">{feed.url}</p>
      <div className="type-label-sm text-on-surface-muted">
        <FetchState feed={feed} timeZone={timeZone} />
      </div>
      {editing ? (
        <EditFeed feed={feed} categories={categories} onDone={() => setEditing(false)} />
      ) : (
        <div className="flex flex-wrap gap-sm pt-xs">
          <Button aria-label={`${feed.title}をいま取得`} onClick={() => void fetchNow()} disabled={fetching}>
            {fetching ? "取得中…" : "いま取得"}
          </Button>
          <Button ref={editButton} aria-label={`${feed.title}を編集`} onClick={() => setEditing(true)}>
            編集
          </Button>
          <Button aria-label={`${feed.title}を削除`} onClick={() => setConfirming(true)}>
            削除
          </Button>
        </div>
      )}
      <ConfirmDialog
        open={confirming}
        title="購読フィードを削除しますか"
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
        <p>{feedDeletionText(feed)}</p>
        <ScopedFiltersNote target={{ feedId: feed.id }} />
        <p>記事を残したまま取得だけを止めるには、編集で一時停止にしてください。</p>
      </ConfirmDialog>
    </li>
  );
}

// ---- the base interval -------------------------------------------------------------------------

function BaseInterval({ settings }: { settings: Settings }) {
  const { api } = useApp();
  const client = useQueryClient();
  const refresh = useRefresh();
  const toast = useToast();
  const [minutes, setMinutes] = useState(String(settings.feedIntervalMinutes));
  const [problem, setProblem] = useState<string | null>(null);

  async function save(event: FormEvent) {
    event.preventDefault();
    const value = minutesOf(minutes);
    if (value === null) {
      setProblem(RANGE);
      return;
    }
    try {
      client.setQueryData(["settings"], await api.updateSettings({ feedIntervalMinutes: value }));
      refresh("feeds");
      setProblem(null);
      toast({ message: "取得周期を保存しました" });
    } catch (error) {
      setProblem(messageFor(error));
    }
  }

  return (
    <section aria-label="取得周期" className={SECTION}>
      <h2 className="type-headline-md">取得周期</h2>
      <form noValidate onSubmit={save} className="flex max-w-measure flex-col gap-md">
        <Field
          label="基本の取得周期（分）"
          type="number"
          inputMode="numeric"
          min={5}
          max={1440}
          value={minutes}
          onChange={(event) => {
            setMinutes(event.target.value);
            setProblem(null);
          }}
          error={problem}
          hint="周期を個別に決めていない購読フィードを、この間隔で取得します。取得に失敗したフィードは、成功するまで間隔を延ばします。"
        />
        <div>
          <Button type="submit" variant="primary">
            取得周期を保存
          </Button>
        </div>
      </form>
    </section>
  );
}

// ---- OPML --------------------------------------------------------------------------------------

function Opml() {
  const { api } = useApp();
  const refresh = useRefresh();
  const [file, setFile] = useState<File | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);

  async function download() {
    try {
      const url = URL.createObjectURL(new Blob([await api.exportOpml()], { type: "text/x-opml" }));
      const link = document.createElement("a");
      link.href = url;
      link.download = "smarternews-feeds.opml";
      link.click();
      URL.revokeObjectURL(url);
      setError(null);
    } catch (caught) {
      setError(caught);
    }
  }

  async function upload(event: FormEvent) {
    event.preventDefault();
    if (!file) return;
    setResult(null);
    try {
      const done = await api.importOpml(await file.text());
      setError(null);
      setResult(
        `${done.feedsCreated}件を登録し、${done.feedsSkipped}件を飛ばしました。` +
          (done.categoriesCreated > 0 ? `カテゴリを${done.categoriesCreated}件作りました。` : ""),
      );
      refresh("feeds", "categories", "counts");
    } catch (caught) {
      setError(caught);
    }
  }

  return (
    <section aria-label="OPML" className={SECTION}>
      <h2 className="type-headline-md">OPML</h2>
      <p className="max-w-measure type-body-md text-on-surface-muted">
        購読フィードの一覧を、ほかのRSSリーダーと受け渡すためのファイルです。
      </p>
      <div>
        <Button onClick={() => void download()}>書き出す</Button>
      </div>
      <form noValidate onSubmit={upload} className="flex max-w-measure flex-col gap-sm">
        <label className="flex flex-col gap-xs type-label-md">
          読み込むOPMLファイル
          <input type="file" accept=".opml,.xml,text/x-opml,text/xml,application/xml" className="type-body-md" onChange={(event) => setFile(event.target.files?.[0] ?? null)} />
        </label>
        <p className="type-label-sm text-on-surface-muted">
          フォルダーは、同じ名前のカテゴリになります。同じ名前のカテゴリがなければ作ります。フォルダーに入っていないフィードは「{UNCATEGORIZED_LABEL}
          」に入ります。すでに購読しているフィードは飛ばします。いま購読しているフィードは消えません。
        </p>
        <div>
          <Button type="submit" disabled={!file}>
            読み込む
          </Button>
        </div>
      </form>
      <p role="status" className="type-body-md">
        {result}
      </p>
      {error ? (
        <p role="alert" className="max-w-measure rounded-md border border-error px-lg py-sm type-body-md text-error">
          {error instanceof ApiError && error.kind === "invalid"
            ? "OPMLとして読めなかったため、何も変更していません。"
            : error instanceof ApiError && error.kind === "conflict"
              ? `${conflictLabel(error.message)}何も変更していません。`
              : messageFor(error)}
        </p>
      ) : null}
    </section>
  );
}

/** How much went to the translation API this month. Without a key there is nothing to count, and that is said instead. */
function TranslationUsage() {
  const status = useTranslationStatus();
  const count = (value: number) => value.toLocaleString("ja-JP");
  return (
    <section aria-label="翻訳の利用状況" className={SECTION}>
      <h2 className="type-headline-md">翻訳</h2>
      {status.isError ? <ErrorNotice error={status.error} onRetry={() => void status.refetch()} /> : null}
      {status.data ? (
        status.data.apiKeyConfigured ? (
          <p className="max-w-measure type-body-md">
            今月、翻訳のAPIへ送った文字数は <span className="tabular-nums">{count(status.data.chars)}文字</span> です。上限は{" "}
            <span className="tabular-nums">{count(status.data.monthlyChars)}文字</span> で、達したあとは月が替わるまでLLMで翻訳します。
          </p>
        ) : (
          <p className="max-w-measure type-body-md">
            翻訳のAPIキーが設定されていないため、LLMだけで翻訳します。タイトルと本文は、記事を開いたときに翻訳します。
          </p>
        )
      ) : null}
    </section>
  );
}

/** A stale feed or one whose last fetch failed: what the switch above the list puts first. */
const needsLook = (feed: Feed) => feed.stale || feed.lastError !== null;

/** Subscribed feeds: adding, the list with what the last fetch did, the base interval, and OPML. */
export function FeedsPage() {
  const feeds = useFeeds();
  // Kept on this screen only: opened again, the list is in the order of the left pane.
  const [problemsFirst, setProblemsFirst] = useState(false);
  const listed = feeds.data && problemsFirst ? [...feeds.data.filter(needsLook), ...feeds.data.filter((feed) => !needsLook(feed))] : feeds.data;
  const categories = useCategories().data ?? [];
  const settings = useSettings().data;
  const timeZone = useTimeZone();
  return (
    <div className="h-full overflow-y-auto bg-surface">
      <header className="flex flex-col gap-xs border-b border-outline px-lg py-md md:px-2xl">
        <Link to="/settings" className="tap type-body-md text-primary underline underline-offset-4">
          設定へ戻る
        </Link>
        <h1 className="type-headline-md">購読フィード</h1>
        <p className="max-w-measure type-body-md text-on-surface-muted">
          登録したフィードを定期的に取得し、配信された記事をそのまま一覧に並べます。AIによる要約はしません。
        </p>
      </header>
      <AddFeed categories={categories} />
      <section aria-label="購読フィードの一覧" className={SECTION}>
        <h2 className="type-headline-md">一覧</h2>
        {feeds.isError ? <ErrorNotice error={feeds.error} onRetry={() => void feeds.refetch()} /> : null}
        {feeds.isPending && !feeds.isError ? <Loading /> : null}
        {feeds.data?.length === 0 ? <p className="type-body-md text-on-surface-muted">購読フィードはまだありません。</p> : null}
        {feeds.data && feeds.data.length > 0 ? (
          <Checkbox label="問題のある購読フィードを先頭に並べる" checked={problemsFirst} onChange={(event) => setProblemsFirst(event.target.checked)} />
        ) : null}
        <ul>{listed?.map((feed) => <FeedRow key={feed.id} feed={feed} categories={categories} settings={settings} timeZone={timeZone} />)}</ul>
      </section>
      {settings ? <BaseInterval settings={settings} /> : null}
      <TranslationUsage />
      <Opml />
    </div>
  );
}
