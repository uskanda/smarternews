# Proposal

## Why

予算の警告はどの画面でも上部に出る。一方、実行の失敗、上限での停止、解釈の失敗は、実行履歴を開かないと見えない。0件が続く検索や、記事を生まないトピック、Google Newsの転送用URLの解決の失敗は、実行履歴を開いても気付きにくい。このため、収集が静かに止まっていても、利用者は記事が減ったことでしか気付けない。

## What Changes

- 実行の異常を、プログラムで「注意」の項目にまとめる。LLMは呼ばない。項目は次の5種類である
  - 最新の定時の実行が失敗し、やり直しの予定もないカテゴリと、上限で止まったカテゴリ
  - 実行を経ても、解釈が未了のままのトピック
  - 直近3回の試行で0件が続くニュース検索（検索先と検索語の組）とLLM検索（トピック）
  - 直近14日に、記事が作られず、更新もされていないトピック
  - 直近3回の実行で、Google Newsの転送用URLを1件も解決できなかったこと
- 検索を1回試すごとに、返った結果の数とGoogle Newsの解決の数を記録する。記録は実行履歴と同じ30日で消す
- APIに、注意の一覧と、項目を「確認した」とする操作を足す。確認した項目は、きっかけが変わるまで一覧に出さない
- Webの実行履歴の画面の先頭に「注意」の区画を置く。左のペインの「実行履歴」に、確認していない項目の数を付ける
- 最初のgrillingの「通知は初版では出さない」を、Webの画面の中に限って決め直す。Androidアプリと外への通知は変えない

## Capabilities

### New Capabilities

なし。

### Modified Capabilities

- `runs`：検索の試行の記録と、その保存期間。注意の項目の条件と、確認した項目の扱い
- `http-api`：注意の一覧と、確認の操作
- `web-runs`：実行履歴の画面の「注意」の区画と、確認の操作
- `web-shell`：左のペインの「実行履歴」の件数の印

## Impact

- `packages/core`の保存：移行`029_attention.sql`（表`search_attempts`と`attention_dismissals`）と`db/search-attempts.ts`
- `packages/core`の処理：`sources/news-search.ts`、`pipeline/run.ts`、`runs/retention.ts`、`api.ts`の型
- `packages/core`の新しい処理：`runs/attention.ts`
- `apps/server`：`GET /api/v1/attention`と`POST /api/v1/attention/dismissals`
- `packages/client`：APIの呼び出しと、項目の説明の文
- `apps/web`：`Shell.tsx`の「実行履歴」の印、`RunsPage.tsx`の「注意」の区画、`queries.ts`
- `docs/api.md`
- Androidアプリは変わらない
