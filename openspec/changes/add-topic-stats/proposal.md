# Proposal

## Why

購読フィードには直近30日の統計があるが、トピックには実行1回分の除外のまとめしかない。どのトピックが外れを多く生み、どの段階で候補を除外しているかを、数字で確かめる手段がない。#137で外れの印が残るようになったので、トピックの当たり外れを数えられるようになった。

## What Changes

- プログラムが候補を除外したとき、理由の文とともに理由の種類も保存する。種類は `no-date`、`below-minimum`、`over-limit`、`event-outside-window`、`event-no-date` の5つである。
- 判定（モデル）による除外は、理由の種類を持たない。移行のときに、今ある候補の理由の文から種類を埋める。
- `GET /api/v1/categories/:id/topic-stats` を足す。カテゴリのトピックごとに、直近30日の成績を返す。LLMは呼ばない。
- 成績の数は、集めた候補（全体と取得元ごと）と、理由の種類ごとの除外である。作った記事、更新した記事、開いた記事、スター、外れ、よく除外されるサイトの上位3つも返す。
- Webのカテゴリの画面に「トピックの成績」の区画を、トピックの区画のすぐ後に置く。「問題のあるトピックを先頭へ」の切り替えと、各行からトピックの編集へのリンクを置く。
- 実行の詳細の「トピックごとにまとめる」の見出しごとに、成績の行へのリンクを足す。

## Capabilities

### New Capabilities

なし。

### Modified Capabilities

- `article-pipeline`: 除外の記録に、プログラムが付けた理由の種類を残す。
- `http-api`: トピックの成績のAPIを足す。
- `web-settings`: カテゴリの画面にトピックの成績の区画を足す。
- `web-runs`: トピックごとのまとめの見出しに、成績へのリンクを足す。

## Impact

- `packages/core` の移行：`028_candidate_reason_code.sql` を足す
- `packages/core` の処理：`pipeline/reasons.ts`、`pipeline/run.ts`、`db/candidates.ts` を変え、`db/topicStats.ts` を足す
- `packages/core` の型：`api.ts` に成績のスキーマと並べ方の関数を足す
- `packages/core` の移行の番号：#164の出典の理由の移行を `026_ref_reasons.sql` に移す（024番が重なっていた）
- `apps/server`：経路を1つ足す
- `packages/client`：`topicStats(categoryId)` を足す
- `apps/web`：`settings/CategoryPage.tsx`、`settings/TopicStats.tsx`、`runs/RunPage.tsx`、`lib/paths.ts`
- `docs/api.md`：表の1行と成績の節と `curl` の例
- Androidアプリは変えない（トピックの設定の画面がない）
