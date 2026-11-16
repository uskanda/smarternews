# Design

## Context

動機はproposal.mdのWhyを参照する。

- 集約（`groupStories`、`run.ts`）は、ニュースでは`recentNewsArticles`の結果を`existingArticles`として渡す。直近14日（`FOLLOW_UP_LOOKBACK_MS`）に更新した生成記事である。イベントでは終わっていない記事を渡す。
- 集約で既存の記事に結び付いた候補は、最初の公開から72時間（`UPDATE_WINDOW_MS`）以内ならその記事を書き直し、過ぎていれば前の記事を指す新しい記事（mode "follow"）になる。新しい記事にはスターが付かない。
- 前の記事の連なり（`previousArticlesOf`）は、`previous_article_id`を前へ最大20件たどる。`previous_article_id`には索引がない。
- 記事の要約（`toSummary`）は`SUMMARY_COLUMNS`の行から作る。一覧、検索、最近読んだ記事、詳細のどれも同じ列を使う。
- アプリの通知の確認（`check.ts`）は、「重要度5だけ」のとき`minImportance=5`でサーバーに絞らせ、`planNotifications`がしきい値でも絞る。
- 生成記事の保持期限は180日で、スターのない記事も90日より長く残る。

## Goals / Non-Goals

**Goals:**

- LLMの呼び出しの回数を増やさずに、スターを付けた話題を90日まで続報に結ぶ。
- 前の記事と対になる形で、その後の記事をたどれるようにする。

**Non-Goals:**

- Androidアプリでの表示（grilling.mdの後回しにしたもの）。
- 72時間で書き直すか新しい記事にするかの判定の変更。
- 保持の処理の変更。

## Decisions

### 索引の追加

`038_previous_article_index.sql`で`articles (previous_article_id)`に索引を足す。その後の記事をたどる問い合わせと未読の続報の件数は、`previous_article_id = ?`で後の記事を探す。一覧の1行ごとに走るので、索引なしでは表を全部読むことになる。

### 集約に渡すスター付きの記事

`starredStoryTips(db, categoryId, since, limit, exclude)`を`db/articles.ts`に足す。対象は、スター付きで、更新が`since`以後のニュースの生成記事である。これを更新の新しい順に取り、各記事から後の記事をたどって、いちばん新しい記事に置き換える（grilling Q1のA）。

- 後の記事が枝分かれしているときは、`first_published_at`がいちばん新しい記事へ進む。連なりは原則1本で、枝分かれは誤った結び付けのときだけ起きるからである。
- たどる途中で自分に戻ったときは、そこで止める。たどる段数は20までにする。
- 置き換えた結果が重なるときは1件にする。
- `exclude`に入っている記事は、数えずに飛ばす。

`groupStories`は、ニュースのとき、`recentNewsArticles`の結果に`starredStoryTips`の結果を足す。範囲は`STARRED_LOOKBACK_MS`（90日）とする。足す分は`STARRED_STORIES_LIMIT`（20）件までにする。14日以内の記事のidを`exclude`に渡すので、重なる記事は1件として数え、足す分の枠を使わない。

置き換えたあとの記事は、スター付きの記事より新しい。そのため、範囲の外に出ることはない。

置き換えずにスター付きの記事そのものを渡す案（Q1のB）は、grilling.mdのとおり選ばなかった。

### その後の記事の連なり

`laterArticlesOf(db, id)`は、`previous_article_id = ?`で後の記事を幅優先でたどる。見つけた記事は`first_published_at`の新しい順に並べ、20件までを返す。たどる記事は200件までにし、一度訪れた記事は二度たどらない。そのため輪になっても止まる。形は`previousArticles`と同じく、id、タイトル、最初の公開日時である。記事の詳細の`laterArticles`として返す。

### 要約の2つの項目

`SUMMARY_COLUMNS`に、相関する再帰の共通表式（`WITH RECURSIVE`）で2つの列を足す。

- `follows_starred`：生成記事のとき、`previous_article_id`を前へ20段までたどり、自分以外にスター付きの記事があれば1。
- `unread_follow_ups`：スター付きの生成記事のとき、`previous_article_id = ?`で後ろへ20段までたどり、自分以外の未読の記事を数える。そうでなければ0。

JavaScriptで1行ずつ問い合わせる案もある。しかし要約を作る関数はデータベースを受け取らない。そのため、SQLの列に足す方が変更は小さい。配信記事とスターのない記事は`CASE`で問い合わせを飛ばす。

段数で切るので、枝分かれした連なりでは、数え方が「新しい順に20件」と少しずれることがある。印は0かどうかしか使わないので、表示には影響しない。

### 絞り込み`starredStory`

`articleListQuerySchema`に`starredStory: "true"`を足す。条件は`(a.starred = 1 OR follows_starred の式)`である。最近読んだ記事とは組み合わせられない。ほかの絞り込みと同じ扱いである。

### 通知

`planNotifications`は、`starred`か`followsStarred`が真の生成記事を、しきい値と関係なく通知の対象とする。書き直されたスター付きの記事は、`starred`が真なので対象になる（Q3のA）。設定が「出さない」なら今と同じく何も返さない。

`check.ts`は、設定が「重要度5だけ」のとき、2つ目の問い合わせを足す。条件は`origin=generated&unread=true&starredStory=true`である。2つの結果をidでまとめてから`planNotifications`に渡す。「AI生成のすべての新着」では問い合わせを増やさない。

### Webの表示

- `ArticleView.tsx`：「この話題の前の記事」の節の直前に「この話題のその後の記事」の節を同じ組み方で出す。どちらも新しい順なので、話題を新しい方から読み下ろせる。
- `ArticleRow.tsx`：スター付きで`unreadFollowUps > 0`の行に、今ある`Badge`で「続報あり」を出す。

## Risks / Trade-offs

- 集約の入力が増え、誤った結び付けが増える → 足す分を20件までにする。保存のためにスターを付けた記事も対象になるが、上限で抑える。
- 一覧の1行ごとに再帰の問い合わせが走る → 索引を足し、段数を20に抑え、対象をスター付きと生成記事に限る。
- 枝分かれで、選ばなかった枝が集約に渡らない → 枝分かれは誤った結び付けのときだけで、選んだ枝の方が新しい。

## Migration Plan

データベースの変更は索引を足すだけで、データは変えない。戻すときは索引を残したままでも動く。
