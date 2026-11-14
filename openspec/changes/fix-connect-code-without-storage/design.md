# Design

## Context

`App` は、使っているトークンを `tokenRef`（ページの中の変数）に持ち、APIの呼び出しにはこの値を使う。localStorageに書けない環境でも、入力したトークンはここに残る。一方、`ConnectCode` の `show()` は `readToken()` でlocalStorageから読むため、その環境では値が空になり、何もせずに終わる。

## Goals / Non-Goals

**Goals:**

- 接続用のQRコードが、APIの呼び出しと同じトークンを使う。

**Non-Goals:**

- トークンが空のときの説明。設定の画面はトークンがあるときだけ表示され、空のときはトークンの入力の画面に替わる。直したあとは、ボタンが何もしない経路がなくなる。
- ほかの画面の変更。`readToken()` を使うのは、ほかには `App` の初期値だけ。

## Decisions

- 文脈 `AppServices` に `getToken: () => string | null` を足す。`App` は `() => tokenRef.current` を入れる。
- 値そのものを文脈に入れる案は採らない。トークンが変わるたびに、文脈とAPIの呼び出しの部品が作り直されるため。関数なら、今の `useMemo` の作りのまま足せる。
- `ConnectCode` は `useApp()` から得た `getToken` を使い、`token-store` のimportを外す。

## Risks / Trade-offs

- 関数は描画を引き起こさない → QRコードはボタンを押したときに読むので、描画の更新は要らない。
