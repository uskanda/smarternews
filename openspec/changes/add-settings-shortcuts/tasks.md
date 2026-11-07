# Tasks

どの作業も、失敗するテストを先に書いてから実装する。

## 1. ダイアログからほかの設定へ

- [x] 1.1 `apps/web/src/reader/feed-dialogs.test.tsx` に、「ほかの設定」のテストを書く。その行の編集が開き、名前の入力欄にフォーカスがあることを確かめる。保存していない切り替えが保存されないことも確かめる
- [x] 1.2 `apps/web/src/reader/FeedOptionsDialog.tsx` に、リンク「ほかの設定」を置く。リンク先は `/settings/feeds#feed-<id>` で、選ぶとダイアログを閉じる

## 2. 購読フィードの設定の画面

- [x] 2.1 `apps/web/src/settings/feeds-settings.test.tsx` に、行の「〈名前〉の記事の一覧」で `/f/<id>` へ移るテストを書く。編集の欄を開いている間はリンクが出ないテストも書く
- [x] 2.2 `apps/web/src/settings/feeds-settings.test.tsx` に、`#feed-<id>` で開いたときのテストを書く。その行だけ編集が開き、フォーカスが入り、行までスクロールすることを確かめる。存在しない購読フィードを指定したときは、どの行の編集も開かないことを確かめる
- [x] 2.3 `SettingsPage.tsx` の `useScrollToHash` を、新しい `apps/web/src/ui/useScrollToHash.ts` に移す
- [x] 2.4 `apps/web/src/settings/FeedsPage.tsx` で、行にidと「記事の一覧」のリンクを足す。ハッシュに合う行は、編集を開いた状態から始める。スクロールは一覧を読み込んだあとにする

## 3. 設定の画面

- [x] 3.1 `apps/web/src/settings/settings.test.tsx` に、区画のナビのテストを書く。9つのリンクがあり、各リンクの先の区画があることを確かめる
- [x] 3.2 `apps/web/src/settings/settings.test.tsx` に、スクロールのテストを書く。`/settings#reader` と `/settings#providers` で開いたときと、リンクを選んだときである
- [x] 3.3 `apps/web/src/settings/settings.test.tsx` に、設定の画面に主となるボタンがないテストを書く
- [x] 3.4 `apps/web/src/settings/SettingsPage.tsx` で、見出しの下に区画のリンクを置き、9つの区画にidを付ける。スクロールは、設定とプロバイダーを読み込んだあとにする
- [x] 3.5 `apps/web/src/settings/SettingsPage.tsx` の主となるボタン3つを、`secondary` にする

## 4. 確認

- [x] 4.1 `apps/web` を実際のブラウザーで開いて確かめる。狭い画面と広い画面で、区画のリンクの折り返し、ダイアログの「ほかの設定」、ハッシュで開いたときのスクロールを見る
- [x] 4.2 `make verify` の各検査を通し、`openspec validate add-settings-shortcuts --strict` が通ることを確かめる
