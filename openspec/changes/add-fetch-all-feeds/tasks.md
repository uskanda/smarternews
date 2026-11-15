# Tasks

## 1. 取得の求めの時刻（`packages/core`）

- [x] 1.1 `db/feeds.test.ts` に、一括の求めのテストを先に書き、失敗することを確かめる。確かめるのは次の4つである。求めた件数と飛ばした件数。取得周期の途中の購読フィードと、失敗で間隔の延びた購読フィードに、取得の時刻が来ること。Retry-Afterで待つものと一時停止中のものを外すこと。取得の記録と一時停止で、求めの時刻が消えること
- [x] 1.2 `feeds` に、移行 `032` で `fetch_requested_at` の列を足す。`db/feeds.ts` に求めの記録、次の取得の時刻の計算、求めの時刻の消去を足す。`api.ts` の `Feed` に `fetchRequestedAt` を足す。1.1のテストが通ることを確かめる
- [x] 1.3 `feeds/poller.test.ts` に、一括の求めのあとの取得のテストを先に書き、失敗することを確かめる。対象は、1件ずつ取得すること、取得の途中の求めがその回のあとに続けて取得されること、取得のあとはもとの周期に戻ること、別の `FeedPoller` でも残りを取得することである
- [x] 1.4 `FeedPoller` の `tick` と `idle` を直し、1.3のテストが通ることを確かめる

## 2. APIと共有の呼び出し（`apps/server`、`packages/client`）

- [x] 2.1 `feeds-api.test.ts` に `POST /api/v1/feeds/fetch` のテストを先に書き、失敗することを確かめる。対象は、件数をすぐに返すこと、`FeedPoller` の `idle` のあとに配信記事が増えること、Retry-Afterで待つものを飛ばすこと、取得を待つ間の `fetchRequestedAt` である
- [x] 2.2 `app.ts` に操作を足し、`packages/client` に `fetchAllFeeds` を足す。2.1のテストと `packages/client` のテストが通ることを確かめる
- [x] 2.3 `docs/api.md` に、操作の行、`fetchRequestedAt` の行、振る舞いの説明を足す。書いた `curl` の例が、操作の経路と一致することを確かめる

## 3. Webの操作（`apps/web`）

- [x] 3.1 `feeds-settings.test.tsx` と `shell.test.tsx` に、一括の取得のテストを先に書く。確かめるのは次の4つである。2つのボタンの`取得中…`の表示。終わりの知らせと未読の数の読み直し。失敗の件数と飛ばした件数。対象が0件のときの知らせ。テストは実装の前に書いたが、実装の前に実行して失敗を見る手順は飛ばした
- [x] 3.2 `lib/fetch-now.ts` に `useFetchAllFeedsNow` と `useFetchAllCompletion` を足し、`useFeeds` の読み直しの間隔を変える。`settings/FeedsPage.tsx` と `shell/Shell.tsx` にボタンを置く。3.1のテストが通ることを確かめる
- [x] 3.3 `DESIGN.md` に、左のペインの見出しの行に置くボタンの置き方を書き足し、`make verify` の `verify-design` と `verify-tokens` が通ることを確かめる

## 4. 全体の確認

- [x] 4.1 `make verify` の各検査と `openspec validate add-fetch-all-feeds --strict` が通ることを確かめる。実行の環境では依存を入れ直せず、`make verify` をそのままでは動かせなかった。lint、型検査、テスト、ビルド、設計の値、文章と用語の検査を、同じコマンドで1つずつ実行した
