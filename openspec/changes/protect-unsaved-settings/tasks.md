# Tasks

どの作業も、失敗するテストを先に書いてから実装する。テストは実際のLLMと外部サイトを呼ばない。

## 1. 仕組みとカテゴリの編集の画面

- [ ] 1.1 `apps/web/src/settings/unsaved.tsx` に `UnsavedGuard`、`useUnsaved`、`useUnsavedLeaving` を作る。`CategoryPage.tsx` の確認を、これで置き換える。今のカテゴリの確認のテストが通ることを確かめる。カテゴリを削除したあとに確認が出ないことも確かめる
- [ ] 1.2 `TopicEditor` と新しいトピックの欄を登録する。左のペインと `Shift+J` で止まること、空の欄では止まらないこと、2つの欄の名前が並ぶことを `settings.test.tsx` で確かめる
- [ ] 1.3 `TopicEditor` の「閉じる」で、変更があるときだけ確かめる。「破棄して閉じる」と「編集を続ける」の動きを `settings.test.tsx` で確かめる
- [ ] 1.4 `beforeunload` の既定の動作を、変更があるときだけ止める。`settings.test.tsx` で確かめる

## 2. 設定の画面

- [ ] 2.1 `SettingsPage.tsx` で、新しいカテゴリの名前、読み手情報、全体設定を登録する。止まること、保存したあとと追加して移るときに止まらないこと、「この端末の設定」で止まらないことを `settings.test.tsx` で確かめる

## 3. 購読フィード、フィルター、語の色付けの画面

- [ ] 3.1 `FeedsPage.tsx` と `AddFeedForm.tsx` で、購読フィードの編集、基本の取得周期、URLの欄を登録する。止まることと、「やめる」が確かめずに閉じることを `feeds-settings.test.tsx` で確かめる
- [ ] 3.2 `FilterForm.tsx` で、フィルターの編集と新しいフィルターを登録する。止まることと、記事の画面の選択範囲からフィルターを作るダイアログが対象にならないことを `filters.test.tsx` で確かめる
- [ ] 3.3 `TermHighlightsPage.tsx` で、まとまりの追加、編集、語の追加を登録する。止まることを `term-highlights.test.tsx` で確かめる

## 4. 確認

- [ ] 4.1 `make verify` を通し、`openspec validate protect-unsaved-settings --strict` を通す
