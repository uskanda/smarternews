import type { Category, Feed, Settings } from "@smarternews/core/api";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link } from "react-router";
import { ApiError, feedErrorLabel, fieldError, formatClock, formatDay, UNCATEGORIZED_LABEL } from "@smarternews/client";
import { useCategories, useFeeds, useSettings, useTimeZone } from "../api/queries.ts";
import { useApp } from "../app/context.ts";
import { useToast } from "../shell/toast.tsx";
import { ConfirmDialog } from "../ui/ConfirmDialog.tsx";
import { Badge, Button, Checkbox, ErrorNotice, Field, Loading, messageFor } from "../ui/controls.tsx";

const SECTION = "flex flex-col gap-md border-b border-outline px-lg py-xl md:px-2xl";
const SELECT = "w-full rounded-md border border-outline-strong bg-surface px-sm py-xs type-body-md text-on-surface";
const RANGE = "5分から1440分（24時間）の範囲で入力してください。";
const NO_CATEGORY = "";

/** A whole number of minutes within the allowed range, or null. */
function minutesOf(text: string): number | null {
  if (!/^\d+$/.test(text.trim())) return null;
  const value = Number(text.trim());
  return value >= 5 && value <= 1440 ? value : null;
}

function useRefresh() {
  const client = useQueryClient();
  return (...keys: string[]) => {
    for (const key of keys) void client.invalidateQueries({ queryKey: [key] });
  };
}

function CategorySelect({ id, value, onChange, categories }: { id: string; value: string; onChange: (value: string) => void; categories: Category[] }) {
  return (
    <select id={id} value={value} onChange={(event) => onChange(event.target.value)} className={SELECT}>
      <option value={NO_CATEGORY}>なし（{UNCATEGORIZED_LABEL}）</option>
      {/* A feed belongs to a news category or to none: an event category lists events by day. */}
      {categories
        .filter((category) => category.kind === "news")
        .map((category) => (
          <option key={category.id} value={String(category.id)}>
            {category.name}
          </option>
        ))}
    </select>
  );
}

// ---- adding ------------------------------------------------------------------------------------

function AddFeed({ categories }: { categories: Category[] }) {
  const { api } = useApp();
  const refresh = useRefresh();
  const toast = useToast();
  const [url, setUrl] = useState("");
  const [category, setCategory] = useState(NO_CATEGORY);
  const [found, setFound] = useState<Array<{ url: string; title: string }> | null>(null);
  const [chosen, setChosen] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const firstChoice = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (found) firstChoice.current?.focus();
  }, [found]);

  function explain(error: unknown): string {
    if (error instanceof ApiError && error.kind === "conflict") return "このフィードはすでに購読しています。";
    const reason = fieldError(error, "url");
    if (reason) return `このURLを取得できませんでした。URLを確かめてください（${reason}）`;
    return messageFor(error);
  }

  async function subscribe(feedUrl: string) {
    const created = await api.createFeed({ url: feedUrl, categoryId: category === NO_CATEGORY ? null : Number(category) });
    refresh("feeds", "counts", "articles");
    toast({ message: `「${created.title}」を追加しました` });
    setUrl("");
    setFound(null);
    setChosen("");
  }

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setProblem(null);
    try {
      await action();
    } catch (error) {
      setProblem(explain(error));
    } finally {
      setBusy(false);
    }
  }

  function add(event: FormEvent) {
    event.preventDefault();
    void run(async () => {
      if (found !== null && chosen) return subscribe(chosen);
      // The URL may be a feed or a page that points to feeds; the server tells which.
      const { feeds } = await api.discoverFeeds(url.trim());
      if (feeds.length === 0) {
        setProblem("このページにフィードは見つかりませんでした。フィードのURLが分かるときは、それを直接入力してください。");
        return;
      }
      if (feeds.length === 1) return subscribe(feeds[0]!.url);
      setFound(feeds);
      setChosen(feeds[0]!.url);
    });
  }

  return (
    <section aria-label="購読フィードの追加" className={SECTION}>
      <h2 className="type-headline-md">追加</h2>
      <form onSubmit={add} className="flex max-w-measure flex-col gap-md">
        <Field
          label="フィードまたはサイトのURL"
          type="url"
          inputMode="url"
          autoComplete="off"
          value={url}
          onChange={(event) => {
            setUrl(event.target.value);
            setFound(null);
          }}
          hint="サイトのURLを入れると、そのページが案内しているフィードを探します。"
        />
        <div className="flex flex-col gap-xs">
          <label htmlFor="add-feed-category" className="type-label-md">
            カテゴリ
          </label>
          <CategorySelect id="add-feed-category" value={category} onChange={setCategory} categories={categories} />
        </div>
        {found ? (
          // The legend names the group and says what happened; the focus moves here, so it is read out.
          <fieldset className="flex flex-col gap-sm type-body-md">
            <legend className="pb-xs type-label-md">フィードが{found.length}つ見つかりました。購読するものを選んでください。</legend>
            {found.map((feed, index) => (
              <label key={feed.url} className="flex cursor-pointer items-baseline gap-xs">
                <input
                  type="radio"
                  name="found-feed"
                  className="accent-primary"
                  ref={index === 0 ? firstChoice : undefined}
                  checked={chosen === feed.url}
                  onChange={() => setChosen(feed.url)}
                />
                <span className="min-w-0">
                  <span>{feed.title || "（名前なし）"}</span>
                  <span className="block break-all type-label-sm text-on-surface-muted">{feed.url}</span>
                </span>
              </label>
            ))}
          </fieldset>
        ) : null}
        {problem ? (
          <p role="alert" className="type-body-md text-error">
            {problem}
          </p>
        ) : null}
        <div>
          <Button type="submit" variant="primary" disabled={busy || url.trim().length === 0}>
            {found ? "選んだフィードを追加" : "フィードを追加"}
          </Button>
        </div>
      </form>
    </section>
  );
}

// ---- the list ----------------------------------------------------------------------------------

function EditFeed({ feed, categories, onDone }: { feed: Feed; categories: Category[]; onDone: () => void }) {
  const { api } = useApp();
  const refresh = useRefresh();
  const toast = useToast();
  const [title, setTitle] = useState(feed.title);
  const [category, setCategory] = useState(feed.categoryId === null ? NO_CATEGORY : String(feed.categoryId));
  const [ownInterval, setOwnInterval] = useState(feed.intervalMinutes !== null);
  const [minutes, setMinutes] = useState(feed.intervalMinutes === null ? "" : String(feed.intervalMinutes));
  const [paused, setPaused] = useState(!feed.enabled);
  const [intervalError, setIntervalError] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  // The form takes the place of the buttons that opened it, so the focus is carried into it.
  const form = useRef<HTMLFormElement>(null);
  useEffect(() => {
    form.current?.querySelector("input")?.focus();
  }, []);

  async function save(event: FormEvent) {
    event.preventDefault();
    const intervalMinutes = ownInterval ? minutesOf(minutes) : null;
    if (ownInterval && intervalMinutes === null) {
      setIntervalError(RANGE);
      return;
    }
    try {
      await api.updateFeed(feed.id, {
        ...(title.trim() !== feed.title ? { title: title.trim() } : {}),
        categoryId: category === NO_CATEGORY ? null : Number(category),
        intervalMinutes,
        enabled: !paused,
      });
      refresh("feeds", "counts", "articles");
      toast({ message: "購読フィードを保存しました" });
      onDone();
    } catch (caught) {
      setError(caught);
    }
  }

  const id = `feed-${feed.id}`;
  // The form checks the range itself, so that the reason is shown in the app's words beside the field.
  return (
    <form ref={form} noValidate onSubmit={save} className="flex max-w-measure flex-col gap-md pt-sm">
      <Field label="名前" value={title} onChange={(event) => setTitle(event.target.value)} error={fieldError(error, "title")} />
      <div className="flex flex-col gap-xs">
        <label htmlFor={`${id}-category`} className="type-label-md">
          カテゴリ
        </label>
        <CategorySelect id={`${id}-category`} value={category} onChange={setCategory} categories={categories} />
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
          error={intervalError}
        />
      ) : null}
      <Checkbox label="取得を一時停止する" checked={paused} onChange={(event) => setPaused(event.target.checked)} />
      {error && !(error instanceof ApiError && error.kind === "invalid") ? <ErrorNotice error={error} /> : null}
      <div className="flex flex-wrap gap-sm">
        <Button type="submit" variant="primary" disabled={title.trim().length === 0}>
          保存する
        </Button>
        <Button onClick={onDone}>やめる</Button>
      </div>
    </form>
  );
}

/** What the last fetches did, in words: a colour alone would not tell a failing feed from a healthy one. */
function FetchState({ feed, timeZone }: { feed: Feed; timeZone: string }) {
  const at = (iso: string) => `${formatDay(iso, timeZone).date} ${formatClock(iso, timeZone)}`;
  const lastSuccess = feed.lastSucceededAt ? `最後の成功 ${at(feed.lastSucceededAt)}` : "まだ取得していません";
  return (
    <span className="flex flex-wrap items-baseline gap-x-md gap-y-xs">
      {feed.enabled ? null : <Badge>一時停止中</Badge>}
      {feed.lastError ? <Badge tone="error">取得に失敗</Badge> : null}
      <span className="tabular-nums">{feed.lastError && !feed.lastSucceededAt ? "まだ成功していません" : lastSuccess}</span>
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
      refresh("counts", "articles");
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
      refresh("feeds", "counts", "articles");
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
        <p>
          「{feed.title}」と、その配信記事{feed.articleCount}件が消えます。
          {feed.starredCount > 0 ? `うち${feed.starredCount}件にはスターが付いています。` : ""}元に戻せません。
        </p>
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
      <form onSubmit={upload} className="flex max-w-measure flex-col gap-sm">
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
          {error instanceof ApiError && error.kind === "invalid" ? "OPMLとして読めなかったため、何も変更していません。" : messageFor(error)}
        </p>
      ) : null}
    </section>
  );
}

/** Subscribed feeds: adding, the list with what the last fetch did, the base interval, and OPML. */
export function FeedsPage() {
  const feeds = useFeeds();
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
        <ul>{feeds.data?.map((feed) => <FeedRow key={feed.id} feed={feed} categories={categories} settings={settings} timeZone={timeZone} />)}</ul>
      </section>
      {settings ? <BaseInterval settings={settings} /> : null}
      <Opml />
    </div>
  );
}
