# Tasks

## 1. 共有のモデル

- [x] 1.1 `order.test.ts` に候補のテストを書き、失敗を確かめる。対象は、並び、部分一致、文字の幅と大小の同一視、複数の語、隠す前のモデルの使用である
- [x] 1.2 `order.ts` に `jumpCandidates` を足し、テストを通す

## 2. Web

- [x] 2.1 `shell.test.tsx` に `g u` のテストを書く。対象は、開くことと絞り込み、矢印のキーとEnterでの移動、折りたたんだ項目と隠している項目である
- [x] 2.2 `shell.test.tsx` に、当たらないときと変換中のEnterのテストと、Escのテストを書く
- [x] 2.3 `shell.test.tsx` に、ダイアログの中のキーと狭い画面の左のペインのテストを書く
- [x] 2.4 `settings.test.tsx` に、未保存の編集があるときの `g u` からの移動で確認が出るテストを書く
- [x] 2.5 `JumpDialog.tsx` を足し、`Shell.tsx` のキーの表と `useHotkeys` に `g u` を足して、テストを通す
- [x] 2.6 `shell.test.tsx` と `reader/mentions.test.tsx` のキーの一覧の期待値に `g u` を足す

## 3. 文書

- [x] 3.1 `README.md` と `README.ja.md` のキー操作の説明に `g u` を足す
- [x] 3.2 `openspec validate add-nav-jump-dialog --strict` と `make verify` を通す
