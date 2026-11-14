# Tasks

## 1. テスト

- [x] 1.1 `runs.test.tsx`に、100件のときに注記が出ること、99件のときに出ないこと、絞り込み中は絞り込みを勧める文が出ないことのテストを書き、失敗することを確かめる

## 2. 実装

- [x] 2.1 `queries.ts`に上限の定数`RUNS_LIMIT`を書き出し、`useRuns`で使う
- [x] 2.2 `RunsPage.tsx`で、返った件数が上限に達したとき、表の下に絞り込みの有無に応じた注記を出す
- [x] 2.3 `runs.test.tsx`に足したテストが通ることを確かめる

## 3. 確認

- [x] 3.1 `make verify`が通ることを確かめる（サンドボックスの空のファイルを読めず`check:private`だけ実行できなかった。既存の変更の文書の指摘は残る）
- [x] 3.2 `openspec validate show-runs-list-limit --strict`が通ることを確かめる
