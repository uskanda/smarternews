import type { Category, Feed, Filter } from "@smarternews/core/api";
import { useInfiniteQuery } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { Link } from "react-router";
import { formatFull } from "@smarternews/client";
import { useCategories, useFeeds, useFilters, useTimeZone } from "../api/queries.ts";
import { useApp } from "../app/context.ts";
import { useToast } from "../shell/toast.tsx";
import { ConfirmDialog } from "../ui/ConfirmDialog.tsx";
import { Button, ErrorNotice, Loading, messageFor } from "../ui/controls.tsx";
import { ACTION_LABEL, conditionsLabel, FilterForm, scopeLabel, useRefresh } from "./FilterForm.tsx";
import { useInlineEditFocus } from "./inline-edit-focus.ts";
import { UnsavedGuard } from "./unsaved.tsx";

const SECTION = "flex flex-col gap-md border-b border-outline px-lg py-xl md:px-2xl";

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

function FilterRow({
  filter,
  categories,
  feeds,
  afterRemoval,
}: {
  filter: Filter;
  categories: Category[];
  feeds: Feed[];
  /** Where the focus goes once the row is gone. */
  afterRemoval: () => HTMLElement | null;
}) {
  const { api } = useApp();
  const refresh = useRefresh();
  const toast = useToast();
  const [editing, setEditing] = useState(false);
  const [showing, setShowing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const removed = useRef(false);
  const focus = useInlineEditFocus(editing);
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
      removed.current = true;
      setConfirming(false);
      refresh();
      toast({ message: `フィルターを削除しました。${restored > 0 ? `${restored}件が一覧に戻りました。` : ""}` });
    } catch {
      setConfirming(false);
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
        <div ref={focus.region}>
          <FilterForm filter={filter} label={`フィルター『${summary}』の編集`} onDone={() => setEditing(false)} />
        </div>
      ) : (
        <div className="flex flex-wrap gap-sm pt-xs">
          <Button aria-expanded={showing} aria-label={`${summary}が隠している記事`} onClick={() => setShowing(!showing)} disabled={!filter.enabled}>
            隠している記事
          </Button>
          <Button ref={focus.opener} aria-label={`${summary}を編集`} onClick={() => setEditing(true)}>
            編集
          </Button>
          <Button aria-label={`${summary}を${filter.enabled ? "無効にする" : "有効にする"}`} onClick={() => void toggle()}>
            {filter.enabled ? "無効にする" : "有効にする"}
          </Button>
          <Button aria-label={`${summary}を削除`} onClick={() => setConfirming(true)}>
            削除
          </Button>
        </div>
      )}
      {showing && filter.enabled && !editing ? <HiddenArticles filter={filter} /> : null}
      <ConfirmDialog
        open={confirming}
        title="フィルターを削除しますか"
        onDismiss={() => setConfirming(false)}
        returnFocus={() => (removed.current ? afterRemoval() : null)}
        actions={
          <>
            <Button variant="danger" onClick={() => void remove()}>
              削除する
            </Button>
            <Button onClick={() => setConfirming(false)}>やめる</Button>
          </>
        }
      >
        <p>{summary}</p>
        <p className="break-all">{conditionsLabel(filter)}</p>
        <p>
          {filter.enabled && filter.hiddenCount > 0 ? `隠している${filter.hiddenCount}件は一覧に戻ります。` : ""}
          削除せずに無効にもできます。
        </p>
      </ConfirmDialog>
    </li>
  );
}

/** Filters that hide feed articles, or keep only some of them. */
export function FiltersPage() {
  return (
    <UnsavedGuard>
      <Filters />
    </UnsavedGuard>
  );
}

function Filters() {
  const filters = useFilters();
  const categories = useCategories().data ?? [];
  const feeds = useFeeds().data ?? [];
  const listHeading = useRef<HTMLHeadingElement>(null);
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
        <h2 ref={listHeading} tabIndex={-1} className="type-headline-md">
          一覧
        </h2>
        {filters.isError ? <ErrorNotice error={filters.error} onRetry={() => void filters.refetch()} /> : null}
        {filters.isPending && !filters.isError ? <Loading /> : null}
        {filters.data?.length === 0 ? <p className="type-body-md text-on-surface-muted">フィルターはまだありません。</p> : null}
        <ul className="max-w-measure-article">
          {filters.data?.map((filter) => (
            <FilterRow key={filter.id} filter={filter} categories={categories} feeds={feeds} afterRemoval={() => listHeading.current} />
          ))}
        </ul>
        <p className="max-w-measure-article type-label-sm text-on-surface-muted">
          隠した記事は消えません。フィルターを無効にするか削除すると、隠す前の既読とスターのまま一覧に戻ります。
        </p>
      </section>
    </div>
  );
}
