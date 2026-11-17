# Tasks

どの作業も、失敗するテストを先に書いてから実装する。

## 1. 取得の層

- [ ] 1.1 `Fetcher.#send` で、最初から続く301と308の行き先を `permanentUrl` として返す。`HttpResponse` と `BytesResponse` に足す。301だけ、308から301、301から302、302だけ、転送なしを `http.test.ts` で確かめる
- [ ] 1.2 `PageResult` の成功の結果に `permanentUrl` を渡す。`pages.test.ts` で確かめる

## 2. データベースとAPIの型

- [ ] 2.1 `032_feed_url_moves.sql` で、`feeds` に `move_target`、`move_count`、`moved_from`、`moved_at` を足す
- [ ] 2.2 `Feed` と `feedSchema` に `movedFrom` と `movedAt` を足し、`feedUpdateSchema` で `url` を受け付ける。`updateFeed` は `url` を受け取らない

## 3. 自動の書き換え

- [ ] 3.1 `fetchFeed` で、成功した取得の転送の行き先を数え、3回目で書き換える。仕様 `feed-subscriptions` の「恒久的な転送によるURLの書き換え」の各場合を `ingest.test.ts` で確かめる

## 4. 手動のURLの変更

- [ ] 4.1 `ingest.ts` に `changeFeedUrl` を足す。仕様 `feed-subscriptions` の「購読フィードのURLの変更」を `ingest.test.ts` で確かめる
- [ ] 4.2 `PATCH /feeds/:id` で、`url` を含む要求を `changeFeedUrl` に回す。サーバーのテストと `packages/client` のテストで確かめ、`docs/api.md` を更新する

## 5. Webの設定の画面

- [ ] 5.1 `EditFeed` にURLの欄を足す。仕様 `web-settings` の「購読フィードのURLの変更の操作」を `feeds-settings.test.tsx` で確かめる
- [ ] 5.2 `FetchState` に書き換えの表示を足す。仕様 `web-settings` の「転送によるURLの書き換えの表示」を `feeds-settings.test.tsx` で確かめる

## 6. 全体の確認

- [ ] 6.1 lint、型、テスト、ビルド、`openspec validate --strict` を通す
