# Design

## Context

LLM検索は `collectLlmSearch`（`packages/core/src/sources/llm-search.ts`）が担う。今は、検索のタスクが返したURLを判定済みかどうかを見ずに1件ずつ取得する。判定済みを除くのは、`collect`（`packages/core/src/pipeline/run.ts`）が全部の取得元を集めたあとである。

検索の試行は `search_attempts` の表に1行ずつ記録し、`returned` は判定済みを除く前の数である。注意の項目（`packages/core/src/runs/attention.ts`）は、この表と確認した鍵の表から毎回作る。

トピックの応答には、前例として、問い合わせのたびに数える値 `missesSinceInterpretation` がある。

add-run-attentionの変更はまだアーカイブされていない。そのため、この変更の仕様の差分は、決め直す部分もADDEDで書き、LLM検索について代わることを本文に書く。

## Goals / Non-Goals

**Goals:**

- 判定済みのURLの取得と、空振りの続く検索のタスクの呼び出しを減らす。
- 減らしたかどうかを、取得の処理、注意の項目、トピックの応答で同じ条件から決める。

**Non-Goals:**

- ニュース検索の数え方と注意の項目は変えない。
- Androidアプリの画面は変えない。
- 「減らさない」をトピックの設定にすることはしない（grilling.md の後回し）。

## Decisions

### 判定済みの判定を `collectLlmSearch` に渡す

ニュース検索の `searchNews` と同じく、`isSeen` を依存として受け取る。判定済みのURLは `fetchPage` を呼ばずに飛ばすので、ページ数の上限は新しいページにだけ使われる。`collectLlmSearch` は候補の配列を返し、`collect` はその件数を `returned` に書く。返す候補は判定済みでなく、取得でき、期間に収まるページだけなので、件数がそのまま「新しい候補の数」になる。

`collect` の最後の判定済みの除外は、別名（転送前のURL）を見るので残す。

### 減らした状態の判定を1か所に置く

`packages/core/src/runs/llm-search-reduction.ts` に、判定の純粋な関数と、表から読む関数を置く。

- 純粋な関数は、トピックのLLM検索の試行（古い順）、トピックの文、元に戻した試行のidを受け取る。成功した試行のうち、`query` が文と一致し、idが元に戻した試行より大きいものを選ぶ。その末尾で `returned = 0` が続く部分が3件以上なら、その部分を返す。そうでなければnullを返す。
- 注意の項目は、続き始めた試行のidで鍵を作る。鍵は `empty:llm-search:<トピックのid>:<続き始めた試行のid>` のままにする。
- トピックの応答の `llmSearchReduced` は、`listTopics` と `getTopic` が同じ関数で求める。LLM検索が無効なら `false` にする。

SQLの副問い合わせで数える案もあったが、注意の項目と別の書き方になり、条件がずれるおそれがあるので採らない。1人分のトピックと30日分の試行は少ないので、トピックごとに読んでも足りる。

### 「元に戻す」の記録は別の表に置く

移行 `032_llm_search_resets.sql` で `llm_search_resets`（`topic_id` 主キー、`after_attempt_id`、`reset_at`）を足す。`topic_id` はトピックの削除で消える。元に戻すと、そのときの `search_attempts` の最大のidを記録する。試行がなければ0にする。

トピックの列にすると、設定ファイルの書き出しやトピックの履歴の比較に入り込む。これは実行の記録なので、別の表にする。

### その日の1回の判定

`collect` は、減らした状態のトピックについて、`startOfLocalDay(now, settings.timeZone)` 以降に成功したLLM検索の試行があれば、検索を省く。省いたときは `attempt` を呼ばないので、試行は記録されず、取得元の数にも入らない。手動の実行と定時の実行は区別しない。

### 見出しの渡し方

`SearchInput` に `recentHeadlines?: string[]` を足す。`collect` は、`article_topics` と `articles` を結び、`origin = 'generated'` の記事の見出しを `updated_at` の新しい順に10件読む。プロンプトでは、見出しを `<material>` で包んで渡す。見出しは自前で書いた文だが、元は取得したページから作ったものなので、データとして扱う。

### API と画面

- `topicSchema` に `llmSearchReduced: z.boolean()` を足す。
- `POST /api/v1/topics/:id/llm-search/restore` は、記録を書いてトピックを返す。
- Webの実行履歴の画面では、`source = 'llm-search'` の `empty-search` の項目に「元に戻す」を足す。成功したら注意の一覧とトピックの問い合わせを読み直す。
- カテゴリの設定の画面では、トピックの編集の「LLM検索」の選択の下に、注記の1行とボタンを出す。

## Risks / Trade-offs

- [見出しを渡すと、モデルが続報まで避ける] → 「同じページは挙げず、新しい展開や続報のページは含める」と明示する。
- [回数を減らすと速報が遅れる] → 対象はLLM検索だけにする。新しい候補が1件出れば自動で戻る。
- [`search_attempts` の表が空になると、idが1から振り直される] → 元に戻した試行のidより小さいidの試行は数えないので、そのトピックはしばらく減らした状態にならない。毎回の検索に寄るだけで、検索が止まることはない。
- [add-run-attentionの仕様と、LLM検索の数え方が食い違って見える] → このIssueの決定を grilling.md と仕様の差分に明記した。アーカイブのときに両方の要件を読めば分かる。

## Migration Plan

移行 `032` は表を足すだけで、既存の行は変えない。移行の前に記録した `returned` は判定済みを含む数なので、移行の直後は、0件の続きが前より短く見えることがある。数回の実行で新しい数え方に入れ替わる。
