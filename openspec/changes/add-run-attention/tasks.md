# Tasks

## 1. 検索の試行の記録

- [x] 1.1 `news-search.test.ts`に、返った数と、Google Newsの解決を試した数と解決できなかった数のテストを足し、失敗を確かめる
- [x] 1.2 `news-search.ts`に`searchNews`を足し、`collectNews`はその候補を返すようにする
- [x] 1.3 `collect.test.ts`に、試行ごとの記録、判定済みのURLを除く前の数、エラーの試行、フィードを記録しないことのテストを足し、失敗を確かめる
- [x] 1.4 `026_attention.sql`の移行で`search_attempts`と`attention_dismissals`を足し、`run.ts`の`attempt`で試行を記録する
- [x] 1.5 `retention.test.ts`に、試行と確認の記録が30日で消えるテストを足し、`purgeExpired`で消す

## 2. 注意の一覧

- [x] 2.1 `attention.test.ts`に、5種類の項目の条件を満たす場合と満たさない場合、確認した項目の扱い、鍵が変わると項目がまた出ることのテストを書き、失敗を確かめる
- [x] 2.2 `api.ts`に注意の項目の型を足し、`runs/attention.ts`に`listAttention`と`dismissAttention`を書く

## 3. API

- [x] 3.1 `runs-api.test.ts`に、一覧、確認、確認のあとに件数が減ること、空の鍵の拒否のテストを足し、失敗を確かめる
- [x] 3.2 `GET /api/attention`と`POST /api/attention/dismissals`を足し、`packages/client`に呼び出しと説明の文を足す
- [x] 3.3 `docs/api.md`に2つの操作を書き足す

## 4. Webの画面

- [x] 4.1 `runs.test.tsx`と`shell.test.tsx`に、区画の表示、確認の操作とその失敗、左のペインの件数とその読み上げ名のテストを足し、失敗を確かめる
- [x] 4.2 `queries.ts`に`useAttention`と確認の操作を足し、`RunsPage.tsx`に「注意」の区画を、`Shell.tsx`に件数の印を置く

## 5. 確かめる

- [x] 5.1 `openspec/glossary.yml`に「注意の項目」と「検索の試行」を足す
- [x] 5.2 `openspec validate add-run-attention --strict`を通す
- [x] 5.3 `make verify`を通す
