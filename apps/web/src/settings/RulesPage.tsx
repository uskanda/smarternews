import type { Category, Feed, Rule } from "@smarternews/core/api";
import { useRef, useState } from "react";
import { Link } from "react-router";
import { useCategories, useFeeds, useRules } from "../api/queries.ts";
import { useApp } from "../app/context.ts";
import { useToast } from "../shell/toast.tsx";
import { ConfirmDialog } from "../ui/ConfirmDialog.tsx";
import { Button, ErrorNotice, Loading, messageFor } from "../ui/controls.tsx";
import { conditionsLabel, scopeLabel } from "./FilterForm.tsx";
import { useInlineEditFocus } from "./inline-edit-focus.ts";
import { actionsLabel, RuleForm, useRuleRefresh } from "./RuleForm.tsx";
import { UnsavedGuard } from "../ui/unsaved.tsx";

const SECTION = "flex flex-col gap-md border-b border-outline px-lg py-xl md:px-2xl";

function RuleRow({
  rule,
  categories,
  feeds,
  afterRemoval,
}: {
  rule: Rule;
  categories: Category[];
  feeds: Feed[];
  /** Where the focus goes once the row is gone. */
  afterRemoval: () => HTMLElement | null;
}) {
  const { api } = useApp();
  const refresh = useRuleRefresh();
  const toast = useToast();
  const [editing, setEditing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const removed = useRef(false);
  const focus = useInlineEditFocus(editing);
  const summary = `ルール（${scopeLabel(rule.scope, categories, feeds)}）`;

  async function toggle() {
    try {
      const changed = await api.updateRule(rule.id, { enabled: !rule.enabled });
      refresh();
      toast({ message: changed.enabled ? "ルールを有効にしました。新しく届く記事に働きます。" : "ルールを無効にしました。" });
    } catch (error) {
      toast({ message: messageFor(error) });
    }
  }

  async function remove() {
    try {
      await api.deleteRule(rule.id);
      removed.current = true;
      setConfirming(false);
      refresh();
      toast({ message: "ルールを削除しました。" });
    } catch {
      setConfirming(false);
      toast({ message: "削除できませんでした。もう一度試してください。" });
    }
  }

  return (
    <li className="flex flex-col gap-xs border-b border-outline py-md type-body-md">
      <div className="flex flex-wrap items-baseline gap-x-lg gap-y-xs">
        <span className="type-label-md">{summary}</span>
        {rule.enabled ? null : <span className="rounded-sm border border-current px-xs type-label-sm text-on-surface-muted">無効</span>}
      </div>
      <p className="break-all">{conditionsLabel(rule)}</p>
      <p className="text-on-surface-muted">操作：{actionsLabel(rule)}</p>
      {editing ? (
        <div ref={focus.region}>
          <RuleForm rule={rule} onDone={() => setEditing(false)} />
        </div>
      ) : (
        <div className="flex flex-wrap gap-sm pt-xs">
          <Button ref={focus.opener} aria-label={`${summary}を編集`} onClick={() => setEditing(true)}>
            編集
          </Button>
          <Button aria-label={`${summary}を${rule.enabled ? "無効にする" : "有効にする"}`} onClick={() => void toggle()}>
            {rule.enabled ? "無効にする" : "有効にする"}
          </Button>
          <Button aria-label={`${summary}を削除`} onClick={() => setConfirming(true)}>
            削除
          </Button>
        </div>
      )}
      <ConfirmDialog
        open={confirming}
        title="ルールを削除しますか"
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
        <p className="break-all">{conditionsLabel(rule)}</p>
        <p>ルールが付けたスターや既読は、そのまま残ります。削除せずに無効にもできます。</p>
      </ConfirmDialog>
    </li>
  );
}

/** Rules that star, mark read, notify or ask for the summary of new feed articles. */
export function RulesPage() {
  return (
    <UnsavedGuard>
      <Rules />
    </UnsavedGuard>
  );
}

function Rules() {
  const rules = useRules();
  const categories = useCategories().data ?? [];
  const feeds = useFeeds().data ?? [];
  const listHeading = useRef<HTMLHeadingElement>(null);
  return (
    <div className="h-full overflow-y-auto bg-surface">
      <header className="flex flex-col gap-xs border-b border-outline px-lg py-md md:px-2xl">
        <Link to="/settings" className="tap type-body-md text-primary underline underline-offset-4">
          設定へ戻る
        </Link>
        <h1 className="type-headline-md">ルール</h1>
      </header>
      <section aria-label="ルールの追加" className={SECTION}>
        <h2 className="type-headline-md">追加</h2>
        <ul aria-label="ルールが働く記事" className="flex max-w-measure-article list-disc flex-col gap-xs pl-lg type-label-sm text-on-surface-muted">
          <li>新しく届いた配信記事にだけ働きます。保存済みの記事と、内容が書き換わった記事には働きません。AI生成の記事にも働きません。</li>
          <li>フィルターで隠れた記事と、重複として隠した記事には働きません。</li>
          <li>1つの記事が複数のルールに合うときは、すべての操作を行います。</li>
        </ul>
        <RuleForm />
      </section>
      <section aria-label="ルールの一覧" className={SECTION}>
        <h2 ref={listHeading} tabIndex={-1} className="type-headline-md">
          一覧
        </h2>
        {rules.isError ? <ErrorNotice error={rules.error} onRetry={() => void rules.refetch()} /> : null}
        {rules.isPending && !rules.isError ? <Loading /> : null}
        {rules.data?.length === 0 ? <p className="type-body-md text-on-surface-muted">ルールはまだありません。</p> : null}
        <ul className="max-w-measure-article">
          {rules.data?.map((rule) => (
            <RuleRow key={rule.id} rule={rule} categories={categories} feeds={feeds} afterRemoval={() => listHeading.current} />
          ))}
        </ul>
      </section>
    </div>
  );
}
