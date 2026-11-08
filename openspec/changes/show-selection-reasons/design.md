# Design

## Context

- 判定のタスクは、候補ごとに理由と重要度を残す（`candidates`の`reason`と`importance`の列）。採用した候補は`status = 'accepted'`と`article_id`を持つ。
- 候補は30日で消える（`HISTORY_RETENTION_DAYS`）。記事は180日残り、スター付きの記事は消えない。
- 記事の出典（`article_refs`）は、記事を書く段階（`writeStories`）で、候補のURL、サイト名、タイトル、公開日時から作る。`UNIQUE (article_id, url)`と`INSERT OR IGNORE`により、続報で同じURLを渡しても前の行が残る。
- 配信記事の出典は、購読フィードの取り込み（`feeds/ingest.ts`）が別に書く。
- 当てはまったトピックの表示と、トピックの編集へのリンクは、#110ですでに本文の上部にある。

## Goals / Non-Goals

**Goals:**

- 生成記事が残っている間ずっと、出典ごとの判定の理由と重要度をたどれること。
- LLMを呼ばず、保存済みの出力を見せるだけにすること。

**Non-Goals:**

- Androidアプリの表示、RSSの出力、実行の詳細の画面。
- トピックの表示位置の変更。

## Decisions

- **理由は出典に写す。** migration 026で`article_refs`に`reason TEXT`と`importance INTEGER`を足す。どちらもNULLを許す。候補を結合して読む案は、30日を過ぎた記事で理由が消えるため採らない。
- **既存の記事はmigrationで埋める。** 採用済みの候補のうち、`article_id`と`url`が出典と一致するものから写す。同じURLの候補が複数あるときは、最小のidの候補を使う。最初に判定した理由を残すためである。続報で`INSERT OR IGNORE`が最初の行を残すのと同じ考え方である。空の理由はNULLにする。
- **書く段階で渡す。** `PendingCandidate`へ`reason`と`judgedImportance`を足す。`judgedImportance`は、既定値1で埋める前の重要度である。記事の重要度の計算は、今の`importance`を使い続ける。`writeStories`は、両方を`refs`の各項目へ渡す。空の理由はNULLとして保存する。
- **`NewRef`では理由を省略できる。** `ArticleRef`は`reason`と`importance`を必ず持つ（nullを含む）。`NewRef`は、その2つを省ける型とする。省略したときはNULLを書く。理由のない出典を作る箇所（テストの手助けなど）は、変えずに済む。
- **APIはnullableの項目を足すだけにする。** `articleRefSchema`に`reason: string | null`と`importance: integer | null`を足す。今のAndroidアプリは知らない項目を無視するため、そのまま動く。
- **Webでは出典の行の下に1行足す。** 各`<li>`で、リンクとサイト名の下に`<p>`を置く。見た目は`type-label-sm text-on-surface-muted break-words`で、中身は重要度と理由を「・」でつないだものである。重要度の書き方は、見出しの補足の行にそろえ、「重要度」と数字の間に半角の空白を置く。一方だけあるときはその方だけを出し、両方ないときは行を出さない。理由はReactの子要素の文字列として出し、HTMLとして解釈しない。配信記事では、出典の区画そのものを出さない。この振る舞いは今のままである。

## Risks / Trade-offs

- 30日より前の既存の記事では、候補が消えているため理由は埋まらない。表示しないだけで、誤った理由は出さない。
- 理由の文は、判定のときの出力言語で書かれている。出力言語を途中で変えると、記事の本文と理由の言語は、ずれることもある。保存済みの出力を見せる方針のため、そのまま表示する。
