# Proposal

## Why

書き直しは今回加わったことの文を上書きする。利用者が読んだあとに2回書き直されると、1回目の文は消える。「新しい出典」の印は2回分に付くのに、文は最後の1回分しか出ず、印と文の範囲が合わない。

## What Changes

- クローラーは、書き直しのたびに、今回加わったことの文があればその文と時刻を記事の更新の記録として残す。記事の今回加わったこと（最新の1文）は今と同じく置き換える。
- 今ある記事の今回加わったことは、記事の更新日時を時刻にして記録へ写す。
- APIは、記事の詳細に、前回読んでから加わったことの文と時刻を古い順で足す。一度も読まれていない記事では、最新の書き直しの文だけを返す。
- Webの本文の画面は、前回読んでからの文が2件以上あるとき、または最新の書き直しに文がないときに、「前回読んでから加わったこと」の見出しで時刻付きで並べる。それ以外は今と同じく「今回の更新で加わったこと」として1文を出す。
- 一覧の行、AndroidアプリとRSSの出力、本文の生成のタスクは変えない。

## Capabilities

### New Capabilities

なし。

### Modified Capabilities

- `article-pipeline`: 書き直しごとの今回加わったことを記録として残す。
- `http-api`: 記事の詳細に、前回読んでから加わったことの一覧を足す。
- `web-reader`: 本文の画面で、前回読んでから加わったことを並べて出す。

## Impact

- `packages/core/src/db/migrations/032_article_update_notes.sql`（新しい表と、今ある文の写し）
- `packages/core/src/db/articles.ts`（`reviseArticle`での記録と、記事の詳細での取り出し）
- `packages/core/src/api.ts`（`articleSchema`の`updateNotes`）
- `apps/web/src/reader/ArticleView.tsx`（本文の画面の表示）
- `docs/api.md`（記事の詳細の項目）
- APIには項目を足すだけなので、AndroidアプリとRSSは壊れない。
