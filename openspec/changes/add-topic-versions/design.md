# Design

## Context

- トピックの値は `db/topics.ts` の `save` が上書きする。値を変えるのは、`createTopic`、`updateTopic`（APIの編集と設定ファイル）、`applyInterpretation`（実行の解釈と設定ファイル）、`requestInterpretation`（「解釈し直す」）である。
- カテゴリの値は `db/categories.ts` の `createCategory` と `updateCategory` が保存する。
- #138 の成績は `db/topicStats.ts` の `topicStats` が、直近30日の候補と生成記事を数える。候補は30日で消え、生成記事は180日残る。
- #137 の「解釈してからの外れ」は、`topics.interpreted_at` より後に付いた外れの印を数える。

## Goals / Non-Goals

**Goals:**

- トピックとカテゴリの値の変化を、契機とともに版として残す。
- 選んだ版のトピックの値に、再解釈なしで戻せるようにする。
- #138 の成績を、最後の版の切れ目の前と後に分けて見せる。

**Non-Goals:**

- 版ごとの成績、カテゴリの版に戻す操作、版の数の上限、設定ファイルへの履歴の書き出し、Androidアプリの画面。
- LLMの呼び出し。

## Decisions

### 版は値をまるごと持つ別の表にする

`topic_versions` と `category_versions` に、残す項目の値をまるごと入れる。差分だけを持つより行は大きいが、「この版に戻す」も履歴の表示も1行で済む。トピックの版は `interpreted` も持つ。戻した後に再解釈が要るかを決めるためで、比べる項目には入れない。`restored_from` は戻した元の版のIDで、元の版はトピックと一緒にしか消えないので外部キーにしない。

### 版の記録は「直前の版と比べて違うときだけ足す」1つの関数にする

`db/versions.ts` の `recordTopicVersion(db, topicId, trigger, at)` は、今のトピックの値を直前の版と比べ、残す項目が違えば1行足す。同じで、今のトピックが解釈済みなのに直前の版が未解釈なら、直前の版を解釈済みに直す（解釈が同じ値を返したときに、その版に戻すと再解釈が起きるのを避けるため）。有効と無効の切り替えと「解釈し直す」は、残す項目を変えないので版を作らない。

呼ぶ側は次のとおり。

- `createTopic`：保存の後に契機 `created`。
- `updateTopic(db, id, patch, clock = systemClock, record = true)`：保存の後に契機 `edited`。設定ファイルは `record = false` で呼ぶ。
- `applyInterpretation(db, id, interpretation, interpretedAt?, record = true)`：保存の後に契機 `interpreted`。時刻は `interpretedAt`、なければ今。設定ファイルは `record = false` で呼ぶ。
- `importSettings`：既存のトピックの `updateTopic` と `applyInterpretation` を済ませた後で、契機 `settings-file` を1回だけ記録する。新しいトピックは `createTopic` の `created` の版だけになる。
- `restoreTopicVersion`：値を保存した後に契機 `restored`。

時計の既定値を `systemClock` にするのは、既存のテストと呼び出しを変えずに済ませるためである。サーバーの経路と設定ファイルは時計を渡す。

カテゴリは `recordCategoryVersion(db, categoryId, trigger, at)` が最低重要度と件数上限を直前の版と比べる。`createCategory` は `created`、`updateCategory(db, id, patch, clock = systemClock, trigger = "edited")` は渡された契機で記録する。設定ファイルは `settings-file` を渡す。

### 戻すときは取得元を利用者の選択にし、解釈の時刻を戻した時刻にする

`restoreTopicVersion(db, topicId, versionId, clock)` は、版の値を `save` で今の値にし、`sources_set_by_user` を1にする。版が解釈済みなら `interpreted` を1、`interpreted_at` を戻した時刻にして、「解釈してからの外れ」を数え直す。未解釈の版なら `interpreted` を0にし、次の実行で解釈される。版が別のトピックのものなら、存在しない版と同じく404にする。全体を1つのトランザクションで行う。

### 成績は期間を受け取る集計にして、全体と前と後に3回使う

`topicStats` の3つの問い合わせ（候補、記事、よく除外されるサイト）を、期間の始まりと終わり（終わりは省略可）を受け取る `countTopics` にまとめる。全体は今までどおり始まりだけで数えるので、#138 の数と並べ方は変わらない。切れ目のあるトピックについて、前（始まりから切れ目まで）と後（切れ目から）を同じ関数で数え、`before` と `after` に入れる。`before` と `after` は全体と同じ数の項目（`text` と `topicId` を除く）を持つ。

切れ目は、トピックの版を古い順に見て、最初に解釈が済んだ版より後の版のうち、期間の始まり以降で最後のものとする。最初の版を除くだけだと、新しいトピックの最初の解釈が切れ目になり、変更前が空の列になるためである。トピックごとに版を1回問い合わせる。トピックの数は少ないので、まとめた問い合わせにはしない。

### 画面は別のファイルの区画にする

トピックの履歴は `settings/TopicHistory.tsx`、カテゴリの履歴は `settings/CategoryHistory.tsx` に置き、`CategoryPage.tsx` の `TopicEditor` とカテゴリの設定の区画から使う。前の版との違いは、画面で隣り合う版を比べて項目の名前を出す。成績の2列は `TopicStats.tsx` の行の中で、切れ目があるときだけ `rowsOf` を `before` と `after` に使って並べる。

## Risks / Trade-offs

- [版が増え続ける] → 版は残す項目が変わったときだけでき、解釈は文章の変更か「解釈し直す」のときだけ走るので、数は少ない。上限は要るとわかってから足す。
- [切れ目が1つしか見えない] → 直近30日の中で最後の切れ目だけで分ける。それより前の変更の効果は、履歴の日付と照らして確かめる。
- [戻した後に取得元が解釈で変わらなくなる] → 戻すのは利用者の操作なので、取得元を利用者の選択として扱う（計画の決定）。

## Migration Plan

`030_versions.sql` で2つの表を作り、既存のトピックとカテゴリに今の値で契機 `created` の版を入れる。時刻は作成時刻にする。表を消すだけで戻せる。
