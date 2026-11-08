# Tasks

## 1. 共通のフック

- [x] 1.1 `firstField`の単体テストを先に書き、落ちることを確かめる。対象は、textareaから始まる欄、ラジオボタンから始まる欄、無効な欄を飛ばす欄
- [x] 1.2 `apps/web/src/settings/inline-edit-focus.ts`に`firstField`と`useInlineEditFocus`を書き、1.1のテストが通ることを確かめる

## 2. 各画面への適用

- [x] 2.1 `settings.test.tsx`に、トピックの開閉のフォーカスのテストを書き、落ちることを確かめる。`CategoryPage.tsx`の`TopicItem`でフックを使い、通す
- [x] 2.2 `filters.test.tsx`に、フィルターの開閉と、画面を開いた直後に動かないことのテストを書く。`FiltersPage.tsx`の`FilterRow`でフックを使い、通す
- [x] 2.3 `term-highlights.test.tsx`に、語のまとまりの開閉のテストを書き、落ちることを確かめる。`TermHighlightsPage.tsx`の`GroupRow`でフックを使い、通す
- [x] 2.4 `FeedsPage.tsx`の今の処理をフックに置き換え、`feeds-settings.test.tsx`の今あるフォーカスのテストが通ることを確かめる

## 3. 全体の確認

- [x] 3.1 `make verify`の各検査が通ることを確かめる
- [x] 3.2 `openspec validate align-inline-edit-focus --strict`が通ることを確かめる
