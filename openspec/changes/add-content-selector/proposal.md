# Proposal

## Why

全文には、Readabilityの結果だけを使っている。関連記事の一覧やコメント欄を本文として取り出すサイトでは、長い誤りがそのまま全文になる。
いま利用者にできるのは、記事ごとに配信された内容へ切り替えることだけである（Issue #220）。
add-full-contentは、Non-Goalsに「サイトごとに取り出しの方式を変える設定」を挙げ、誤りの出るサイトが分かった時点で見直すとしていた。この変更で、その項目を見直す。

## What Changes

- 購読フィードの設定に「本文のセレクター」を1つ足す。指定があり、記事のページに当たる要素があれば、最初の要素をReadabilityの結果の代わりにMarkdownへ変換する。
- 当たる要素がないページ、または要素の文字列が空のページでは、Readabilityの結果に戻す。
- 自動の要約が自分でページを読むときも、同じセレクターで本文を取り出す。
- 本文のセレクターを変えたときは、その購読フィードの未読の記事の全文、失敗の記録、全文をもとにした本文の訳を消し、取得し直せるようにする。既読の記事は保存済みのまま残す。
- 本文のセレクターを試す見本の操作を足す。そのフィードの最新の記事1件のページを取得し、取り出した本文の先頭を返す。何も保存しない。
- Webの設定の、購読フィードの編集のフォームに、本文のセレクターの欄と見本を見るボタンを置く。
- 設定ファイルに、本文のセレクターを指定があるときだけ書き、読み込みでも受ける。
- LLMは呼ばない。生成記事の処理は変えない。

## Capabilities

### New Capabilities

なし。

### Modified Capabilities

- `feed-subscriptions`：本文のセレクターの保持、全文と要約での使い方、当たらないときの扱い、変えたときの未読の記事の全文の消去の要件を足す。
- `http-api`：購読フィードの一覧、登録、変更での本文のセレクターの扱いと、見本を求める操作の要件を足す。
- `settings`：設定ファイルでの本文のセレクターの扱いの要件を足す。
- `web-settings`：購読フィードの編集の画面の、本文のセレクターの欄と見本の要件を足す。

## Impact

- `packages/core/src/sources/extract.ts`：取り出しに、省略できる本文のセレクターを足す
- `packages/core/src/feeds/full-content.ts`、`packages/core/src/feeds/summarize.ts`：本文のセレクターを取り出しに渡す。見本の処理を足す
- `packages/core/src/db/feeds.ts`、`packages/core/src/db/articles.ts`：本文のセレクターの保存と、変えたときの未読の記事の全文の消去
- `packages/core/src/db/migrations/045_feed_content_selector.sql`（新規）：`feeds` の表に列を1つ足す
- `packages/core/src/api.ts`、`packages/core/src/settings-file.ts`：型、検証、設定ファイル
- `apps/server/src/app.ts`：見本の操作の入口と、変更のあとの全文の取得の開始
- `packages/client`、`apps/web`：見本の呼び出しと、編集のフォームの欄
- `docs/api.md`、`examples/settings.example.yaml`：項目と例
- アプリ（`apps/mobile`）：変えない
