# Tasks

失敗するテストを先に書いてから実装する。

## 1. 接続用のQRコードのトークン（#105）

- [x] 1.1 `apps/web/src/settings/settings.test.tsx` にテストを足す。localStorageの読み書きが例外を出す状態でトークンを入力し、設定の画面でボタンを押すと、そのトークンを含むQRコードが出ることを確かめる。足したテストが失敗することを確かめる
- [x] 1.2 `AppServices` に `getToken` を足し、`App` で `() => tokenRef.current` を入れる。`ConnectCode` は `useApp()` から得た `getToken` を使う。`token-store` のimportを外す。1.1のテストと既存の接続のテストが通ることを確かめる

## 2. 全体の確認

- [x] 2.1 `make verify` と `openspec validate fix-connect-code-without-storage --strict` が通ることを確かめる
