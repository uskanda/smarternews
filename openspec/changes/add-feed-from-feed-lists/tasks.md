# Tasks

どの作業も、失敗するテストを先に書いてから実装する。

## 1. 2つの一覧の追加のボタン

- [x] 1.1 `apps/web/src/reader/feed-dialogs.test.tsx` にテストを足し、失敗を確かめる。「購読フィード」と「未分類」の一覧の上部に「購読フィードを追加」がある。個々の購読フィードの一覧と「未読」の一覧にはない
- [x] 1.2 `feed-dialogs.test.tsx` に、2つの一覧から開いたダイアログのテストを足し、失敗を確かめる。カテゴリは「なし（未分類）」で、フォーカスはURLの入力欄にある。追加するとカテゴリなしで登録され、ダイアログが閉じる。一覧はそのままで、フォーカスはボタンに戻る。カテゴリを選び直すと、そのカテゴリで登録される
- [x] 1.3 `apps/web/src/reader/AddFeedDialog.tsx` の `category` を省けるようにする。`apps/web/src/reader/ReaderPage.tsx` のボタンの条件に2つの一覧を足す。1.1と1.2のテストが通ることを確かめる
- [x] 1.4 `AddFeedDialog.tsx` と `apps/web/src/settings/AddFeedForm.tsx` のコメントの「カテゴリの一覧の上」を、3つの一覧に合わせて直す

## 2. 進行中の変更の差分

- [x] 2.1 `openspec/changes/add-feed-from-category/specs/web-reader/spec.md` の、カテゴリ以外の一覧についての文を直す。`openspec validate add-feed-from-category --strict` が通ることを確かめる

## 3. 確認

- [x] 3.1 `make verify` を通し、`openspec validate add-feed-from-feed-lists --strict` が通ることを確かめる
