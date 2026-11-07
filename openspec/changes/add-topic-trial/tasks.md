# Tasks

どの作業も、失敗するテストを先に書いてから実装する。

## 1. 呼び出しの用途と上限

- [x] 1.1 `022_llm_call_purpose.sql`で`llm_calls`に`purpose`を足す。既存のテストが通ることを確かめる
- [x] 1.2 `TaskRunner`に、`CallBudget.purpose`と`topicTrialsToday()`と`trialBlocked(calls)`を足す。上限`topicTrialsPerDay`の既定は30とする
- [x] 1.3 `runner.test.ts`で確かめる。試しの呼び出しが`purpose='trial'`で記録され、試しと1日の両方に数えられる。試しの上限で止まっても、実行は止まらない
- [x] 1.4 `config.ts`に`limits.topicTrialsPerDay`（0以上、既定30）を足し、`llmCallsPerDay`の既定を380にする。既定と誤りを`config.test.ts`で確かめる
- [x] 1.5 `apps/server/src/runtime.ts`から、試しの上限をランナーに渡す
- [x] 1.6 README.md、README.ja.md、docs/providers.md、examples/config.example.yamlに、試しの上限と既定380回を書く。textlintが通ることを確かめる

## 2. 試しの処理

- [x] 2.1 `reasons.ts`に`programReasonCode(reason)`を足す。日本語と英語の決まった文を見分け、ほかの文でnullを返すことをテストで確かめる
- [x] 2.2 `db/candidates.ts`に`listTrialCandidates`を足し、`candidates.test.ts`で確かめる。2つの側に分けて取り、足りない分を埋める。公開日時が不明の候補は入らない
- [x] 2.3 `candidates.test.ts`で、プログラムの理由で除外した候補が採用の側に入ることを確かめる
- [x] 2.4 `api.ts`に、試しの入力、結果、状態の型とスキーマを足し、型検査が通ることを確かめる
- [x] 2.5 `pipeline/trial.ts`に`planTopicTrial`を作る。偽のLLMで、呼び出しが解釈1回と判定2回であることを`trial.test.ts`で確かめる
- [x] 2.6 `trial.test.ts`で、試すトピックだけが差し替わることと、組ごとの現在時刻を確かめる
- [x] 2.7 `trial.test.ts`で、入れ替わりと、最低を下回る旨を確かめる
- [x] 2.8 `trial.test.ts`で、試しのあとにトピックと候補と判定済みのURLと記事の表が変わらないことを確かめる

## 3. サーバーとAPI

- [ ] 3.1 `apps/server`に、試しをメモリーに置く`TopicTrials`と、2つの操作を足す
- [ ] 3.2 `topic-trials-api.test.ts`で確かめる。202で受け付け、問い合わせで結果が返る。動いている間の2つ目は409になる
- [ ] 3.3 `topic-trials-api.test.ts`で、上限0で断られることと、存在しないトピックと結果が404になることを確かめる
- [ ] 3.4 `apps/server/src/testing.ts`に`topicTrialsPerDay`を足す
- [ ] 3.5 `docs/api.md`のTopicsの節に2つの操作を書く
- [ ] 3.6 `packages/client/src/api.ts`に`startTopicTrial`と`topicTrial`を足し、型検査が通ることを確かめる

## 4. 画面

- [ ] 4.1 `TopicEditor`に「試す」と結果の表示を足す。編集中の文章が送られ、保存の要求が出ないことを`topic-trial.test.tsx`で確かめる
- [ ] 4.2 `topic-trial.test.tsx`で、結果の一覧と、入れ替わりがないときの表示を確かめる
- [ ] 4.3 `topic-trial.test.tsx`で、上限で断られたときの表示を確かめる

## 5. 確かめ

- [ ] 5.1 `make verify`と`openspec validate add-topic-trial --strict`が通ることを確かめる
