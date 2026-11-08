import type { CategoryVersionTrigger } from "@smarternews/core/api";
import { useId } from "react";
import { useCategoryVersions, useTimeZone } from "../api/queries.ts";
import { ErrorNotice, Loading } from "../ui/controls.tsx";
import { formatWhen } from "./TopicHistory.tsx";

const TRIGGER_LABEL: Record<CategoryVersionTrigger, string> = {
  created: "作成",
  edited: "編集",
  "settings-file": "設定ファイル",
};

/**
 * The category's minimum importance and limit of articles each time they changed, newest first. There is no going
 * back: the two fields above change them. The dates tell whether a change in the topic stats came from them.
 */
export function CategoryHistory({ categoryId }: { categoryId: number }) {
  const versions = useCategoryVersions(categoryId);
  const timeZone = useTimeZone();
  const headingId = useId();
  return (
    <section aria-labelledby={headingId} className="flex max-w-measure flex-col gap-sm pt-md">
      <h3 id={headingId} className="type-label-md">
        最低重要度と件数上限の履歴
      </h3>
      <p className="type-label-sm text-on-surface-muted">
        変えた日と値です。トピックの成績が変わったとき、この変更によるものかを見分けるのに使えます。
      </p>
      {versions.isError ? <ErrorNotice error={versions.error} onRetry={() => void versions.refetch()} /> : null}
      {versions.isPending && !versions.isError ? <Loading /> : null}
      <ul className="flex flex-col">
        {versions.data?.map((version) => (
          <li key={version.id} className="flex flex-wrap gap-x-md gap-y-xs border-t border-outline py-xs type-label-sm">
            <span className="tabular-nums">{formatWhen(version.createdAt, timeZone)}</span>
            <span className="text-on-surface-muted">{TRIGGER_LABEL[version.trigger]}</span>
            <span className="tabular-nums">最低重要度 {version.minImportance}</span>
            <span className="tabular-nums">件数上限 {version.maxArticlesPerRun}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
