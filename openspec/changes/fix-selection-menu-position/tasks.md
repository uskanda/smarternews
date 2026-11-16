# Tasks

どの作業も、失敗するテストを先に書いてから実装する。

## 1. 位置の計算

- [x] 1.1 `placeMenu` の単体テストを書く。はみ出さないとき、右にはみ出すとき（幅390px、範囲の左249px、メニューの幅210pxなら left は172px）、下にはみ出すとき、上下どちらにも入らないときを確かめ、失敗することを確かめる
- [x] 1.2 `apps/web/src/reader/Annotations.tsx` に `placeMenu` を足し、1.1のテストを通す

## 2. 測り直しと隠すこと

- [x] 2.1 `apps/web/src/reader/annotations.test.tsx` に結合テストを足す。Range とペインの `getBoundingClientRect` を差し替える。ペインの `scroll` でツールバーの top が変わることを確かめる。範囲をペインの外に出すとツールバーが消え、戻すとまた出ることも確かめる。どれも失敗することを先に確かめる
- [x] 2.2 `selectionIn` の `rect` に `right` を足し、`scroll`（capture）と `resize` で範囲の矩形を1フレームに1回測り直す。範囲がペインと重ならないときはツールバーを描かない。ツールバーの大きさを `useLayoutEffect` で測り、`placeMenu` の位置を当てる。2.1のテストを通す

## 3. 見た目と確認

- [x] 3.1 `apps/web/src/styles/app.css` の `.selection-menu` に折り返しと最大幅を足す。`flex-wrap: wrap` と `max-width: calc(100vw - 2 * 8px)` である
- [x] 3.2 `make verify` を通す。lint、型、テスト、ビルドは通った。`verify-private` はサンドボックスの空のファイルを読めずに止まり、`verify-textlint` はmainにある別の変更の指摘でも止まる
- [x] 3.3 `openspec validate fix-selection-menu-position --strict` を通す
