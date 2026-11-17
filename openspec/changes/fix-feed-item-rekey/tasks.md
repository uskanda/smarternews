# Tasks

## 1. 識別子の付け替え

- [x] 1.1 `ingest.test.ts` に、識別子の付け替えのテストを先に書き、失敗することを確かめる。対象は、guidのhttpからhttpsへの変更、識別子とURLの同時の変更、タイトルの違う項目、古い識別子が残る文書、1対1に決まらない候補、翻訳する購読フィード、Webページの購読フィードである
- [x] 1.2 `url.ts` に下限のないタイトルのならし方を切り出し、`normalizeTitle` の既存のテストが通ることを確かめる
- [x] 1.3 `ingest.ts` の `storeItems` に付け替えの判定と書き換えを足し、1.1のテストと既存の `ingest.test.ts` が通ることを確かめる

## 2. 全体の確認

- [x] 2.1 `make verify` と `openspec validate fix-feed-item-rekey --strict` が通ることを確かめる
