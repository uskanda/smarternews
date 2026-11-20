# Tasks

## 1. サーバーの一括の既読

- [ ] 1.1 `packages/core/src/db/articles.test.ts` に、終了したイベントと終了していないイベントのあるカテゴリで、カテゴリを指定した場合と指定しない場合の一括の既読のテストを書き、失敗することを確かめる
- [ ] 1.2 `apps/server/src/articles.test.ts` に、`/articles/mark-read` の応答の件数と識別子に終了したイベントが入らないテストを書く
- [ ] 1.3 `markArticlesRead` の条件に終了したイベントの除外を足し、1.1と1.2のテストが通ることを確かめる
- [ ] 1.4 `docs/api.md` の `mark-read` の説明に、終了したイベントを除くことを書き足す

## 2. Webのイベントの一覧

- [ ] 2.1 `apps/web/src/reader/reader.test.tsx` に、イベントのカテゴリの読み込み中、失敗と再試行、「さらに読み込む」、「読み直す」、「すべて既読にする」と `Shift+A`、未読がないときにボタンとキーが働かないこと、最近読んだ記事の一覧で `Shift+A` が働かないことのテストを書き、失敗することを確かめる
- [ ] 2.2 `EventList.tsx` に上部の操作、取得の状態、続きの読み込みを受け取らせ、`ReaderPage.tsx` の `canMarkAll` と `importantOnly` を直して、2.1のテストが通ることを確かめる

## 3. 全体の確認

- [ ] 3.1 `make verify` が通ることを確かめる
- [ ] 3.2 `openspec validate complete-event-list --strict` が通ることを確かめる
