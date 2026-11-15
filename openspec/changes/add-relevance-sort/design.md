# Design

## Context

動機は proposal.md の Why を参照。決定の根拠は grilling.md にある。

- 記事の一覧は `packages/core/src/db/articles.ts` の `listArticles` が返す。並びは `updated_at` と `id` で、続きの値は `[時刻, id, 向き]` を符号化したものである（#48の `add-oldest-first-sort`）。向きが要求と違う続きの値は断る。
- 並び順は `list_views` の `sort` 列に保存する。列には `CHECK (sort IN ('newest', 'oldest'))` がある（移行031）。
- 一括の既読は、一覧の応答の `asOf` を時刻として送るので、並び順によらず働く。
- 読んだ記事を一覧に残す `mergeKept`（`packages/client/src/merge.ts`）は、並びの鍵と向きを受け取る。
- `opened_at`（記事を初めて開いた時刻）とスターは記録済みで、購読フィードの統計が直近30日を `articles_feed_created` の索引で数えている。
- 色付けの語は `highlight_terms` に、照合の形（`normalizeForMatch`、NFKCと小文字）とともに保存してある。記事との照合は画面だけが行っている。SQLではNFKCの正規化ができない。
- 全文の索引の更新は、見出しや要約などの列の `UPDATE OF` で動くトリガーである。関連度の列を書き換えても動かない。
- スケジューラー（`packages/core/src/runs/scheduler.ts`）は30秒ごとに `tick` し、1時間ごとに掃除をする。起動時にも1回 `tick` する。

## Goals / Non-Goals

**Goals:**

- 関連度順の一覧を、いまの一覧と同じく索引で並べ、続きの取得を `[並びの値, id]` の形で行う。
- 関連度の値の書き換えを、行動の値の1日1回の計算と、語の一致が変わるときだけにする。読んでいる途中の並びがずれないようにする。

**Non-Goals:**

- 検索の結果、イベントの一覧、最近読んだ記事の一覧、RSS、通知する記事の選び方の並び。
- 関連度の値や理由の表示、関連度の効き目を変える設定（grillingで後回しにした）。
- 生成記事の語の一致。生成記事の関連度は重要度だけで決まる（第2ラウンド Q6、計画）。

## Decisions

### 並びの値は「時刻＋関連度×2日」の仮想の生成列にする

移行032で、`articles` に次の列を足す。

```sql
ALTER TABLE articles ADD COLUMN feed_score REAL NOT NULL DEFAULT 0;
ALTER TABLE articles ADD COLUMN term_match INTEGER NOT NULL DEFAULT 0;
ALTER TABLE articles ADD COLUMN rank_at TEXT GENERATED ALWAYS AS (
  strftime('%Y-%m-%dT%H:%M:%fZ', julianday(updated_at) + 2.0 * (
    CASE WHEN origin = 'generated' THEN (coalesce(importance, 1) - 1) / 4.0
         ELSE 0.5 * feed_score + 0.5 * term_match END))
) VIRTUAL;
```

- 指数的に減る重みを掛けた値の順は、関連度を時間に換算して時刻に足した値の順と同じである（第2ラウンド Q8）。関連度1は48時間に当たる（Q5）。
- 値は `updated_at` と同じISOの文字列なので、文字列の比較で並び、続きの値にもそのまま入る。
- 生成列にすると、`updated_at`、`importance`、`feed_score`、`term_match` を書き換える既存と新しい処理のどれにも、並びの値を保つ処理が要らない。`reviseArticle` の続報も、そのまま並びに効く。
- `strftime` と `julianday` は `'now'` を使わない限り決定的で、生成列と索引に使える（SQLite 3.53で確認）。
- 保存する生成列（STORED）は `ALTER TABLE` で足せないので、仮想にする。索引が値を持つので、並べるときに計算し直すことはない。

採らなかった案は、並びの値を普通の列として持ち、書き換える処理のすべてで計算する案である。`updated_at` を書く処理は、続報、配信記事の書き換え、移行など何か所もあり、1つでも漏れると並びが狂う。

### 索引は、いまの `updated_at` の索引と対にする

```sql
CREATE INDEX articles_rank ON articles (rank_at, id);
CREATE INDEX articles_unread_rank ON articles (rank_at, id) WHERE is_read = 0;
CREATE INDEX articles_category_rank ON articles (category_id, rank_at, id);
CREATE INDEX articles_category_unread_rank ON articles (category_id, rank_at, id) WHERE is_read = 0;
CREATE INDEX articles_feed_rank ON articles (feed_id, rank_at, id);
CREATE INDEX articles_origin_rank ON articles (origin, rank_at, id);
```

`articles_updated`、`articles_unread`、`articles_category_updated`、`articles_category_unread`、`articles_feed_updated`、`articles_origin_updated` と同じ組み合わせである。

### 行動の値は購読フィードに置き、記事へ写す

- `feeds` に `relevance_score REAL NOT NULL DEFAULT 0` を足す。計算の結果は、まずここに入れる。
- 同じ値を、その購読フィードの配信記事の `feed_score` へ写す（`UPDATE … WHERE feed_id = ? AND feed_score <> ?`）。生成列は他の表を参照できないので、記事の側にも値が要る。
- 配信記事を保存するときは、購読フィードの `relevance_score` を `feed_score` に入れる。次の計算を待たずに、新しい記事がフィードの値で並ぶ。
- 購読フィードを登録するときは、10件未満の購読フィードに使う値（平均）を `relevance_score` に入れる。計算は読み出しだけで、ほかの記事の並びは変えない。

計算の方法は次のとおりである（第2ラウンド Q10）。

1. 直近30日（`FEED_STATS_DAYS`）に保存した配信記事を、購読フィードごとに数える。フィルターで隠した記事と隠した重複は、利用者が開けないので数えない。
2. 開いた（`opened_at` がある）かスターを付けた記事の割合を、購読フィードごとに求める。
3. 10件以上ある購読フィードの割合の最大で割る。最大が0か、10件以上ある購読フィードがなければ、すべて0にする。
4. 10件未満の購読フィードには、10件以上ある購読フィードの値の平均を使う。

計算は `packages/core/src/db/relevance.ts` に置く。値を求める関数（読み出しだけ）と、保存する関数に分ける。

### スケジューラーは、起動の直後と、そのあと24時間ごとに計算する

`Scheduler` に、最後に計算した時刻を持たせ、`tick` で24時間が過ぎていれば計算する。最初の値は0なので、起動直後の最初の `tick` で計算する。計算に失敗しても、掃除と予定の確認は続ける。
同じ時点で、全配信記事の語の一致も照合し直す。移行の直後の記事に値を入れるためと、照合し直しの漏れがあっても1日で直すためである。

### 語の一致は、配信記事ごとにサーバーで照合して保存する

- 照合は `normalizeForMatch` で見出し、翻訳した見出し、要約をそれぞれ照合の形にし、`highlight_terms.normalized` のどれかを部分文字列として含むかで決める。画面の `createTermMatcher` と同じ方法である。3つをつなげて照合しないのは、つなぎ目にまたがる一致を避けるためである。
- 関数は `packages/core/src/db/relevance.ts` に置く。記事の番号の一覧を受けて照合し直す関数と、すべての配信記事を照合し直す関数である。値が変わる記事だけを書き換える。
- 呼ぶ時点（第2ラウンド Q9）
  - 配信記事の保存（`storeItems` の新しい記事と、見出しか要約を書き換えた記事）
  - 翻訳した見出しの保存（`saveTranslatedTitle`）
  - 色付けの語の追加と削除、語のまとまりの削除（`addHighlightTerm`、`deleteHighlightTerm`、`deleteTermGroup`）。このときは全記事を照合し直す。設定ファイルの読み込みも、これらの関数を通るので同じになる。
- 生成記事は照合しない。関連度は重要度だけで決まる。

### APIは `order=relevance` を受け、続きの値に向きを入れる

- `listSortSchema` を `["newest", "oldest", "relevance"]` にする。
- 関連度順の並びは `ORDER BY a.rank_at DESC, a.id DESC`、続きの条件は `(a.rank_at < ? OR (a.rank_at = ? AND a.id < ?))` である。
- 続きの値は `[rank_at, id, "relevance"]` である。向きが要求と違う値は、いまの仕組みのまま `invalid_input` で断る。
- `kind=event` と `recentlyRead=true` は、いまの `refuseOrder` のまま断る。
- 一覧の要約に `rankAt` を足す。画面は表示せず、`mergeKept` が並べ直すためだけに使う（第2ラウンド Q12）。
- 一括の既読は `asOf` を使うので変えない。

### 画面は、並びの鍵を並び順から選ぶ

- `mergeKept` は、関連度順のとき `rankAt` の新しい順で混ぜる。最近読んだ記事は並び順を持たないので、いまのとおりである。
- `targetFilter` は、新しい順以外のときに `order` を付ける。
- Webの `SortMenu` とアプリのメニューに「関連度順」を足す。選択肢の名前は「関連度順」で、ボタンには「並び順：関連度順」と出る。

### 設定ファイルは `sort: relevance` を読み書きする

`listSortSchema` を広げるだけで、書き出しと読み込みの形は変えない。

### `list_views` を作り直して `relevance` を許す

移行031と同じく、新しい表を作り、行を番号ごと写して入れ替える。表を参照する表はないので、外部キーは有効のままでよい。

## Risks / Trade-offs

- [行動の値の計算のたびに、関連度順の並びが少し変わる] → 1日1回だけで、読み込んだ一覧は再取得まで変わらない。再取得で上のほうの記事が入れ替わることはある。
- [語を足すと、全配信記事を照合し直す] → 配信記事は保存期間で消えるので件数に上限がある。値が変わる記事だけを書き換え、全文の索引のトリガーも動かない。
- [配信記事の関連度は購読フィードの単位の差が中心になる] → 語の一致で記事の単位の差を付ける（第2ラウンド Q7）。
- [新しく登録した購読フィードの値は、登録の時点の平均で固定される] → 次の計算（24時間以内）で直る。
- [関連度順を保存すると、古いアプリは表示の設定を読めない] → Migration Planのとおり、アプリを先に新しくする。
- [`rank_at` は `updated_at` の書式に依存する] → どちらの記事もISOの文字列（`toISOString`）で書いている。`julianday` が読めない値では `rank_at` が NULL になり、関連度順の続きの取得から漏れる。生成記事と配信記事のそれぞれで `rank_at` が入ることをテストで確かめる。

## Migration Plan

- 移行032は、列と索引を足し、`list_views` を作り直す。既存の記事の `feed_score` と `term_match` は0で、`rank_at` は既存の値から計算される。
- 起動直後のスケジューラーの最初の計算で、行動の値が入る。語の一致は、移行のあとで最初に語を変えるまで0のままになるので、同じ計算で全配信記事を照合し直す。照合し直しは値の変わる記事だけを書くので、毎日行っても並びは変わらない。
- 古いWebとアプリは `order=relevance` を送らない。関連度順を保存すると、古いアプリは表示の設定の応答を読めない。Webは同じサーバーが配信するので同時に新しくなる。アプリは新しい版を入れてから関連度順を選ぶ。
- 戻すときは、サーバーを前の版に戻す。`list_views` に `relevance` の行が残ると前の版の型の検査で読めなくなるので、戻す前に関連度順の項目を新しい順に戻す。
