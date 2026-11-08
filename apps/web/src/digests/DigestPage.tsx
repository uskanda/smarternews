import type { Digest, DigestRequestResult, DigestSummary, DigestTrigger } from "@smarternews/core/api";
import { ApiError, formatFull } from "@smarternews/client";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { useDigest, useDigests, useSettings, useTimeZone } from "../api/queries.ts";
import { useApp } from "../app/context.ts";
import { useLayout } from "../lib/layout.ts";
import { Button, ErrorNotice, Loading } from "../ui/controls.tsx";

const TRIGGER_LABEL: Record<DigestTrigger, string> = { schedule: "定時", "catch-up": "補完", manual: "手動" };

/** Why asking for a digest now made none, in the app's words. */
const REFUSAL: Record<Exclude<DigestRequestResult["status"], "queued">, string> = {
  limit: "今日はこれ以上作れません。ダイジェストの1日の上限に達しました。",
  budget: "月の予算に達したため、作れません。",
  empty: "期間内に記事がないため、作りませんでした。",
};

/** The id in the path, or null when the path names none. */
function idOf(param: string | undefined): number | null {
  return param && /^\d+$/.test(param) ? Number(param) : null;
}

function DigestList({ items, selected, timeZone }: { items: DigestSummary[]; selected: number | null; timeZone: string }) {
  return (
    <nav aria-label="過去のダイジェスト" className="flex flex-col gap-xs">
      <h2 className="px-sm type-label-sm text-on-surface-muted">過去のダイジェスト</h2>
      <ul className="flex flex-col gap-px">
        {items.map((item) => (
          <li key={item.id} className="flex">
            <Link
              to={`/digests/${item.id}`}
              aria-current={item.id === selected ? "page" : undefined}
              className={`tap flex min-w-0 flex-1 items-baseline justify-between gap-sm rounded-md px-sm py-xs type-body-md ${item.id === selected ? "bg-selected font-semibold" : ""}`}
            >
              <span className="tabular-nums">{formatFull(item.createdAt, timeZone)}</span>
              <span className="type-label-sm text-on-surface-muted">{TRIGGER_LABEL[item.trigger]}</span>
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}

function DigestView({ digest, timeZone }: { digest: Digest; timeZone: string }) {
  const titles = new Map(digest.articles.map((article) => [article.id, article.title]));
  return (
    <section aria-label="ダイジェスト" className="mx-auto flex w-full max-w-measure-article flex-col gap-xl">
      <header className="flex flex-col gap-xs">
        <h2 className="type-headline-lg">{formatFull(digest.createdAt, timeZone)} のダイジェスト</h2>
        <p className="type-label-sm tabular-nums text-on-surface-muted">
          期間 {formatFull(digest.periodStart, timeZone)} から {formatFull(digest.periodEnd, timeZone)} まで・記事 {digest.articleCount}件
        </p>
      </header>
      <p className="whitespace-pre-line type-body-lg">{digest.executiveSummary}</p>
      {digest.sections.map((section) => (
        <section key={section.categoryId} aria-label={section.categoryName} className="flex flex-col gap-sm">
          <h3 className="type-headline-md">{section.categoryName}</h3>
          <ul className="flex list-disc flex-col gap-md pl-lg type-body-md">
            {section.lines.map((line, index) => {
              const sources = line.articleIds.filter((id) => titles.has(id));
              return (
                <li key={index}>
                  <p>{line.text}</p>
                  {sources.length > 0 ? (
                    <ul aria-label="根拠の記事" className="flex flex-col gap-xs pt-xs type-label-sm">
                      {sources.map((id) => (
                        <li key={id}>
                          <Link to={`/all/${id}`} className="tap text-primary underline underline-offset-4">
                            {titles.get(id)}
                          </Link>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </section>
  );
}

/** What is shown before the first digest: that there is none, and when one will be made. */
function NoDigest() {
  const schedule = useSettings().data?.digestSchedule;
  return (
    <div className="flex flex-col gap-xs type-body-md">
      <p>ダイジェストはまだありません。</p>
      {schedule === undefined ? null : schedule.length > 0 ? (
        <p className="text-on-surface-muted">毎日 {schedule.join("、")} に作ります。「今すぐ作る」でも作れます。</p>
      ) : (
        <p className="text-on-surface-muted">時刻では作りません。「今すぐ作る」で作ってください。作る時刻は設定の全体設定で決めます。</p>
      )}
    </div>
  );
}

/** The button that asks for a digest now, and what came of asking. */
function BuildNow({ building }: { building: boolean }) {
  const { api } = useApp();
  const client = useQueryClient();
  const navigate = useNavigate();
  const [message, setMessage] = useState<string | null>(null);
  const [asking, setAsking] = useState(false);
  // What was said about a digest being made no longer holds once it is done.
  const [wasBuilding, setWasBuilding] = useState(building);
  if (building !== wasBuilding) {
    setWasBuilding(building);
    if (!building) setMessage(null);
  }

  async function build() {
    setAsking(true);
    setMessage(null);
    try {
      const result = await api.requestDigest();
      if (result.status === "queued") {
        // The new digest is the latest one, which the page shows when no digest is named.
        void navigate("/digests");
      } else {
        setMessage(REFUSAL[result.status]);
      }
    } catch (error) {
      setMessage(error instanceof ApiError && error.kind === "conflict" ? "すでに作っています。できあがると表示されます。" : "作り始められませんでした。もう一度試してください。");
    }
    await client.invalidateQueries({ queryKey: ["digests"] });
    setAsking(false);
  }

  return (
    <div className="flex flex-wrap items-center gap-md">
      <Button onClick={() => void build()} disabled={building || asking}>
        今すぐ作る
      </Button>
      <p role="status" className="type-body-md">
        {message ?? (building ? "作っています。できあがると表示されます。" : null)}
      </p>
    </div>
  );
}

/** The latest digest, or the one named in the path, beside the list of every digest. */
export function DigestPage() {
  const layout = useLayout();
  const timeZone = useTimeZone();
  const named = idOf(useParams().digestId);
  const digests = useDigests();
  const items = digests.data?.items ?? [];
  const selected = named ?? items[0]?.id ?? null;
  const digest = useDigest(selected);
  const notFound = digest.error instanceof ApiError && digest.error.kind === "not_found";

  const list = items.length > 0 ? <DigestList items={items} selected={selected} timeZone={timeZone} /> : null;
  const shown = notFound ? (
    <p className="type-body-md">このダイジェストはありません。</p>
  ) : digest.isError ? (
    <ErrorNotice error={digest.error} onRetry={() => void digest.refetch()} />
  ) : digest.data ? (
    <DigestView digest={digest.data} timeZone={timeZone} />
  ) : selected !== null ? (
    <Loading />
  ) : null;

  return (
    <div className="flex h-full flex-col bg-surface">
      <header className="flex flex-wrap items-center gap-x-xl gap-y-sm border-b border-outline px-lg py-md md:px-2xl">
        <h1 className="type-headline-md">ダイジェスト</h1>
        <BuildNow building={digests.data?.building ?? false} />
      </header>
      {digests.isError ? <ErrorNotice error={digests.error} onRetry={() => void digests.refetch()} /> : null}
      {digests.isPending && !digests.isError ? <Loading /> : null}
      {digests.isSuccess && items.length === 0 ? (
        <div className="px-lg py-xl md:px-2xl">
          <NoDigest />
        </div>
      ) : null}
      {items.length > 0 ? (
        layout === "narrow" ? (
          <div className="flex min-h-0 flex-1 flex-col gap-2xl overflow-y-auto px-lg py-xl">
            {shown}
            {list}
          </div>
        ) : (
          <div className="flex min-h-0 flex-1">
            <div className="w-list-min shrink-0 overflow-y-auto border-r border-outline p-sm">{list}</div>
            <div className="min-w-0 flex-1 overflow-y-auto px-2xl py-xl">{shown}</div>
          </div>
        )
      ) : null}
    </div>
  );
}
