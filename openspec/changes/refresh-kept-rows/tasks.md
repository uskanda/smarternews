# Tasks

## 1. 取得した行を優先する

- [x] 1.1 `merge.test.ts`に、取得した行が新しいときは取得した行を使うこと、同じときは既読とスターを重ねること、最近読んだ記事が取得した行の既読の時刻で並ぶことのテストを足す
- [x] 1.2 `mergeKept`を、取得した行を優先し、更新の時刻が同じか古いときだけ残した行の既読とスターを重ねる形にする。1.1のテストで確かめる

## 2. Webの残した行

- [x] 2.1 `reader.test.tsx`に、残した行に続報が届いて一覧を取り直すと新しい見出しの未読の行になるテストを足す。`translation.test.tsx`に、翻訳の見出しが残した行に届くテストを足す
- [x] 2.2 `apps/web/src/api/queries.ts`の`patchArticle`が受け手に変更を渡すようにし、`useArticlePatchListener`を足す
- [x] 2.3 `ReaderPage.tsx`で受け手から`kept`に当てる。`flagFailed`の手での巻き戻しを消す。スクロールでの既読は今の行から写す。2.1のテストと、既存の失敗の巻き戻しのテストで確かめる

## 3. アプリの残した行

- [x] 3.1 `actions.test.tsx`に、続報、払う操作での既読の失敗、長押しのメニューでのスターと未読の失敗のテストを足す。`translation.test.tsx`に、翻訳の見出しが残した行に届くテストを足す
- [x] 3.2 `apps/mobile/src/api/queries.ts`の`patchArticle`が受け手に変更を渡すようにし、`useArticlePatchListener`を足す。`useArticleFlags`の`onError`は送った値の反対を当てる
- [x] 3.3 `session.tsx`の`ReaderSessionProvider`が受け手から`kept`に当てる。3.1のテストで確かめる

## 4. 確かめる

- [x] 4.1 `openspec validate refresh-kept-rows --strict`を通す
- [ ] 4.2 `make verify`を通す
