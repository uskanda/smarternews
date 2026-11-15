# Tasks

どの作業も、失敗するテストを先に書いてから実装する。

## 1. テスト

- [x] 1.1 `apps/web/src/lib/keys.test.ts` に、`repeat: true` の `Shift+A`・`Shift+J`・`m` などが操作を呼ばないテストを足す
- [x] 1.2 `apps/web/src/lib/keys.test.ts` に、`repeat: true` の `j`・`k`・`Space`・`Shift+Space` が操作を呼ぶテストを足す。`repeat` のない最初の1回も動くことを確かめる
- [x] 1.3 `apps/web/src/lib/keys.test.ts` に、`g` のあとに `repeat: true` の `g` が来ても、続く2打目で組み合わせが動くテストを足す。1.1と1.3が失敗することを確かめる

## 2. 実装

- [x] 2.1 `apps/web/src/lib/keys.ts` に `REPEATABLE_KEYS` を足し、`onKeyDown` で繰り返してよいキー以外の繰り返しの入力を無視する。1のテストが通ることを確かめる
- [x] 2.2 `useHotkeys` の説明のコメントに、押し続けたときの扱いを足す

## 3. 確認

- [x] 3.1 `make verify` を通し、`openspec validate ignore-key-repeat --strict` が通ることを確かめる
