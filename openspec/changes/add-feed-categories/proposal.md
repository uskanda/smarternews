# Proposal

## Why

購読フィードのパーサーは、項目の分類（RSSの `category` と `dc:subject`、Atomの `category`）を読まずに捨てている。
1つのフィードに複数の分類を混ぜて配信するサイトで、分類を条件にしたフィルターを書けない。タイトルやURLに分類が現れないサイトでは、代わりの条件も書けない（issueの218番、Web UIの監査のR-08）。

## What Changes

- 購読フィードの取得で、配信記事の「配信元の分類」を読み、文字列の並びで保存する。読む要素は、RSS（RSS 1.0を含む）の `category` と `dc:subject`、Atomの `category`、JSON Feedの `tags` である。
- 値は前後の空白を除いてプレーンテキストにし、空の値と重複は保存しない。1件に20個まで、1つの値は100文字までにする。
- 保存済みの項目の分類が変わったときは、分類を書き換え、フィルターを照合し直す。翻訳は消さない。
- フィルターの条件の欄に「分類」（APIでは `feedCategories`）を足す。値を1つずつ照合し、どれか1つが合えば欄が合ったとみなす。
- 記事の詳細のAPIに `feedCategories` を足す。
- WebとAndroidアプリの本文の画面で、著者の横に分類を出す。
- 用語集に「配信元の分類」を足す。LLMは使わない。

## Capabilities

### New Capabilities

なし。

### Modified Capabilities

- `feed-subscriptions`: 配信元の分類の読み取り、整え方と上限、分類だけが変わったときの扱いを足す
- `feed-filters`: 条件の欄に分類を足し、複数の値の照合の規則を足す
- `http-api`: 記事の詳細の `feedCategories` を足す
- `web-settings`: フィルターの条件の欄の見出し「分類」を足す
- `web-reader`: 本文の上の行に分類を出す
- `mobile-reader`: 本文の上の行に分類を出す

## Impact

- `packages/core`: フィードのパーサー（`sources/feed.ts`）と保存（`feeds/ingest.ts`）を変える。
- `packages/core`: 移行（`037_article_feed_categories.sql`）を足す。
- `packages/core`: フィルターの照合（`filters/match.ts`、`db/filters.ts`）を変える。
- `packages/core`: APIの型（`api.ts`）と記事の読み出し（`db/articles.ts`）を変える。
- `apps/web`: フィルターの入力（`settings/FilterForm.tsx`）と本文の画面（`reader/ArticleView.tsx`）を変える。
- `apps/mobile`: 本文の画面（`reader/ArticlePage.tsx`）を変える。
- `openspec/glossary.yml`、`README.ja.md`、`README.md`、`docs/api.md` を変える。
- RSSの出力とLLMのタスクは変えない。
