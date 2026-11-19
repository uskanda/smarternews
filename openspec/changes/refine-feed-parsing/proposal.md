# Proposal

## Why

フィードの読み取りに5つの漏れがあり、項目の並びや操作が崩れる（Issue #215、監査ID R-05）。
`JST` などの略称つきの日時は読めず、項目が取得の時刻で並び、90日より古い項目の除外も働かない。`&mdash;` を含むタイトルは、その文字列のまま一覧に出る。`link` のないRSSの項目はURLを持たず、元のページを開けない。Atomの添付は読まれない。過去の回をすべて載せる大きなフィードは購読できない。

## What Changes

- 地域の略称（`JST`、`CET`、`BST` など16個）を時差に置き換えてから日時を読む。`IST` は読まない。
- 時差のない日時は、サーバーのプロセスのタイムゾーンではなく、全体設定のタイムゾーンで読む。
- タイトルと抜粋の文字参照を、HTMLの名前付きの文字参照の表で解く。名前の大文字と小文字は区別する。
- `link` のないRSSの項目は、パーマリンクでURLの形のguidを、元のページのURLに使う。
- Atomの `link rel="enclosure"` を添付として読む。
- `config.yaml` に `fetch.feedMaxBytes`（既定10MB）を足し、フィードの取得にだけ使う。

## Capabilities

### New Capabilities

なし。

### Modified Capabilities

- `feed-subscriptions`：購読フィードの日時、文字参照、guidのURL、Atomの添付、応答の大きさの上限の要件を足す。
- `sources`：トピックのフィードとニュース検索の日時と、応答の大きさの上限の要件を足す。

## Impact

- コード：`packages/core/src/sources/` の `text.ts`、`feed.ts`、`news-search.ts`。`packages/core/src/` の `feeds/ingest.ts`、`feeds/discover.ts`、`fetch/http.ts`、`pipeline/run.ts`、`config.ts`。サーバーの `apps/server/src/runtime.ts`。
- 依存：`entities`（8.1.0、BSD-2-Clause）を `packages/core` の直接の依存にする。`linkedom` の依存として、すでに同じ版が入っている。
- 設定：`fetch.feedMaxBytes` を足す。既存の `config.yaml` は書き換えずにそのまま動く。
- データ：保存済みの配信記事は変えない。次の取得から新しい読み方になる。
