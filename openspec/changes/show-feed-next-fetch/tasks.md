# Tasks

## 1. 続けて失敗した回数

- [x] 1.1 `feeds-settings.test.tsx` に、`failureCount` が1の行には回数が出ず、3の行には「3回続けて失敗」が出るテストを先に書き、失敗することを確かめる
- [x] 1.2 `FeedsPage.tsx` の `FetchState` に回数の表示を足し、1.1のテストが通ることを確かめる

## 2. 次の取得

- [x] 2.1 `feeds-settings.test.tsx` に、次の取得の日時が未来の行、過ぎた行、一時停止中の行のテストを先に書き、失敗することを確かめる
- [x] 2.2 `FetchState` に次の取得の表示を足し、2.1のテストが通ることを確かめる

## 3. 全体の確認

- [x] 3.1 `make verify` と `openspec validate show-feed-next-fetch --strict` が通ることを確かめる
