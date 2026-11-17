# Design

## Context

フィルター（`packages/core/src/db/filters.ts`）は、条件の照合を `filters/match.ts` の純粋な関数で行い、範囲を全体・カテゴリ・購読フィードから選ぶ。フィルターは保存済みの記事にも動的に当たるので、記事と条件の組を表 `filter_matches` に持ち、隠すかどうかを記事の列 `filtered` に記録している。
配信記事の保存は `feeds/ingest.ts` の `storeItems` が行う。新しい記事ごとに、重複の判定（`duplicate_of`）とフィルターの照合（`applyFilters`）をする。
自動の要約の対象は、`db/articles.ts` の `CAN_BE_SUMMARIZED` と `WAITING_FOR_SUMMARY` が決める。順番は `nextArticleToSummarize` が決め、1日の上限は `llm/runner.ts` の `canSummarize` が数える。
アプリの通知は、端末が定期的にサーバーへ問い合わせる方式である。`packages/client/src/notify.ts` の `planNotifications` が通知する記事を選ぶ。`apps/mobile/src/notifications/check.ts` が、問い合わせて通知を出す。

## Goals / Non-Goals

**Goals:**

- ルールの照合と範囲の判定を、フィルターと同じ処理で行う。
- ルールの適用を、配信記事の保存と同じトランザクションの中で、LLMを呼ばずに終える。
- ルールの通知を、今の通知の仕組み（端末からの問い合わせ）の上に載せる。

**Non-Goals:**

- webhookへ送る操作。
- 保存済みの記事へルールを当てて操作すること。件数を数えるだけにする。
- アプリでのルールの設定の画面。

## Decisions

### ルールは保存のときに1度だけ照合し、照合の結果を持たない

フィルターは保存済みの記事にも当たるので `filter_matches` を持つ。ルールは初めて保存した記事だけを操作し、あとから取り消さない。照合の結果を表に残す必要がないので、保存のときに条件を照合し、操作の結果だけを記事の列に書く。
条件は表 `rules` の列 `conditions` にJSONで持つ。フィルターのように条件の表を分けると、照合の結果を持たないルールでは、読み書きが増えるだけになる。

### 操作は真偽値の列で持ち、APIでは配列で表す

表 `rules` に `star`、`mark_read`、`notify`、`summarize` の4つの真偽値の列を置き、少なくとも1つが真であることをCHECKで保証する。APIでは `actions: ["star", "read", "notify", "summarize"]` の配列で表す。配列なら、webhookのように操作を足したときにも形が変わらない。

### 適用の手順

`storeItems` の新しい記事の保存で、`applyFilters` のあとに `applyRules(db, id, now)` を呼ぶ。呼ぶのは重複でない記事（`kept === null`）だけで、書き換えの経路では呼ばない。`applyRules` も、`filtered` が1の記事と `duplicate_of` のある記事には何もしない。
有効なルールのうち、範囲に入り条件と合うものをすべて集め、それらの操作を合わせて行う。

- スター：`starred = 1`。
- 既読：`is_read = 1`、`read_at = now`。
- 通知：既読にしないときだけ `rule_notify_at = now`。
- 要約：`rule_summary_requested_at = now`。

範囲の判定は、フィルターの `inScope` と同じく、記事の今の `category_id` と `feed_id` で行う。保存の直後なので、購読フィードの今の所属と同じである。

### ルールで頼んだ要約

`CAN_BE_SUMMARIZED` の購読フィードの条件を「自動の要約を有効にした購読フィードの、有効にしたあとの記事」か「`rule_summary_requested_at` がある記事」に広げる。`WAITING_FOR_SUMMARY` は、`rule_summary_requested_at` のある記事を、既読でも待ちに残す。
並び順は、開いて頼んだ記事（`auto_summary_requested_at`）、ルールで頼んだ記事（`rule_summary_requested_at` の新しい順）、ほかの記事（新しい順）とする。1日の上限は `canSummarize` が今のまま数える。
開いて頼む要約（`requestAutoSummary`）も `CAN_BE_SUMMARIZED` を使うので、ルールで頼んだ記事は、自動の要約をしない購読フィードの記事でも、開いて頼むと先に回る。

### ルールの通知の問い合わせは専用の経路にする

計画では記事の一覧に問い合わせを足す例を挙げたが、`GET /api/v1/rule-notifications?after=&limit=` を新しく作る。応答の項目は `{ notifiedAt, feedTitle, article }` で、`article` は記事の一覧の項目と同じ形である。
記事の一覧に足すと、一覧の項目の型（`ArticleSummary`）に通知の時刻を足すことになり、通知のほかに使わない列が、すべての一覧の応答に載る。並び順も、一覧の並び（最終の更新）と違い、通知の対象になった時刻で並べる必要がある。

対象は、`rule_notify_at` が `after` より後で、未読で、フィルターで隠れていない配信記事である。新しい順に返す。

### 端末は、生成記事とルールの通知で見た位置を別に持つ

生成記事の見た位置は記事の最終の更新の時刻、ルールの通知の見た位置は `rule_notify_at` である。比べる時刻が違うので、端末に別のキー（`smarternews.notify.ruleCheckedAt`）で保存する。`setBaseline` は、ルールの通知の対象の最新の `notifiedAt`（なければ始まりの時刻）を記録する。
`planNotifications` は、生成記事とルールの通知の対象を合わせて数え、4件以上なら1つにまとめる。まとめた通知の本文は、生成記事のうち重要度のいちばん高い記事の見出しとし、生成記事がなければ、ルールの通知の対象のうち最新の見出しとする。
既存の端末で、ルールの見た位置がまだないときは、最初の確認で位置だけを記録し、通知しない。有効にする前からある記事を通知しない規則に合わせるためである。

アプリの一覧で見ただけの配信記事は、ルールの通知を止めない。一覧の項目は `rule_notify_at` を持たず、見た位置を進められないからである。既読にした記事は通知しない。

### Webの画面はフィルターの入力を部品として使い回す

`FilterForm.tsx` から、条件の入力（`ConditionsInput`）、範囲の選択（`ScopeSelect`）、条件と範囲の表示の関数を書き出す。新しい `RuleForm.tsx` と `RulesPage.tsx` は、それらを使う。範囲の選択は、残すフィルターのための「選んでください」の扱いを引数で切り替える。

### 範囲の対象の削除

`rules` の `category_id` と `feed_id` は、フィルターと同じく `ON DELETE CASCADE` とする。削除の確認の表示は、`ScopedFiltersNote` と並べて、ルールの数を示す `ScopedRulesNote` を置く。

## Risks / Trade-offs

- ［購読フィードを登録した直後の取得でも、ルールが当たる。条件が広いと、通知がまとめて出る］→4件以上は1つにまとめる。件数の確認で、条件の広さを登録の前に確かめられる。
- ［ルールで頼んだ要約が多いと、自動の要約が翌日へ回る］→1日の上限は変えない。件数の確認で、当たる記事の数を確かめられる。
- ［端末の見た位置が2つになり、片方だけ保存に失敗すると、次の確認で同じ記事を再び通知することがある］→両方の通知を出したあとで、2つの位置をまとめて保存する。
- ［ルールの通知の一覧を持たない古いサーバーにつないだ端末で、確認が止まる］→ルールの通知の問い合わせが失敗しても、生成記事の通知は続ける。そのときは、ルールの見た位置を動かさない。
- ［AGENTS.mdの規則（配信記事の要約は、自動の要約を有効にした購読フィードの記事だけ）が、ルールで頼んだ要約と食い違う］→自動の実行ではAGENTS.mdを変えられないため、利用者が規則を直す。

## Migration Plan

移行 `041_rules.sql` は、表 `rules` を作り、`articles` に列を2つ足すだけで、既存の行を書き換えない。戻すときは、新しい列と表を無視すれば、前の版のコードでも動く。
