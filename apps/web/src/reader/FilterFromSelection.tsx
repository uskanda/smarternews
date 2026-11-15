import type { Article, Filter, FilterScope } from "@smarternews/core/api";
import { useState } from "react";
import { useCategories, useFeeds } from "../api/queries.ts";
import { useApp } from "../app/context.ts";
import { FilterForm, useRefresh, type FilterStart } from "../settings/FilterForm.tsx";
import { useToast } from "../shell/toast.tsx";
import { FormDialog } from "../ui/FormDialog.tsx";

// Making a hide filter of the text selected in a feed article: the inputs of the settings of filters, filled in.
// Saving leaves the article open; the lists and the counts are read again, and the notice can undo it. Once the
// inputs differ from what they were filled in with, closing the dialog asks first.

/** How many articles a filter hides now, in the words of a notice. */
const hiddenText = (count: number) => (count > 0 ? `${count}件を隠しています。` : "いま隠している記事はありません。");

/**
 * The dialog: a hide filter over everything that matches `value` in the title or the content, as a part of
 * either. The feed of the article and its category, when that holds news, are offered first as the scope.
 */
export function FilterFromSelectionDialog({ value, article, onClose, onCreated }: { value: string; article: Article; onClose: () => void; onCreated: () => void }) {
  const { api } = useApp();
  const refresh = useRefresh();
  const toast = useToast();
  const feeds = useFeeds().data ?? [];
  const categories = useCategories().data ?? [];
  const feed = feeds.find((each) => each.id === article.feedId);
  const category = categories.find((each) => each.id === feed?.categoryId && each.kind === "news");
  // Kept as it is while the dialog is open: the form tells a change by comparing with it.
  const [initial] = useState<FilterStart>(() => ({
    action: "hide",
    scope: { type: "all" },
    conditions: [{ fields: ["title", "content"], match: "contains", value }],
  }));
  const preferred: FilterScope[] = [
    ...(feed ? [{ type: "feed" as const, feedId: feed.id }] : []),
    ...(category ? [{ type: "category" as const, categoryId: category.id }] : []),
  ];

  function created(saved: Filter) {
    onCreated();
    toast({
      message: `隠すフィルターを追加しました。${hiddenText(saved.hiddenCount)}`,
      action: {
        label: "取り消す",
        run: () => {
          api
            .deleteFilter(saved.id)
            .then(({ restored }) => {
              refresh();
              toast({ message: `フィルターを取り消しました。${restored > 0 ? `${restored}件が一覧に戻りました。` : ""}` });
            })
            .catch(() => toast({ message: "取り消せませんでした。フィルターの設定から削除してください。" }));
        },
      },
    });
  }

  return (
    <FormDialog open onOpenChange={(open) => (open ? undefined : onClose())} title="隠すフィルターを作る" layout="article">
      <p className="type-label-sm text-on-surface-muted">配信記事のタイトルと配信された内容を照合します。スターまたは注釈のある記事は隠しません。</p>
      <FilterForm initial={initial} preferred={preferred} onDone={onClose} onCreated={created} />
    </FormDialog>
  );
}
