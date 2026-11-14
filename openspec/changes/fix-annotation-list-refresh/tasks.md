# Tasks

## 1. 記事メモの書き直し

- [x] 1.1 `annotations.test.tsx` に、2ページ目にある記事メモを書き直すテストと、新しい記事メモが先頭に入るテストを先に書き、前者が失敗することを確かめる
- [x] 1.2 `queries.ts` の `saveNote` で、保存の前からあるメモを先頭に入れないようにし、1.1のテストが通ることを確かめる

## 2. `r` での注釈の取り直し

- [x] 2.1 `annotations.test.tsx` に、注釈の画面で `r` を押すと、サーバーで足した注釈が現れるテストを先に書き、失敗することを確かめる
- [x] 2.2 `ReaderPage.tsx` の `refresh` で、注釈の画面のときに注釈の一覧を無効にし、2.1のテストが通ることを確かめる

## 3. 削除のあとの注釈の一覧

- [x] 3.1 `annotations.test.tsx` に左のペインのメニューから登録を解除するテストを、`settings.test.tsx` にカテゴリを削除するテストを先に書き、失敗することを確かめる
- [x] 3.2 `FeedDeletionDialog.tsx` と `CategoryPage.tsx` で、削除のあとに注釈の一覧を無効にし、3.1のテストが通ることを確かめる

## 4. 全体の確認

- [ ] 4.1 `make verify` と `openspec validate fix-annotation-list-refresh --strict` が通ることを確かめる
