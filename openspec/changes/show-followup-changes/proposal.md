# Proposal

## Why

続報で書き直された記事は未読に戻るが、画面に出るのは「更新」の印と回数だけである。加わった内容を知るには本文を読み直すしかなく、朝の未読を短い時間で読み終えられない。

## What Changes

- 本文の生成のタスクは、既存の記事を書き直すときだけ、「今回加わったこと」を1〜2文で出力する。呼び出しの回数は増えない。その項目だけが不正でも、記事は保存する。
- クローラーは、書き直しのたびに「今回加わったこと」を保存し直し、出典に加わった時刻と、書き直す前に読んだ時刻を残す。
- APIは、記事の要約に「今回加わったこと」を、出典に新しい出典かどうかを、記事の詳細に前の記事の連なりを足す。前の記事への参照の項目は残す。
- Webの画面は、本文の上に「今回の更新で加わったこと」を、出典に「新しい出典」の印を、一覧の行に「更新：」で始まる1行を出す。「この話題の前の記事」を連なり全体の一覧にする。
- AndroidアプリとRSSの出力は変えない。

## Capabilities

### New Capabilities

なし。

### Modified Capabilities

- `llm-tasks`: 本文の生成のタスクの出力に「今回加わったこと」を足し、それだけが不正な出力の扱いを定める。
- `article-pipeline`: 期間内の続報による更新で「今回加わったこと」と出典に加わった時刻を保存し、更新された記事の未読化で前回読んだ時刻を残す。
- `http-api`: 記事の要約、出典、記事の詳細に項目を足す。
- `web-reader`: 本文の上の「今回の更新で加わったこと」、「新しい出典」の印、一覧の行の更新の1行を足し、前の記事への参照を連なりの表示に改める。

## Impact

- `packages/core/src/llm/tasks.ts`（本文の生成のタスクの出力とプロンプト）
- `packages/core/src/db/migrations/`（`articles`と`article_refs`への列の追加）
- `packages/core/src/db/articles.ts`、`packages/core/src/pipeline/run.ts`
- `packages/core/src/api.ts`（応答の型）、`docs/api.md`
- `apps/web/src/reader/ArticleRow.tsx`、`apps/web/src/reader/ArticleView.tsx`
