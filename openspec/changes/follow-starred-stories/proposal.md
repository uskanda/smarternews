# Proposal

## Why

続報を結び付ける相手は、直近14日に更新した記事だけである。スターを付けた話題の続きが3週間後に出ても、前の記事とつながらない新しい記事になる。前の記事へのリンクは出るが、後の記事へのリンクはないので、スターを付けた記事から続きにたどり着けない。

## What Changes

- 集約の入力に、そのカテゴリのスター付きのニュースの生成記事を加える。範囲は更新から90日以内、更新の新しい順に20件までとする。スター付きの記事に後の記事があるときは、連なりのいちばん新しい記事を代わりに渡す。LLMの呼び出しの回数は増えない。
- APIは、記事の詳細にその後の記事の連なりを、記事の要約にスター付きの記事に続く記事かどうかと未読の続報の件数を足す。一覧に、スター付きの話題の記事だけに絞る指定を足す。
- Webの画面は、本文に「この話題のその後の記事」を、スター付きの記事の一覧の行に未読の続報があることを示す印「続報あり」を出す。
- Androidアプリは、スター付きの記事の続報と、スター付きの記事そのものの書き直しを、重要度の設定にかかわらず通知する。通知の設定が「出さない」なら通知しない。アプリの表示は変えない。

## Capabilities

### New Capabilities

なし。

### Modified Capabilities

- `article-pipeline`: 集約に渡す既存の記事に、スター付きの話題の記事を加える。
- `http-api`: その後の記事の連なり、スター付きの記事に続く記事かどうか、未読の続報の件数を返し、スター付きの話題での絞り込みを受け付ける。
- `web-reader`: 本文の「この話題のその後の記事」と、一覧の行の「続報あり」の印を表示する。
- `mobile-notifications`: スター付きの話題の続報を、重要度の設定にかかわらず通知する。

## Impact

- `packages/core/src/db/migrations/`（`articles (previous_article_id)` の索引）
- `packages/core/src/db/articles.ts`、`packages/core/src/pipeline/run.ts`
- `packages/core/src/api.ts`（応答の型と一覧の指定）、`docs/api.md`
- `apps/web/src/reader/ArticleView.tsx`、`apps/web/src/reader/ArticleRow.tsx`
- `packages/client/src/notify.ts`、`apps/mobile/src/notifications/check.ts`

集約の入力は最大20件分長くなる。誤った結び付けが増えるおそれは、件数の上限で抑える。
