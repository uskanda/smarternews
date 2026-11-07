import * as Dialog from "@radix-ui/react-dialog";
import {
  budgetWarningLabel,
  buildNav,
  FEED_STATE_LABEL,
  hideEmptyEntries,
  listKey,
  nextEventCategory,
  parseListKey,
  stepTarget,
  type FeedState,
  type ListTarget,
  type NavEntry,
  type NavModel,
} from "@smarternews/client";
import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactElement } from "react";
import { Link, NavLink, Outlet, useLocation, useNavigate, useParams, useSearchParams } from "react-router";
import { useQueryClient } from "@tanstack/react-query";
import { useArticle, useAttention, useCategories, useCounts, useFeeds, useProviders } from "../api/queries.ts";
import { useApp } from "../app/context.ts";
import { unfold, useCollapsed } from "../lib/collapsed.ts";
import { useHideRead } from "../lib/hide-read.ts";
import { useHotkeys } from "../lib/keys.ts";
import { useLayout } from "../lib/layout.ts";
import { PANES, usePanes } from "../lib/panes.ts";
import { usePageTitle } from "../lib/title.ts";
import { isOnList, listPathOf } from "../lib/paths.ts";
import { ConfirmDialog } from "../ui/ConfirmDialog.tsx";
import { feedDeletionText } from "../settings/feed-deletion.ts";
import { ScopedFiltersNote } from "../settings/ScopedFiltersNote.tsx";
import { PaneResizer } from "../ui/PaneResizer.tsx";
import { Button } from "../ui/controls.tsx";
import { EntryMenu, openEntryMenu, useNavDrag, useNavMoves } from "./order.tsx";
import { useToast } from "./toast.tsx";

const KEYS: Array<[string, string]> = [
  ["j", "次の記事"],
  ["k", "前の記事"],
  ["s", "スターの切り替え"],
  ["m", "既読と未読の切り替え"],
  ["x", "生成記事の外れの印の切り替え。付けると既読にする"],
  ["o", "主な出典を新しいタブで開く"],
  ["w", "全文の取得と、配信された内容との切り替え"],
  ["h", "選んだ文字列をハイライトする"],
  ["Space", "本文を1画面分送る。本文の末尾なら次の記事"],
  ["Shift+Space", "本文を1画面分戻す。本文の先頭なら前の記事"],
  ["Shift+A", "表示中の一覧をすべて既読にする"],
  ["r", "一覧と件数を読み直す"],
  ["u", "既読も表示するかを切り替える"],
  ["Shift+J", "左のペインの次の項目"],
  ["Shift+K", "左のペインの前の項目"],
  ["g a", "「未読」へ移る"],
  ["g s", "「スター」へ移る"],
  ["g e", "次のイベントのカテゴリへ移る"],
  ["g r", "「最近読んだ記事」へ移る"],
  ["Shift+F10", "フォーカスのあるカテゴリと購読フィードで、項目のメニューを開く（並べ替え、登録の解除）"],
  ["/", "検索欄へ移る"],
  ["?", "この一覧を開く"],
];

/** The id of the search box, which the `/` key puts the focus in. */
const SEARCH_BOX = "article-search";

/**
 * The search box at the top of the left pane. Enter opens the results over every article; spaces alone do
 * nothing. While results are shown, it holds their words.
 */
function SearchBox({ onNavigate }: { onNavigate?: () => void }) {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const [params] = useSearchParams();
  const onResults = pathname === "/search" || pathname.startsWith("/search/");
  const shown = onResults ? (params.get("q") ?? "") : null;
  const [value, setValue] = useState(shown ?? "");
  useEffect(() => {
    if (shown !== null) setValue(shown);
  }, [shown]);
  function submit(event: FormEvent) {
    event.preventDefault();
    const words = value.trim();
    if (words.length === 0) return;
    void navigate(`/search?q=${encodeURIComponent(words)}`);
    onNavigate?.();
    // The results are where the keyboard goes on: j and k move through them.
    document.getElementById("content")?.focus();
  }
  return (
    <form role="search" onSubmit={submit} className="flex px-xs">
      <input
        id={SEARCH_BOX}
        type="search"
        aria-label="記事を検索"
        placeholder="記事を検索"
        enterKeyHint="search"
        value={value}
        onChange={(event) => setValue(event.target.value)}
        className="tap w-full min-w-0 rounded-md border border-outline-strong bg-surface px-sm py-xs type-body-md text-on-surface"
      />
    </form>
  );
}

const ITEM = "tap flex min-w-0 flex-1 items-center justify-between gap-sm rounded-md px-sm py-xs type-body-md";

function NavItem({
  to,
  label,
  count,
  attention,
  onNavigate,
}: {
  to: string;
  label: string;
  count?: number;
  /** The attention items not yet dismissed, shown in the warning colour and read out as what they are. */
  attention?: number;
  onNavigate?: () => void;
}) {
  return (
    <NavLink to={to} onClick={onNavigate} className={({ isActive }) => `${ITEM} ${isActive ? "bg-selected font-semibold" : ""}`}>
      <span className="min-w-0 truncate">{label}</span>
      {count ? <span className="tabular-nums text-on-surface-muted">{count}</span> : null}
      {attention ? (
        <>
          {/* Read out apart from the name, and as what the number counts. */}
          <span className="sr-only">{`、注意${attention}件`}</span>
          <span aria-hidden="true" className="tabular-nums text-warning">
            {attention}
          </span>
        </>
      ) : null}
    </NavLink>
  );
}

const STATE_COLOR: Record<FeedState, string> = { gone: "text-error", failed: "text-error", stale: "text-warning", paused: "text-on-surface-muted" };
/** What the mark on a folded category says: the state belongs to a feed below it, not to the category. */
const HIDDEN_STATE_LABEL: Record<FeedState, string> = {
  gone: "配信を終えた購読フィードがあります",
  failed: "取得に失敗した購読フィードがあります",
  stale: "更新が止まった購読フィードがあります",
  paused: "一時停止中の購読フィードがあります",
};

/**
 * The mark of a feed whose fetches went wrong, told by its shape as well as its colour: a triangle with "!" for a
 * failed fetch and for a feed the site answers is gone, a clock for no new item for long, two bars for a pause. Its
 * name, which tells a gone feed from a failing one, is read out and shown on hover.
 */
function FeedStateIcon({ state, label = FEED_STATE_LABEL[state] }: { state: FeedState; label?: string }) {
  return (
    <span role="img" aria-label={label} title={label} className={`feed-state-icon ${STATE_COLOR[state]}`}>
      <svg aria-hidden="true" viewBox="0 0 16 16" width="100%" height="100%" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        {state === "failed" || state === "gone" ? (
          <>
            <path d="M8 1.75 14.5 13.5h-13z" />
            <path d="M8 6v3.5M8 11.5v.25" />
          </>
        ) : state === "stale" ? (
          <>
            <circle cx="8" cy="8" r="6.25" />
            <path d="M8 4.5V8l2.5 1.5" />
          </>
        ) : (
          <path d="M5.75 3.5v9M10.25 3.5v9" strokeWidth="2" />
        )}
      </svg>
    </span>
  );
}

/** An entry that opens a list of articles. It is current on that list and on an article opened from it. */
function ListItem({
  entry,
  to,
  count = entry.unread,
  holdsCurrent = false,
  state = entry.state,
  stateLabel,
  onNavigate,
}: {
  entry: NavEntry;
  to: string;
  count?: number;
  /** True for a folded category whose hidden entry is the one that is open: the row shows where the reader is. */
  holdsCurrent?: boolean;
  /** The mark beside the name: the feed's own state, or that of the feeds hidden below a folded category. */
  state?: FeedState;
  stateLabel?: string;
  onNavigate?: () => void;
}) {
  const current = isOnList(to, useLocation().pathname);
  return (
    <Link
      to={to}
      onClick={onNavigate}
      aria-current={current ? "page" : undefined}
      title={entry.label}
      draggable={false}
      className={`${ITEM} ${current || holdsCurrent ? "bg-selected font-semibold" : ""}`}
    >
      <span className="min-w-0 flex-1 truncate">{entry.label}</span>
      {state ? (
        <>
          {/* Read out apart from the name: the two would otherwise run together as one word. */}
          <span className="sr-only">、</span>
          <FeedStateIcon state={state} label={stateLabel} />
        </>
      ) : null}
      {count > 0 ? <span className="tabular-nums text-on-surface-muted">{count}</span> : null}
    </Link>
  );
}

/**
 * The views, the enabled categories with what is below them, the feeds without a category, and the two
 * management pages. A category that has subscribed feeds can be folded.
 */
function Nav({ onNavigate }: { onNavigate?: () => void }) {
  // What is drawn, dragged and moved by the menu is what is shown: a move then never passes a hidden feed by.
  const { shown: model, pathOf: pathOfTarget } = useNavModels();
  const feeds = useFeeds().data;
  const attention = useAttention().data?.count ?? 0;
  const collapsed = useCollapsed();
  const { pathname } = useLocation();
  const pathOf = (entry: NavEntry) => pathOfTarget(entry.target) ?? "/unread";
  // The fold buttons take a column of their own. It exists only once something can be folded.
  const foldable = model.groups.some((group) => group.children.length > 0);

  const { api } = useApp();
  const client = useQueryClient();
  const toast = useToast();
  const navigate = useNavigate();
  const element = useRef<HTMLElement>(null);
  const move = useNavMoves();
  const { drag, onPointerDown } = useNavDrag({
    nav: element,
    model,
    onMove: move,
    unfold,
  });
  const [leaving, setLeaving] = useState<number | null>(null);
  const [removing, setRemoving] = useState(false);
  // The row the dialog was opened from, or the first entry once that row is gone.
  const leavingRow = useRef<number | null>(null);
  if (leaving !== null) leavingRow.current = leaving;
  const leavingFeed = feeds?.find((feed) => feed.id === leaving);
  async function unsubscribe(feed: { id: number }) {
    if (removing) return;
    setRemoving(true);
    try {
      await api.deleteFeed(feed.id);
      for (const key of ["feeds", "counts", "articles", "filters"]) void client.invalidateQueries({ queryKey: [key] });
      toast({ message: "購読フィードの登録を解除しました" });
      // The list that was open is gone with the feed.
      if (isOnList(`/f/${feed.id}`, pathname)) void navigate("/unread");
    } catch {
      toast({ message: "登録を解除できませんでした。もう一度試してください。" });
    }
    setRemoving(false);
    setLeaving(null);
  }
  const menu = (entry: NavEntry, link: ReactElement) => (
    <EntryMenu entry={entry} model={model} onMove={move} onUnsubscribe={setLeaving}>
      {link}
    </EntryMenu>
  );

  return (
    <nav
      ref={element}
      aria-label="項目"
      onPointerDown={onPointerDown}
      onDragStart={(event) => event.preventDefault()}
      className="relative flex h-full flex-col gap-lg overflow-y-auto bg-background p-sm"
    >
      <SearchBox onNavigate={onNavigate} />
      <ul className="flex flex-col gap-px">
        {model.views.map((entry) => (
          <li key={listKey(entry.target)} className="flex">
            {/* Beside "スター" stands the number of starred articles, not of unread ones. */}
            <ListItem entry={entry} to={pathOf(entry)} count={entry.target.type === "starred" ? model.starred : entry.unread} onNavigate={onNavigate} />
          </li>
        ))}
        {/* Not a list of articles: it stays below 注釈, and Shift+J and Shift+K pass it by. */}
        <li className="flex">
          <NavItem to="/digests" label="ダイジェスト" onNavigate={onNavigate} />
        </li>
      </ul>
      <div className="flex flex-col gap-px">
        <h2 className="px-sm pb-xs type-label-sm text-on-surface-muted">カテゴリ</h2>
        <ul className="flex flex-col gap-px">
          {model.groups.map((group) => {
            const key = listKey(group.entry.target);
            const folded = collapsed.isCollapsed(key);
            const childIsCurrent = group.children.some((child) => isOnList(pathOf(child), pathname));
            return (
              <li key={key} data-drop-over={drag?.over?.key === key ? drag.over.state : undefined} className="nav-group flex flex-col gap-px">
                <div
                  data-nav-key={key}
                  data-dragging={drag?.key === key ? "" : undefined}
                  onKeyDown={openEntryMenu}
                  className="nav-row flex items-center"
                >
                  {group.children.length > 0 ? (
                    <button
                      type="button"
                      aria-expanded={!folded}
                      aria-controls={`nav-group-${key}`}
                      aria-label={`${group.entry.label}の下の項目`}
                      onClick={() => collapsed.toggle(key)}
                      className="nav-fold flex shrink-0 items-center justify-center self-stretch rounded-sm text-on-surface-muted"
                    >
                      <span aria-hidden="true" className={`inline-block type-label-sm ${folded ? "-rotate-90" : ""}`}>
                        ▾
                      </span>
                    </button>
                  ) : foldable ? (
                    <span aria-hidden="true" className="nav-fold shrink-0" />
                  ) : null}
                  {menu(
                    group.entry,
                    <ListItem
                      entry={group.entry}
                      to={pathOf(group.entry)}
                      holdsCurrent={folded && childIsCurrent}
                      // Folded, the feeds below cannot show their marks: the row shows the strongest of them.
                      state={folded ? group.childState : undefined}
                      stateLabel={group.childState ? HIDDEN_STATE_LABEL[group.childState] : undefined}
                      onNavigate={onNavigate}
                    />,
                  )}
                </div>
                {group.children.length > 0 ? (
                  <ul id={`nav-group-${key}`} hidden={folded} className={folded ? "" : "flex flex-col gap-px"}>
                    {folded
                      ? null
                      : group.children.map((child) => (
                          <li
                            key={listKey(child.target)}
                            data-nav-key={listKey(child.target)}
                            data-dragging={drag?.key === listKey(child.target) ? "" : undefined}
                            onKeyDown={openEntryMenu}
                            className="nav-row nav-child flex"
                          >
                            {menu(child, <ListItem entry={child} to={pathOf(child)} onNavigate={onNavigate} />)}
                          </li>
                        ))}
                  </ul>
                ) : null}
              </li>
            );
          })}
        </ul>
      </div>
      <div className="flex flex-col gap-px">
        <h2 className="px-sm pb-xs type-label-sm text-on-surface-muted">管理</h2>
        <ul className="flex flex-col gap-px">
          <li className="flex">
            <NavItem to="/settings" label="設定" onNavigate={onNavigate} />
          </li>
          <li className="flex">
            <NavItem to="/runs" label="実行履歴" attention={attention} onNavigate={onNavigate} />
          </li>
        </ul>
      </div>
      {drag && drag.lineTop !== null ? <div data-drop-line aria-hidden="true" className="nav-drop-line" style={{ top: `${drag.lineTop}px` }} /> : null}
      {drag ? (
        // What is being dragged, carried beside the pointer so that it is plain that something is held.
        <div data-drag-ghost aria-hidden="true" className="nav-drag-ghost type-body-md" style={{ left: `${drag.x + 12}px`, top: `${drag.y + 8}px` }}>
          {drag.label}
        </div>
      ) : null}
      <ConfirmDialog
        open={leavingFeed !== undefined}
        title="購読フィードの登録を解除しますか"
        onDismiss={() => setLeaving(null)}
        returnFocus={() =>
          element.current?.querySelector<HTMLElement>(`[data-nav-key="feed-${leavingRow.current}"] a`) ?? element.current?.querySelector<HTMLElement>("a")
        }
        actions={
          <>
            <Button variant="danger" disabled={removing} onClick={() => leavingFeed && void unsubscribe(leavingFeed)}>
              登録を解除する
            </Button>
            <Button onClick={() => setLeaving(null)}>やめる</Button>
          </>
        }
      >
        {leavingFeed ? (
          <>
            <p>{feedDeletionText(leavingFeed)}</p>
            <ScopedFiltersNote target={{ feedId: leavingFeed.id }} />
            <p>記事を残したまま取得だけを止めるには、設定の購読フィードで一時停止にしてください。</p>
          </>
        ) : null}
      </ConfirmDialog>
    </nav>
  );
}

/** The list of the left pane that is open, with an article opened from it or not; null on any other page. */
function currentEntry(model: NavModel, pathname: string, pathOf: (target: ListTarget) => string | null): ListTarget | null {
  const entries = [...model.views, ...model.groups.flatMap((group) => [group.entry, ...group.children])];
  return (
    entries.find((entry) => {
      const path = pathOf(entry.target);
      return path !== null && isOnList(path, pathname);
    })?.target ?? null
  );
}

/**
 * The entries of the left pane: `full` holds every one, `shown` those the pane shows — without the entries that
 * have no unread article when this browser hides them. The open entry is found in `full`, so that it stays.
 */
function useNavModels(): { full: NavModel; shown: NavModel; current: ListTarget | null; pathOf: (target: ListTarget) => string | null } {
  const counts = useCounts().data;
  const categories = useCategories().data;
  const feeds = useFeeds().data;
  const hideRead = useHideRead();
  const { pathname } = useLocation();
  const full = useMemo(() => buildNav({ categories: categories ?? [], feeds: feeds ?? [], counts }), [categories, feeds, counts]);
  const pathOf = (target: ListTarget) => listPathOf(target, (categoryId) => categories?.find((category) => category.id === categoryId)?.slug);
  const current = currentEntry(full, pathname, pathOf);
  const currentKey = current === null ? null : listKey(current);
  const counted = counts !== undefined;
  const shown = useMemo(
    () => (hideRead ? hideEmptyEntries(full, { current: currentKey === null ? null : parseListKey(currentKey), counted }) : full),
    [full, hideRead, currentKey, counted],
  );
  return { full, shown, current, pathOf };
}

const OVERLAY = "fixed inset-0 z-40 bg-on-surface/40";

function KeyHelp({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className={OVERLAY} />
        <Dialog.Content
          data-hotkeys="off"
          className="fixed top-1/2 left-1/2 z-50 max-h-[90dvh] w-[min(90vw,var(--spacing-list))] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-lg border border-outline bg-surface p-xl"
        >
          <Dialog.Title className="type-headline-md">キー操作</Dialog.Title>
          <Dialog.Description className="pt-xs type-label-sm text-on-surface-muted">
            入力欄で文字を打っている間は働きません。
          </Dialog.Description>
          <dl className="grid grid-cols-[auto_1fr] gap-x-lg gap-y-sm pt-lg type-body-md">
            {KEYS.map(([key, action]) => (
              <div key={key} className="contents">
                <dt>
                  <kbd className="rounded-sm border border-outline px-sm">{key}</kbd>
                </dt>
                <dd>{action}</dd>
              </div>
            ))}
          </dl>
          <div className="flex justify-end pt-lg">
            <Dialog.Close asChild>
              <Button>閉じる</Button>
            </Dialog.Close>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/**
 * The warning above every page once the budget period spent the warning share of the monthly budget. Only
 * shown while a provider costs money: without one, nothing counts towards the budget.
 */
function BudgetWarning() {
  const status = useProviders().data;
  const text = status?.providers.some((provider) => provider.billable) ? budgetWarningLabel(status.budget) : null;
  if (!text) return null;
  return (
    <div role="status" aria-label="月の予算の警告" className="flex flex-wrap items-baseline gap-x-md gap-y-xs border-b border-warning bg-surface px-lg py-sm type-body-md text-warning">
      <span>{text}</span>
      <Link to="/settings#providers" className="underline underline-offset-2">
        プロバイダーの設定
      </Link>
    </div>
  );
}

/** The frame around every page: the navigation pane, or a button that opens it on narrower screens. */
export function Shell() {
  const layout = useLayout();
  const panes = usePanes(layout);
  const [navOpen, setNavOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const { now } = useApp();
  const navigate = useNavigate();
  const counts = useCounts().data;
  const collapsed = useCollapsed();
  const { full: model, shown, current, pathOf } = useNavModels();
  const open = (target: ListTarget | null | undefined) => {
    const path = target ? pathOf(target) : null;
    if (path !== null) void navigate(path);
  };
  const view = (type: ListTarget["type"]) => model.views.find((entry) => entry.target.type === type)?.target;
  useHotkeys(
    {
      "?": () => setHelpOpen(true),
      // On a narrower screen the box is in the pane behind the button: opening it puts the focus in the box, its first field.
      "/": () => {
        if (layout === "wide") document.getElementById(SEARCH_BOX)?.focus();
        else setNavOpen(true);
      },
      // Through the entries the pane shows: the hidden ones are passed by.
      "Shift+J": () => open(stepTarget(shown, current, 1, collapsed.isCollapsed)),
      "Shift+K": () => open(stepTarget(shown, current, -1, collapsed.isCollapsed)),
      "g a": () => open(view("unread")),
      "g s": () => open(view("starred")),
      "g e": () => open(nextEventCategory(model, current)),
      "g r": () => open(view("recentlyRead")),
    },
    { now },
  );
  // The reader fetches the same article, so this reads it from the cache.
  const articleId = Number(useParams().articleId);
  const openArticle = useArticle(Number.isInteger(articleId) && articleId > 0 ? articleId : null).data;
  usePageTitle(counts?.unread, openArticle?.translatedTitle ?? openArticle?.title);

  return (
    <div className="flex h-full">
      <a
        href="#content"
        className="sr-only focus:not-sr-only focus:fixed focus:top-sm focus:left-sm focus:z-50 focus:rounded-md focus:border focus:border-primary focus:bg-surface focus:px-md focus:py-xs"
        onClick={(event) => {
          event.preventDefault();
          document.getElementById("content")?.focus();
        }}
      >
        内容へ移動
      </a>
      {layout === "wide" ? (
        <aside className="relative shrink-0 border-r border-outline" style={{ width: panes.shown.nav }}>
          <Nav />
          <PaneResizer
            label="項目の一覧の幅"
            width={panes.shown.nav}
            min={PANES.nav.min}
            max={panes.widest("nav")}
            onResize={(width) => panes.set("nav", width)}
            onReset={() => panes.reset("nav")}
          />
        </aside>
      ) : null}
      <div className="flex min-w-0 flex-1 flex-col">
        {layout !== "wide" ? (
          <header className="flex items-center gap-md border-b border-outline bg-background px-lg py-sm">
            <Dialog.Root open={navOpen} onOpenChange={setNavOpen}>
              <Dialog.Trigger asChild>
                <Button aria-label="項目を開く">項目</Button>
              </Dialog.Trigger>
              <Dialog.Portal>
                <Dialog.Overlay className={OVERLAY} />
                <Dialog.Content className="fixed inset-y-0 left-0 z-50 w-[min(80vw,var(--spacing-nav))] border-r border-outline bg-background">
                  <Dialog.Title className="sr-only">項目</Dialog.Title>
                  <Dialog.Description className="sr-only">表示する一覧を選びます。</Dialog.Description>
                  <Nav onNavigate={() => setNavOpen(false)} />
                </Dialog.Content>
              </Dialog.Portal>
            </Dialog.Root>
            <span className="type-label-md">smarternews</span>
          </header>
        ) : null}
        <BudgetWarning />
        <main id="content" tabIndex={-1} className="min-h-0 flex-1 focus:outline-none">
          <Outlet />
        </main>
      </div>
      <KeyHelp open={helpOpen} onOpenChange={setHelpOpen} />
    </div>
  );
}

export function NotFound() {
  const location = useLocation();
  return (
    <div className="flex flex-col items-start gap-md p-xl type-body-md">
      <p>このページはありません。</p>
      <p className="break-all text-on-surface-muted">{location.pathname}</p>
      <Link to="/unread" className="text-primary underline underline-offset-4">
        未読の一覧へ
      </Link>
    </div>
  );
}
