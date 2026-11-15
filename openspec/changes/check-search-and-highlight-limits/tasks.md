# Tasks

## 1. 確かめる関数

- [x] 1.1 `packages/client/src/messages.test.ts` に検索の語のテストを先に書き、失敗を確かめる。200文字と201文字、前後の空白、絵文字を扱う
- [x] 1.2 `packages/client/src/messages.test.ts` に、ハイライトの引用の5000文字と5001文字のテストを先に書き、失敗を確かめる
- [x] 1.3 `packages/client/src/messages.ts` に `checkSearchWords` と `checkHighlightQuote` を足す。1.1と1.2のテストが通ることを確かめる

## 2. 検索欄

- [x] 2.1 `apps/web/src/reader/search.test.tsx` に、201文字の語では画面を移さずに理由を出すテストを先に書き、失敗を確かめる。直して押し直すと移ることも確かめる
- [x] 2.2 `apps/web/src/shell/Shell.tsx` の検索欄で語を確かめて理由を出し、2.1のテストが通ることを確かめる

## 3. 検索の結果の画面

- [x] 3.1 `apps/web/src/reader/search.test.tsx` に、201文字の語のURLのテストを先に書き、失敗を確かめる。APIを呼ばず、理由を出し、「再試行」を出さないことを確かめる
- [x] 3.2 `apps/web/src/ui/controls.tsx` の `ErrorNotice` に、決まった文を渡せるようにする
- [x] 3.3 `apps/web/src/reader/ReaderPage.tsx` で長すぎる語の検索を止めて理由を出し、3.1のテストが通ることを確かめる

## 4. ハイライト

- [x] 4.1 `apps/web/src/reader/annotations.test.tsx` に、5001文字の選択のテストを先に書き、失敗を確かめる。入口は「ハイライト」、`h` キー、右クリックのメニュー、「メモを書く」である
- [x] 4.2 4.1のテストでは、APIを呼ばず知らせに理由が出ること、「メモを書く」でダイアログが開かないことを確かめる
- [x] 4.3 `apps/web/src/reader/Annotations.tsx` で、ハイライトを付ける前に引用の長さを確かめ、4.1のテストが通ることを確かめる

## 5. 全体の確かめ

- [ ] 5.1 `make verify` が通ることを確かめる
- [x] 5.2 `openspec validate check-search-and-highlight-limits --strict` が通ることを確かめる
