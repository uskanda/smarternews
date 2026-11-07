# Design

## Context

トピックの文章を保存すると、`updateTopic`がトピックを未解釈に戻す。次の実行の前に、解釈のタスクが検索語と判定基準を作り直す。解釈は`recentMissTitles`で、90日以内の外れの見出しを20件まで読む。
LLMの呼び出しは`TaskRunner`を通り、`llm_calls`に1行ずつ記録される。セレクターの提案は、タスクの名前で数える専用の上限を持ち、`llmCallsPerDay`にも数えられる。書き直しの案も同じ形にする。
記事とトピックは`article_topics`で、候補とトピックは`candidate_topics`で結び付く。記事の表では、開いた時刻を`opened_at`の列に、スターを`starred`の列に持つ。スターを付けた時刻は残っていない。

## Goals / Non-Goals

**Goals:**

- 利用者が求めたときに、1回の呼び出しで、トピックの文章の書き直しの案を1〜2件返す。
- 案を出す処理は、`llm_calls`のほかに何も書き込まない。

**Non-Goals:**

- 判定基準の案を出すこと、利用者が判定基準を直接書くこと（grillingのQ8）。
- 案をデータベースに残すこと。
- 保存していない編集中の文章を入力にすること（grillingのQ12）。

## Decisions

### タスクの名前と割り当て

タスクの名前は`proposeTopicRewrite`とする。`TASK_NAMES`、`taskNameSchema`、`TaskIo`、設定の`tasks`に足す。
割り当てがないときは、`CAPABLE_TASKS`に入れて`smart`を優先する。
`OWN_ALLOWANCE`の条件（`summarize`と`digest`を除く）はそのままにするので、このタスクの呼び出しは`callsToday()`に入る。

### 上限の確かめ

`TaskLimits`に`topicRewritesPerDay`を足し、既定は定数`TOPIC_REWRITES_PER_DAY = 20`とする。`topicRewritesToday()`は`task = 'proposeTopicRewrite'`の行を数える。
`#spend`は、このタスクのとき、まず専用の上限を確かめ、達していれば`LlmLimitError("day")`を投げる。そのあと、ほかのタスクと同じく、実行あたり、1日あたり、予算を確かめる。
始める前の確かめは`rewriteBlocked()`が受け持ち、次のどれかを返す。

- 専用の上限に達していれば`"limit"`
- 1日の上限に達していれば`"day"`
- 割り当てたプロバイダーが金額のかかるもので、予算に達していれば`"budget"`

やり直しの前に上限で止まったときは、`LlmLimitError`を受けて`rewriteBlocked()`の理由を返す（理由がなければ`"day"`）。

### 入力の集め方

`db/rewrite-inputs.ts`に、トピックの識別子と現在時刻から入力を読む関数を置く。期間と件数は定数にする。

- 開いた記事：`origin = 'generated'`で、`opened_at`が30日以内のもの。`opened_at`の降順で20件まで。
- スターの記事：`starred = 1`で、`created_at`が30日以内のもの。`created_at`の降順で20件まで。スターの時刻がないので、記事の作られた時刻で区切る。
- 除外：`status = 'rejected'`で、`created_at`が30日以内の候補を読む。`programReasonCode(reason)`がnullのものだけを、`created_at`と`id`の降順で30件まで取る。
- 外れ：`recentMissTitles`をそのまま使う。

記事の要約は`summary`の列を使う。どの記事の情報も、プロンプトでは`material()`で包む。

### 処理

`pipeline/rewrite.ts`の`proposeTopicRewrite(deps, topicId)`は、試しの`pipeline/trial.ts`と並べて置く。この関数は、トピックを読み（なければ404）、未解釈なら呼ばずに`uninterpreted`を返す。
`rewriteBlocked()`が理由を返せば、呼ばずにそれを返す。そうでなければ、設定、カテゴリ、入力を読み、`{ runId: null, calls: 0 }`でタスクを1回呼ぶ。
`TaskFailedError`は`DomainError("unavailable")`にして503で返す。

### タスクの出力の確かめ

出力は`proposals`を1〜2件とし、各件は`text`（トピックの文章の上限の文字数まで）と`explanation`（1000文字まで）である。
`check`は、今の文章と（前後の空白を除いて）同じ案と、同じ文章の2案を誤りにする。誤りなら1回だけやり直す。

### API

`POST /api/v1/topics/:id/rewrite-proposals`は本文をとらない。1回の呼び出しで終わるので、セレクターの提案と同じく同期で答える。
答えは`{ status, proposals }`で、`status`は`proposed`、`limit`、`day`、`budget`、`uninterpreted`のどれかである。`proposed`以外では`proposals`は空である。

### 画面

`TopicEditor`の「試す」と同じ並びに「書き直しの案を出す」を置き、案の一覧は`TopicRewrite.tsx`に作る。
保存していない変更があるとき（`dirty`）は押せず、保存してから求めるよう説明文で示す。
各案は、文章、説明、「この案を使う」を並べる。押すと`form.text`が置き換わる。編集欄は保存していない状態になるので、そのまま「試す」と「保存する」に進める。

## Risks / Trade-offs

- 案の質は入力の量で変わる → 記事がほとんどないトピックでは、案が今の文章とあまり変わらないことがある。案は利用者が手を入れる下書きなので、それでよい。
- 1回の呼び出しで多くの記事を読む → 件数と期間で区切り、入力の大きさと金額を見積もれるようにした。
- 応答を待つ間、画面は待たされる → タスクの時間の上限で終わる。時間切れは503で知らせる。

## Migration Plan

- データベースの移行はない。
- `limits.topicRewritesPerDay`を書いていない環境は、既定の20回になる。`llmCallsPerDay`の既定は380回のままである。
