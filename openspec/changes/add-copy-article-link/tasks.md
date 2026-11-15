# Tasks

どの作業も、失敗するテストを先に書いてから実装する。

## 1. コピーの部品

- [ ] 1.1 `apps/web/src/lib/clipboard.test.ts` に、`copyText` のテストを書く。`navigator.clipboard` があるときは、`writeText` に値が渡ることを確かめる。無いときと拒否されたときは、`execCommand("copy")` を呼び、元の選択が戻ることを確かめる。`execCommand` が `false` を返したら、失敗を返すことも確かめる
- [ ] 1.2 `apps/web/src/lib/clipboard.ts` に `copyText` を実装する
- [ ] 1.3 `apps/web/src/reader/Annotations.tsx` の `copy` を `copyText` に置き換える

## 2. リンクの文字列

- [ ] 2.1 `apps/web/src/lib/article-link.test.ts` に、`articleLink` のテストを書く。翻訳したタイトルがあるときと無いとき、`[` `]` `\` のエスケープ、URLの括弧と空白の置き換え、`primaryUrl` が無いときを確かめる
- [ ] 2.2 `apps/web/src/lib/article-link.ts` に `articleLink` を実装する

## 3. 本文の画面とキー

- [ ] 3.1 `apps/web/src/reader/reader.test.tsx` に、生成記事のボタンと `c` のキーのテストを書く。期待どおりのMarkdownがコピーされ、知らせが出ることを確かめる。出典の無い生成記事ではボタンが出ず、`c` も働かないことを確かめる。コピーに失敗したときの知らせも確かめる
- [ ] 3.2 `apps/web/src/reader/feeds.test.tsx` に、翻訳したタイトルのある配信記事のボタンのテストを書く
- [ ] 3.3 `apps/web/src/reader/mentions.test.tsx` のキー操作の一覧の期待値に `c` を足す
- [ ] 3.4 `apps/web/src/reader/ArticleView.tsx` の下端の操作の列に「リンクをコピー」を足す
- [ ] 3.5 `apps/web/src/reader/ReaderPage.tsx` に、`copyLink` と `c` のキーを足す
- [ ] 3.6 `apps/web/src/shell/Shell.tsx` の `KEYS` に `c` を足す

## 4. 確認

- [ ] 4.1 `make verify` の各検査を通し、`openspec validate add-copy-article-link --strict` が通ることを確かめる
