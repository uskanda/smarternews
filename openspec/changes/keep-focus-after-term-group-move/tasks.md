# Tasks

## 1. テスト

- [x] 1.1 `term-highlights.test.tsx`に、A、BでAを下へ動かしてからまとまりを追加しても、フォーカスがAの「下へ」へ移らないテストを書き、落ちることを確かめる
- [x] 1.2 A、B、CでCを上へ動かしてからAを削除しても、フォーカスがCの「下へ」へ移らないテストを書き、落ちることを確かめる
- [x] 1.3 A、B、C、DでAを下へ2回続けて動かしても、2回ともフォーカスが動かしたまとまりの操作に残るテストを書く

## 2. 修正

- [x] 2.1 `TermHighlightsPage.tsx`の`GroupRow`で、フォーカスを移したあとに親へ知らせて移動の記録を消す。`serial`を外す。1のテストが通ることを確かめる

## 3. 全体の確認

- [x] 3.1 `make verify`の各検査が通ることを確かめる
- [x] 3.2 `openspec validate keep-focus-after-term-group-move --strict`が通ることを確かめる
