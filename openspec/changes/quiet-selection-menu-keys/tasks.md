# Tasks

## 1. 選んだ文字列のメニュー

- [x] 1.1 `apps/web/src/reader/filter-from-selection.test.tsx` に、選んだ文字列のメニューを開いて `j` と `s` を押すテストを足す。記事が変わらないこと、メニューが開いたままであること、スターが付かないことを確かめる。印を足す前に失敗することを確かめる
- [x] 1.2 `apps/web/src/reader/Annotations.tsx` の選んだ文字列のメニューの `ContextMenu.Content` に `data-hotkeys="off"` を足す。1.1のテストが通ることを確かめる

## 2. 確認

- [ ] 2.1 `make verify` を通し、`openspec validate quiet-selection-menu-keys --strict` が通ることを確かめる
