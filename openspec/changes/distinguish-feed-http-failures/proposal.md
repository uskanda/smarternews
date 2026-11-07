# Proposal

## Why

購読フィードの取得で、サーバーは2xxと304以外の応答をすべて同じ失敗として扱う。そのため、サイトがRetry-Afterで指定した待ち時間を守らない場合がある。配信を終えたフィード（410）と、一時的な失敗も見分けられない（issueの129番、Web UIの監査のR-08）。

## What Changes

- 429と503の応答にRetry-Afterがあれば、その時刻を次の自動の取得の下限にする。秒数と日付の両方の形を読み、24時間より先は24時間に切り詰める。読めない値と過去の時刻は無視する。
- 410の応答を、ほかの失敗と分けて記録する。410が続いている間、最初の410の時刻を持ち、ほかの応答で空に戻す。自動では無効にしない。
- APIの購読フィードに `goneAt` を足す。`nextFetchAt` は、Retry-Afterの時刻に従う。
- Webの画面に、配信の終了の状態（「配信終了」）を足す。一覧の上の帯で登録の解除を勧め、設定の画面には印を出し、左のペインには印を出す。
- 429と410の理由の文言を、ほかのHTTPの失敗と分ける。
- RSSとAtomの購読フィードと、Webページの購読フィードを、同じに扱う。
- LLMは呼ばない。手動の「いま取得」は、待っている間でもすぐに取得する。

## Capabilities

### New Capabilities

なし。

### Modified Capabilities

- `feed-subscriptions`: Retry-Afterを守る要件と、410を記録する要件を足す
- `http-api`: 購読フィードの `goneAt` と、Retry-Afterに従う `nextFetchAt` の要件を足す
- `web-reader`: 一覧の上の帯と左のペインに、配信の終了の状態を足す
- `web-settings`: 購読フィードの行に、配信の終了の印を足す

## Impact

- `packages/core`: 次のファイルを変える。
  - スキーマの変更（`024_feed_http_failures.sql`）。
  - 取得の失敗の扱い（`feeds/ingest.ts`）と、記録と次の取得の時刻（`db/feeds.ts`）。
  - `PageResult` のRetry-After（`fetch/pages.ts`）と、Retry-Afterを読む関数（`fetch/retry-after.ts`）。
  - APIの型（`api.ts`）。
- `packages/client`: `FeedState` に `gone` を足し、429と410の文言を変える。
- `apps/web`: 一覧の上の帯、設定の画面の印、左のペインの印を変える。
- `docs/api.md`: 購読フィードの表に `goneAt` を足す。
- Androidアプリは、取得の状態を表示していないので変えない。
