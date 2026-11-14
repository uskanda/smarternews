# Tasks

どの作業も、失敗するテストを先に書いてから実装する。

## 1. 記事の一覧を空として扱う

- [x] 1.1 `apps/web/src/reader/annotations.test.tsx` にテストを足す。「すべて」で記事を開いて「注釈」へ移り、`s`・`m`・`o` を押す。その記事への要求はサーバーへ送られず、ウィンドウも開かない
- [x] 1.2 `apps/web/src/reader/reader.test.tsx` に、「すべて」を読んだあとに存在しない購読フィードのパスへ移り、`s`・`m`・`Space` が何もしないテストを足す
- [x] 1.3 `apps/web/src/reader/ReaderPage.tsx` で、注釈の画面と、一覧の種類が決まらない画面では、取得した行と残しておいた行を一覧に入れない。一覧のキーに注釈の画面であることを含める。1.1と1.2のテストが通ることを確かめる

## 2. 注釈の画面のSpace

- [x] 2.1 `apps/web/src/reader/annotations.test.tsx` にテストを足す。`Space` で注釈の1件目から2件目へ移る。本文の末尾の `Space` で次の注釈へ移り、先頭の `Shift+Space` で前の注釈へ戻る。「すべて」の記事のパスへは移らず、その記事への要求も送られない
- [x] 2.2 `apps/web/src/reader/AnnotationList.tsx` の移動の処理をrefのpropで渡す。`ReaderPage.tsx` の `Space` の処理は、注釈の画面ではそれを呼ぶ。2.1のテストが通ることを確かめる

## 3. 確認

- [x] 3.1 `make verify` を通し、`openspec validate fix-annotation-keys --strict` が通ることを確かめる
