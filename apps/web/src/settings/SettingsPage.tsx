import type { Category, Settings } from "@smarternews/core/api";
import { useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router";
import { ApiError } from "@smarternews/client";
import { useCategories, useProviders, useSettings, useTopics } from "../api/queries.ts";
import { useApp } from "../app/context.ts";
import { useToast } from "../shell/toast.tsx";
import { Badge, Button, ErrorNotice, Field, fieldError, Loading, messageFor } from "../ui/controls.tsx";
import { ConnectCode } from "./ConnectCode.tsx";

export const KIND_LABEL = { news: "ニュース", event: "イベント" } as const;
const TASK_LABEL = { interpret: "解釈", search: "検索", judge: "判定", cluster: "集約", write: "本文の生成" } as const;
const SECTION = "flex flex-col gap-md border-b border-outline px-lg py-xl md:px-2xl";

/** The reason the server gave for refusing a value, introduced in the app's own words. */
export function refusal(error: unknown, path: string): string | null {
  const reason = fieldError(error, path);
  return reason ? `この値は保存できません（${reason}）` : null;
}

function CategoryRow({ category }: { category: Category }) {
  const topics = useTopics(category.id).data;
  return (
    <li className="flex flex-wrap items-baseline gap-x-lg gap-y-xs border-b border-outline py-sm type-body-md">
      <Link to={`/settings/categories/${category.id}`} className="tap type-label-md text-primary underline underline-offset-4">
        {category.name}
      </Link>
      <span className="text-on-surface-muted">{KIND_LABEL[category.kind]}</span>
      <span className="tabular-nums text-on-surface-muted">{category.schedule.join(", ")}</span>
      <span className="text-on-surface-muted">トピック {topics?.length ?? "…"}</span>
      {category.enabled ? null : <Badge>無効</Badge>}
    </li>
  );
}

function Categories() {
  const { api } = useApp();
  const categories = useCategories();
  const client = useQueryClient();
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [kind, setKind] = useState<"news" | "event">("news");
  const [error, setError] = useState<unknown>(null);

  async function add(event: FormEvent) {
    event.preventDefault();
    try {
      const created = await api.createCategory({ name, kind });
      await client.invalidateQueries({ queryKey: ["categories"] });
      void client.invalidateQueries({ queryKey: ["counts"] });
      void navigate(`/settings/categories/${created.id}`);
    } catch (caught) {
      setError(caught);
    }
  }

  return (
    <section aria-label="カテゴリ" className={SECTION}>
      <h2 className="type-headline-md">カテゴリ</h2>
      {categories.isError ? <ErrorNotice error={categories.error} onRetry={() => void categories.refetch()} /> : null}
      {categories.data?.length === 0 ? (
        <p className="type-body-md text-on-surface-muted">カテゴリはまだありません。下の欄から追加してください。</p>
      ) : null}
      <ul className="max-w-measure">{categories.data?.map((category) => <CategoryRow key={category.id} category={category} />)}</ul>
      <form onSubmit={add} className="flex max-w-measure flex-col gap-md">
        <Field label="カテゴリの名前" value={name} onChange={(event) => setName(event.target.value)} error={refusal(error, "name")} />
        <fieldset className="flex flex-wrap gap-lg type-body-md">
          <legend className="pb-xs type-label-md">種別</legend>
          {(["news", "event"] as const).map((value) => (
            <label key={value} className="inline-flex cursor-pointer items-center gap-xs">
              <input type="radio" name="kind" className="accent-primary" checked={kind === value} onChange={() => setKind(value)} />
              {KIND_LABEL[value]}
            </label>
          ))}
        </fieldset>
        <p className="type-label-sm text-on-surface-muted">
          ニュースは直近に公開されたページを、イベントはこれから開催される催しを集めます。種別はあとから変えられません。
        </p>
        {error && !(error instanceof ApiError && error.kind === "invalid") ? <ErrorNotice error={error} /> : null}
        <div>
          <Button type="submit" variant="primary" disabled={name.trim().length === 0}>
            カテゴリを追加
          </Button>
        </div>
      </form>
    </section>
  );
}

function ReaderInfo({ settings }: { settings: Settings }) {
  const { api } = useApp();
  const client = useQueryClient();
  const toast = useToast();
  const [text, setText] = useState(settings.readerInfo);
  const [error, setError] = useState<unknown>(null);

  async function save(event: FormEvent) {
    event.preventDefault();
    try {
      client.setQueryData(["settings"], await api.updateSettings({ readerInfo: text }));
      setError(null);
      toast({ message: "読み手情報を保存しました" });
    } catch (caught) {
      setError(caught);
    }
  }

  return (
    <section aria-label="読み手情報" className={SECTION}>
      <h2 className="type-headline-md">読み手情報</h2>
      <form onSubmit={save} className="flex max-w-measure flex-col gap-md">
        <Field
          label="読み手情報"
          multiline
          value={text}
          onChange={(event) => setText(event.target.value)}
          error={refusal(error, "readerInfo")}
          hint="記事を読む人の仕事や関心を書きます。次の実行から、関連と重要度の判定に使われます。空にすると、記事に読み手への影響は付きません。"
        />
        {error && !(error instanceof ApiError && error.kind === "invalid") ? <ErrorNotice error={error} /> : null}
        <div>
          <Button type="submit" variant="primary">
            読み手情報を保存
          </Button>
        </div>
      </form>
    </section>
  );
}

function GlobalSettings({ settings }: { settings: Settings }) {
  const { api } = useApp();
  const client = useQueryClient();
  const toast = useToast();
  const [form, setForm] = useState({
    outputLanguage: settings.outputLanguage,
    timeZone: settings.timeZone,
    language: settings.search.language,
    region: settings.search.region,
  });
  const [error, setError] = useState<unknown>(null);
  const set = (name: keyof typeof form) => (event: { target: { value: string } }) => setForm({ ...form, [name]: event.target.value });

  async function save(event: FormEvent) {
    event.preventDefault();
    try {
      const saved = await api.updateSettings({
        outputLanguage: form.outputLanguage.trim(),
        timeZone: form.timeZone.trim(),
        search: { language: form.language.trim(), region: form.region.trim() },
      });
      client.setQueryData(["settings"], saved);
      setError(null);
      toast({ message: "全体設定を保存しました" });
    } catch (caught) {
      setError(caught);
    }
  }

  return (
    <section aria-label="全体設定" className={SECTION}>
      <h2 className="type-headline-md">全体設定</h2>
      <form onSubmit={save} className="grid max-w-measure grid-cols-1 gap-md sm:grid-cols-2">
        <Field
          label="出力言語"
          value={form.outputLanguage}
          onChange={set("outputLanguage")}
          error={refusal(error, "outputLanguage")}
          hint="記事を書く言語。ja や en のように書きます。"
        />
        <Field
          label="タイムゾーン"
          value={form.timeZone}
          onChange={set("timeZone")}
          error={refusal(error, "timeZone")}
          hint="実行時刻と日時の表示の基準。Asia/Tokyo のように書きます。"
        />
        <Field label="ニュース検索の言語" value={form.language} onChange={set("language")} error={refusal(error, "search.language")} />
        <Field
          label="ニュース検索の地域"
          value={form.region}
          onChange={set("region")}
          error={refusal(error, "search.region")}
          hint="JP や US のように、大文字2文字で書きます。"
        />
        {error && !(error instanceof ApiError && error.kind === "invalid") ? <ErrorNotice error={error} /> : null}
        <div className="sm:col-span-2">
          <Button type="submit" variant="primary">
            全体設定を保存
          </Button>
        </div>
      </form>
    </section>
  );
}

function SettingsFile() {
  const { api } = useApp();
  const client = useQueryClient();
  const [file, setFile] = useState<File | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);

  async function download() {
    try {
      const url = URL.createObjectURL(new Blob([await api.exportSettings()], { type: "application/yaml" }));
      const link = document.createElement("a");
      link.href = url;
      link.download = "smarternews-settings.yaml";
      link.click();
      URL.revokeObjectURL(url);
      setError(null);
    } catch (caught) {
      setError(caught);
    }
  }

  async function upload(event: FormEvent) {
    event.preventDefault();
    if (!file) return;
    setResult(null);
    try {
      const done = await api.importSettings(await file.text());
      setError(null);
      setResult(
        `カテゴリを${done.categoriesCreated}件作成、${done.categoriesUpdated}件更新。トピックを${done.topicsCreated}件作成、${done.topicsUpdated}件更新。`,
      );
      for (const key of ["categories", "topics", "settings", "counts", "feeds", "stop-words", "articles"]) void client.invalidateQueries({ queryKey: [key] });
    } catch (caught) {
      setError(caught);
    }
  }

  return (
    <section aria-label="設定ファイル" className={SECTION}>
      <h2 className="type-headline-md">設定ファイル</h2>
      <p className="max-w-measure type-body-md text-on-surface-muted">
        カテゴリ、トピック、購読フィード、ストップワード、読み手情報、全体設定を1つのYAMLファイルにします。控えや、別のサーバーへの移行に使えます。
      </p>
      <div>
        <Button onClick={() => void download()}>書き出す</Button>
      </div>
      <form onSubmit={upload} className="flex max-w-measure flex-col gap-sm">
        <label className="flex flex-col gap-xs type-label-md">
          読み込む設定ファイル
          <input
            type="file"
            accept=".yaml,.yml,application/yaml,text/yaml"
            className="type-body-md"
            onChange={(event) => setFile(event.target.files?.[0] ?? null)}
          />
        </label>
        <p className="type-label-sm text-on-surface-muted">
          識別名が一致するカテゴリ、文章が一致するトピック、URLが一致する購読フィードは更新し、ないものは作ります。ファイルに書かれていないカテゴリとトピックは消えません。購読フィードとストップワードも消えません。
        </p>
        <div>
          <Button type="submit" disabled={!file}>
            読み込む
          </Button>
        </div>
      </form>
      {result ? <p className="type-body-md">{result}</p> : null}
      {error ? (
        <div role="alert" className="max-w-measure rounded-md border border-error px-lg py-sm type-body-md text-error">
          <p>{error instanceof ApiError && error.kind === "invalid" ? "設定ファイルの形式が合わないため、何も変更していません。" : messageFor(error)}</p>
          {error instanceof ApiError ? (
            <ul className="list-disc pl-lg">
              {error.fields.map((field) => (
                <li key={field.path} className="break-words">
                  {field.path}: {field.message}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

function Providers() {
  const providers = useProviders();
  const status = providers.data;
  return (
    <section aria-label="プロバイダー" className={SECTION}>
      <h2 className="type-headline-md">プロバイダー</h2>
      {providers.isError ? <ErrorNotice error={providers.error} onRetry={() => void providers.refetch()} /> : null}
      {status ? (
        <>
          <p className="type-body-md">
            今日のLLMの呼び出し{" "}
            <span className="tabular-nums type-label-md">
              {status.llmCallsToday} / {status.limits.llmCallsPerDay}
            </span>
            <span className="pl-md text-on-surface-muted">1回の実行の上限 {status.limits.llmCallsPerRun}</span>
          </p>
          <div className="max-w-measure overflow-x-auto">
            <table className="w-full text-left type-body-md">
              <thead className="type-label-sm text-on-surface-muted">
                <tr>
                  <th className="py-xs pr-lg font-normal">名前</th>
                  <th className="py-xs pr-lg font-normal">アダプター</th>
                  <th className="py-xs pr-lg font-normal">モデル</th>
                  <th className="py-xs font-normal">Webの検索</th>
                </tr>
              </thead>
              <tbody>
                {status.providers.map((provider) => (
                  <tr key={provider.name} className="border-t border-outline">
                    <td className="py-xs pr-lg">{provider.name}</td>
                    <td className="py-xs pr-lg">{provider.adapter}</td>
                    <td className="py-xs pr-lg">{provider.model}</td>
                    <td className="py-xs">{provider.webSearch ? "できる" : "できない"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <dl className="grid max-w-measure grid-cols-[auto_1fr] gap-x-lg gap-y-xs type-body-md">
            {(Object.keys(TASK_LABEL) as Array<keyof typeof TASK_LABEL>).map((task) => (
              <div key={task} className="contents">
                <dt className="text-on-surface-muted">{TASK_LABEL[task]}</dt>
                <dd>{status.tasks[task]}</dd>
              </div>
            ))}
          </dl>
          <p className="max-w-measure type-label-sm text-on-surface-muted">
            プロバイダーと割り当ては、サーバーの <code>config.yaml</code> で変更します。この画面からは変更できません。
          </p>
        </>
      ) : null}
    </section>
  );
}

/** Everything that is configured rather than read: categories, the reader, global settings, the settings file. */
export function SettingsPage() {
  const { clearToken } = useApp();
  const settings = useSettings();
  return (
    <div className="h-full overflow-y-auto bg-surface">
      <header className="border-b border-outline px-lg py-md md:px-2xl">
        <h1 className="type-headline-md">設定</h1>
      </header>
      <Categories />
      <section aria-label="購読フィード" className={SECTION}>
        <h2 className="type-headline-md">購読フィード</h2>
        <p className="max-w-measure type-body-md text-on-surface-muted">
          RSSやAtomのフィードを登録すると、配信された記事をそのまま読めます。読みたくない記事は、ストップワードで隠せます。
        </p>
        <ul className="flex flex-col gap-xs type-body-md">
          <li>
            <Link to="/settings/feeds" className="tap text-primary underline underline-offset-4">
              購読フィードを設定する
            </Link>
          </li>
          <li>
            <Link to="/settings/stop-words" className="tap text-primary underline underline-offset-4">
              ストップワードを設定する
            </Link>
          </li>
        </ul>
      </section>
      {settings.isError ? <ErrorNotice error={settings.error} onRetry={() => void settings.refetch()} /> : null}
      {settings.data ? (
        <>
          <ReaderInfo settings={settings.data} />
          <GlobalSettings settings={settings.data} />
        </>
      ) : settings.isPending ? (
        <Loading />
      ) : null}
      <SettingsFile />
      <Providers />
      <section aria-label="トークン" className={SECTION}>
        <h2 className="type-headline-md">トークン</h2>
        <p className="max-w-measure type-body-md text-on-surface-muted">
          このブラウザーに保存したAPIのトークンを消します。次に開くとき、もう一度入力が必要になります。
        </p>
        <div>
          <Button onClick={clearToken}>このブラウザーからトークンを消す</Button>
        </div>
        <ConnectCode />
      </section>
    </div>
  );
}
