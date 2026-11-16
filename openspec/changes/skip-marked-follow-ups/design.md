# Design

## Context

動機はproposal.mdの「Why」を参照する。

- 実行の `groupStories` は、集約のタスクに既存の記事を渡す。ニュースでは直近14日に更新した生成記事、イベントでは終わっていないイベントの記事である。
- `groupStories` は、話題ごとに相手の記事（`existing`）と扱い（`new`、`update`、`follow`）を決める。`writeStories` は、基準未満と件数上限だけを本文の生成の前に除外する。
- 外れの印は記事と別の表（`misses`）にあり、記事が消えても残る。
- 理由の種類は `candidates` の `reason_code` のCHECK制約に並んでいる。SQLiteではCHECK制約を変えられない。`candidate_topics` が `candidates` を参照している。
- トピックの成績は、理由の種類ごとに除外の数を数える。

## Goals / Non-Goals

**Goals:**

- 印のある記事への続報で、本文の生成のタスクを呼ばない
- 除外した候補の理由から、どの記事のどの印のせいかが分かる

**Non-Goals:**

- 集約の入力（渡す記事の範囲と期間）は変えない
- 実行の詳細の画面とAPIの候補の形は変えない
- Androidアプリは変えない

## Decisions

### 除外の位置

`writeStories` の話題ごとの処理の先頭、基準未満の判定より前で、`story.existing` の印を見て除外する。集約の結果を作る `groupStories` ではなく `writeStories` に置くのは、除外を他の除外と同じ並びで記録し、`ctx.stats.rejected` に数えるためである。

印は `ArticleDigest` に `missed` と `followUpsStopped` を足して運ぶ。`recentNewsArticles`、`openEventArticles`、`findEventByKey` の問い合わせで、`misses` の有無と記事の列を読む。集約のタスクへの入力には渡さない。

### 生成のあとに分かった同じイベント

イベントで相手の記事がない話題は、生成の結果からイベントのキーを得て `findEventByKey` で同じイベントの記事を探す。見つかった記事に印があれば、書き直さずに同じ理由の種類で除外する。生成の呼び出しは済んでいるので減らないが、記事は未読に戻らない。

### 理由の文

`reasonText(code, language, title?)` に見出しの引数を足す。2つの新しい種類は見出しを入れた文を返す。

- ja：「外れの印を付けた記事「…」の続報」「続報を止めた記事「…」の続報」
- en：`follow-up to "…", which was marked as a miss`、`follow-up to "…", whose follow-ups were stopped`

`rejectCandidates` に見出しを受け取る引数を足す。候補のAPIの形を変えずに相手の記事を示せる（grilling Q3）。

### 保存

- `articles.follow_ups_stopped INTEGER NOT NULL DEFAULT 0` を足す。記事が消えれば要らない印なので、列で足りる（grilling Q4）。
- `candidates` は作り直してCHECK制約に2つの値を足す。先頭に `-- foreign_keys: off` を付け、列、id、索引を引き継ぐ。索引は `candidates_run`、`candidates_category_status`、`candidates_category_created` の3つである。
- `candidate_topics` の参照は、同じidで行を写すので保たれる。移行の処理が `foreign_key_check` で確かめる。

### API

- `Article` に `followUpsStopped: boolean` を足す。
- `articleUpdateSchema` に `followUpsStopped` を足す。`setArticleFlags` で列を書き換え、配信記事には `missed` と同じく400（`not_allowed`）を返す。既読は変えない。
- `topicStatsCountsSchema` に `rejectedByMark` を足す。`topicRejected` にも含める。

### Web

- 本文のペインの外れのボタンの隣に、`aria-pressed` 付きの切り替えのボタンを置く。生成記事にだけ出す。押した直後の知らせは出さない。失敗したときは既存の印と同じく知らせを出し、もう一度試せるようにする。
- トピックの成績に「印のある記事の続報」の行を足す。

## Risks / Trade-offs

- ［集約が別の話題を印のある記事に結び付けると、要る候補まで除外する］→ 理由の文に相手の記事の見出しを入れ、実行の詳細で確かめられるようにする。誤りなら印を外せば次からは除外されない。
- ［印は最後の更新から14日で集約の入力から外れる］→ その後の同じ話題は新しい記事になる。grilling Q1で受け入れた。
- ［`candidates` の作り直しは表全体を写す］→ 候補は30日で消えるので行は多くない。移行の前にデータベースの写しを取る既存の仕組みが働く。

## Migration Plan

移行 `036_follow_up_marks.sql` を足す。戻すときは、移行の前に取られる写し（`*.before-036`）からデータベースを戻す。
