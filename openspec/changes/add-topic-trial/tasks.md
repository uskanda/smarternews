# Tasks

どの作業も、失敗するテストを先に書いてから実装する。

## 1. 呼び出しの用途と上限

- [ ] 1.1 `022_llm_call_purpose.sql` で `llm_calls` に `purpose` を足し、`packages/core/src/db/database.test.ts` などの既存のテストが通ることを確かめる
- [ ] 1.2 `TaskRunner` に、`CallBudget.purpose`、`topicTrialsToday()`、`trialBlocked(calls)`、`topicTrialsPerDay`（既定30）を足す。試しの呼び出しが `purpose='trial'` で記録され、試しと1日の両方に数えられること、試しの上限で止まっても実行は止まらないことを `runner.test.ts` で確かめる
- [ ] 1.3 `config.ts` に `limits.topicTrialsPerDay`（0以上、既定30）を足し、`llmCallsPerDay` の既定を380にする。既定と負の値の誤りを `config.test.ts` で確かめ、`apps/server/src/runtime.ts` からランナーに渡す
- [ ] 1.4 README.md、README.ja.md、docs/providers.md、examples/config.example.yaml に、`topicTrialsPerDay` と既定380回を書き、`make verify-textlint` が通ることを確かめる

## 2. 試しの処理

- [ ] 2.1 `reasons.ts` に `programReasonCode(reason)` を足し、日本語と英語の決まった文を見分け、ほかの文で null を返すことをテストで確かめる
- [ ] 2.2 `db/candidates.ts` に `listTrialCandidates` を足す。2つの側に分けて取り、足りない分を埋めること、公開日時が不明の候補が入らないこと、プログラムの理由で除外した候補が採用の側に入ることを `candidates.test.ts` で確かめる
- [ ] 2.3 `api.ts` に、試しの入力、結果、状態の型とスキーマを足す
- [ ] 2.4 `pipeline/trial.ts` に `runTopicTrial` を作る。偽のLLMで、呼び出しが解釈1回と判定2回であること、試すトピックだけが差し替わること、組ごとの現在時刻、入れ替わりと最低を下回る旨、試しのあとで topics、candidates、candidate_topics、seen_urls、articles が変わらないことを `trial.test.ts` で確かめる

## 3. サーバーとAPI

- [ ] 3.1 `apps/server` に `TopicTrials` と、`POST /api/v1/topics/:id/trials`、`GET /api/v1/topic-trials/:id` を足す。202と問い合わせの結果、動いている間の409、上限0での断り、存在しないトピックと結果の404を `topic-trials-api.test.ts` で確かめる
- [ ] 3.2 `apps/server/src/testing.ts` に `topicTrialsPerDay` を足す
- [ ] 3.3 `docs/api.md` の Topics の節に2つの操作を書く
- [ ] 3.4 `packages/client/src/api.ts` に `startTopicTrial` と `topicTrial` を足し、型が通ることを確かめる

## 4. 画面

- [ ] 4.1 `TopicEditor` に「試す」と結果の表示を足す。編集中の文章が送られ保存の要求が出ないこと、結果の一覧、入れ替わりがないときの表示、上限で断られたときの表示を `apps/web/src/settings/topic-trial.test.tsx` で確かめる

## 5. 確かめ

- [ ] 5.1 `make verify` と `openspec validate add-topic-trial --strict` が通ることを確かめる
