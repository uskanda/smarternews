import * as Dialog from "@radix-ui/react-dialog";
import { useState } from "react";
import { Link, NavLink, Outlet, useLocation } from "react-router";
import { useCategories, useCounts } from "../api/queries.ts";
import { useHotkeys } from "../lib/keys.ts";
import { useLayout } from "../lib/layout.ts";
import { Button } from "../ui/controls.tsx";

const KEYS: Array<[string, string]> = [
  ["j", "次の記事"],
  ["k", "前の記事"],
  ["s", "スターの切り替え"],
  ["m", "既読と未読の切り替え"],
  ["o", "主な出典を新しいタブで開く"],
  ["?", "この一覧を開く"],
];

function NavItem({ to, label, count, onNavigate }: { to: string; label: string; count?: number; onNavigate?: () => void }) {
  return (
    <NavLink
      to={to}
      onClick={onNavigate}
      className={({ isActive }) =>
        `tap flex items-center justify-between gap-sm rounded-md px-sm py-xs type-body-md ${isActive ? "bg-selected font-semibold" : ""}`
      }
    >
      <span className="min-w-0 truncate">{label}</span>
      {count ? <span className="tabular-nums text-on-surface-muted">{count}</span> : null}
    </NavLink>
  );
}

/** The views, the enabled categories with their unread counts, and the two management pages. */
function Nav({ onNavigate }: { onNavigate?: () => void }) {
  const counts = useCounts().data;
  const categories = useCategories().data ?? [];
  const unreadOf = (categoryId: number) => counts?.categories.find((entry) => entry.categoryId === categoryId)?.unread;
  return (
    <nav aria-label="項目" className="flex h-full flex-col gap-lg overflow-y-auto bg-background p-sm">
      <div className="flex flex-col gap-px">
        <NavItem to="/unread" label="未読" count={counts?.unread} onNavigate={onNavigate} />
        <NavItem to="/all" label="すべて" onNavigate={onNavigate} />
        <NavItem to="/starred" label="スター" count={counts?.starred} onNavigate={onNavigate} />
      </div>
      <div className="flex flex-col gap-px">
        <h2 className="px-sm pb-xs type-label-sm text-on-surface-muted">カテゴリ</h2>
        {categories
          .filter((category) => category.enabled)
          .map((category) => (
            <NavItem key={category.id} to={`/c/${category.slug}`} label={category.name} count={unreadOf(category.id)} onNavigate={onNavigate} />
          ))}
      </div>
      <div className="flex flex-col gap-px">
        <h2 className="px-sm pb-xs type-label-sm text-on-surface-muted">管理</h2>
        <NavItem to="/settings" label="設定" onNavigate={onNavigate} />
        <NavItem to="/runs" label="実行履歴" onNavigate={onNavigate} />
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
