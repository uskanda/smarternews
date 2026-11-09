# Proposal

## Why

購読フィードの記事を読んでいて、そのフィードが要らないと分かったとき、登録を解除するには左のペインでメニューを開くか、設定の画面へ移る必要がある。
記事の一覧の上部にある「購読フィードの設定」から、そのまま登録を解除できるようにする（Issue #178）。

## What Changes

- 購読フィードの一覧から開く「購読フィードの設定」のダイアログの下端に、「登録を解除」の操作を足す。
- 選ぶと設定のダイアログを閉じ、左のペインと設定の画面と同じ確認のダイアログを開く。確認して解除すると「未読」の一覧を開く。
- 確認のダイアログと解除の処理を、左のペイン、設定の画面、設定のダイアログの3か所で共有する部品にまとめる。見た目と振る舞いは、既存の2か所で変えない。
- Androidアプリには手を入れない。

## Capabilities

### New Capabilities

なし。

### Modified Capabilities

- `web-reader`：購読フィードの設定のダイアログからの登録解除の要件を足す。

## Impact

- `apps/web/src/reader/FeedOptionsDialog.tsx`：「登録を解除」の操作と確認のダイアログ
- `apps/web/src/settings/FeedDeletionDialog.tsx`（新規）：共有の確認のダイアログと解除の処理
- `apps/web/src/shell/Shell.tsx`、`apps/web/src/settings/FeedsPage.tsx`：共有の部品に置き換える
- APIとサーバー：変えない。既存の購読フィードの削除のAPIを使う
