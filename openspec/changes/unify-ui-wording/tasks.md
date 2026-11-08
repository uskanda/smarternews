# Tasks

## 1. テストを新しい文言に直す

- [x] 1.1 `apps/web/src`の各テストで、文言を名前で探す箇所を新しい名前に直す。1つの画面に「保存する」が2つ以上あるテストは、区画の中でボタンを探す。直したあと、古い文言のままの画面ではテストが失敗する
- [x] 1.2 `feeds-settings.test.tsx`に、購読フィードの画面の説明文を確かめるテストを足す。`order.test.tsx`に、左のペインから登録を解除したときの知らせを確かめる行を足す

## 2. 画面の文言を直す

- [x] 2.1 `FeedsPage.tsx`の説明文を差し替える。1.2のテストで確かめる
- [x] 2.2 `Shell.tsx`と`FeedsPage.tsx`の確認、ボタン、知らせを「登録を解除」の言葉にそろえる。`order.test.tsx`、`feeds-settings.test.tsx`、`filters.test.tsx`で確かめる
- [x] 2.3 `SettingsPage.tsx`、`FeedsPage.tsx`、`CategoryPage.tsx`の保存のボタンを「保存する」にそろえる。各画面のテストで確かめる
- [x] 2.4 `FilterForm.tsx`、`TermHighlightsPage.tsx`、`Annotations.tsx`の保存のボタンも「保存する」にする。各画面のテストで確かめる
- [x] 2.5 `ReaderPage.tsx`と`AnnotationList.tsx`の一覧を取り直すボタンを「読み直す」にする。`reader.test.tsx`と`shell.test.tsx`で確かめる
- [x] 2.6 `AddFeedDialog.tsx`、`FeedOptionsDialog.tsx`、`AddFeedForm.tsx`の名前を「購読フィードを追加」「購読フィードの設定」にする。`feed-dialogs.test.tsx`と`feeds-settings.test.tsx`で確かめる

## 3. 要件と進行中の変更

- [x] 3.1 `web-shell`の「メニューからの登録解除」の差分を書く。`openspec validate unify-ui-wording --strict`で確かめる
- [x] 3.2 `add-feed-from-category`のproposal、design、tasks、web-readerの差分の要件の「フィードを追加」「フィードの設定」を直す。検索で古い語が残っていないことを確かめる

## 4. 確かめる

- [x] 4.1 `apps/web/src`を検索し、テスト以外に古い文言が残っていないことを確かめる。対象は、ボタンの「保存」と「〜を保存」、一覧の「更新」ボタン、購読フィードの操作の「削除」、「フィードを追加」と「フィードの設定」である
- [ ] 4.2 `make verify`を通す
