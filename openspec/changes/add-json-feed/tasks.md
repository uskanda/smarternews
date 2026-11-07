# Tasks

## 1. JSON Feedの読み取り

- [x] 1.1 `feed.test.ts` にJSON Feedのテストを書き、失敗することを確かめる。1.1の文書の全欄、1.0の `author` と数の `id`、`content_text` だけの項目のHTMLへの変換を確かめる。`parseFeed` と `collectFeed` の候補、`version` のないJSONの「not a feed」も確かめる。この環境では依存を導入できず、実装の前にテストを実行できなかった。失敗は確かめていない
- [x] 1.2 `feed.ts` に `parseJsonFeed` を足し、`parseFeed` と `parseSubscription` から使う。1.1のテストが通ることを確かめる
- [x] 1.3 `fetchXml` と `ingest.ts` の `FEED_ACCEPT` に `application/feed+json` を足す。`ingest.test.ts` に、JSON Feedの購読フィードでETagを送るテストを足す。304で `not_modified` になり、テストが通ることを確かめる

## 2. フィードの発見

- [x] 2.1 `discover.test.ts` に発見のテストを書き、失敗することを確かめる。`application/feed+json` のlinkの要素と、JSON FeedそのもののURLを確かめる。3番目の場所で見つかる場合の要求の記録、どこにもない場合、linkの要素があるときに試さない場合も確かめる（1.1と同じ理由で、失敗は確かめていない）
- [x] 2.2 `discover.ts` に型と、よくある6か所の試行を足し、2.1のテストが通ることを確かめる

## 3. 画面と文書

- [x] 3.1 `AddFeedForm.tsx` の案内文と、`README.ja.md` と `README.md` の購読フィードの説明を変える。`make verify` のtextlintで、変えた文書に指摘がないことを確かめる

## 4. 全体の確認

- [ ] 4.1 `make verify` と `openspec validate add-json-feed --strict` が通ることを確かめる
