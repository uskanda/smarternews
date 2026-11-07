# Proposal

## Why

トピックの保存は上書きで、解釈の結果も上書きされる。カテゴリの最低重要度や件数上限の変更も残らない。#138 でトピックの成績が見えるようになったが、トピックを直した効果を、直す前と後で比べる手段がない。前の判定基準に戻したくても、文章を書き戻して解釈し直すしかない。

## What Changes

- トピックの文章、検索語、判定基準、取得元（フィードのURL、ニュース検索、LLM検索）、検索の言語と地域のどれかが変わるたびに、トピックの版を1つ残す。契機（作成、編集、解釈、設定ファイル、版に戻す）も残す。有効と無効の切り替えでは版を作らない。
- カテゴリの最低重要度か件数上限が変わるたびに、カテゴリの版を1つ残す。
- 既存のトピックとカテゴリには、移行のときに今の値で最初の版を入れる。
- `GET /api/v1/topics/:id/versions`、`POST /api/v1/topics/:id/versions/:versionId/restore`、`GET /api/v1/categories/:id/versions` を足す。
- 「この版に戻す」は、選んだ版の値を今の値にし、契機「版に戻す」の新しい版を作る。解釈済みの版なら再解釈は起きない。
- `GET /api/v1/categories/:id/topic-stats` の各トピックに、直近30日の中の最後の版の切れ目と、その前と後の成績を足す。
- Webのトピックの編集に「履歴」の区画と「この版に戻す」を置く。トピックの成績の行は、切れ目があれば「変更前」と「変更後」の2列で並べる。カテゴリの画面に、最低重要度と件数上限の履歴を置く。
- LLMは呼ばない。

## Capabilities

### New Capabilities

なし。

### Modified Capabilities

- `http-api`: トピックとカテゴリの版を残し、一覧と「この版に戻す」のAPIを足す。トピックの成績に版の切れ目の前と後を足す。
- `article-pipeline`: 解釈の結果を反映したときに、トピックの版を作る。
- `web-settings`: トピックの編集に履歴と「この版に戻す」を置き、成績の区画に変更前と変更後を並べ、カテゴリの画面に版の履歴を置く。

## Impact

- `packages/core` の移行：`030_versions.sql` を足す
- `packages/core` の処理：`db/versions.ts` を足し、`db/topics.ts`、`db/categories.ts`、`db/topicStats.ts`、`settings-file.ts`、`pipeline/run.ts` を変える
- `packages/core` の型：`api.ts` に版のスキーマと、成績の切れ目の項目を足す
- `apps/server`：経路を3つ足す
- `packages/client`：`topicVersions`、`restoreTopicVersion`、`categoryVersions` を足す
- `apps/web`：`settings/CategoryPage.tsx`、`settings/TopicStats.tsx`、`settings/TopicHistory.tsx`、`settings/CategoryHistory.tsx`、`api/queries.ts`
- `docs/api.md`：表の3行と版の節
- Androidアプリは変えない（トピックの設定の画面がない）。設定ファイルの書き出しに履歴は入れない
