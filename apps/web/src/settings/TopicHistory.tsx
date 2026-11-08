import type { Topic, TopicVersion, TopicVersionTrigger } from "@smarternews/core/api";
import { formatClock, formatDate } from "@smarternews/client";
import { useQueryClient } from "@tanstack/react-query";
import { useId, useState } from "react";
import { useTimeZone, useTopicVersions } from "../api/queries.ts";
import { useApp } from "../app/context.ts";
import { useToast } from "../shell/toast.tsx";
import { ConfirmDialog } from "../ui/ConfirmDialog.tsx";
import { Badge, Button, ErrorNotice, Loading } from "../ui/controls.tsx";

export const TOPIC_VERSION_TRIGGER_LABEL: Record<TopicVersionTrigger, string> = {
  created: "作成",
  edited: "編集",
  interpreted: "解釈",
  "settings-file": "設定ファイル",
  restored: "版に戻す",
};

/** "2026年3月20日 09:00" in the time zone of the settings. */
export function formatWhen(iso: string, timeZone: string): string {
  return `${formatDate(iso, timeZone)} ${formatClock(iso, timeZone)}`;
}

const sameList = (a: string[], b: string[]) => a.length === b.length && a.every((item, index) => item === b[index]);

/** The names of the kept values a version changed from the one before it. */
function changedFields(version: TopicVersion, previous: TopicVersion): string[] {
  return [
    version.text !== previous.text ? "文章" : null,
    sameList(version.queries, previous.queries) ? null : "検索語",
    version.criteria !== previous.criteria ? "判定基準" : null,
    sameList(version.sources.feeds, previous.sources.feeds) &&
    version.sources.newsSearch === previous.sources.newsSearch &&
    version.sources.llmSearch === previous.sources.llmSearch
      ? null
      : "取得元",
    version.search?.language === previous.search?.language && version.search?.region === previous.search?.region ? null : "検索の言語と地域",
  ].filter((field): field is string => field !== null);
}

/**
 * The versions of the topic, newest first, each with what made it and what it changed, and a way back to any of
 * them but the current one. Going back is refused while the editor holds unsaved changes, which it would replace.
 * `onRestored` gets the topic as the server answered it, once its list and its versions were fetched again.
 */
export function TopicHistory({
  topicId,
  categoryId,
  dirty,
  onRestored,
}: {
  topicId: number;
  categoryId: number;
  dirty: boolean;
  onRestored: (topic: Topic) => void;
}) {
  const { api } = useApp();
  const client = useQueryClient();
  const toast = useToast();
  const timeZone = useTimeZone();
  const versions = useTopicVersions(topicId);
  const headingId = useId();
  const hintId = useId();
  const [target, setTarget] = useState<TopicVersion | null>(null);
  const list = versions.data ?? [];

  async function restore(version: TopicVersion) {
    setTarget(null);
    try {
      const restored = await api.restoreTopicVersion(topicId, version.id);
      void client.invalidateQueries({ queryKey: ["topic-stats", categoryId] });
      await Promise.all([
        client.invalidateQueries({ queryKey: ["topics", categoryId] }),
        client.invalidateQueries({ queryKey: ["topic-versions", topicId] }),
      ]);
      toast({ message: "この版に戻しました" });
      onRestored(restored);
    } catch {
      toast({ message: "この版に戻せませんでした。もう一度試してください。" });
    }
  }

  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-sm">
      <h3 id={headingId} className="type-label-md">
        履歴
      </h3>
      <p id={hintId} className={`type-label-sm ${dirty ? "text-warning" : "text-on-surface-muted"}`}>
        {dirty
          ? "保存していない変更があります。保存するか、変更を取り消してから戻してください。"
          : "文章、検索語、判定基準、取得元、検索の言語と地域が変わるたびに、版が残ります。「この版に戻す」は、判定基準ごと戻すので、解釈し直しません。"}
      </p>
      {versions.isError ? <ErrorNotice error={versions.error} onRetry={() => void versions.refetch()} /> : null}
      {versions.isPending && !versions.isError ? <Loading /> : null}
      <ul className="flex flex-col">
        {list.map((version, index) => {
          const previous = list[index + 1];
          const changed = previous ? changedFields(version, previous) : [];
          const source = version.restoredFrom === null ? undefined : list.find((other) => other.id === version.restoredFrom);
          return (
            <li key={version.id} className="flex flex-col gap-xs border-t border-outline py-sm">
              <div className="flex flex-wrap items-center gap-x-md gap-y-xs type-label-sm">
                <span className="tabular-nums">{formatWhen(version.createdAt, timeZone)}</span>
                <span>{TOPIC_VERSION_TRIGGER_LABEL[version.trigger]}</span>
                {source ? <span className="text-on-surface-muted">（{formatWhen(source.createdAt, timeZone)}の版から）</span> : null}
                {index === 0 ? <Badge>今の版</Badge> : null}
                {version.interpreted ? null : <Badge>未解釈</Badge>}
              </div>
              <p className="type-label-sm text-on-surface-muted">
                {previous ? (changed.length > 0 ? `変わった項目：${changed.join("、")}` : "解釈が済みました") : "最初の版"}
              </p>
              <dl className="grid grid-cols-[auto_1fr] gap-x-md gap-y-xs type-label-sm">
                <dt className="text-on-surface-muted">文章</dt>
                <dd className="whitespace-pre-wrap break-words">{version.text}</dd>
                {version.criteria ? (
                  <>
                    <dt className="text-on-surface-muted">判定基準</dt>
                    <dd className="line-clamp-3 break-words">{version.criteria}</dd>
                  </>
                ) : null}
              </dl>
              {index === 0 ? null : (
                <div>
                  <Button disabled={dirty} aria-describedby={dirty ? hintId : undefined} onClick={() => setTarget(version)}>
                    この版に戻す
                  </Button>
                </div>
              )}
            </li>
          );
        })}
      </ul>
      <ConfirmDialog
        open={target !== null}
        title="この版に戻しますか"
        onDismiss={() => setTarget(null)}
        actions={
          <>
            <Button variant="primary" onClick={() => target && void restore(target)}>
              戻す
            </Button>
            <Button onClick={() => setTarget(null)}>やめる</Button>
          </>
        }
      >
        {target ? (
          <>
            <p>
              文章、検索語、判定基準、取得元、検索の言語と地域が、{formatWhen(target.createdAt, timeZone)}
              の版に戻ります。今の値は履歴に残ります。
            </p>
            <p>{target.interpreted ? "解釈済みの版なので、解釈し直しません。" : "解釈が済んでいない版なので、次の実行で解釈されます。"}</p>
            <p>取得元は、あなたが選んだものとして扱い、後の解釈では変わりません。</p>
          </>
        ) : null}
      </ConfirmDialog>
    </section>
  );
}
