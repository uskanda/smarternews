# Tasks

## 1. テスト

- [ ] 1.1 `reader.test.tsx` の `describe("stars")` に、スターの一覧で外した行が残り、`j` で次の記事が開くテストを先に書き、失敗することを確かめる
- [ ] 1.2 同じ場所に、更新のあとと別の項目から戻ったあとに行が消えるテストと、残った行でスターを付け直すと行が1つのままのテストを書く

## 2. 実装

- [ ] 2.1 `ReaderPage.tsx` の `setStar` で、スターの一覧でスターを外した行を `kept` に足し、1のテストが通ることを確かめる

## 3. 全体の確認

- [ ] 3.1 `make verify` と `openspec validate keep-unstarred-row --strict` が通ることを確かめる
