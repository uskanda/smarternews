# Tasks

## 1. 日時

- [x] 1.1 `text.ts` の `parseDate` に略称の表とタイムゾーンの引数を足す。`text.test.ts` で `JST`、`CET`、`BST` を読めることと、`IST` が `null` になることを確かめる。時差のない日時が `Asia/Tokyo` と `UTC` で違う結果になることも確かめる
- [x] 1.2 `parseFeed`、`parseSubscription`、`collectFeed` にタイムゾーンを渡し、`ingest.ts` と `pipeline/run.ts` から全体設定のタイムゾーンを渡す。`feed.test.ts` と `ingest.test.ts` で略称つきの日時と時差のない日時が読めることを確かめる

## 2. 文字参照

- [x] 2.1 `entities` を `packages/core` の依存に足し、`pnpm-lock.yaml` の `packages/core` の依存に、すでに入っている8.1.0を書き足す。`text.test.ts` で `entities` を読み込めることを確かめる
- [x] 2.2 `decodeEntities` を `decodeHTMLStrict` で解くように変える。`text.test.ts` で `&mdash;`、`&hellip;`、`&Eacute;` と `&eacute;` を解くことを確かめる。未知の名前と、`;` で終わらない `&` を残すことも確かめる

## 3. リンクと添付

- [x] 3.1 `rssItem` で `link` のない項目にパーマリンクのguidを使う。`feed.test.ts` と `ingest.test.ts` で、`isPermaLink="false"` のguidを使わないことまで確かめる
- [x] 3.2 `attachmentsOf` でAtomの `link rel="enclosure"` を読み、`feed.test.ts` で添付の中身と先頭の位置を確かめる

## 4. 大きさ

- [x] 4.1 `Fetcher` の `get` に呼び出しごとの `maxBytes` を足し、`FetcherOptions` に `feedMaxBytes` を足す。`http.test.ts` で、呼び出しごとの上限が使われることを確かめる
- [x] 4.2 `config.ts` に `fetch.feedMaxBytes`（既定10MB）を足し、`config.test.ts` で既定値を確かめる。`examples/config.example.yaml` に書き足す
- [x] 4.3購読フィードの取得、フィードの探索、`fetchXml` でフィードの上限を使い、`runtime.ts` から渡す。`ingest.test.ts`、`discover.test.ts`、`feed.test.ts` で、ページの上限を超えてフィードの上限に収まるフィードを取り込めて探索できることを確かめる

## 5. 仕上げ

- [x] 5.1 `openspec validate refine-feed-parsing --strict` が通ることを確かめる
- [ ] 5.2 `make verify` が通ることを確かめる
