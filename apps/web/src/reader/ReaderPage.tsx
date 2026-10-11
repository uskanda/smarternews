import type { Article, ArticleListQuery, ArticleSummary, Category, Feed } from "@smarternews/core/api";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router";
import { useArticle, useArticleFlags, useArticleList, useCategories, useFeeds, useSettings, useTimeZone } from "../api/queries.ts";
import { useApp } from "../app/context.ts";
import { unfold } from "../lib/collapsed.ts";
import { followScroll } from "../lib/follow.ts";
import { useHotkeys } from "../lib/keys.ts";
import { useLayout } from "../lib/layout.ts";
import {
  buildNav,
  GENERATED_LABEL,
  hasReadToggle,
  listKey as keyOf,
  mergeKept,
  nextTarget,
  targetFilter,
  targetScope,
  UNCATEGORIZED_LABEL,
  type ListTarget,
} from "@smarternews/client";
import { PANES, usePanes } from "../lib/panes.ts";
import { listPathOf } from "../lib/paths.ts";
import { PaneResizer } from "../ui/PaneResizer.tsx";
import { useToast } from "../shell/toast.tsx";
import { Button, Checkbox, ErrorNotice, Loading } from "../ui/controls.tsx";
import { ArticleRow } from "./ArticleRow.tsx";
import { ArticleView } from "./ArticleView.tsx";
import { EventList } from "./EventList.tsx";

export type View = "unread" | "all" | "starred" | "generated" | "uncategorized" | "category" | "category-generated" | "feed";

const TITLES: Record<Exclude<View, "category" | "category-generated" | "feed">, string> = {
  unread: "未読",
  all: "すべて",
  starred: "スター",
  generated: GENERATED_LABEL,
  uncategorized: UNCATEGORIZED_LABEL,
};
const EMPTY: ArticleSummary[] = [];

function EmptyList({ view, hasSources }: { view: View; hasSources: boolean }) {
  const link = "text-primary underline underline-offset-4";
  if (!hasSources) {
    return (
      <div className="flex flex-col items-start gap-sm p-lg type-body-md">
        <p>カテゴリがまだありません。</p>
        <Link to="/settings" className={link}>
          設定でカテゴリを追加する
        </Link>
      </div>
    );
  }
  if (view === "unread") {
    return (
      <div className="flex flex-col items-start gap-sm p-lg type-body-md">
        <p>未読の記事はありません。</p>
        <Link to="/all" className={link}>
          すべての記事を見る
        </Link>
      </div>
    );
  }
  const text =
    view === "starred"
      ? "スターを付けた記事はありません。"
      : view === "all"
        ? "記事はまだありません。カテゴリを実行すると、ここに並びます。"
        : "ここに出す記事はありません。既読も表示すると、読んだ記事を確かめられます。";
  return <p className="p-lg type-body-md text-on-surface-muted">{text}</p>;
}

/** The reading screen: a list of articles for the chosen view, and the chosen article beside it. */
export function ReaderPage({ view }: { view: View }) {
  const { api, now } = useApp();
  const params = useParams();
  const [search, setSearch] = useSearchParams();
  const navigate = useNavigate();
  const layout = useLayout();
  const panes = usePanes(layout);
  const client = useQueryClient();
  const toast = useToast();
  const timeZone = useTimeZone();
  const settings = useSettings();
  const flags = useArticleFlags();

  const categories = useCategories();
  const feeds = useFeeds();
  const inCategory = view === "category" || view === "category-generated";
  const category: Category | undefined = inCategory ? categories.data?.find((entry) => entry.slug === params.slug) : undefined;
  const feed: Feed | undefined = view === "feed" ? feeds.data?.find((entry) => String(entry.id) === params.feedId) : undefined;
  // Null until the category or the feed the path names is known.
  const target = useMemo<ListTarget | null>(() => {
    if (inCategory) return category ? { type: "category", categoryId: category.id, generatedOnly: view === "category-generated" } : null;
    if (view === "feed") return feed ? { type: "feed", feedId: feed.id } : null;
    return { type: view };
  }, [view, inCategory, category, feed]);
  const isEvents = view === "category" && category?.kind === "event";
  const readToggle = target !== null && hasReadToggle(target) && !isEvents;
  // Feed articles have no importance, so the filter is offered only where generated articles can be.
  const importanceFilter = view !== "feed" && view !== "uncategorized";
  const articleId = params.articleId && /^\d+$/.test(params.articleId) ? Number(params.articleId) : null;
  const includeRead = search.get("read") === "1";
  const importantOnly = importanceFilter && search.get("min") === "4";

  const filter = useMemo<ArticleListQuery>(() => {
    if (target === null) return {};
    if (isEvents) return { category: category!.id, kind: "event" };
    return {
      ...(importantOnly ? { minImportance: 4 } : {}),
      ...targetFilter(target),
      ...(readToggle && !includeRead ? { unread: "true" as const } : {}),
    };
  }, [target, category, isEvents, readToggle, includeRead, importantOnly]);
  const unreadOnly = filter.unread === "true";
  const list = useArticleList(filter, target !== null);
  const fetched = useMemo(() => list.data?.pages.flatMap((page) => page.items) ?? EMPTY, [list.data]);

  // Articles read during this visit stay in an unread list until the user changes the list or refreshes.
  const listKey = JSON.stringify(filter);
  const [kept, setKept] = useState<{ key: string; items: ArticleSummary[] }>({ key: listKey, items: [] });
  if (kept.key !== listKey) setKept({ key: listKey, items: [] });
  const items = useMemo(() => mergeKept(fetched, kept.key === listKey ? kept.items : []), [fetched, kept, listKey]);

  const basePath = (target && listPathOf(target, () => category?.slug)) ?? `/${view}`;
  const query = search.toString() ? `?${search.toString()}` : "";
  const articlePath = (id: number) => `${basePath}/${id}${query}`;
  const listPath = `${basePath}${query}`;
  const categoryName = (categoryId: number | null) => categories.data?.find((entry) => entry.id === categoryId)?.name ?? "";
  const feedName = (feedId: number | null) => feeds.data?.find((entry) => entry.id === feedId)?.title ?? "";
  /** What a row shows beside the time: the feed of a feed article, the category of a generated one. */
  const sourceName = (item: ArticleSummary) => (item.origin === "feed" ? feedName(item.feedId) : categoryName(item.categoryId));

  function setRead(target: { id: number; isRead: boolean }, isRead: boolean) {
    const summary = items.find((item) => item.id === target.id);
    if (unreadOnly && summary) {
      setKept((current) => ({
        key: listKey,
        items: [...current.items.filter((item) => item.id !== target.id), { ...summary, isRead }],
      }));
    }
    flags.mutate({ id: target.id, isRead });
  }
  function toggleStar(target: { id: number; starred: boolean }) {
    setKept((current) => ({
      key: current.key,
      items: current.items.map((item) => (item.id === target.id ? { ...item, starred: !target.starred } : item)),
    }));
    flags.mutate({ id: target.id, starred: !target.starred });
  }

  // Opening an unread article marks it as read, once per visit to that article.
  const opened = useArticle(articleId).data;
  const autoMarked = useRef<number | null>(null);
  useEffect(() => {
    if (!opened || autoMarked.current === opened.id) return;
    autoMarked.current = opened.id;
    if (!opened.isRead) setRead(opened, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs when another article is opened, not on every change
  }, [opened?.id]);
  useEffect(() => {
    if (articleId === null) autoMarked.current = null;
  }, [articleId]);

  function refresh() {
    setKept({ key: listKey, items: [] });
    void client.invalidateQueries({ queryKey: ["articles"] });
    void client.invalidateQueries({ queryKey: ["counts"] });
  }

  /**
   * Opens the next list below this one that still has unread articles, by counts fetched after the marking.
   * Returns the name of the list it opened, or null when there is none.
   */
  async function openNext(from: ListTarget): Promise<string | null> {
    const counts = await client.fetchQuery({ queryKey: ["counts"], queryFn: () => api.counts(), staleTime: 0 });
    const model = buildNav({ categories: categories.data ?? [], feeds: feeds.data ?? [], counts });
    const next = nextTarget(model, from);
    const path = next ? listPathOf(next, (id) => categories.data?.find((entry) => entry.id === id)?.slug) : null;
    if (!next || !path) return null;
    // The entry may sit below a folded category.
    const group = next.type === "feed" ? feeds.data?.find((feed) => feed.id === next.feedId)?.categoryId : next.type === "category" ? next.categoryId : undefined;
    if (next.type === "feed" || (next.type === "category" && next.generatedOnly)) {
      unfold(group == null ? keyOf({ type: "uncategorized" }) : keyOf({ type: "category", categoryId: group, generatedOnly: false }));
    }
    void navigate(path);
    // The button that was pressed is gone with the old list: the keyboard continues in the new one.
    document.getElementById("content")?.focus();
    const entry = model.groups.flatMap((candidate) => [candidate.entry, ...candidate.children]).find((candidate) => keyOf(candidate.target) === keyOf(next));
    const parent = next.type === "category" && next.generatedOnly ? categories.data?.find((category) => category.id === next.categoryId)?.name : undefined;
    return entry ? (parent ? `${parent}の${entry.label}` : entry.label) : null;
  }

  async function markAllRead() {
    const newest = fetched.reduce<string | null>((latest, item) => (latest === null || item.updatedAt > latest ? item.updatedAt : latest), null);
    if (newest === null) return;
    // "Before" is just after the newest article on screen, so one that arrives later stays unread.
    const before = new Date(new Date(newest).getTime() + 1).toISOString();
    try {
      const result = await api.markRead({ before, ...(target ? targetScope(target) : {}), ...(importantOnly ? { minImportance: 4 } : {}) });
      refresh();
      // Moving on is an extra: when it fails, the marking has still happened and can still be undone.
      const opened = target && settings.data?.advanceAfterMarkAll ? await openNext(target).catch(() => null) : null;
      toast({
        message: opened ? `${result.updated}件を既読にしました。「${opened}」を開きました` : `${result.updated}件を既読にしました`,
        durationMs: 10_000,
        action: {
          label: "取り消す",
          run: () => void api.markUnread(result.ids).then(refresh),
        },
      });
    } catch (error) {
      toast({ message: error instanceof Error ? "既読にできませんでした。もう一度試してください。" : "既読にできませんでした。" });
    }
  }

  function toggleParam(name: "read" | "min", value: string, on: boolean) {
    const next = new URLSearchParams(search);
    if (on) next.set(name, value);
    else next.delete(name);
    setSearch(next, { replace: true });
  }

  const index = items.findIndex((item) => item.id === articleId);
  // A move with a key takes the list along; a click leaves it where the reader put it.
  const root = useRef<HTMLDivElement>(null);
  const keyStep = useRef(0);
  const move = (step: number) => {
    const target = items[index === -1 ? (step > 0 ? 0 : items.length - 1) : index + step];
    if (!target) return;
    keyStep.current = step;
    void navigate(articlePath(target.id));
  };
  useLayoutEffect(() => {
    const step = keyStep.current;
    keyStep.current = 0;
    const pane = root.current?.querySelector<HTMLElement>("[data-list-scroll]");
    const row = pane?.querySelector('[aria-current="true"]')?.closest("li");
    if (step === 0 || !pane || !row) return;
    const view = pane.getBoundingClientRect();
    const box = row.getBoundingClientRect();
    const rowTop = box.top - view.top + pane.scrollTop;
    const to = followScroll({ top: pane.scrollTop, height: pane.clientHeight || view.height, rowTop, rowBottom: rowTop + box.height, step });
    if (to !== null) pane.scrollTop = to;
  }, [articleId]);
  const selected: Pick<Article, "id" | "isRead" | "starred" | "primaryUrl"> | undefined = opened ?? items[index];
  useHotkeys({
    j: () => move(1),
    k: () => move(-1),
    s: selected ? () => toggleStar(selected) : undefined,
    m: selected ? () => setRead(selected, !selected.isRead) : undefined,
    o: selected?.primaryUrl ? () => void window.open(selected.primaryUrl!, "_blank", "noopener,noreferrer") : undefined,
  });

  if (inCategory && categories.data && !category) {
    return <p className="p-xl type-body-md">このカテゴリはありません。</p>;
  }
  if (view === "feed" && feeds.data && !feed) {
    return <p className="p-xl type-body-md">この購読フィードはありません。</p>;
  }

  const showList = layout !== "narrow" || articleId === null;
  const showArticle = layout !== "narrow" || articleId !== null;
  const title =
    view === "category"
      ? (category?.name ?? "")
      : view === "category-generated"
        ? category
          ? `${category.name}の${GENERATED_LABEL}`
          : ""
        : view === "feed"
          ? (feed?.title ?? "")
          : TITLES[view];
  const canMarkAll = (view === "unread" || readToggle) && fetched.some((item) => !item.isRead);

  const listPane = isEvents ? (
    <EventList title={title} events={items} selectedId={articleId} to={articlePath} timeZone={timeZone} now={now()} />
  ) : (
    <section aria-label="記事の一覧" className="flex h-full min-h-0 flex-col bg-surface">
      <header className="flex flex-col gap-sm border-b border-outline px-lg py-md">
        <div className="flex items-center justify-between gap-sm">
          <h1 className="min-w-0 truncate type-headline-md" title={title}>
            {title}
          </h1>
          <div className="flex shrink-0 gap-sm">
            {canMarkAll ? <Button onClick={() => void markAllRead()}>すべて既読にする</Button> : null}
            <Button onClick={refresh}>更新</Button>
          </div>
        </div>
        <div className="flex flex-wrap gap-x-lg gap-y-xs">
          {readToggle ? (
            <Checkbox label="既読も表示" checked={includeRead} onChange={(event) => toggleParam("read", "1", event.target.checked)} />
          ) : null}
          {importanceFilter ? (
            <Checkbox label="重要度4以上だけ" checked={importantOnly} onChange={(event) => toggleParam("min", "4", event.target.checked)} />
          ) : null}
        </div>
      </header>
      <div data-list-scroll className="min-h-0 flex-1 overflow-y-auto">
        {list.isError ? <ErrorNotice error={list.error} onRetry={() => void list.refetch()} /> : null}
        {list.isPending && !list.isError ? <Loading /> : null}
        {list.isSuccess && items.length === 0 ? (
          <EmptyList view={view} hasSources={(categories.data?.length ?? 1) > 0 || (feeds.data?.length ?? 0) > 0} />
        ) : null}
        <ul>
          {items.map((item) => (
            <ArticleRow
              key={item.id}
              article={item}
              to={articlePath(item.id)}
              selected={item.id === articleId}
              sourceName={sourceName(item)}
              timeZone={timeZone}
              now={now()}
            />
          ))}
        </ul>
        {list.hasNextPage ? (
          <div className="flex justify-center p-lg">
            <Button onClick={() => void list.fetchNextPage()} disabled={list.isFetchingNextPage}>
              さらに読み込む
            </Button>
          </div>
        ) : null}
      </div>
    </section>
  );

  return (
    <div ref={root} className="flex h-full min-h-0">
      {showList ? (
        layout === "narrow" ? (
          <div className="min-w-0 flex-1">{listPane}</div>
        ) : (
          <div data-pane="list" className="relative shrink-0 border-r border-outline" style={{ width: panes.shown.list }}>
            {listPane}
            <PaneResizer
              label="記事の一覧の幅"
              width={panes.shown.list}
              min={PANES.list.min}
              max={panes.widest("list")}
              onResize={(width) => panes.set("list", width)}
              onReset={() => panes.reset("list")}
            />
          </div>
        )
      ) : null}
      {showArticle ? (
        <div className="min-w-0 flex-1 overflow-y-auto bg-surface">
          {showList ? null : <h1 className="sr-only">{title}</h1>}
          {articleId === null ? (
            <p className="p-xl type-body-md text-on-surface-muted">記事を選ぶと、ここに本文が表示されます。</p>
          ) : (
            <ArticleView
              key={articleId}
              id={articleId}
              categoryName={categoryName}
              feedName={feedName}
              timeZone={timeZone}
              backTo={layout === "narrow" ? listPath : null}
              articlePath={articlePath}
              onToggleStar={toggleStar}
              onToggleRead={(article) => setRead(article, !article.isRead)}
            />
          )}
        </div>
      ) : null}
    </div>
  );
}
