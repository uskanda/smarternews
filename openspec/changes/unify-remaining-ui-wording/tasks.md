# Tasks

## 1. テストを新しい文言に直す

- [x] 1.1 `apps/web/src`の、文言を名前で探すテストを新しい名前に直す。対象は`shell.test.tsx`、`runs.test.tsx`、`settings.test.tsx`、`digests.test.tsx`である。`add-topic.test.tsx`、`annotations.test.tsx`、`filter-from-selection.test.tsx`、`feed-dialogs.test.tsx`も直す。カテゴリの保存の知らせは「カテゴリを保存しました」で確かめる。直したあと、古い文言のままの画面ではテストが失敗する
- [x] 1.2 `settings.test.tsx`の区画の一覧に「アプリの接続」を足し、QRコードのボタンが「アプリの接続」の区画にあり「トークン」の区画にないことを確かめる。`filters.test.tsx`に、隠している記事の一覧を「さらに読み込む」で読み足すテストを足す。古い画面では失敗する

## 2. 画面の文言を直す

- [x] 2.1 `ui/controls.tsx`の「再試行」を「もう一度試す」にする。`shell.test.tsx`で確かめる
- [x] 2.2 `CategoryPage.tsx`の「いますぐ実行」を「いま実行」に、保存の知らせを「カテゴリを保存しました」にする。`runs.test.tsx`と`settings.test.tsx`で確かめる
- [x] 2.3 `DigestPage.tsx`と`SettingsPage.tsx`の「今すぐ作る」を「いま作る」にする。`digests.test.tsx`で確かめる
- [x] 2.4 `FiltersPage.tsx`の「さらに表示」を「さらに読み込む」にする。`filters.test.tsx`で確かめる
- [x] 2.5 `AddTopicDialog.tsx`と`Annotations.tsx`の「トピックを足す」を「トピックを追加」にする。`add-topic.test.tsx`、`annotations.test.tsx`、`filter-from-selection.test.tsx`で確かめる
- [x] 2.6 `AddFeedDialog.tsx`の「閉じる」を「やめる」にする。`feed-dialogs.test.tsx`で確かめる
- [x] 2.7 `SettingsPage.tsx`に区画「アプリの接続」（`#connect`）を足し、`ConnectCode`を移す。区画のリンクにも足す。`settings.test.tsx`で確かめる

## 3. 要件、進行中の変更、文書

- [x] 3.1 `web-shell`と`web-settings`の差分を書く。`openspec validate unify-remaining-ui-wording --strict`で確かめる
- [x] 3.2 `openspec/changes`の進行中の変更の文言を、grilling.mdを除いて直す。対象は`add-digests`、`add-topic-from-reader`、`add-settings-shortcuts`、`add-feed-from-category`である。検索で古い語が残っていないことを確かめる
- [x] 3.3 `README.md`、`README.ja.md`、`docs/providers.md`の「今すぐ作る」を「いま作る」にする。`PRODUCT.md`の「検索はまだない」を消して、できることの一覧に検索を足す。検索で古い語が残っていないことを確かめる

## 4. 確かめる

- [x] 4.1 `apps/web/src`、`README*`、`docs/`、`openspec/changes`（grilling.mdとarchiveを除く）を検索し、古い文言が残っていないことを確かめる
- [ ] 4.2 `make verify`を通す
