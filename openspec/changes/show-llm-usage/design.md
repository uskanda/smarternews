# Design

## Context

LLMの呼び出しは、`TaskRunner`（`packages/core/src/llm/runner.ts`）が `llm_calls` に1行ずつ記録する。行は、実行（`run_id`、実行の外の呼び出しでは空）、タスク、プロバイダー、金額（`cost_usd`）、金額のかかるプロバイダーかどうか（`billable`）を持つ。
予算の期間の合計（`budgetStatus` の `spentUsd`）は、`billable = 1 AND cost_usd IS NOT NULL` の行の金額の和である。期間は締め日のUTCの0時で区切る（`budgetPeriod`）。
`llm_calls` の `run_id` は `runs` を参照し、実行の行が消えると空になる（`ON DELETE SET NULL`）。
古い記録は `purgeExpired`（`packages/core/src/runs/retention.ts`）が消す。`Scheduler` が1時間ごとに呼ぶ。動機は `proposal.md` の「Why」を、決定の経緯は `grilling.md` を参照する。

## Goals / Non-Goals

**Goals:**

- 実行、カテゴリ、日ごとの金額と回数を、LLMを呼ばずに `llm_calls` の集計で出す。
- 日ごとの金額の和、カテゴリごとと実行に属さない行の金額の和が、どれも期間の合計（`spentUsd`）と一致するようにする。

**Non-Goals:**

- Androidアプリの画面（`grilling.md` の第1ラウンドのQ1）。
- 呼び出しの記録の列や索引を足す移行。集計は今の列で足りる。

## Decisions

### 金額と回数の数え方は予算の判定にそろえる

金額は、どの集計でも `billable = 1 AND cost_usd IS NOT NULL` の行の和とする。金額のわからない呼び出しは `billable = 1 AND cost_usd IS NULL` の行の数とする。回数は、金額のかからない呼び出しも含めたすべての行の数とする。
予算の判定と同じ条件にしておけば、画面のどの合計も期間の合計と食い違わない。

### 実行に集計を付けるのは db/runs.ts の1か所

`runSchema` に `costUsd`（数か空）、`unknownCostCalls`、`callsByTask` を足す。`callsByTask` の形は `Partial<Record<TaskName, { calls, costUsd }>>` である。
`costUsd` は、その実行に `billable = 1` の行が1件もなければ空とする。金額のわかる行がなく、金額のわからない行だけがあるときは0とする。
タスクごとの `costUsd` も同じく、そのタスクに `billable = 1` の行がなければ空とする。画面が、金額のかからないタスクに「—」を出せるようにするためである。
実行を返すどの関数も同じ形を返すように、行の集まりに集計を付ける関数（`toRuns`）を `db/runs.ts` に置く。取り出した実行のidについてだけ、`llm_calls` を `run_id, task` で `GROUP BY` する問い合わせを1回行う。一覧の100件でも問い合わせは1回で済む。
`llm_calls` に `run_id` の索引はない。表は保存期間の分の行しか持たないので、索引は足さない。

### 利用量の集計は db/usage.ts に置き、TaskRunner が期間と予算を渡す

`db/usage.ts` の `usageReport` が、期間の初日から今までの内訳を作る。
`TaskRunner` の `usageStatus` は、締め日から期間を求めて `usageReport` を呼ぶ。金額のかかるプロバイダーがあるかどうかと月の予算も、引数で渡す。期間と予算の設定を持つのは `TaskRunner` だからである。

- カテゴリごとの行は、`listCategories` と同じ並び（`position, id`）で、すべてのカテゴリを出す。呼び出しは、`llm_calls` の `run_id` から `runs` の `category_id` をたどって集める。作った記事は `origin = 'generated'` で `created_at` が期間内の記事、開いた記事はそのうち `opened_at` のあるもの。1件あたりの金額は、開いた記事が0件なら空にする。
- 実行に属さない行は、`run_id IS NULL` の行である。実行履歴が30日で先に消えた呼び出しも、ここに入る。削除されたカテゴリの実行は実行ごと消えるので、その呼び出しもここに入る。
- 日ごとの行は、`substr(created_at, 1, 10)` で `GROUP BY` する。`created_at` はUTCのISOの文字列なので、先頭の10文字がUTCの日になる。期間の初日から今日までの日を0で埋めてから、集計を重ねる。
- 見込みは `spentUsd × (end - start) / (now - start)` とする。経った時間が0のときは、`spentUsd` をそのまま見込みにする。`exceedsBudget` は、見込みが月の予算より大きいときに真とする。

### 呼び出しの記録を消す境目に予算の期間の初日を入れる

`purgeExpired` の3つ目の引数に `keepCallsSince`（日時）を足す。`llm_calls` を消す境目は、30日を引いた日時と `keepCallsSince` の早いほうとする。実行と候補は今のとおり30日で消す。
`Scheduler` は `budgetResetDay` を受け取り、`budgetPeriod` で求めた期間の始まりを渡す。`runtime.ts` は設定の締め日を渡す。締め日を渡さない `Scheduler`（テストなど）は、今までどおり30日で消す。
予算の期間は最長で31日なので、記録は最長でも31日分残るだけである。

### APIと画面

- `GET /api/v1/usage` は `usageStatus` の結果をそのまま返す。型は `usageSchema`（`packages/core/src/api.ts`）である。
- `packages/client` に `usage` の呼び出しを、Webに `useUsage` を足す。`useUsage` は、プロバイダーの状況と同じ間隔で読み直す。
- タスクの名前の言葉（`TASK_LABEL`）は、設定の画面から `packages/client` の `labels.ts` に移し、実行の詳細と共有する。ダイジェストの言葉も足す。期末の見込みの文は `projectionLabel` として同じ場所に置き、テストを書く。
- 実行の一覧の金額の列は、`costUsd` が空なら「—」を出す。実行の詳細は、`dl` に金額と金額のわからない呼び出しを足し、表「タスクごとの呼び出し」を足す。
- 設定の画面の区画「利用量」は、見込みの文、表「カテゴリごとの利用量」、表「日ごとの利用量」からなる。
- 日ごとの表の横棒は、`bg-outline-strong` の `div` の幅を、期間でいちばん多い日の金額に対する割合で決める。`primary` は押せる部品の色なので使わない。決まりは `DESIGN.md` の部品の節に書く。棒は `aria-hidden` とし、金額は文字で残す。金額のかかるプロバイダーがないときは、横棒の基準を回数にする。
- 区画は、`useScrollToHash` が待つ読み込みに利用量を加える。区画の長さが読み込みで変わるからである。

## Risks / Trade-offs

- 予算の期間の途中で締め日の設定を変えると、新しい期間の初日より前の記録は、30日を過ぎた分から消える。→ 締め日の変更はまれで、変えた期間の数字がずれるだけである。
- 期間の初日のすぐあとは、経った時間が短く、見込みが大きく振れる。→ 文で期間の平均から計算したことを書き、日ごとの表と並べて読めるようにする。
- 生成記事は更新されても `created_at` を変えないので、更新にかかった金額はカテゴリの金額に入るが、作った記事の数には入らない。→ `grilling.md` の第1ラウンドのQ4のとおりとする。
- 実行に属さない呼び出しの行には、実行履歴が先に消えたカテゴリの呼び出しも入る。→ 期間の終わりの1日分だけで、区画の説明にそのことを書く。
