// The parts of the feeds page that deal with web feeds: candidates for the selectors of a page, the preview of
// what a set of selectors takes out, and the fields to write selectors by hand.
import type { PageCandidates, PageSelectors, SelectorFallback, SelectorPreview } from "@smarternews/core/api";
import { ApiError, fieldError, formatClock, formatDay } from "@smarternews/client";
import { useId, useState } from "react";
import { useApp } from "../app/context.ts";
import { useTimeZone } from "../api/queries.ts";
import { Button, Field, messageFor } from "../ui/controls.tsx";

/** The four selectors as the fields hold them: empty text for one that is left out. */
export interface SelectorTexts {
  item: string;
  title: string;
  link: string;
  date: string;
}

const FIELDS: Array<{ name: keyof SelectorTexts; label: string; hint?: string }> = [
  { name: "item", label: "項目のセレクター", hint: "記事1件ずつを囲む要素を指します。必須です。" },
  { name: "title", label: "タイトルのセレクター", hint: "空のときは、リンクの文字列をタイトルにします。" },
  { name: "link", label: "リンクのセレクター", hint: "空のときは、項目の中の最初のリンクを使います。" },
  { name: "date", label: "日時のセレクター", hint: "空のときと日時を読めないときは、見つけた時刻で並べます。" },
];

export function textsOf(selectors: PageSelectors | null): SelectorTexts {
  return { item: selectors?.item ?? "", title: selectors?.title ?? "", link: selectors?.link ?? "", date: selectors?.date ?? "" };
}

/** The selectors the fields hold, without the empty ones. Null without an item selector. */
export function selectorsOf(texts: SelectorTexts): PageSelectors | null {
  const item = texts.item.trim();
  if (item.length === 0) return null;
  const optional = (["title", "link", "date"] as const).filter((name) => texts[name].trim().length > 0);
  return { item, ...Object.fromEntries(optional.map((name) => [name, texts[name].trim()])) };
}

/** Why the server refused a selector, in the app's words. */
export function selectorError(error: unknown, name: keyof SelectorTexts): string | null {
  const message = fieldError(error, `selectors.${name}`);
  if (message === null) return null;
  return message === "not a CSS selector" ? "CSSセレクターとして読めません。" : message;
}

/** What a set of selectors takes out: the count, and the first articles with their dates. */
export function PreviewList({ preview }: { preview: SelectorPreview }) {
  const timeZone = useTimeZone();
  if (preview.count === 0) {
    return <p className="type-body-md text-error">このセレクターでは記事を抜き出せませんでした。</p>;
  }
  return (
    <div className="flex flex-col gap-xs">
      <p className="type-label-md tabular-nums">
        {preview.count}件の記事を抜き出せます{preview.count > preview.items.length ? `（先頭の${preview.items.length}件を表示）` : ""}
      </p>
      <ol className="flex flex-col gap-xs type-body-md">
        {preview.items.map((item, index) => (
          <li key={`${index}-${item.url}`} className="min-w-0">
            <span className="block">{item.title}</span>
            <span className="block break-all type-label-sm text-on-surface-muted">
              <span className="tabular-nums">{item.publishedAt ? `${formatDay(item.publishedAt, timeZone).date} ${formatClock(item.publishedAt, timeZone)}` : "日時なし"}</span>
              {" ・ "}
              {item.url}
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
}

const FALLBACK_REASON: Record<SelectorFallback, string> = {
  limit: "今日のLLMの呼び出しが上限に達したため",
  failed: "LLMから使える答えが返らなかったため",
  empty: "LLMの候補では記事を抜き出せなかったため",
};

/** The sentence that says the model was not used. It is information, not an error, and looks like the text around it. */
function ModelNote({ fallback, empty }: { fallback: SelectorFallback | null; empty: boolean }) {
  const reason = fallback === null ? "" : FALLBACK_REASON[fallback];
  return (
    <p className="rounded-md border border-outline px-lg py-sm type-body-md text-on-surface">
      {reason}、LLMを使わずにページの作りから候補を推定しました。
      {empty ? "候補は見つかりませんでした。セレクターを入力して、見本で確かめてください。" : ""}
    </p>
  );
}

/**
 * The candidates for a page, one to be chosen, each with its preview. When the model was not used, one sentence
 * says so.
 */
export function CandidateChoice({ result, chosen, onChoose }: { result: PageCandidates; chosen: number; onChoose: (index: number) => void }) {
  const name = useId();
  return (
    <div className="flex flex-col gap-md">
      {result.usedModel ? null : <ModelNote fallback={result.fallback} empty={result.candidates.length === 0} />}
      {result.candidates.length > 0 ? (
        <fieldset className="flex flex-col gap-md type-body-md">
          <legend className="pb-xs type-label-md">候補が{result.candidates.length}つあります。見本を確かめて、1つを選んでください。</legend>
          {result.candidates.map((candidate, index) => (
            <div key={index} className="flex flex-col gap-xs rounded-md border border-outline px-lg py-md">
              <label className="flex cursor-pointer items-baseline gap-xs">
                <input type="radio" name={name} className="accent-primary" checked={chosen === index} onChange={() => onChoose(index)} />
                <span className="min-w-0">
                  候補{index + 1}
                  <code className="block break-all type-label-sm text-on-surface-muted">{describe(candidate.selectors)}</code>
                </span>
              </label>
              <PreviewList preview={candidate.preview} />
            </div>
          ))}
        </fieldset>
      ) : null}
    </div>
  );
}

/** The selectors of a candidate on one line: the item first, then the parts that are given. */
function describe(selectors: PageSelectors): string {
  return [
    `項目: ${selectors.item}`,
    ...(selectors.title ? [`タイトル: ${selectors.title}`] : []),
    ...(selectors.link ? [`リンク: ${selectors.link}`] : []),
    ...(selectors.date ? [`日時: ${selectors.date}`] : []),
  ].join(" ／ ");
}

/** Asks the server for candidates; says that it is looking while it waits, which may take minutes. */
export function useCandidates() {
  const { api } = useApp();
  const [state, setState] = useState<{ status: "idle" } | { status: "loading" } | { status: "ready"; result: PageCandidates } | { status: "failed"; error: unknown }>({
    status: "idle",
  });
  async function ask(url: string): Promise<PageCandidates | null> {
    setState({ status: "loading" });
    try {
      const result = await api.pageCandidates(url);
      setState({ status: "ready", result });
      return result;
    } catch (error) {
      setState({ status: "failed", error });
      return null;
    }
  }
  return { state, ask, reset: () => setState({ status: "idle" }) };
}

export function CandidateStatus({ state }: { state: ReturnType<typeof useCandidates>["state"] }) {
  return (
    <p role="status" className="type-body-md text-on-surface-muted">
      {state.status === "loading" ? "記事の見つけ方の候補を探しています…（1分以上かかることがあります）" : ""}
      {state.status === "failed" ? pageFailure(state.error, "候補") : ""}
    </p>
  );
}

/** Why candidates or a preview could not be had: mostly a page that could not be fetched. */
function pageFailure(error: unknown, what: "候補" | "見本"): string {
  const reason = fieldError(error, "url");
  if (reason) return `このページを取得できなかったため、${what}を出せませんでした（${reason}）。`;
  return messageFor(error);
}

/**
 * The four selectors as fields, with a button that shows what they take out of the page. `onTested` hears the
 * selectors once a preview took at least one article out, and null as soon as a field changes.
 */
export function SelectorEditor({
  url,
  value,
  onChange,
  onTested,
  error,
}: {
  url: string;
  value: SelectorTexts;
  onChange: (value: SelectorTexts) => void;
  onTested?: (selectors: PageSelectors | null) => void;
  /** A refusal of the server, whose fields name the selectors. */
  error?: unknown;
}) {
  const { api } = useApp();
  const [preview, setPreview] = useState<SelectorPreview | null>(null);
  const [problem, setProblem] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const shown = problem ?? error;

  async function look() {
    const selectors = selectorsOf(value);
    if (selectors === null) return;
    setBusy(true);
    setProblem(null);
    try {
      const result = await api.pagePreview(url, selectors);
      setPreview(result);
      onTested?.(result.count > 0 ? selectors : null);
    } catch (caught) {
      setPreview(null);
      setProblem(caught);
      onTested?.(null);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-md">
      {FIELDS.map((field) => (
        <Field
          key={field.name}
          label={field.label}
          autoComplete="off"
          spellCheck={false}
          value={value[field.name]}
          onChange={(event) => {
            onChange({ ...value, [field.name]: event.target.value });
            setPreview(null);
            setProblem(null);
            onTested?.(null);
          }}
          hint={field.hint}
          error={selectorError(shown, field.name)}
        />
      ))}
      <div>
        <Button onClick={() => void look()} disabled={busy || selectorsOf(value) === null}>
          {busy ? "見本を取得中…" : "見本を見る"}
        </Button>
      </div>
      {problem && !(problem instanceof ApiError && problem.fields.some((field) => field.path.startsWith("selectors."))) ? (
        <p role="alert" className="type-body-md text-error">
          {pageFailure(problem, "見本")}
        </p>
      ) : null}
      {preview ? <PreviewList preview={preview} /> : null}
    </div>
  );
}
