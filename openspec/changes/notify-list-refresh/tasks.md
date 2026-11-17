# Tasks

## 1. 件数を数える関数

- [x] 1.1 `count-new.test.ts` に単体テストを書き、先に失敗させる。場合は4つある。新しい記事が先頭に入る場合と0件の場合、既読の行が消えて下から繰り上がる場合、古い順で末尾に足される場合である
- [x] 1.2 `count-new.ts` に `countNewArticles` を書き、1.1のテストが通ることを確かめる

## 2. 読み直しの表示と知らせ

- [x] 2.1 `reader.test.tsx` に、ボタンと `r` で取り直し中は「読み直し中…」で押せないことのテストを書き、先に失敗させる
- [x] 2.2 `reader.test.tsx` に、N件と0件の知らせの文言のテストと、失敗のときと「すべて既読にする」のあとは知らせないことのテストを書く
- [x] 2.3 `ReaderPage.tsx` に `refreshByUser` と `refreshing` の状態を足し、ボタンと `r` から呼んで、2.1と2.2のテストと既存のテストが通ることを確かめる

## 3. 確認

- [x] 3.1 `make verify` と `openspec validate notify-list-refresh --strict` が通ることを確かめる
