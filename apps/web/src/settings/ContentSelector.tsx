import { CONTENT_PREVIEW_CHARS, type ContentPreview } from "@smarternews/core/api";
import { ApiError, fieldMessage, fullContentErrorLabel } from "@smarternews/client";
import { useState } from "react";
import { useApp } from "../app/context.ts";
import { Button, Field, messageFor } from "../ui/controls.tsx";

const LABEL = "本文のセレクター";

/** The value a field holds as the API takes it: null when it is empty. */
export function contentSelectorOf(text: string): string | null {
  const value = text.trim();
  return value.length === 0 ? null : value;
}

/** Why the server refused the content selector, in the app's words. */
function contentSelectorError(error: unknown): string | null {
  const problem = error instanceof ApiError ? error.fields.find((field) => field.path === "contentSelector") : undefined;
  if (problem?.code === "format") return "CSSセレクターとして読めません。";
  return fieldMessage(error, "contentSelector", LABEL);
}

/** What the selector took out of the page, and from which article; the body as text, never as HTML. */
function PreviewResult({ preview, tried }: { preview: ContentPreview; tried: string | null }) {
  if (preview.status === "no-article") {
    return <p className="type-body-md">見本に使える記事がありません。元のページのURLを持つ記事が届いてから試してください。</p>;
  }
  const article = (
    <p className="min-w-0 type-label-md">
      <span className="block">見本に使った記事：{preview.article.title}</span>
      <span className="block break-all type-label-sm text-on-surface-muted">{preview.article.url}</span>
    </p>
  );
  if (preview.status === "failed") {
    return (
      <div className="flex flex-col gap-xs">
        {article}
        <p className="type-body-md text-error">ページから本文を取り出せませんでした。{fullContentErrorLabel(preview.error)}</p>
      </div>
    );
  }
  const source = preview.matched
    ? "セレクターに当たる要素から本文を取り出しました。"
    : tried === null
      ? "セレクターが空のため、Readabilityで見つけた本文です。"
      : "セレクターに当たる要素がないため、Readabilityの結果に戻ります。";
  return (
    <div className="flex flex-col gap-xs">
      {article}
      <p className="type-body-md">{source}</p>
      <p className="type-label-sm tabular-nums text-on-surface-muted">
        本文は{preview.chars}文字です。{preview.chars > CONTENT_PREVIEW_CHARS ? `先頭の${CONTENT_PREVIEW_CHARS}文字を表示しています。` : ""}
      </p>
      {preview.shorter ? <p className="type-body-md text-error">配信された内容より短いため、全文としては使いません。</p> : null}
      <div
        role="region"
        aria-label="取り出した本文の先頭"
        className="max-h-[40vh] overflow-y-auto whitespace-pre-wrap break-words rounded-md border border-outline px-lg py-md type-body-md"
      >
        {preview.markdown}
      </div>
    </div>
  );
}

/**
 * The content selector of a feed: a field saved with the rest of the form, and a button that tries what is in
 * the field on the page of the feed's newest article. Trying stores nothing.
 */
export function ContentSelectorField({ feedId, value, onChange, error }: { feedId: number; value: string; onChange: (value: string) => void; error: unknown }) {
  const { api } = useApp();
  const [preview, setPreview] = useState<{ result: ContentPreview; tried: string | null } | null>(null);
  const [problem, setProblem] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  async function look() {
    const tried = contentSelectorOf(value);
    setBusy(true);
    setProblem(null);
    try {
      setPreview({ result: await api.contentPreview(feedId, tried), tried });
    } catch (caught) {
      setPreview(null);
      setProblem(caught);
    } finally {
      setBusy(false);
    }
  }

  const fieldProblem = contentSelectorError(problem ?? error);
  return (
    <div className="flex flex-col gap-sm">
      <Field
        label={LABEL}
        autoComplete="off"
        spellCheck={false}
        value={value}
        onChange={(event) => {
          onChange(event.target.value);
          setPreview(null);
          setProblem(null);
        }}
        hint="全文と要約の本文を、記事のページのどの要素から取り出すかをCSSセレクターで指定します。空のときと、ページに当たる要素がないときは、Readabilityで本文を見つけます。値を変えて保存すると、この購読フィードの未読の記事の全文を取得し直します。"
        error={fieldProblem}
      />
      <div>
        <Button onClick={() => void look()} disabled={busy}>
          {busy ? "見本を取得中…" : "本文の見本を見る"}
        </Button>
      </div>
      {problem && fieldProblem === null ? (
        <p role="alert" className="type-body-md text-error">
          {messageFor(problem)}
        </p>
      ) : null}
      {preview ? <PreviewResult preview={preview.result} tried={preview.tried} /> : null}
    </div>
  );
}
