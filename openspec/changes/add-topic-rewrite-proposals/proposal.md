# Proposal

## Why

判定基準は解釈のタスクが作り、利用者が変えられるのはトピックの文章だけである。
外れの記事を見て文章を直すには、外れの傾向を自分で言葉に直す必要があり、手間がかかる（issue #143、監査ID F-08）。
利用者が求めたときに、読んだ記事、スターの記事、外れの印、判定による除外をもとに、トピックの文章の書き直しの案をLLMに出させる。

## What Changes

- LLMのタスク「トピックの書き直しの案」（`proposeTopicRewrite`）を足す。入力は、トピックの文章と判定基準、読み手情報、開いた記事、スターの記事、外れの見出し、判定が関連なしとした除外である。出力は1〜2案の文章と、変えた点の説明である。
- 呼ぶのは利用者が求めたときだけで、道具は使わせない。1回の求めで1回呼ぶ（不正な応答のあとのやり直しを除く）。
- 専用の1日の上限`limits.topicRewritesPerDay`（既定20回、0で止める）を足す。呼び出しは`llmCallsPerDay`と月の予算にも数える。`llmCallsPerDay`の既定380回は変えない。
- 割り当てがなければ`smart`を使い、なければ既定のプロバイダーを使う。
- APIに`POST /api/v1/topics/:id/rewrite-proposals`を足す。同期で案を返し、何も保存しない。
- Webのトピックの編集に「書き直しの案を出す」を置く。案ごとに「この案を使う」で編集欄の文章を置き換える。保存は利用者がする。

## Capabilities

### New Capabilities

なし。

### Modified Capabilities

- `llm-tasks`：タスクの限定に書き直しの案を足す。書き直しの案のタスク、呼ぶ時点、割り当て、1日の上限、1日の呼び出し回数と予算への計数、呼び出しの記録を足す。1日あたりの呼び出し回数の上限の既定の説明を改める
- `http-api`：トピックの書き直しの案を求める操作を足す
- `web-settings`：トピックの編集での書き直しの案の要件を足す

## Impact

- `packages/core`：タスクの定義、`TaskRunner`の上限と計数、設定の`limits.topicRewritesPerDay`と、`tasks`の`proposeTopicRewrite`。入力を読む関数、案を求める処理、APIの型も足す。
- `apps/server`：1つの操作と、上限の受け渡し。
- `packages/client`：操作の呼び出しと、タスクの表示名。
- `apps/web`：トピックの編集のボタンと案の一覧。
- 文書：README.md、README.ja.md、docs/providers.md、docs/api.md、examples/config.example.yaml。
- データベースの移行はない。Androidアプリは変えない。
