# Tasks

どの作業も、失敗するテストを先に書いてから実装する。

## 1. 既定の変更

- [x] 1.1 `packages/core` に移行を足し、保存済みの設定を有効にする。移行のテストで確かめる
- [x] 1.2 `packages/core/src/db/settings.ts` で、設定を初めて保存するときの値を有効にする。既定が有効であること、無効にした値が保たれることをテストで確かめる
- [x] 1.3 `docs/api.md`、`README.md`、`README.ja.md`、`examples/settings.example.yaml` の既定の説明を直す
- [x] 1.4 `make verify` を通し、`openspec validate enable-advance-by-default --strict` が通ることを確かめる
