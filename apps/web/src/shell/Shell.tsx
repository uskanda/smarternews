import * as Dialog from "@radix-ui/react-dialog";
import { buildNav, listKey, type NavEntry } from "@smarternews/client";
import { useMemo, useState } from "react";
import { Link, NavLink, Outlet, useLocation } from "react-router";
import { useCategories, useCounts, useFeeds } from "../api/queries.ts";
import { useCollapsed } from "../lib/collapsed.ts";
import { useHotkeys } from "../lib/keys.ts";
import { useLayout } from "../lib/layout.ts";
import { isOnList, listPathOf } from "../lib/paths.ts";
import { Button } from "../ui/controls.tsx";

const KEYS: Array<[string, string]> = [
  ["j", "次の記事"],
  ["k", "前の記事"],
  ["s", "スターの切り替え"],
  ["m", "既読と未読の切り替え"],
  ["o", "主な出典を新しいタブで開く"],
  ["?", "この一覧を開く"],
];

const ITEM = "tap flex min-w-0 flex-1 items-center justify-between gap-sm rounded-md px-sm py-xs type-body-md";

function NavItem({ to, label, count, onNavigate }: { to: string; label: string; count?: number; onNavigate?: () => void }) {
  return (
    <NavLink to={to} onClick={onNavigate} className={({ isActive }) => `${ITEM} ${isActive ? "bg-selected font-semibold" : ""}`}>
      <span className="min-w-0 truncate">{label}</span>
      {count ? <span className="tabular-nums text-on-surface-muted">{count}</span> : null}
    </NavLink>
  );
}

/** An entry that opens a list of articles. It is current on that list and on an article opened from it. */
function ListItem({
  entry,
  to,
  count = entry.unread,
  holdsCurrent = false,
  onNavigate,
}: {
  entry: NavEntry;
  to: string;
  count?: number;
  /** True for a folded category whose hidden entry is the one that is open: the row shows where the reader is. */
  holdsCurrent?: boolean;
  onNavigate?: () => void;
}) {
  const current = isOnList(to, useLocation().pathname);
  return (
    <Link
      to={to}
      onClick={onNavigate}
      aria-current={current ? "page" : undefined}
      title={entry.label}
      className={`${ITEM} ${current || holdsCurrent ? "bg-selected font-semibold" : ""}`}
    >
      <span className="min-w-0 truncate">{entry.label}</span>
      {count > 0 ? <span className="tabular-nums text-on-surface-muted">{count}</span> : null}
    </Link>
  );
}

/**
 * The views, the enabled categories with what is below them, the feeds without a category, and the two
 * management pages. A category that has subscribed feeds can be folded.
 */
function Nav({ onNavigate }: { onNavigate?: () => void }) {
  const counts = useCounts().data;
  const categories = useCategories().data;
  const feeds = useFeeds().data;
  const collapsed = useCollapsed();
  const { pathname } = useLocation();
  const model = useMemo(() => buildNav({ categories: categories ?? [], feeds: feeds ?? [], counts }), [categories, feeds, counts]);
  const slugOf = (categoryId: number) => categories?.find((category) => category.id === categoryId)?.slug;
  const pathOf = (entry: NavEntry) => listPathOf(entry.target, slugOf) ?? "/unread";
  // The fold buttons take a column of their own. It exists only once something can be folded.
  const foldable = model.groups.some((group) => group.children.length > 0);
  return (
    <nav aria-label="項目" className="flex h-full flex-col gap-lg overflow-y-auto bg-background p-sm">
      <ul className="flex flex-col gap-px">
        {model.views.map((entry) => (
          <li key={listKey(entry.target)} className="flex">
            {/* Beside "スター" stands the number of starred articles, not of unread ones. */}
            <ListItem entry={entry} to={pathOf(entry)} count={entry.target.type === "starred" ? model.starred : entry.unread} onNavigate={onNavigate} />
          </li>
        ))}
      </ul>
      <div className="flex flex-col gap-px">
        <h2 className="px-sm pb-xs type-label-sm text-on-surface-muted">カテゴリ</h2>
        <ul className="flex flex-col gap-px">
          {model.groups.map((group) => {
            const key = listKey(group.entry.target);
            const folded = collapsed.isCollapsed(key);
            const childIsCurrent = group.children.some((child) => isOnList(pathOf(child), pathname));
            return (
              <li key={key} className="flex flex-col gap-px">
                <div className="flex items-center">
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
                  <ListItem entry={group.entry} to={pathOf(group.entry)} holdsCurrent={folded && childIsCurrent} onNavigate={onNavigate} />
                </div>
                {group.children.length > 0 ? (
                  <ul id={`nav-group-${key}`} hidden={folded} className={folded ? "" : "flex flex-col gap-px"}>
                    {folded
                      ? null
                      : group.children.map((child) => (
                          <li key={listKey(child.target)} className="nav-child flex">
                            <ListItem entry={child} to={pathOf(child)} onNavigate={onNavigate} />
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
            <NavItem to="/runs" label="実行履歴" onNavigate={onNavigate} />
          </li>
        </ul>
      </div>
    </nav>
  );
}

const OVERLAY = "fixed inset-0 z-40 bg-on-surface/40";

function KeyHelp({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className={OVERLAY} />
        <Dialog.Content className="fixed top-1/2 left-1/2 z-50 w-[min(90vw,var(--spacing-list))] -translate-x-1/2 -translate-y-1/2 rounded-lg border border-outline bg-surface p-xl">
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

/** The frame around every page: the navigation pane, or a button that opens it on narrower screens. */
export function Shell() {
  const layout = useLayout();
  const [navOpen, setNavOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  useHotkeys({ "?": () => setHelpOpen(true) });

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
        <aside className="w-nav shrink-0 border-r border-outline">
          <Nav />
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
