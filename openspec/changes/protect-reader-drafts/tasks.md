# Tasks

どの作業も、失敗するテストを先に書いてから実装する。テストは実際のLLMと外部サイトを呼ばない。

## 1. ダイアログの共通の守り

- [x] 1.1 `settings/unsaved.tsx` を `ui/unsaved.tsx` へ移し、設定の画面の読み込み先を直す。設定の画面のテストが通ることで確かめる。対象は `settings.test.tsx`、`feeds-settings.test.tsx`、`filters.test.tsx`、`term-highlights.test.tsx` である
- [x] 1.2 `FormDialog` が、中の部品の変更を集める。外を押しても閉じないことと、Escape、`Dialog.Close`、`useDialogCancel` で確認を出すことを `ui/form-dialog.test.tsx` で確かめる。確認の2つの操作と、入力がなければすぐ閉じることも確かめる

## 2. 購読フィードとトピックのダイアログ

- [x] 2.1 `AddFeedDialog` の「閉じる」と、`FeedOptionsDialog` の「やめる」で確認を出す。購読フィードの設定は、切り替えと保存の待ちを知らせる。「登録を解除」と「ほかの設定」が確認を出さないことも含め、`reader/feed-dialogs.test.tsx` で確かめる。既存の「Escapeで閉じる」場面を新しい仕様に合わせる
- [x] 2.2 `AddTopicDialog` で、文章とカテゴリの変更と追加の待ちを知らせ、「やめる」で確認を出す。`reader/add-topic.test.tsx` で確かめる

## 3. 隠すフィルターを作るダイアログ

- [x] 3.1 `FilterFromSelectionDialog` を `FormDialog` に移し、`FilterForm` が `initial` と比べて変更を知らせる。開いたままの値なら確認なしに閉じ、変えたら確認が出ることを `reader/filter-from-selection.test.tsx` で確かめる。設定の画面の新しいフィルターの確認が変わらないことを `filters.test.tsx` で確かめる

## 4. ハイライトと記事へのメモ

- [x] 4.1 `HighlightDialog` と `NewHighlightDialog` を `FormDialog` に移し、`NoteForm` が書きかけを知らせ、「やめる」で確認を出す。外を押しても閉じないこと、Escapeで確認が出ることを `reader/annotations.test.tsx` で確かめる
- [x] 4.2 `lib/note-drafts.ts` で、記事へのメモの書きかけを記事ごとに `sessionStorage` へ覚える。保存領域が使えないときに例外を出さないことを `lib/note-drafts.test.ts` で確かめる
- [x] 4.3 `ArticleNoteSection` で、覚えた書きかけを戻す。別の記事へ移って戻ると書きかけが入っていること、フォーカスが移らないことを `reader/annotations.test.tsx` で確かめる。やめるで確認して書きかけが消えることと、保存すると消えることも確かめる

## 5. 確認

- [x] 5.1 `make verify` を通し、`openspec validate protect-reader-drafts --strict` を通す
