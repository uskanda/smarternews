# Tasks

## 1. DESIGN.md

- [x] 1.1 `selected` の説明に、選択中の行の右端に引く `primary` の3pxの線と理由を書き足し、`designmd lint DESIGN.md` のエラーが0であることを確かめる
- [x] 1.2 `list-row` の説明に、右端の線と未読の行の `未読。` を書き足す。注釈とイベントの一覧の行も同じ扱いにすると書く。`primary` と `selected` の差が3つの配色で3対1以上あることを計算で確かめる

## 2. 選択中の行の線

- [x] 2.1 `reader.test.tsx` と `annotations.test.tsx` で、記事・イベント・注釈の一覧の選択中の行にだけ右端の線があることを確かめるテストを書き、先に失敗させる
- [x] 2.2 `SelectedMark` を作り、`ArticleRow.tsx`、`EventList.tsx`、`AnnotationList.tsx` の選択中の行に置いて、2.1のテストが通ることを確かめる

## 3. キーで移るときのフォーカス

- [x] 3.1 `reader.test.tsx` と `annotations.test.tsx` にテストを書き、先に失敗させる。行をクリックしてから `j` や本文の末尾の `Space` で移ると、選んだ行のリンクにフォーカスがある。本文にフォーカスがあるときは、一覧へ移らない
- [x] 3.2 `ReaderPage.tsx` と `AnnotationList.tsx` の `move` と `useLayoutEffect` にフォーカスの移動を入れ、3.1のテストが通ることを確かめる

## 4. 未読の読み上げ

- [x] 4.1 `reader.test.tsx` で、記事とイベントの一覧の未読の行のリンクの名前が `未読。` で始まり、既読の行には含まれないことのテストを書き、先に失敗させる
- [x] 4.2 `ArticleRow.tsx` と `EventList.tsx` の見出しに `sr-only` の `未読。` を足し、4.1のテストと既存のテストが通ることを確かめる

## 5. 確認

- [x] 5.1 `make verify` と `openspec validate mark-selected-row --strict` が通ることを確かめる
