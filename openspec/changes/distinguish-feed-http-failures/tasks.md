# Tasks

どの作業も、失敗するテストを先に書いてから実装する。

## 1. Retry-Afterを読む

- [x] 1.1 `packages/core/src/fetch/retry-after.ts` に `parseRetryAfter` を書く。秒数、HTTPの日付、24時間での切り詰め、過去の時刻、読めない値、負の値を `retry-after.test.ts` で確かめる
- [x] 1.2 `PageResult` の `http` の結果に `retryAfter` を足す。`pages.test.ts` で確かめる

## 2. 記録と次の取得の時刻

- [x] 2.1 `024_feed_http_failures.sql` のスキーマの変更で、`feeds` に `retry_after_until` と `gone_at` を足す
- [x] 2.2 `recordFetchFailure` と `recordFetchSuccess` で2つの列を記録し、`nextFetchFrom` を2つの時刻の遅いほうにする。`toFeed` と `feedSchema` に `goneAt` を足す
- [x] 2.3 `ingest.ts` の `download` と `downloadPage` で `FeedHttpError` を投げ、`fetchFeed` で410とRetry-Afterを記録する。仕様 `feed-subscriptions` の3つの要件を、RSSとWebページの購読フィードの両方について `ingest.test.ts` で確かめる。要件は「Retry-Afterの尊重」「配信の終了の記録」「配信の終了による無効化の禁止」である
- [x] 2.4 `poller.test.ts` で、仕様 `feed-subscriptions` の「待っている間の即時の取得」を確かめる。Retry-Afterの時刻までは自動の取得をせず、即時の取得ならすぐに取得する
- [x] 2.5 APIの応答に `goneAt` が入ることを `apps/server/src/feeds-api.test.ts` で確かめる。`docs/api.md` の購読フィードの表に書き足す

## 3. 画面

- [x] 3.1 `packages/client` の `FeedState` に `gone` を足し、`feedErrorLabel` の429と410の文言を変える。`feed-state.test.ts` と `labels.test.ts` で確かめる
- [x] 3.2 `FeedStatusBanner` に配信の終了の行を足す。仕様 `web-reader` の「配信を終えた購読フィードの一覧の表示」を `feeds.test.tsx` で確かめる
- [x] 3.3 `FeedsPage` の行に「配信終了」の印を出す。仕様 `web-settings` の「配信を終えた購読フィードの印」を `feeds-settings.test.tsx` で確かめる
- [x] 3.4 `Shell.tsx` の左のペインの印と、折りたたんだカテゴリの印に `gone` を足す。仕様 `web-reader` の「左のペインの配信の終了の印」を `shell.test.tsx` で確かめる

## 4. 全体の確認

- [x] 4.1 lint、型、テスト、ビルド、`openspec validate --strict` を通す
