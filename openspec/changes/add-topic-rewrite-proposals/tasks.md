# Tasks

どの作業も、失敗するテストを先に書いてから実装する。

## 1. タスクと上限

- [x] 1.1 `tasks.ts`に`proposeTopicRewrite`を足す。`tasks.test.ts`で、入力が`<material>`で包まれること、外れと除外がないときに、その節が出ないことを確かめる。`check`が、今と同じ案や同じ文章の2案を断ることも確かめる
- [x] 1.2 `TASK_NAMES`、`taskNameSchema`、`TaskIo`に足し、型検査が通ることを確かめる
- [x] 1.3 `TaskRunner`に`topicRewritesPerDay`、`topicRewritesToday()`、`rewriteBlocked()`を足す。`runner.test.ts`で、専用の上限（20回、0）、`callsToday()`への計数、予算、実行が止まらないことを確かめる
- [x] 1.4 `config.ts`の`tasks`に`proposeTopicRewrite`を、`limits`に`topicRewritesPerDay`を足し、`CAPABLE_TASKS`に入れる。`config.test.ts`で既定、負の値、`smart`の割り当てを確かめる
- [x] 1.5 `testing/llm.ts`と`apps/server`の`runtime.ts`、`testing.ts`に上限を通す

## 2. 入力と処理

- [x] 2.1 `db/rewrite-inputs.ts`に入力を読む関数を足す。30日の期間、ほかのトピック、件数の上限、プログラムの理由の除外、外れの範囲をテストで確かめる
- [x] 2.2 `api.ts`に答えの型とスキーマを足す
- [x] 2.3 `pipeline/rewrite.ts`に`proposeTopicRewrite`を作る。未解釈と上限で呼ばないこと、失敗が`unavailable`になること、何も保存しないことをテストで確かめる

## 3. サーバーとAPI

- [x] 3.1 `POST /api/v1/topics/:id/rewrite-proposals`を足し、200の各状態、503、404をテストで確かめる。呼び出しの記録が`run_id`なしで残ることも確かめる
- [x] 3.2 `packages/client`に`proposeTopicRewrite`と、タスクの表示名「書き直しの案」を足す
- [x] 3.3 `docs/api.md`のTopicsの節に操作を書く

## 4. 画面

- [x] 4.1 `TopicEditor`に「書き直しの案を出す」と`TopicRewrite.tsx`を足す。`topic-rewrite.test.tsx`で、案が並ぶこと、「この案を使う」で編集欄が置き換わり保存されないこと、未保存の変更で押せないことを確かめる
- [x] 4.2 `topic-rewrite.test.tsx`で、上限、予算、未解釈、失敗の理由が出ることを確かめる

## 5. 文書と確かめ

- [x] 5.1 README.md、README.ja.md、docs/providers.md、examples/config.example.yamlに、タスクと割り当ての既定と上限を書く。`llmCallsPerDay`の既定の内訳も書く
- [ ] 5.2 `make verify`と`openspec validate add-topic-rewrite-proposals --strict`が通ることを確かめる
