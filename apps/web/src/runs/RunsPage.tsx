import { Link, useSearchParams } from "react-router";
import { useCategories, useRuns, useTimeZone } from "../api/queries.ts";
import { formatFull, STATUS_LABEL, TRIGGER_LABEL } from "@smarternews/client";
import { ErrorNotice, Loading } from "../ui/controls.tsx";

const NUMBER = "py-sm pr-lg text-right tabular-nums";

/** Every run of the last 30 days, newest first. Rows update by themselves while a run is in progress. */
export function RunsPage() {
  const [search, setSearch] = useSearchParams();
  const selected = search.get("category");
  const categoryId = selected && /^\d+$/.test(selected) ? Number(selected) : undefined;
  const categories = useCategories().data ?? [];
  const runs = useRuns(categoryId);
  const timeZone = useTimeZone();
  const nameOf = (id: number) => categories.find((category) => category.id === id)?.name ?? "";

  return (
    <div className="flex h-full flex-col overflow-y-auto bg-surface">
      <header className="flex flex-wrap items-center justify-between gap-md border-b border-outline px-lg py-md md:px-2xl">
        <h1 className="type-headline-md">実行履歴</h1>
        <label className="flex items-center gap-sm type-body-md">
          カテゴリ
          <select
            className="rounded-md border border-outline-strong bg-surface px-sm py-xs"
            value={categoryId ?? ""}
            onChange={(event) => setSearch(event.target.value ? { category: event.target.value } : {}, { replace: true })}
          >
            <option value="">すべて</option>
            {categories.map((category) => (
              <option key={category.id} value={category.id}>
                {category.name}
              </option>
            ))}
          </select>
        </label>
      </header>
      {runs.isError ? <ErrorNotice error={runs.error} onRetry={() => void runs.refetch()} /> : null}
      {runs.isPending && !runs.isError ? <Loading /> : null}
      {runs.data?.length === 0 ? (
        <div className="flex flex-col gap-xs p-lg type-body-md md:px-2xl">
          <p>実行の記録はまだありません。</p>
          <p className="text-on-surface-muted">カテゴリの画面から実行するか、スケジュールの時刻を待ってください。</p>
        </div>
      ) : null}
      {runs.data && runs.data.length > 0 ? (
        <div className="overflow-x-auto px-lg py-md md:px-2xl">
          <table aria-label="実行履歴" className="w-full text-left type-body-md">
            <thead className="type-label-sm text-on-surface-muted">
              <tr>
                <th className="py-xs pr-lg font-normal">カテゴリ</th>
                <th className="py-xs pr-lg font-normal">契機</th>
                <th className="py-xs pr-lg font-normal">開始</th>
                <th className="py-xs pr-lg font-normal">状態</th>
                <th className="py-xs pr-lg text-right font-normal">候補</th>
                <th className="py-xs pr-lg text-right font-normal">除外</th>
                <th className="py-xs pr-lg text-right font-normal">作成</th>
                <th className="py-xs pr-lg text-right font-normal">更新</th>
                <th className="py-xs pr-lg text-right font-normal">LLM</th>
              </tr>
            </thead>
            <tbody>
              {runs.data.map((run) => (
                <tr key={run.id} className="border-t border-outline">
                  <td className="py-sm pr-lg">{nameOf(run.categoryId)}</td>
                  <td className="py-sm pr-lg">{TRIGGER_LABEL[run.trigger]}</td>
                  <td className="py-sm pr-lg whitespace-nowrap">
                    <Link to={`/runs/${run.id}`} className="tap tabular-nums text-primary underline underline-offset-4">
                      {formatFull(run.startedAt ?? run.queuedAt, timeZone)}
                    </Link>
                  </td>
                  <td className={`py-sm pr-lg whitespace-nowrap ${run.status === "failed" ? "text-error" : run.status === "partial" || run.status === "stopped_by_limit" ? "text-warning" : ""}`}>
                    {STATUS_LABEL[run.status]}
                  </td>
                  <td className={NUMBER}>{run.collected}</td>
                  <td className={NUMBER}>{run.rejected}</td>
                  <td className={NUMBER}>{run.articlesCreated}</td>
                  <td className={NUMBER}>{run.articlesUpdated}</td>
                  <td className={NUMBER}>{run.llmCalls}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}
