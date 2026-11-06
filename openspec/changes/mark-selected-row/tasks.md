# Tasks

## 1. DESIGN.md

- [ ] 1.1 `selected` の説明に、選択中の行の右端に引く `primary` の3pxの線と理由を書き足し、`designmd lint DESIGN.md` のエラーが0であることを確かめる
- [ ] 1.2 `list-row` の説明に、右端の線、未読の行の「未読。」、注釈とイベントの一覧の行も同じ扱いにすることを書き足し、`primary` と `selected` の差が3つの配色で3対1以上あることを計算で確かめる

## 2. 選択中の行の線

- [ ] 2.1 選択中の行にだけ右端の線があることを、記事・イベント・注釈の一覧のテストで先に失敗させる
- [ ] 2.2 `SelectedMark` を作り、`ArticleRow.tsx`、`EventList.tsx`、`AnnotationList.tsx` の選択中の行に置いて、2.1のテストが通ることを確かめる

## 3. キーで移るときのフォーカス

- [ ] 3.1 行をクリックしてから `j` を押すと選んだ行のリンクにフォーカスがあること、本文にフォーカスがあるときはフォーカスが一覧へ移らないことを、記事と注釈の一覧のテストで先に失敗させる
- [ ] 3.2 `ReaderPage.tsx` と `AnnotationList.tsx` の `move` と `useLayoutEffect` にフォーカスの移動を入れ、3.1のテストが通ることを確かめる

## 4. 未読の読み上げ

- [ ] 4.1 未読の行のリンクの名前が「未読。」で始まり、既読の行には含まれないことを、記事とイベントの一覧のテストで先に失敗させる
- [ ] 4.2 `ArticleRow.tsx` と `EventList.tsx` の見出しに `sr-only` の「未読。」を足し、4.1のテストと既存のテストが通ることを確かめる

## 5. 確認

- [ ] 5.1 `make verify` と `openspec validate mark-selected-row --strict` が通ることを確かめる
