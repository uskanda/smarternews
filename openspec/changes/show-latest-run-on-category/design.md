# Design

## Context

カテゴリの画面は `apps/web/src/settings/CategoryPage.tsx` にある。
カテゴリの設定、トピック、トピックの成績（`TopicStats.tsx`）、実行、削除の5つの区画が1ページに並ぶ。
実行の区画の `RunNow` は、`useRuns(category.id)` でこのカテゴリの実行を新しい順に取り、待機中か実行中のものがあるかどうかだけを見ている。
`useRuns` は、待機中か実行中の実行がある間は3秒ごとに、ほかは1分ごとに取り直す。
設定の画面（`SettingsPage.tsx`）には、add-settings-shortcutsで足した区画のリンク `SectionLinks` がある。
また、アドレスの `#` の要素までスクロールする `useScrollToHash`（`apps/web/src/ui/useScrollToHash.ts`）がある。

## Goals / Non-Goals

**Goals:**

- 「いますぐ実行」の結果を、カテゴリの画面で確かめられるようにする。
- 実行の区画へ、スクロールせずに1回の操作で移れるようにする。

**Non-Goals:**

- APIや取得の処理を足すこと。いまの実行の一覧で足りる。
- 区画の並べ替え。issueはリンクで届かせる直し方を指定している。
- 実行の詳細（候補の数、LLMの呼び出し、金額など）をこの画面に出すこと。詳細はリンクの先で見る。

## Decisions

### 直近の実行は `useRuns` の先頭の1件

`useRuns(category.id)` の結果は新しい順なので、先頭の1件を出す。契機は問わない。行に契機を出すので、スケジュールの実行が先頭でも見分けられる。
実行中の間は3秒ごとに取り直すので、「いますぐ実行」のあとの状態の変化も、そのまま行に出る。

### 行の形は実行履歴の画面に合わせる

開始の日時は `formatFull(startedAt ?? queuedAt)` で書き、`/runs/:id` へのリンクにする。契機は `TRIGGER_LABEL`、状態は `STATUS_LABEL` を使う。
状態の色は実行履歴の画面と同じにする。失敗は `text-error`、一部失敗と上限で停止は `text-warning` である。
作った記事と更新した記事の数は、「作成」と「更新」の語に続けて件数で書く。
実行中であることを知らせる文と、「このカテゴリの実行履歴」のリンクは残す。

### 区画のリンク

見出しの下に `<nav aria-label="カテゴリの区画">` を置き、5つのリンクを並べる。
見た目は設定の画面の `SectionLinks` にそろえる。並びは `flex flex-wrap`、リンクは `tap text-primary underline underline-offset-4` にする。
各区画に `settings`、`topics`、`topic-stats`、`run`、`delete` のidを付ける。リンク先は `/settings/categories/:id#run` などにする。
トピックの行は `#topic-<id>` を使うので、区画のidとは重ならない。

### スクロールは読み込みのあと

`useScrollToHash` をカテゴリの画面でも使う。トピックとトピックの成績は、読み込むと縦に伸び、下の区画の位置を変える。
そこで、両方の読み込みが終わってからスクロールする。読み込みの失敗も、終わりとして扱う。

## Risks / Trade-offs

- ［実行の一覧の取得に失敗すると、行が出ない］→ 区画にエラーの知らせを出す。実行の操作はそのまま使える。
- ［手動の実行のすぐあとにスケジュールの実行が始まると、行がスケジュールの実行に変わる］→ 行に契機を出すので見分けられる。手動の実行は、実行履歴で見られる。
