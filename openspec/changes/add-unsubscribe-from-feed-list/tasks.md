# Tasks

## 1. 共有の確認のダイアログ

- [x] 1.1 `FeedDeletionDialog.tsx` に確認のダイアログと解除の処理をまとめ、`Shell.tsx` と `FeedsPage.tsx` をそれに置き換える。既存の登録解除のテストが通ることで確かめる

## 2. 設定のダイアログからの登録解除

- [x] 2.1 `feed-dialogs.test.tsx` に、設定のダイアログから登録を解除するテストを先に書き、失敗することを確かめる。対象は、操作の表示と確認の文面、解除と「未読」への移動、取りやめとフォーカス、失敗の知らせである
- [x] 2.2 `FeedOptionsDialog.tsx` に「登録を解除」の操作を足し、2.1のテストが通ることを確かめる

## 3. 全体の確認

- [x] 3.1 `make verify` と `openspec validate add-unsubscribe-from-feed-list --strict` が通ることを確かめる
