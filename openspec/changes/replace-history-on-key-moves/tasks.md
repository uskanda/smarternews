# Tasks

どの作業も、失敗するテストを先に書いてから実装する。

## 1. テストの道具

- [ ] 1.1 `apps/web/src/testing/harness.tsx` に、ブラウザーの履歴で描くオプションと戻る操作を足す。2と3のテストで使えることを確かめる

## 2. 記事の一覧

- [x] 2.1 `apps/web/src/reader/reader.test.tsx` に、行で開いてから `j`・`k` で移り、戻ると一覧に戻るテストと、`j` で最初の記事を開いてから戻ると一覧に戻るテストを足す
- [x] 2.2同じファイルに、記事を開いたまま行を押すと、戻る操作で前の記事に戻るテストと、本文の末尾の `Space` で移っても履歴が増えないテストを足す
- [ ] 2.3 `apps/web/src/reader/ReaderPage.tsx` のキーでの移動で、記事が開いていれば履歴を置き換える。2.1と2.2のテストと、既存の `j`・`k` のテストが通ることを確かめる

## 3. 注釈の一覧

- [x] 3.1 `apps/web/src/reader/annotations.test.tsx` に、注釈の一覧を `j`・`k` で移ってから戻ると、注釈を開く前の一覧に戻るテストを足す
- [ ] 3.2 `apps/web/src/reader/AnnotationList.tsx` のキーでの移動で、注釈が開いていれば履歴を置き換える。3.1のテストが通ることを確かめる

## 4. 確認

- [ ] 4.1 `make verify` を通し、`openspec validate replace-history-on-key-moves --strict` が通ることを確かめる
