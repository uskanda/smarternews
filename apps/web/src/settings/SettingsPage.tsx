import {
  CATEGORY_NAME_MAX_CHARS,
  READER_INFO_MAX_CHARS,
  SCHEDULE_MAX_TIMES,
  STALE_FEED_DAYS_MAX,
  type Category,
  type ProviderStatus,
  type Settings,
  type TaskName,
  type Usage,
} from "@smarternews/core/api";
import { useQueryClient } from "@tanstack/react-query";
import { useId, useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router";
import {
  ApiError,
  budgetWarningLabel,
  checkRequired,
  checkText,
  checkTimes,
  checkWholeNumber,
  fieldMessage,
  formatUsd,
  periodDayLabel,
  projectionLabel,
  settingsFileProblem,
  TASK_LABEL,
  THEME_CHOICES,
  THEME_LABEL,
} from "@smarternews/client";
import { useCategories, useProviders, useSettings, useTopics, useUsage } from "../api/queries.ts";
import { useApp } from "../app/context.ts";
import { chooseHideRead, useHideRead } from "../lib/hide-read.ts";
import { chooseScrollRead, useScrollRead } from "../lib/scroll-read.ts";
import { chooseTheme, useThemeChoice } from "../lib/theme.ts";
import { useToast } from "../shell/toast.tsx";
import { ConfirmDialog } from "../ui/ConfirmDialog.tsx";
import { Badge, Button, Checkbox, ErrorNotice, Field, Loading, messageFor } from "../ui/controls.tsx";
import { useScrollToHash } from "../ui/useScrollToHash.ts";
import { LANGUAGE_FORMAT_HINT, problemsOf, REGION_FORMAT_HINT, TIME_FORMAT_HINT, type Problems } from "./checks.ts";
import { ConnectCode } from "./ConnectCode.tsx";
import { UnsavedGuard, useUnsaved, useUnsavedLeaving } from "./unsaved.tsx";

export const KIND_LABEL = { news: "ニュース", event: "イベント" } as const;
const SECTION = "flex flex-col gap-md border-b border-outline px-lg py-xl md:px-2xl";

/** The times written in a field, separated by commas, 、 or spaces. */
function timesOf(text: string): string[] {
  return text.split(/[\s,、]+/).filter((time) => time.length > 0);
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
  const [problem, setProblem] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const leave = useUnsavedLeaving();
  useUnsaved("新しいカテゴリの名前", name.trim() !== "");

  async function add(event: FormEvent) {
    event.preventDefault();
    const found = checkText(name, { label: "カテゴリの名前", max: CATEGORY_NAME_MAX_CHARS });
    setProblem(found);
    if (found !== null) return;
    try {
      const created = await api.createCategory({ name, kind });
      await client.invalidateQueries({ queryKey: ["categories"] });
      void client.invalidateQueries({ queryKey: ["counts"] });
      // The name is saved now, in the category this opens.
      leave();
      void navigate(`/settings/categories/${created.id}`);
    } catch (caught) {
      setError(caught);
    }
  }

  return (
    <section id="categories" aria-label="カテゴリ" className={SECTION}>
      <h2 className="type-headline-md">カテゴリ</h2>
      {categories.isError ? <ErrorNotice error={categories.error} onRetry={() => void categories.refetch()} /> : null}
      {categories.data?.length === 0 ? (
        <p className="type-body-md text-on-surface-muted">カテゴリはまだありません。下の欄から追加してください。</p>
      ) : null}
      <ul className="max-w-measure">{categories.data?.map((category) => <CategoryRow key={category.id} category={category} />)}</ul>
      <form noValidate onSubmit={add} className="flex max-w-measure flex-col gap-md">
        <Field
          label="カテゴリの名前"
          value={name}
          onChange={(event) => {
            setName(event.target.value);
            setProblem(null);
          }}
          error={problem ?? fieldMessage(error, "name", "カテゴリの名前")}
        />
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
          <Button type="submit" disabled={name.trim().length === 0}>
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
  const [problem, setProblem] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  useUnsaved("読み手情報", text !== settings.readerInfo);

  async function save(event: FormEvent) {
    event.preventDefault();
    const found = checkText(text, { label: "読み手情報", max: READER_INFO_MAX_CHARS, required: false });
    setProblem(found);
    if (found !== null) return;
    try {
      client.setQueryData(["settings"], await api.updateSettings({ readerInfo: text }));
      setError(null);
      toast({ message: "読み手情報を保存しました" });
    } catch (caught) {
      setError(caught);
    }
  }

  return (
    <section id="reader" aria-label="読み手情報" className={SECTION}>
      <h2 className="type-headline-md">読み手情報</h2>
      <form noValidate onSubmit={save} className="flex max-w-measure flex-col gap-md">
        <Field
          label="読み手情報"
          multiline
          value={text}
          onChange={(event) => {
            setText(event.target.value);
            setProblem(null);
          }}
          error={problem ?? fieldMessage(error, "readerInfo", "読み手情報")}
          hint="記事を読む人の仕事や関心を書きます。次の実行から、関連と重要度の判定に使われます。空にすると、記事に読み手への影響は付きません。"
        />
        {error && !(error instanceof ApiError && error.kind === "invalid") ? <ErrorNotice error={error} /> : null}
        <div>
          <Button type="submit">
            保存する
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
    digestSchedule: settings.digestSchedule.join(", "),
  });
  const [advance, setAdvance] = useState(settings.advanceAfterMarkAll);
  const [removeDuplicates, setRemoveDuplicates] = useState(settings.removeDuplicates);
  const duplicatesHint = useId();
  const [staleDays, setStaleDays] = useState(String(settings.staleFeedDays));
  const [problems, setProblems] = useState<Problems>({});
  const [error, setError] = useState<unknown>(null);
  const set = (name: keyof typeof form) => (event: { target: { value: string } }) => {
    setForm({ ...form, [name]: event.target.value });
    setProblems((shown) => ({ ...shown, [name]: undefined }));
  };
  // Compared the way they are saved, so that nothing is left to ask about once they are.
  useUnsaved(
    "全体設定",
    form.outputLanguage.trim() !== settings.outputLanguage ||
      form.timeZone.trim() !== settings.timeZone ||
      form.language.trim() !== settings.search.language ||
      form.region.trim() !== settings.search.region ||
      timesOf(form.digestSchedule).join(",") !== settings.digestSchedule.join(",") ||
      advance !== settings.advanceAfterMarkAll ||
      removeDuplicates !== settings.removeDuplicates ||
      staleDays.trim() !== String(settings.staleFeedDays),
  );

  async function save(event: FormEvent) {
    event.preventDefault();
    const stale = checkWholeNumber(staleDays, { label: "更新が止まったとみなす日数", min: 1, max: STALE_FEED_DAYS_MAX });
    const digestTimes = checkTimes(form.digestSchedule, { label: "ダイジェストを作る時刻", max: SCHEDULE_MAX_TIMES, formatHint: TIME_FORMAT_HINT });
    const found = problemsOf({
      outputLanguage: checkRequired(form.outputLanguage, "出力言語"),
      timeZone: checkRequired(form.timeZone, "タイムゾーン"),
      language: checkRequired(form.language, "ニュース検索の言語"),
      region: checkRequired(form.region, "ニュース検索の地域"),
      digestSchedule: digestTimes.ok ? null : digestTimes.message,
      staleDays: stale.ok ? null : stale.message,
    });
    setProblems(found ?? {});
    if (found !== null || !stale.ok || !digestTimes.ok) return;
    try {
      const saved = await api.updateSettings({
        outputLanguage: form.outputLanguage.trim(),
        timeZone: form.timeZone.trim(),
        search: { language: form.language.trim(), region: form.region.trim() },
        advanceAfterMarkAll: advance,
        removeDuplicates,
        staleFeedDays: stale.value,
        digestSchedule: digestTimes.value,
      });
      client.setQueryData(["settings"], saved);
      // The server puts the times in order and drops the same time given twice.
      setForm((shown) => ({ ...shown, digestSchedule: saved.digestSchedule.join(", ") }));
      // Which feeds are stale follows the days at once.
      void client.invalidateQueries({ queryKey: ["feeds"] });
      setError(null);
      toast({ message: "全体設定を保存しました" });
    } catch (caught) {
      setError(caught);
    }
  }

  return (
    <section id="global" aria-label="全体設定" className={SECTION}>
      <h2 className="type-headline-md">全体設定</h2>
      <form noValidate onSubmit={save} className="grid max-w-measure grid-cols-1 gap-md sm:grid-cols-2">
        <Field
          label="出力言語"
          value={form.outputLanguage}
          onChange={set("outputLanguage")}
          error={problems.outputLanguage ?? fieldMessage(error, "outputLanguage", { label: "出力言語", formatHint: LANGUAGE_FORMAT_HINT })}
          hint="記事を書く言語。ja や en のように書きます。"
        />
        <Field
          label="タイムゾーン"
          value={form.timeZone}
          onChange={set("timeZone")}
          error={problems.timeZone ?? fieldMessage(error, "timeZone", "タイムゾーン")}
          hint="実行時刻と日時の表示の基準。Asia/Tokyo のように書きます。"
        />
        <Field
          label="ニュース検索の言語"
          value={form.language}
          onChange={set("language")}
          error={problems.language ?? fieldMessage(error, "search.language", { label: "ニュース検索の言語", formatHint: LANGUAGE_FORMAT_HINT })}
        />
        <Field
          label="ニュース検索の地域"
          value={form.region}
          onChange={set("region")}
          error={problems.region ?? fieldMessage(error, "search.region", { label: "ニュース検索の地域", formatHint: REGION_FORMAT_HINT })}
          hint="JP や US のように、大文字2文字で書きます。"
        />
        <div className="sm:col-span-2">
          <Field
            label="ダイジェストを作る時刻"
            value={form.digestSchedule}
            onChange={set("digestSchedule")}
            error={
              problems.digestSchedule ??
              fieldMessage(error, "digestSchedule", { label: "ダイジェストを作る時刻", formatHint: TIME_FORMAT_HINT })
            }
            hint="24時間表記の時刻を、コンマで区切って並べます。例は 07:00, 19:00。タイムゾーンの時刻で作ります。空にすると、時刻では作らず、ダイジェストの画面の「今すぐ作る」でだけ作ります。"
          />
        </div>
        <div className="sm:col-span-2">
          <Checkbox
            label="「すべて既読にする」のあと、未読のある次の項目へ移る"
            checked={advance}
            onChange={(event) => setAdvance(event.target.checked)}
          />
        </div>
        <div className="flex flex-col gap-xs sm:col-span-2">
          <Checkbox
            label="ほかの購読フィードが先に配信した記事を、全体とカテゴリの一覧に出さない"
            checked={removeDuplicates}
            aria-describedby={duplicatesHint}
            onChange={(event) => setRemoveDuplicates(event.target.checked)}
          />
          <p id={duplicatesHint} className="type-label-sm text-on-surface-muted">
            7日以内に同じURLか同じタイトルで届いた記事を、先に届いた1件にまとめます。まとめた記事も、それぞれの購読フィードの一覧には出ます。
          </p>
        </div>
        <div className="sm:col-span-2">
          <Field
            label="更新が止まったとみなす日数"
            type="number"
            inputMode="numeric"
            min={1}
            max={STALE_FEED_DAYS_MAX}
            value={staleDays}
            onChange={(event) => {
              setStaleDays(event.target.value);
              setProblems((shown) => ({ ...shown, staleDays: undefined }));
            }}
            error={problems.staleDays ?? fieldMessage(error, "staleFeedDays", { label: "更新が止まったとみなす日数", min: 1, max: STALE_FEED_DAYS_MAX })}
            hint={`新しい記事がこの日数届いていない購読フィードに、購読フィードの一覧で印を付けます。取得は続けます。1から${STALE_FEED_DAYS_MAX}まで。`}
          />
        </div>
        {error && !(error instanceof ApiError && error.kind === "invalid") ? <ErrorNotice error={error} /> : null}
        <div className="sm:col-span-2">
          <Button type="submit">
            保存する
          </Button>
        </div>
      </form>
    </section>
  );
}

/**
 * What this browser keeps for itself: the colour scheme, whether the list marks read what is scrolled past, and
 * whether the left pane hides the entries without unread articles. A change takes effect at once: none of them
 * is part of the settings on the server.
 */
function DeviceSettings() {
  const choice = useThemeChoice();
  const scrollRead = useScrollRead();
  const hideRead = useHideRead();
  const id = useId();
  return (
    <section id="device" aria-labelledby={`${id}-title`} className={SECTION}>
      <h2 id={`${id}-title`} className="type-headline-md">
        この端末の設定
      </h2>
      <p id={`${id}-hint`} className="max-w-measure type-body-md text-on-surface-muted">
        この区画の設定は、このブラウザーだけに保存し、サーバーには送りません。
      </p>
      <div className="flex flex-col gap-xs">
        <span id={`${id}-theme`} className="type-label-md">
          配色
        </span>
        <div
          role="radiogroup"
          aria-labelledby={`${id}-theme`}
          aria-describedby={`${id}-theme-hint ${id}-hint`}
          className="flex flex-wrap gap-x-lg gap-y-xs type-body-md"
        >
          {THEME_CHOICES.map((value) => (
            <label key={value} className="inline-flex cursor-pointer items-center gap-xs">
              <input type="radio" name="theme" className="accent-primary" checked={choice === value} onChange={() => chooseTheme(value)} />
              {THEME_LABEL[value]}
            </label>
          ))}
        </div>
        <p id={`${id}-theme-hint`} className="max-w-measure type-label-sm text-on-surface-muted">
          「端末に従う」は、端末が暗い配色のとき「ダークブルー」で表示します。
        </p>
      </div>
      <div className="flex flex-col gap-xs">
        <Checkbox
          label="スクロールした記事を既読にする"
          checked={scrollRead}
          aria-describedby={`${id}-scroll-hint`}
          onChange={(event) => chooseScrollRead(event.target.checked)}
        />
        <p id={`${id}-scroll-hint`} className="max-w-measure type-label-sm text-on-surface-muted">
          記事の一覧を送ったとき、一覧の上端を越えた記事を既読にします。最近読んだ記事、検索の結果、イベントの一覧は対象にしません。
        </p>
      </div>
      <div className="flex flex-col gap-xs">
        <Checkbox
          label="未読のない項目を左のペインで隠す"
          checked={hideRead}
          aria-describedby={`${id}-hide-read-hint`}
          onChange={(event) => chooseHideRead(event.target.checked)}
        />
        <p id={`${id}-hide-read-hint`} className="max-w-measure type-label-sm text-on-surface-muted">
          未読が0のカテゴリと購読フィードを、左のペインに出しません。開いている項目と、取得に問題のある購読フィードは出します。Shift+JとShift+Kも、隠した項目を通りません。
        </p>
      </div>
    </section>
  );
}

function SettingsFile() {
  const { api } = useApp();
  const client = useQueryClient();
  const [file, setFile] = useState<File | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [confirming, setConfirming] = useState(false);

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

  function ask(event: FormEvent) {
    event.preventDefault();
    if (file) setConfirming(true);
  }

  async function upload() {
    setConfirming(false);
    if (!file) return;
    setResult(null);
    try {
      const done = await api.importSettings(await file.text());
      setError(null);
      setResult(
        `カテゴリを${done.categoriesCreated}件作成、${done.categoriesUpdated}件更新。トピックを${done.topicsCreated}件作成、${done.topicsUpdated}件更新。` +
          `語のまとまりを${done.termGroupsCreated}件作成、語を${done.highlightTermsCreated}件追加。`,
      );
      for (const key of ["categories", "topics", "settings", "counts", "feeds", "filters", "articles", "term-groups"]) void client.invalidateQueries({ queryKey: [key] });
    } catch (caught) {
      setError(caught);
    }
  }

  return (
    <section id="settings-file" aria-label="設定ファイル" className={SECTION}>
      <h2 className="type-headline-md">設定ファイル</h2>
      <p className="max-w-measure type-body-md text-on-surface-muted">
        カテゴリ、トピック、購読フィード、フィルター、語の色付け、読み手情報、全体設定を1つのYAMLファイルにします。控えや、別のサーバーへの移行に使えます。
      </p>
      <div>
        <Button onClick={() => void download()}>書き出す</Button>
      </div>
      <form noValidate onSubmit={ask} className="flex max-w-measure flex-col gap-sm">
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
          識別名が一致するカテゴリ、文章が一致するトピック、URLが一致する購読フィードは更新し、ないものは作ります。ファイルに書かれていないカテゴリとトピックは消えません。購読フィードとフィルターも消えません。語の色付けは、名前が一致するまとまりの色を変え、ない語だけを足します。ファイルにないまとまりと語は消えません。以前のストップワードの形式のファイルも読み込め、各語は全体の隠すフィルターになります。カテゴリと購読フィードは、ファイルに書かれた順に並びます。
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
                  {settingsFileProblem(field)}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
      <ConfirmDialog
        open={confirming}
        title="設定ファイルを読み込みますか"
        onDismiss={() => setConfirming(false)}
        actions={
          <>
            <Button variant="primary" onClick={() => void upload()}>
              読み込む
            </Button>
            <Button onClick={() => setConfirming(false)}>やめる</Button>
          </>
        }
      >
        <p className="break-all">ファイル：{file?.name}</p>
        <ul className="list-disc pl-lg">
          <li>一致するカテゴリ、トピック、購読フィードを更新します。</li>
          <li>ファイルにある読み手情報と全体設定を上書きします。</li>
        </ul>
        <p>読み込みは元に戻せません。先に「書き出す」で控えを取れます。</p>
      </ConfirmDialog>
    </section>
  );
}

/** What the budget period spent, against the monthly budget, with the warning once it passes the warning share. */
function Budget({ status }: { status: ProviderStatus }) {
  const { budget } = status;
  const warning = budgetWarningLabel(budget);
  const billable = status.providers.some((provider) => provider.billable);
  return (
    <div role="group" aria-label="月の予算" className="flex max-w-measure flex-col gap-sm">
      <h3 className="type-label-md">月の予算</h3>
      <p className="type-body-md">
        {periodDayLabel(budget.periodStart)}から{periodDayLabel(budget.periodEnd)}まで（UTC）{" "}
        <span className="tabular-nums type-label-md">
          {formatUsd(budget.spentUsd)} / {formatUsd(budget.monthlyBudgetUsd)}
        </span>
        <span className="pl-md text-on-surface-muted">警告は{Math.round(budget.warnRatio * 100)}%から</span>
      </p>
      {warning ? (
        <p role="status" aria-label="予算の警告" className="rounded-md border border-warning px-lg py-sm type-body-md text-warning">
          {warning}
        </p>
      ) : null}
      {budget.unknownCostCalls > 0 ? (
        <p className="type-label-sm text-on-surface-muted">
          金額のわからない呼び出しが{budget.unknownCostCalls}件あります。時間切れなどで応答が届かなかった呼び出しで、その分だけ、合計は実際より少ないことがあります。
        </p>
      ) : null}
      <p className="type-label-sm text-on-surface-muted">
        {billable
          ? "金額は、APIが返したトークン数とモデルの単価からサーバーが計算した見込みです。請求の額とは一致しないことがあります。"
          : "金額のかかるプロバイダー（アダプターが anthropic のもの）はありません。月の予算には、その呼び出しだけを数えます。"}
      </p>
    </div>
  );
}

function Providers() {
  const providers = useProviders();
  const status = providers.data;
  return (
    <section id="providers" aria-label="プロバイダー" className={SECTION}>
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
          <Budget status={status} />
          <div className="max-w-measure overflow-x-auto">
            <table aria-label="プロバイダーの一覧" className="w-full text-left type-body-md">
              <thead className="type-label-sm text-on-surface-muted">
                <tr>
                  <th className="py-xs pr-lg font-normal">名前</th>
                  <th className="py-xs pr-lg font-normal">アダプター</th>
                  <th className="py-xs pr-lg font-normal">モデル</th>
                  <th className="py-xs pr-lg font-normal">Webの検索</th>
                  <th className="py-xs text-right font-normal">期間の金額</th>
                </tr>
              </thead>
              <tbody>
                {status.providers.map((provider) => (
                  <tr key={provider.name} className="border-t border-outline">
                    <td className="py-xs pr-lg">{provider.name}</td>
                    <td className="py-xs pr-lg">{provider.adapter}</td>
                    <td className="py-xs pr-lg">{provider.model}</td>
                    <td className="py-xs pr-lg">{provider.webSearch ? "できる" : "できない"}</td>
                    <td className="py-xs text-right tabular-nums">
                      {provider.billable ? formatUsd(status.budget.byProvider[provider.name] ?? 0) : "かからない"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="max-w-measure overflow-x-auto">
            <table aria-label="タスクの割り当てと金額" className="w-full text-left type-body-md">
              <thead className="type-label-sm text-on-surface-muted">
                <tr>
                  <th className="py-xs pr-lg font-normal">タスク</th>
                  <th className="py-xs pr-lg font-normal">プロバイダー</th>
                  <th className="py-xs text-right font-normal">期間の金額</th>
                </tr>
              </thead>
              <tbody>
                {(Object.keys(TASK_LABEL) as TaskName[]).map((task) => (
                  <tr key={task} className="border-t border-outline">
                    <th scope="row" className="py-xs pr-lg text-left font-normal text-on-surface-muted">
                      {TASK_LABEL[task]}
                    </th>
                    <td className="py-xs pr-lg">{status.tasks[task]}</td>
                    <td className="py-xs text-right tabular-nums">{formatUsd(status.budget.byTask[task] ?? 0)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="max-w-measure type-label-sm text-on-surface-muted">
            プロバイダー、割り当て、月の予算は、サーバーの <code>config.yaml</code> で変更します。この画面からは変更できません。
          </p>
        </>
      ) : null}
    </section>
  );
}

/** Money in a cell of the usage tables, or that it costs nothing when no provider does. */
function usageCost(usage: Usage, costUsd: number): string {
  return usage.billable ? formatUsd(costUsd) : "かからない";
}

const CELL = "py-xs pr-lg text-right tabular-nums";
const HEAD = "py-xs pr-lg text-right font-normal whitespace-nowrap";

/** The money and calls of each category, with what its articles were worth to the reader, and the calls outside runs last. */
function UsageByCategory({ usage }: { usage: Usage }) {
  const { outsideRuns } = usage;
  return (
    <div className="max-w-measure overflow-x-auto">
      <table aria-label="カテゴリごとの利用量" className="w-full text-left type-body-md">
        <thead className="type-label-sm text-on-surface-muted">
          <tr>
            <th className="py-xs pr-lg font-normal">カテゴリ</th>
            <th className={HEAD}>回数</th>
            <th className={HEAD}>金額</th>
            <th className={HEAD}>作った記事</th>
            <th className={HEAD}>開いた記事</th>
            <th className="py-xs text-right font-normal whitespace-nowrap">1件あたり</th>
          </tr>
        </thead>
        <tbody>
          {usage.byCategory.map((row) => (
            <tr key={row.categoryId} className="border-t border-outline">
              <th scope="row" className="py-xs pr-lg text-left font-normal">
                {row.name}
              </th>
              <td className={CELL}>{row.calls}</td>
              <td className={CELL}>{usageCost(usage, row.costUsd)}</td>
              <td className={CELL}>{row.articlesCreated}</td>
              <td className={CELL}>{row.articlesOpened}</td>
              <td className="py-xs text-right tabular-nums">
                {usage.billable ? (row.costPerOpenedUsd === null ? "—" : formatUsd(row.costPerOpenedUsd)) : "かからない"}
              </td>
            </tr>
          ))}
          <tr className="border-t border-outline">
            <th scope="row" className="py-xs pr-lg text-left font-normal text-on-surface-muted">
              実行に属さない呼び出し
            </th>
            <td className={CELL}>{outsideRuns.calls}</td>
            <td className={CELL}>{usageCost(usage, outsideRuns.costUsd)}</td>
            <td className={CELL} />
            <td className={CELL} />
            <td className="py-xs" />
          </tr>
        </tbody>
      </table>
    </div>
  );
}

/** The money and calls of each UTC day of the period, with a bar that lets the busy days stand out. */
function UsageByDay({ usage }: { usage: Usage }) {
  // Without a provider that costs money, the bars follow the calls.
  const measure = (day: Usage["byDay"][number]) => (usage.billable ? day.costUsd : day.calls);
  const most = Math.max(0, ...usage.byDay.map(measure));
  return (
    <div className="max-w-measure overflow-x-auto">
      <table aria-label="日ごとの利用量" className="w-full text-left type-body-md">
        <thead className="type-label-sm text-on-surface-muted">
          <tr>
            <th className="py-xs pr-lg font-normal whitespace-nowrap">日（UTC）</th>
            <th colSpan={2} className="py-xs pr-lg font-normal">
              金額
            </th>
            <th className="py-xs text-right font-normal whitespace-nowrap">回数</th>
          </tr>
        </thead>
        <tbody>
          {usage.byDay.map((day) => (
            <tr key={day.day} className="border-t border-outline">
              <th scope="row" className="py-xs pr-lg text-left font-normal whitespace-nowrap tabular-nums">
                {periodDayLabel(day.day)}
              </th>
              <td className="py-xs pr-sm text-right whitespace-nowrap tabular-nums">{usageCost(usage, day.costUsd)}</td>
              <td className="w-full py-xs pr-lg align-middle">
                <div
                  aria-hidden="true"
                  className="h-sm rounded-sm bg-outline-strong"
                  style={{ width: `${most > 0 ? Math.round((measure(day) / most) * 100) : 0}%` }}
                />
              </td>
              <td className="py-xs text-right tabular-nums">{day.calls}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** The model calls of the budget period by category and by day, and where the money is heading. */
function UsageSection() {
  const usage = useUsage();
  const data = usage.data;
  return (
    <section id="usage" aria-label="利用量" className={SECTION}>
      <h2 className="type-headline-md">利用量</h2>
      {usage.isError ? <ErrorNotice error={usage.error} onRetry={() => void usage.refetch()} /> : null}
      {data ? (
        <>
          <p className="max-w-measure type-body-md">
            予算の期間の{periodDayLabel(data.periodStart)}から今日まで（UTC）のLLMの呼び出しです。
            {data.billable ? null : "金額のかかるプロバイダーはないので、回数で示します。"}
          </p>
          {data.billable ? (
            <p className="max-w-measure type-body-md">
              {projectionLabel(data)}
              <span className="text-on-surface-muted">見込みの額で、請求の額とは一致しないことがあります。</span>
            </p>
          ) : null}
          <h3 className="type-label-md">カテゴリごと</h3>
          <UsageByCategory usage={data} />
          <p className="max-w-measure type-label-sm text-on-surface-muted">
            作った記事と開いた記事は、期間の中で作った生成記事の数です。1件あたりは、開いた記事1件あたりの金額です。実行に属さない呼び出しは、要約、翻訳、セレクターの提案、ダイジェストと、実行の記録が30日を過ぎて消えた呼び出しです。
          </p>
          <h3 className="type-label-md">日ごと</h3>
          <UsageByDay usage={data} />
        </>
      ) : usage.isPending ? (
        <Loading />
      ) : null}
    </section>
  );
}

/** The sections of the page, in their order, as the links at the top name them. */
const SECTIONS = [
  { id: "categories", name: "カテゴリ" },
  { id: "feeds", name: "購読フィード" },
  { id: "term-highlights", name: "語の色付け" },
  { id: "reader", name: "読み手情報" },
  { id: "global", name: "全体設定" },
  { id: "device", name: "この端末の設定" },
  { id: "settings-file", name: "設定ファイル" },
  { id: "providers", name: "プロバイダー" },
  { id: "usage", name: "利用量" },
  { id: "tokens", name: "トークン" },
] as const;

/** Links to every section, wrapping onto more lines when the width runs out, and scrolling away with the page. */
function SectionLinks() {
  return (
    <nav aria-label="設定の区画">
      <ul className="flex flex-wrap gap-x-lg gap-y-xs type-body-md">
        {SECTIONS.map((section) => (
          <li key={section.id}>
            <Link to={`/settings#${section.id}`} className="tap text-primary underline underline-offset-4">
              {section.name}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}

/** Everything that is configured rather than read: categories, the reader, global settings, the settings file. */
export function SettingsPage() {
  return (
    <UnsavedGuard>
      <SettingsSections />
    </UnsavedGuard>
  );
}

function SettingsSections() {
  const { clearToken } = useApp();
  const settings = useSettings();
  const providers = useProviders();
  const usage = useUsage();
  // The reader and the global settings appear only once the settings are in, and the sections of the providers and
  // of the usage grow when theirs are, so the page scrolls to the section the address names after all of them.
  useScrollToHash(!settings.isPending && !providers.isPending && !usage.isPending);
  const [clearing, setClearing] = useState(false);
  return (
    <div className="h-full overflow-y-auto bg-surface">
      <header className="flex flex-col gap-md border-b border-outline px-lg py-md md:px-2xl">
        <h1 className="type-headline-md">設定</h1>
        <SectionLinks />
      </header>
      <Categories />
      <section id="feeds" aria-label="購読フィード" className={SECTION}>
        <h2 className="type-headline-md">購読フィード</h2>
        <p className="max-w-measure type-body-md text-on-surface-muted">
          RSSやAtomのフィードを登録すると、配信された記事をそのまま読めます。読みたくない記事は、フィルターで隠せます。
        </p>
        <ul className="flex flex-col gap-xs type-body-md">
          <li>
            <Link to="/settings/feeds" className="tap text-primary underline underline-offset-4">
              購読フィードを設定する
            </Link>
          </li>
          <li>
            <Link to="/settings/filters" className="tap text-primary underline underline-offset-4">
              フィルターを設定する
            </Link>
          </li>
        </ul>
      </section>
      <section id="term-highlights" aria-label="語の色付け" className={SECTION}>
        <h2 className="type-headline-md">語の色付け</h2>
        <p className="max-w-measure type-body-md text-on-surface-muted">
          登録した語を、生成記事と配信記事の両方の一覧と本文で色付けします。語はまとまりに分け、まとまりごとに色を選びます。色付けは記事を隠しません。
        </p>
        <div>
          <Link to="/settings/term-highlights" className="tap type-body-md text-primary underline underline-offset-4">
            語の色付けを設定する
          </Link>
        </div>
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
      <DeviceSettings />
      <SettingsFile />
      <Providers />
      <UsageSection />
      <section id="tokens" aria-label="トークン" className={SECTION}>
        <h2 className="type-headline-md">トークン</h2>
        <p className="max-w-measure type-body-md text-on-surface-muted">
          このブラウザーに保存したAPIのトークンを消します。次に開くとき、もう一度入力が必要になります。
        </p>
        <div>
          <Button onClick={() => setClearing(true)}>このブラウザーからトークンを消す</Button>
        </div>
        <ConfirmDialog
          open={clearing}
          title="トークンを消しますか"
          onDismiss={() => setClearing(false)}
          actions={
            <>
              <Button variant="danger" onClick={clearToken}>
                消す
              </Button>
              <Button onClick={() => setClearing(false)}>やめる</Button>
            </>
          }
        >
          <p>このブラウザーに保存したトークンを消します。次に開くとき、サーバーで表示したトークンをもう一度入力する必要があります。</p>
        </ConfirmDialog>
        <ConnectCode />
      </section>
    </div>
  );
}
