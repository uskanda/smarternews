# Proposal

## Why

購読フィードのURLを変更できない。恒久的な転送（301、308）を受けても、保存したURLは変わらない（issueの124番、Web UIの監査のR-01）。
httpsへの移行やドメインの移転のたびに、削除して登録し直すしかなく、スター、注釈、既読の記録が消える。
利用者は転送が続く間は移転に気づかず、転送元が消えた日から取得が失敗する。

## What Changes

- 購読フィードの更新の要求で `url` を受け付ける。受け付けたURLには、登録と同じ検査（正規化、登録済みのURLの拒否、取得してフィードとして読めること、Webページの購読フィードではセレクターで記事を取り出せること）をする。
- 検査に通ったら、取得した項目をその場で保存し、条件付きの取得の値（ETag、Last-Modified）、失敗の記録、配信終了の記録、転送の数、書き換えの記録を消す。通らなければ何も保存しない。
- 取得が、同じ行き先への恒久的な転送（最初から続く301と308）を、続けて3回の成功した取得で受けたら、保存したURLを行き先に書き換え、元のURLと日時を記録する。行き先が登録済みなら書き換えず、数えない。失敗した取得は数を変えない。
- APIの購読フィードに `movedFrom` と `movedAt` を足す。
- Webの設定の編集の欄に「URL」の欄を足し、取得の状況に自動で書き換えたことを文で出す。
- 配信記事の見分けは今までどおり購読フィードと項目の識別子で行うので、URLの変更の後もスター、注釈、既読は残る。
- LLMは呼ばない。

## Capabilities

### New Capabilities

なし。

### Modified Capabilities

- `feed-subscriptions`: 購読フィードの編集にURLの変更を足し、恒久的な転送によるURLの書き換えの要件と、書き換えの記録を足す
- `web-settings`: 編集の欄のURLと、自動の書き換えの表示を足す

## Impact

- `packages/core`: 次のファイルを変える。
  - 取得の結果の `permanentUrl`（`fetch/http.ts`、`fetch/pages.ts`）。
  - スキーマの変更（`032_feed_url_moves.sql`）と、記録（`db/feeds.ts`）。
  - 自動の書き換えと手動の変更（`feeds/ingest.ts`）。
  - APIの型（`api.ts`）。
- `apps/server`: `PATCH /feeds/:id` がURLの変更を `changeFeedUrl` に回す。
- `apps/web`: 設定の購読フィードの編集の欄と取得の状況。
- `docs/api.md`: 更新の要求の `url` と、購読フィードの `movedFrom`、`movedAt`。
- Androidアプリは変えない。
