import type { StopWord, StopWordScope } from "@smarternews/core/api";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { Link } from "react-router";
import { ApiError } from "@smarternews/client";
import { useApp } from "../app/context.ts";
import { useToast } from "../shell/toast.tsx";
import { Button, ErrorNotice, Field, Loading, messageFor } from "../ui/controls.tsx";

const SECTION = "flex flex-col gap-md border-b border-outline px-lg py-xl md:px-2xl";
const SCOPE_LABEL: Record<StopWordScope, string> = { title: "タイトルだけ", title_and_content: "タイトルと内容" };
const SCOPES: StopWordScope[] = ["title", "title_and_content"];

function useStopWords() {
  const { api } = useApp();
  return useQuery({ queryKey: ["stop-words"], queryFn: () => api.stopWords() });
}

function useRefresh() {
  const client = useQueryClient();
  // A stop word changes which articles the lists hold and what the counts say.
  return () => {
    for (const key of ["stop-words", "articles", "counts"]) void client.invalidateQueries({ queryKey: [key] });
  };
}

function AddStopWord() {
  const { api } = useApp();
  const refresh = useRefresh();
  const toast = useToast();
  const [text, setText] = useState("");
  const [scope, setScope] = useState<StopWordScope>("title");
  const [problem, setProblem] = useState<string | null>(null);

  async function add(event: FormEvent) {
    event.preventDefault();
    try {
      const word = await api.createStopWord({ text: text.trim(), scope });
      refresh();
      setText("");
      setProblem(null);
      toast({ message: `「${word.text}」を追加しました。${word.hiddenCount > 0 ? `${word.hiddenCount}件を隠しています。` : "いま隠している記事はありません。"}` });
    } catch (error) {
      setProblem(error instanceof ApiError && error.kind === "conflict" ? "この語はすでに登録しています。" : messageFor(error));
    }
  }

  return (
    <section aria-label="ストップワードの追加" className={SECTION}>
      <h2 className="type-headline-md">追加</h2>
      <form onSubmit={add} className="flex max-w-measure flex-col gap-md">
        <Field
          label="隠す語"
          value={text}
          onChange={(event) => {
            setText(event.target.value);
            setProblem(null);
          }}
          error={problem}
          hint="この語を含む記事を一覧から隠します。大文字と小文字、全角と半角は区別しません。"
        />
        <fieldset className="flex flex-wrap gap-lg type-body-md">
          <legend className="pb-xs type-label-md">照合の対象</legend>
          {SCOPES.map((value) => (
            <label key={value} className="inline-flex cursor-pointer items-center gap-xs">
              <input type="radio" name="stop-word-scope" className="accent-primary" checked={scope === value} onChange={() => setScope(value)} />
              {SCOPE_LABEL[value]}
            </label>
          ))}
        </fieldset>
        <p className="type-label-sm text-on-surface-muted">
          購読フィードの配信記事だけを隠します。AI生成の記事と、スターのある記事は隠しません。隠した記事は消えず、語を削除すると一覧に戻ります。
        </p>
        <div>
          <Button type="submit" variant="primary" disabled={text.trim().length === 0}>
            ストップワードを追加
          </Button>
        </div>
      </form>
    </section>
  );
}

function StopWordRow({ word }: { word: StopWord }) {
  const { api } = useApp();
  const refresh = useRefresh();
  const toast = useToast();

  async function changeScope(scope: StopWordScope) {
    try {
      const changed = await api.updateStopWord(word.id, { scope });
      refresh();
      toast({ message: `「${changed.text}」の対象を「${SCOPE_LABEL[changed.scope]}」にしました` });
    } catch (error) {
      toast({ message: messageFor(error) });
    }
  }

  async function remove() {
    try {
      const { restored } = await api.deleteStopWord(word.id);
      refresh();
      toast({ message: `「${word.text}」を削除しました。${restored > 0 ? `${restored}件が一覧に戻りました。` : ""}` });
    } catch {
      toast({ message: "削除できませんでした。もう一度試してください。" });
    }
  }

  return (
    <li className="flex flex-wrap items-center gap-x-lg gap-y-xs border-b border-outline py-sm type-body-md">
      <span className="type-label-md">{word.text}</span>
      <label className="inline-flex items-center gap-xs text-on-surface-muted">
        <span className="sr-only">{word.text}の照合の対象</span>
        <select
          value={word.scope}
          onChange={(event) => void changeScope(event.target.value as StopWordScope)}
          className="rounded-md border border-outline-strong bg-surface px-sm py-xs type-body-md text-on-surface"
        >
          {SCOPES.map((value) => (
            <option key={value} value={value}>
              {SCOPE_LABEL[value]}
            </option>
          ))}
        </select>
      </label>
      <span className="tabular-nums text-on-surface-muted">{word.hiddenCount > 0 ? `${word.hiddenCount}件を隠しています` : "隠している記事はありません"}</span>
      <Button aria-label={`${word.text}を削除`} onClick={() => void remove()}>
        削除
      </Button>
    </li>
  );
}

/** Words that hide the feed articles containing them. */
export function StopWordsPage() {
  const words = useStopWords();
  return (
    <div className="h-full overflow-y-auto bg-surface">
      <header className="flex flex-col gap-xs border-b border-outline px-lg py-md md:px-2xl">
        <Link to="/settings" className="tap type-body-md text-primary underline underline-offset-4">
          設定へ戻る
        </Link>
        <h1 className="type-headline-md">ストップワード</h1>
      </header>
      <AddStopWord />
      <section aria-label="ストップワードの一覧" className={SECTION}>
        <h2 className="type-headline-md">一覧</h2>
        {words.isError ? <ErrorNotice error={words.error} onRetry={() => void words.refetch()} /> : null}
        {words.isPending && !words.isError ? <Loading /> : null}
        {words.data?.length === 0 ? <p className="type-body-md text-on-surface-muted">ストップワードはまだありません。</p> : null}
        <ul className="max-w-measure-article">{words.data?.map((word) => <StopWordRow key={word.id} word={word} />)}</ul>
      </section>
    </div>
  );
}
