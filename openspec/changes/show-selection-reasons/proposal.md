# Proposal

## Why

生成記事を読んでも、各出典がなぜ選ばれたのかが分からない。判定のタスクは採用した候補にも理由と重要度を残しているが、記事の側からはたどれない。しかも候補は30日で消えるため、記事が残っていても理由は失われる。PRODUCT.mdの「理由を隠さない」という原則に沿い、記事が残っている間ずっと、出典ごとの理由をたどれるようにする。

## What Changes

- 記事を書くとき、採用した候補の判定の理由と重要度を、出典（`article_refs`）に写して保存する。続報で記事を書き直すとき、すでにある出典では最初の理由を残す。
- migrationで出典に2つの列を足し、まだ残っている採用済みの候補から、既存の記事の出典を埋める。
- 記事の詳細のAPIは、出典ごとに`reason`と`importance`を返す。保存されていない出典ではnullになる。
- Webの本文の画面で、生成記事の各出典の下に、判定の重要度と理由を1行で表示する。理由のない出典では表示しない。
- LLMは呼ばない。RSSの出力、配信記事の表示、Androidアプリは変えない。

## Capabilities

### New Capabilities

なし。

### Modified Capabilities

- `http-api`: 記事の詳細の出典に、判定の理由と重要度を足す。
- `web-reader`: 生成記事の出典ごとに、重要度と判定の理由を表示する。

## Impact

- `packages/core/src/db/migrations/027_ref_reasons.sql`（新規。024の`024_feed_http_failures.sql`と版が重なったので027に改めた）
- `packages/core/src/api.ts`（`articleRefSchema`）
- `packages/core/src/db/articles.ts`、`packages/core/src/db/candidates.ts`
- `packages/core/src/pipeline/run.ts`（記事を書く段階）
- `apps/web/src/reader/ArticleView.tsx`
- 上の各箇所のテスト
