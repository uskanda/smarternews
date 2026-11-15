import type { Category, PageCandidates, PageSelectors } from "@smarternews/core/api";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { ApiError, checkRequired, conflictLabel, fieldError, fieldMessage, UNCATEGORIZED_LABEL } from "@smarternews/client";
import { useApp } from "../app/context.ts";
import { useToast } from "../shell/toast.tsx";
import { AutoSummarize, FetchFullContent, Translate } from "./FeedSwitches.tsx";
import { CandidateChoice, CandidateStatus, SelectorEditor, textsOf, useCandidates, type SelectorTexts } from "./PageSelectors.tsx";
import { Button, Field, messageFor } from "../ui/controls.tsx";
import { useUnsaved } from "./unsaved.tsx";

const SELECT = "w-full rounded-md border border-outline-strong bg-surface px-sm py-xs type-body-md text-on-surface";
export const NO_CATEGORY = "";
const URL_LABEL = "フィードまたはサイトのURL";

function useRefresh() {
  const client = useQueryClient();
  return (...keys: string[]) => {
    for (const key of keys) void client.invalidateQueries({ queryKey: [key] });
  };
}

export function CategorySelect({ id, value, onChange, categories }: { id: string; value: string; onChange: (value: string) => void; categories: Category[] }) {
  return (
    <select id={id} value={value} onChange={(event) => onChange(event.target.value)} className={SELECT}>
      <option value={NO_CATEGORY}>なし（{UNCATEGORIZED_LABEL}）</option>
      {/* A feed belongs to a news category or to none: an event category lists events by day. */}
      {categories
        .filter((category) => category.kind === "news")
        .map((category) => (
          <option key={category.id} value={String(category.id)}>
            {category.name}
          </option>
        ))}
    </select>
  );
}

/** Subscribing to a page without a feed: candidates for its selectors, or selectors written by hand. */
function PageChoice({
  url,
  candidates,
  chosen,
  onChoose,
  manual,
  onManualChange,
  onTested,
}: {
  url: string;
  candidates: ReturnType<typeof useCandidates>["state"];
  chosen: number;
  onChoose: (index: number) => void;
  manual: SelectorTexts;
  onManualChange: (value: SelectorTexts) => void;
  onTested: (selectors: PageSelectors | null) => void;
}) {
  return (
    <section aria-label="記事の見つけ方" className="flex flex-col gap-md">
      <CandidateStatus state={candidates} />
      {candidates.status === "ready" ? <CandidateChoice result={candidates.result} chosen={chosen} onChoose={onChoose} /> : null}
      {candidates.status === "ready" && candidates.result.candidates.length === 0 ? (
        <SelectorEditor url={url} value={manual} onChange={onManualChange} onTested={onTested} />
      ) : null}
    </section>
  );
}

/**
 * The fields for subscribing to a feed or a page, on the page of feeds and in the dialog above the list of a
 * category, of feeds or of uncategorized feeds.
 * It starts in `categoryId` when given, and tells `onAdded` once a feed is subscribed.
 */
export function AddFeedForm({ categories, categoryId = null, onAdded }: { categories: Category[]; categoryId?: number | null; onAdded?: () => void }) {
  const { api } = useApp();
  const refresh = useRefresh();
  const toast = useToast();
  const id = useId();
  const initialCategory = categoryId === null ? NO_CATEGORY : String(categoryId);
  const [url, setUrl] = useState("");
  // Only on the page of feeds: the dialog above a list has no guard, and this does nothing there.
  useUnsaved("購読フィードの追加", url.trim() !== "");
  const [category, setCategory] = useState(initialCategory);
  const [found, setFound] = useState<Array<{ url: string; title: string }> | null>(null);
  const [chosen, setChosen] = useState("");
  const [autoSummarize, setAutoSummarize] = useState(false);
  const [translate, setTranslate] = useState(false);
  const [fetchFullContent, setFetchFullContent] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // A page without a feed: offered once discovery finds none, and subscribed to as a web feed once chosen.
  const [noFeed, setNoFeed] = useState<string | null>(null);
  const [page, setPage] = useState<string | null>(null);
  const candidates = useCandidates();
  const [chosenCandidate, setChosenCandidate] = useState(0);
  const [manual, setManual] = useState<SelectorTexts>(textsOf(null));
  const [tested, setTested] = useState<PageSelectors | null>(null);
  const firstChoice = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (found) firstChoice.current?.focus();
  }, [found]);

  function explain(error: unknown): string {
    if (error instanceof ApiError && error.kind === "conflict") return conflictLabel(error.message);
    const url = fieldMessage(error, "url", "URL");
    if (url) return url;
    if (fieldError(error, "selectors")) return "このセレクターではページから記事を抜き出せませんでした。見本を確かめてください。";
    return fieldMessage(error, "categoryId", "カテゴリ") ?? messageFor(error);
  }

  function leavePage() {
    setNoFeed(null);
    setPage(null);
    candidates.reset();
    setChosenCandidate(0);
    setManual(textsOf(null));
    setTested(null);
  }

  /** The selectors the page is subscribed with: the chosen candidate, or those written by hand and tried. */
  function pageSelectors(result: PageCandidates | null): PageSelectors | null {
    if (result === null) return null;
    return result.candidates.length > 0 ? (result.candidates[chosenCandidate]?.selectors ?? null) : tested;
  }

  async function choosePage(pageUrl: string) {
    setPage(pageUrl);
    setProblem(null);
    // The page gives titles, links and dates only: the text comes from full content, so it starts switched on.
    setFetchFullContent(true);
    const result = await candidates.ask(pageUrl);
    if (result && result.candidates.length > 0) setChosenCandidate(0);
  }

  async function subscribe(feedUrl: string, selectors?: PageSelectors) {
    const created = await api.createFeed({
      url: feedUrl,
      ...(selectors ? { format: "page" as const, selectors } : {}),
      categoryId: category === NO_CATEGORY ? null : Number(category),
      autoSummarize,
      translate,
      fetchFullContent,
    });
    refresh("feeds", "counts", "articles");
    toast({ message: `「${created.title}」を追加しました` });
    setUrl("");
    setFound(null);
    setChosen("");
    setAutoSummarize(false);
    setTranslate(false);
    setFetchFullContent(false);
    leavePage();
    onAdded?.();
  }

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setProblem(null);
    try {
      await action();
    } catch (error) {
      setProblem(explain(error));
    } finally {
      setBusy(false);
    }
  }

  function add(event: FormEvent) {
    event.preventDefault();
    const empty = page === null && found === null ? checkRequired(url, URL_LABEL) : null;
    if (empty !== null) {
      setProblem(empty);
      return;
    }
    void run(async () => {
      if (page !== null) {
        const selectors = pageSelectors(candidates.state.status === "ready" ? candidates.state.result : null);
        return selectors ? subscribe(page, selectors) : undefined;
      }
      if (found !== null && chosen) return subscribe(chosen);
      // The URL may be a feed or a page that points to feeds; the server tells which.
      const { feeds } = await api.discoverFeeds(url.trim());
      if (feeds.length === 0) {
        setProblem("このページにフィードは見つかりませんでした。フィードのURLが分かるときは、それを直接入力してください。");
        // Only a page without a feed is offered as a web feed: a feed is read more reliably than a page.
        setNoFeed(url.trim());
        return;
      }
      if (feeds.length === 1) return subscribe(feeds[0]!.url);
      setFound(feeds);
      setChosen(feeds[0]!.url);
    });
  }

  return (
    <form noValidate onSubmit={add} className="flex max-w-measure flex-col gap-md">
      <Field
        label={URL_LABEL}
        type="url"
        inputMode="url"
        autoComplete="off"
        value={url}
        onChange={(event) => {
          setUrl(event.target.value);
          setFound(null);
          leavePage();
        }}
        hint="サイトのURLを入れると、そのページが案内しているフィードと、よくある場所のフィードを探します。"
      />
      <div className="flex flex-col gap-xs">
        <label htmlFor={`${id}-category`} className="type-label-md">
          カテゴリ
        </label>
        <CategorySelect id={`${id}-category`} value={category} onChange={setCategory} categories={categories} />
      </div>
      <AutoSummarize id={`${id}-summarize-hint`} checked={autoSummarize} onChange={setAutoSummarize} />
      <Translate id={`${id}-translate-hint`} checked={translate} onChange={setTranslate} />
      <FetchFullContent id={`${id}-full-content-hint`} checked={fetchFullContent} onChange={setFetchFullContent} page={page !== null} />
      {found ? (
        // The legend names the group and says what happened; the focus moves here, so it is read out.
        <fieldset className="flex flex-col gap-sm type-body-md">
          <legend className="pb-xs type-label-md">フィードが{found.length}つ見つかりました。購読するものを選んでください。</legend>
          {found.map((feed, index) => (
            <label key={feed.url} className="flex cursor-pointer items-baseline gap-xs">
              <input
                type="radio"
                name={`${id}-found-feed`}
                className="accent-primary"
                ref={index === 0 ? firstChoice : undefined}
                checked={chosen === feed.url}
                onChange={() => setChosen(feed.url)}
              />
              <span className="min-w-0">
                <span>{feed.title || "（名前なし）"}</span>
                <span className="block break-all type-label-sm text-on-surface-muted">{feed.url}</span>
              </span>
            </label>
          ))}
        </fieldset>
      ) : null}
      {problem ? (
        <p role="alert" className="type-body-md text-error">
          {problem}
        </p>
      ) : null}
      {noFeed !== null && page === null ? (
        <div className="flex flex-col gap-xs">
          <div>
            <Button onClick={() => void choosePage(noFeed)} aria-describedby={`${id}-page-hint`}>
              このページを購読する
            </Button>
          </div>
          <p id={`${id}-page-hint`} className="type-label-sm text-on-surface-muted">
            フィードのないページから、記事のタイトルとリンクを抜き出して購読します。記事の見つけ方の候補を出すときに、LLMを1回使います。
          </p>
        </div>
      ) : null}
      {page !== null ? (
        <PageChoice
          url={page}
          candidates={candidates.state}
          chosen={chosenCandidate}
          onChoose={setChosenCandidate}
          manual={manual}
          onManualChange={setManual}
          onTested={setTested}
        />
      ) : null}
      <div>
        {page !== null ? (
          <Button
            type="submit"
            variant="primary"
            disabled={busy || pageSelectors(candidates.state.status === "ready" ? candidates.state.result : null) === null}
          >
            このページを追加
          </Button>
        ) : (
          <Button type="submit" variant="primary" disabled={busy || url.trim().length === 0}>
            {found ? "選んだフィードを追加" : "購読フィードを追加"}
          </Button>
        )}
      </div>
    </form>
  );
}
