# Tasks

## 1. サーバーの一括の既読

- [x] 1.1 `packages/core/src/db/articles.test.ts` に一括の既読のテストを書く。対象は、終了したイベントと終了していないイベントのあるカテゴリである。カテゴリを指定した場合と指定しない場合を書き、失敗することを確かめる
- [x] 1.2 `apps/server/src/articles.test.ts` に、`/articles/mark-read` の応答の件数と識別子に終了したイベントが入らないテストを書く
- [x] 1.3 `markArticlesRead` の条件に終了したイベントの除外を足し、1.1と1.2のテストが通ることを確かめる
- [x] 1.4 `docs/api.md` の `mark-read` の説明に、終了したイベントを除くことを書き足す

## 2. Webのイベントの一覧

- [x] 2.1 `apps/web/src/reader/reader.test.tsx` に、イベントのカテゴリの表示のテストを書く。読み込み中、失敗と再試行、「さらに読み込む」、「読み直す」を確かめる
- [x] 2.2 `reader.test.tsx` に、一括の既読のテストを書く。「すべて既読にする」と `Shift+A` の動き、未読がないときに働かないこと、最近読んだ記事の一覧で働かないことを確かめる。2.1と合わせて、失敗することを確かめる
- [x] 2.3 `EventList.tsx` に上部の操作、取得の状態、続きの読み込みを受け取らせる。`ReaderPage.tsx` の `canMarkAll` と `importantOnly` を直し、2.1と2.2のテストが通ることを確かめる

## 3. 全体の確認

実装した環境では、lint、型の検査、テスト、ビルドは通った。
`check:private` は、実行環境が作業ディレクトリに置く読めないファイルで止まった。textlintと用語の検査は、この変更の文書では通り、既存の `add-feed-articles-list` の文書で失敗した。
そのため3.1は残してある。

- [ ] 3.1 `make verify` が通ることを確かめる
- [x] 3.2 `openspec validate complete-event-list --strict` が通ることを確かめる
