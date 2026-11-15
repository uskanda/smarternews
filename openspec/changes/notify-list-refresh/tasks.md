# Tasks

## 1. 件数を数える関数

- [ ] 1.1 `count-new.test.ts` に、新しい記事が先頭に入る、0件、既読の行が消えて下から繰り上がる、古い順で末尾に足される、の単体テストを書き、先に失敗させる
- [ ] 1.2 `count-new.ts` に `countNewArticles` を書き、1.1のテストが通ることを確かめる

## 2. 読み直しの表示と知らせ

- [ ] 2.1 `reader.test.tsx` に、ボタンと `r` で取り直し中は「読み直し中…」で押せないこと、N件と0件のトーストの文言、失敗のときにトーストが出ないこと、「すべて既読にする」では読み直しのトーストが出ないことのテストを書き、先に失敗させる
- [ ] 2.2 `ReaderPage.tsx` に `refreshByUser` と `refreshing` の状態を足し、ボタンと `r` から呼んで、2.1のテストと既存のテストが通ることを確かめる

## 3. 確認

- [ ] 3.1 `pnpm run verify` と `openspec validate notify-list-refresh --strict` が通ることを確かめる
