# Design

## Context

実行の結果は`runs`の表にあり、失敗は`failures`の列にJSONで残る。やり直しの予定は`retry_at`にある。
一方、検索先と検索語ごとの結果の数は、どこにも残っていない。Google Newsの転送用URLの解決に失敗した結果は、本文を取れない候補（`fetchable=false`）として残るだけである。
決定の経緯は`grilling.md`にある。最初のgrillingの「通知は初版では出さない」は、Webの画面の中に限って決め直した。

## Goals / Non-Goals

**Goals:**

- 5種類の注意の項目を、プログラムだけで作る。LLMは呼ばない。
- 確認した項目を、きっかけが変わるまで隠す。
- 実行履歴の画面と左のペインで、確認していない項目を見せる。

**Non-Goals:**

- Androidアプリでの表示と、端末やサーバーの外への通知（`grilling.md`のQ1）。
- トピックに書いたフィードの0件の検知（Q5）。
- 画面の上部の帯（Q2）。

## Decisions

### 検索の試行を表に残す

移行`026_attention.sql`で表`search_attempts`を足す。主な列は次のとおりである。

| 列 | 中身 |
|---|---|
| `run_id`、`topic_id` | 試行した実行とトピック |
| `kind` | `news-search`か`llm-search` |
| `engine` | 検索先。LLM検索ではNULL |
| `query` | 検索語。LLM検索ではトピックの文 |
| `ok` | エラーで終わったら0 |
| `returned` | 判定済みのURLを除く前の結果の数 |
| `google_attempted`、`google_unresolved` | 転送用URLの解決を試した数と、解決できなかった数 |

`run_id`と`topic_id`は`ON DELETE CASCADE`にする。実行の削除（30日）とトピックの削除で、記録も消える。`purgeExpired`は、念のため`created_at`でも30日で消す。

`run.ts`の`collect`の`attempt`が、ニュース検索とLLM検索の試行ごとに1行を書く。フィードの試行は書かない。
返った結果の数は、ニュース検索では、期間の外を除き件数の上限で切ったあと、判定済みのURLを除く前の数とする。LLM検索では、ページを取得して候補にできた数とする。LLM検索は判定済みのURLを除かないので、これが返った数になる。

### ニュース検索の数を返す関数を分ける

`news-search.ts`に`searchNews`を足し、候補、返った数、解決を試した数、解決できなかった数を返す。`collectNews`は`searchNews`の候補だけを返す薄い関数として残す。既存の呼び出しとテストを変えずに済む。

### 注意の一覧は、そのつど表から作る

`runs/attention.ts`の`listAttention(db, now)`は、表を読んで項目を返すだけの関数にする。項目を表に保存しないので、条件が解けた項目は、次に一覧を作ったときに消える。保存するのは確認の記録（表`attention_dismissals`の`key`と`dismissed_at`）だけである。

項目の鍵は、種類、対象、きっかけからなる。

| 種類 | 鍵 |
|---|---|
| `run-failed` | `run:<実行のid>` |
| `uninterpreted` | `interpret:<トピックのid>:<実行のid>` |
| `empty-search` | `empty:news-search:<トピックのid>:<検索先>:<検索語>:<続き始めた試行のid>`、LLM検索は`empty:llm-search:<トピックのid>:<続き始めた試行のid>` |
| `no-adoption` | `idle:<トピックのid>:<最後に記事を作るか更新した日時、なければトピックを作った日時>` |
| `google-unresolved` | `google:<続き始めた実行のid>` |

「続き始めた」は、末尾から数えて条件を満たし続けている試行や実行のうち、最も古いものである。同じ状態が続くあいだ、鍵は変わらない。検索語を直したあとにまた0件が続けば、続き始めた試行が変わるので、項目はまた出る。

`run-failed`は、カテゴリごとに`trigger = 'schedule'`の最新の実行を見る。待機中か実行中なら項目を作らない。やり直しの予定が立つまでのあいだも、`retry_at`がNULLでない失敗は対象にしない。

`google-unresolved`はカテゴリを区別しない。解決の仕組みは全体で1つだからである。

### 説明の文は画面で作る

APIの項目は、種類と、カテゴリの名前、トピックの文、検索先、検索語、実行のid、続き始めた日時といった構造化した値を返す。説明の文は`packages/client`の関数が日本語で作る。画面の言葉はほかの画面と同じく`packages/client`に置いている。

### APIと画面

`GET /api/attention`は`{ items, count }`を返す。`POST /api/attention/dismissals`は`{ key }`を受け取り、204を返す。同じ鍵の2回目は上書きする。

Webでは`useAttention()`で一覧を取り、ほかと同じ1分ごとに取り直す。実行が終わってから項目が消えるまで、最長で1分かかる。
「確認した」は、送る前に画面から項目を除く。失敗したら元に戻し、画面の下で知らせる。
左のペインの「実行履歴」は、件数を`text-warning`で表示する。読み上げ名は`注意N件`にし、行の名前と続けて読まれないよう、間に読点を置く。

## Risks / Trade-offs

- 注意の一覧は、表示のたびに数本の問い合わせを流す。カテゴリとトピックの数は個人の規模なので、索引（`search_attempts`の`(topic_id, kind, engine, query, id)`）で足りる。
- 確認の記録は30日で消えるので、30日以上続く採用のない状態は、確認しても30日後にまた出る。長く放置された状態を、もう一度知らせる意味もある。
- サーバーの設定から外した検索先は、`listAttention`が今の設定の検索先を受け取って除く。外す前の試行が残っていても、その項目は出ない。
