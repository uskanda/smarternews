# Tasks

どの作業も、失敗するテストを先に書いてから実装する。

## 1. 戻ったときの位置と選択

- [ ] 1.1 `apps/web/src/reader/ReaderPage.tsx` で、一覧ごとのスクロール位置と最後に開いた記事を覚え、狭い画面で戻ったときに位置、選択、フォーカスを戻す。「一覧へ戻る」とブラウザーの戻る操作の両方を、`apps/web/src/shell/shell.test.tsx` のテストで確かめる
- [ ] 1.2 `apps/web/src/shell/shell.test.tsx` のテストで、戻ったあとの `j` が直前の行の次へ進むことを確かめる
- [ ] 1.3 `apps/web/src/reader/reader.test.tsx` のテストで、「スクロールで既読にする」を有効にして戻っても、上を通り過ぎた行が既読にならないことを確かめる

## 2. ページの境目での移動

- [ ] 2.1 `move` が、読み込んだ最後の記事で続きのページがあるとき、次のページを読み込んでその最初の記事へ移るようにする。`j` と `Space` の両方と、続きがないときに止まることを、`apps/web/src/reader/reader.test.tsx` のテストで確かめる

## 3. 本文の末尾の「前の記事」「次の記事」

- [ ] 3.1 `apps/web/src/reader/ArticleView.tsx` に「前の記事」「次の記事」を置き、狭い画面だけで `ReaderPage.tsx` から隣の記事を渡す。見出しと行き先、一覧の端で片方だけが出ること、広い画面では出ないことを、`apps/web/src/shell/shell.test.tsx` のテストで確かめる
- [ ] 3.2 `apps/web/src/shell/shell.test.tsx` のテストで、「次の記事」を何度か選んで表示範囲の外まで進んでから戻ると、その行が表示範囲の中に送られていることを確かめる
- [ ] 3.3 `apps/web/src/reader/reader.test.tsx` のテストで、続きのページがあるときの最後の記事の「次の記事」が、次のページの最初の記事を開くことを確かめる

## 4. 確認

- [ ] 4.1 `apps/web` を実際のブラウザーで幅390pxの画面で開き、戻る動きと「前の記事」「次の記事」の見た目を確かめる
- [ ] 4.2 `make verify` を通し、`openspec validate keep-narrow-list-place --strict` が通ることを確かめる
