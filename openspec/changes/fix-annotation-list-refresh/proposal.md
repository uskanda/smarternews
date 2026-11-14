# Proposal

## Why

注釈の一覧が、3つの場面で古い内容のままになる（Issue #194、Web UIの監査の項目B-12）。

- 読み込んでいないページにある古い記事全体へのメモを書き直すと、その行が一覧の先頭に入る。続きを読み込むと、同じ行が2つになる。
- 注釈の画面で `r` を押しても、注釈は取り直されない。
- 注釈を表示中に購読フィードやカテゴリを削除しても、消えた記事の行が残る。

## What Changes

- 記事全体へのメモの保存で、読み込み済みのページにない古いメモは先頭に入れない。続きのページがもうないときは、一覧を取り直す。新しいメモは、いまと同じく先頭に入れる。
- 注釈の画面で `r` を押すと、注釈の一覧も取り直す。
- 購読フィードの登録の解除とカテゴリの削除のあとに、注釈の一覧を取り直す。
- Androidアプリには手を入れない。

## Capabilities

### New Capabilities

なし。

### Modified Capabilities

- `web-shell`：キーボードでの一覧の再取得に、注釈の一覧を足す。
- `web-reader`：記事全体へのメモの書き直しと、記事の削除のあとの注釈の一覧の要件を足す。

## Impact

- `apps/web/src/api/queries.ts`：記事全体へのメモの保存のあとの一覧の書き換え
- `apps/web/src/reader/ReaderPage.tsx`：`r` と更新のボタンの処理
- `apps/web/src/settings/FeedDeletionDialog.tsx`、`apps/web/src/settings/CategoryPage.tsx`：削除のあとで無効にする問い合わせ
- APIとサーバー：変えない
