# Proposal

## Why

LLM検索を有効にしたトピックでは、実行のたびに検索のタスクを1回呼ぶ。すでに記事にした話題は入力に渡さないので、モデルは同じページを返し続ける。返ったページは判定済みかどうかを見る前に取得するので、実行あたりのページ数の上限も無駄に減る。毎回同じページを返す検索は、注意の項目にも出ない。2026-11-13のWeb UIの監査（F-12）で見つけた。

## What Changes

- LLM検索が返した判定済みのURLは、ページを取得する前に除く。ページ数の上限は、新しいページの取得にだけ使う。
- 検索のタスクの入力に、そのトピックの直近の生成記事の見出しを10件まで渡す。同じページは避け、新しい展開や続報は含めるように指示する。
- LLM検索の試行で数える結果の数を、判定済みを除く前の数から「新しい候補の数」に変える。ニュース検索は変えない。
- 新しい候補が3回続けて0件のLLM検索は、そのトピックのLLM検索を1日1回に減らし、注意の項目に出す。新しい候補が1件でも出れば自動で戻る。
- 利用者は、注意の項目とトピックの編集から「元に戻す」を選べる。元に戻すと、そこから数え直す。
- APIのトピックに `llmSearchReduced` を、操作に `POST /api/v1/topics/:id/llm-search/restore` を足す。

## Capabilities

### New Capabilities

なし。

### Modified Capabilities

- `sources`：LLM検索で判定済みのURLを取得しないこと、空振りが続くLLM検索を1日1回に減らすこと。
- `llm-tasks`：検索のタスクの入力に直近の見出しを足すこと。
- `runs`：LLM検索の試行で数える結果の数と、LLM検索の注意の項目。
- `http-api`：トピックの `llmSearchReduced` と、元に戻す操作。
- `web-runs`：LLM検索の注意の項目の「元に戻す」。
- `web-settings`：トピックの編集で、減らしていることと「元に戻す」を出すこと。

## Impact

- `packages/core`の取得と実行：`sources/llm-search.ts`、`llm/tasks.ts`、`pipeline/run.ts`、`runs/attention.ts`。
- `packages/core`の保存と型：`db/topics.ts`、`db/articles.ts`、`db/search-attempts.ts`、`api.ts`。
- `packages/core`の新しいファイル：移行`032_llm_search_resets.sql`とモジュール`runs/llm-search-reduction.ts`。
- `apps/server`：元に戻す操作の経路。
- `apps/web`：実行履歴の画面の注意の区画と、カテゴリの設定の画面のトピックの編集。
- `packages/client`：元に戻す操作の呼び出し。
- `docs/api.md`：トピックの欄と、元に戻す操作。
- LLMの呼び出しは減る。Androidアプリの画面は変えない。
