import { Checkbox } from "../ui/controls.tsx";

/** The switch for summaries. What it costs and which articles it covers is said beside it, before it is chosen. */
export function AutoSummarize({ id, checked, onChange }: { id: string; checked: boolean; onChange: (checked: boolean) => void }) {
  return (
    <div className="flex flex-col gap-xs">
      <Checkbox label="自動で要約する" checked={checked} onChange={(event) => onChange(event.target.checked)} aria-describedby={id} />
      <p id={id} className="type-label-sm text-on-surface-muted">
        要約にはLLMを使います。これから届く記事だけを要約します。
      </p>
    </div>
  );
}

/** The switch for translation. That the articles leave this server is said beside it, before it is chosen. */
export function Translate({ id, checked, onChange }: { id: string; checked: boolean; onChange: (checked: boolean) => void }) {
  return (
    <div className="flex flex-col gap-xs">
      <Checkbox label="翻訳する" checked={checked} onChange={(event) => onChange(event.target.checked)} aria-describedby={id} />
      <p id={id} className="type-label-sm text-on-surface-muted">
        記事のタイトルと本文を、翻訳のためにGoogleまたは設定したLLMのサービスへ送ります。
      </p>
    </div>
  );
}

/**
 * The switch for full content. That the page of every article is fetched, and only for articles still to come,
 * is said beside it, before it is chosen.
 */
export function FetchFullContent({ id, checked, onChange, page = false }: { id: string; checked: boolean; onChange: (checked: boolean) => void; page?: boolean }) {
  return (
    <div className="flex flex-col gap-xs">
      <Checkbox label="全文を取得する" checked={checked} onChange={(event) => onChange(event.target.checked)} aria-describedby={id} />
      <p id={id} className="type-label-sm text-on-surface-muted">
        記事ごとに元のページを取得して、本文を保存します。これから届く記事だけが対象です。
        {/* A web feed takes only the title, the link and the date out of its page: without this, its articles have no text. */}
        {page ? "ページから得るのは記事のタイトル、リンク、日時だけです。本文は、全文の取得で得ます。" : ""}
      </p>
    </div>
  );
}
