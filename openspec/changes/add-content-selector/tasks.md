# Tasks

## 1. 取り出し

- [ ] 1.1 `extract.test.ts` に取り出しのテストを書き、失敗を確かめる。セレクターが当たるときは最初の要素だけを使い、入れ子でも二重にならない。当たらないときと空のときは、Readabilityの結果に戻る
- [ ] 1.2 `extractArticle` に、省略できる本文のセレクターと `matched` を足す

## 2. 保存と型

- [ ] 2.1 `db/feeds.test.ts` と `api.test.ts` に、値の保存と解除、使えないセレクターの拒否のテストを書き、失敗を確かめる
- [ ] 2.2 `db/feeds.test.ts` に、値が変わったときだけ未読の記事の全文と訳を消すテストを書き、失敗を確かめる。既読の記事とほかのフィードの記事は残る
- [ ] 2.3 `032_feed_content_selector.sql` の移行と、`feedSchema` と `feedFields` の `contentSelector` を足す
- [ ] 2.4 `insertFeed` と `updateFeed` に、保存と消去を足す

## 3. 全文と要約

- [ ] 3.1 `full-content.test.ts` と `summarize.test.ts` に、指定した要素から全文と要約の入力を作るテストを書き、失敗を確かめる
- [ ] 3.2 `articleForFullContent` と `nextArticleForFullContent` で本文のセレクターを読み、全文と要約の取り出しに渡す

## 4. 見本のAPI

- [ ] 4.1 `content-preview.test.ts` とサーバーの入口のテストを書き、失敗を確かめる
- [ ] 4.2 `previewContent` と `POST /feeds/:id/content-preview` を足す。購読フィードの変更のあとに、全文の取得の処理を起こす
- [ ] 4.3 `packages/client` に見本の呼び出しを足す

## 5. 設定ファイル

- [ ] 5.1 `settings-file.test.ts` に、書き出しと読み込みと不正な値の拒否のテストを書き、失敗を確かめる
- [ ] 5.2 `settings-file.ts` と設定ファイルの型に `contentSelector` を足し、`examples/settings.example.yaml` に例を足す

## 6. Webの画面

- [ ] 6.1 `feeds-settings.test.tsx` に、欄の保存と解除、説明、見本の表示のテストを書き、失敗を確かめる
- [ ] 6.2 `FeedsPage.tsx` の編集のフォームに、本文のセレクターの欄と見本を足す

## 7. 文書と確認

- [ ] 7.1 `docs/api.md` に、`contentSelector` と見本の操作を足す
- [ ] 7.2 `openspec validate add-content-selector --strict` が通ることを確かめる
- [ ] 7.3 `make verify` が通ることを確かめる
