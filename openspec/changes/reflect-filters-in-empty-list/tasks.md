# Tasks

## 1. テスト

- [x] 1.1 `reader.test.tsx` にテストを書き、先に失敗させる。重要度で絞って0件のカテゴリと「未読」で、絞り込みの文とボタンが出て、ボタンで記事が並ぶ。「既読も表示」で0件のときは、勧める文が出ない

## 2. 実装

- [x] 2.1 `ReaderPage.tsx` の `EmptyList` に `includeRead`、`importantOnly`、`onWiden` を足し、呼び出しから渡して、1.1のテストが通ることを確かめる

## 3. 確認

- [x] 3.1 `make verify` と `openspec validate reflect-filters-in-empty-list --strict` が通ることを確かめる
