# Tasks

## 1. テストの道具

- [x] 1.1 `IntersectionObserver` の代用品のうち、交差を起こせるものをテストの道具に足す。何もしない代用品は既定のまま残す

## 2. 記事の一覧

- [x] 2.1 `reader.test.tsx` と `mentions.test.tsx` のボタンを押すテストを、目印の交差を起こす形に書き直す。読み込みの間の表示、失敗とやり直し、失敗のあとの要求、`rootMargin` のテストを足して、先に失敗させる
- [x] 2.2 `LoadMore` を作り、`ReaderPage.tsx` のボタンを置き換え、続きの失敗では先頭の知らせを出さないようにして、2.1のテストが通ることを確かめる

## 3. 注釈の一覧

- [x] 3.1 `annotations.test.tsx` に、末尾の交差で続きを読み込むことと、失敗のときの表示のテストを書き、先に失敗させる
- [x] 3.2 `AnnotationList.tsx` のボタンを `LoadMore` に置き換え、3.1のテストが通ることを確かめる

## 4. 確認

- [x] 4.1 `make verify` と `openspec validate load-more-on-scroll --strict` が通ることを確かめる
