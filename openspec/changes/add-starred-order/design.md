# Design

## Context

スターは記事の表の `starred` の列の0か1だけで、付けた時刻を持たない。
記事の一覧は `updated_at` の順で並び、続きの値には時刻と識別子と、古い順のときは並び順を入れる。並び順を固定する一覧（イベントと最近読んだ記事）は、並び順の指定を断る。
項目ごとの並び順は `list_views` の表に保存し、`sort` をCHECK制約で `newest` と `oldest` に縛っている。設定ファイルの読み込みも、APIと同じ `checkListViewTarget` と `setListView` を通る。
並び順のメニューは、Webでは `SortMenu`、アプリでは `ListScreen` の下から出す選択の欄で、どちらも選択肢を2つの固定の列挙で持つ。

## Goals / Non-Goals

**Goals:**

- 並び順の値を1つ足すだけで、「スター」の一覧にスターを付けた順を出す。並び順の保存、共有、設定ファイルの往復は、いまの仕組みをそのまま使う。
- 検索の絞り込みに「スターだけ」を足し、「スター」の一覧と同じ範囲を探す。

**Non-Goals:**

- タグ。
- 外したスターを「元に戻す」ときに、元の時刻へ戻すこと。
- トピックの書き直しの提案に渡す材料の変更（`rewrite-inputs.ts`）。
- 検索の結果をスターを付けた順に並べること。検索はいつも最終更新の新しい順である。

## Decisions

### 時刻の列と移行

記事の表に `starred_at TEXT` の列を足す。移行の037で、`starred = 1` の行に `updated_at` を入れる（Q2）。
索引は `(starred_at DESC, id DESC) WHERE starred = 1` の部分索引とし、スターのない大半の行を持たない。

`setArticleFlags` は、スターを付けるときに、すでにスターがあれば時刻を残し、なければ `now` を入れる。外すときは `NULL` を入れる。
付け直しで時刻を変えないことを、1つのUPDATEの文で守る。既読の時刻（`read_at`）と同じく、外したスターの時刻は残さない。

### 並び順の値

`listSortSchema` に `"starred"` を足す。
新しい列挙を作らないのは、一覧の `order`、表示の設定の `sort`、設定ファイルの `sort` の3か所が同じスキーマを使うためである。1か所を変えれば3か所がそろう。
代わりに、`starred` を使えない場所を検査で断る。

- 記事の一覧：`order=starred` は `starred=true` がないと、入力が不正として断る。`kind=event` と `recentlyRead` は、いまと同じく並び順の指定そのものを断る。
- 表示の設定：`list` が `starred` でない項目への `"starred"` を、入力が不正として断る。APIの変更と設定ファイルの読み込みの両方が `checkListViewTarget` を通るので、その関数に並び順を渡して検査する。
- `list_views` のCHECK：`sort` に `'starred'` を許し、`sort <> 'starred' OR list = 'starred'` も確かめる。031と同じく表を作り直し、行を識別子ごと写す。

### 一覧の並びと続きの値

`order=starred` の一覧は `a.starred_at DESC, a.id DESC` で並べる。条件に `a.starred = 1` がすでに入っているので、部分索引が使える。
続きの値は `[starred_at, id, "starred"]` とし、`decodeCursor` は3つ目の値に `starred` も受ける。ほかの並び順の続きの値は、いまと同じく並び順の違いとして断る。

### 記事の要約

`ArticleSummary` に `starredAt`（nullあり）を足す。画面は一覧に残した行を並べ直すとき（`mergeKept`）にこの時刻を使う。
`sortKeyFor` に並び順を渡し、並び順が `starred` のときにこの時刻を返す。

### 検索

`articleSearchQuerySchema` に `starred: "true"` を足す。`searchArticles` は `a.starred = 1` で絞り、隠した重複を除く条件を、購読フィードを指定したときと同じく外す（Q4）。

### 画面

共有のモデル（`nav.ts`）に `sortOptionsOf` を足す。「スター」では3つ、ほかでは2つを返す。Webの `SortMenu` とアプリの選択の欄は、この結果を選択肢として描く。
`listSortOf` は、保存された値が `"starred"` でも「スター」以外の項目なら新しい順として扱う。サーバーが断るので通常は起きないが、古いサーバーや手で編集した設定に備える。
`targetFilter` は、並び順が `starred` のときに `order: "starred"` を送る。

検索の結果の「スターだけ」は、「未読だけ」の隣に置く。WebはURLの `starred=true`、アプリは画面の引数の `starred=true` に持ち、本文の画面へ移っても保つ。「絞り込みを外す」は、これも外す。

ラベルは「スターを付けた順」である。

## Risks / Trade-offs

- 移行の前のスターの時刻は、推定ではなく記事の日時である。→ いまの並びをそのまま残す。これから付けるスターは、その上に並ぶ。
- 古いアプリが `"starred"` の並び順を受け取ると、ボタンの文字が欠ける。→ Webとアプリを同じ変更で直し、アプリは同時に更新する。
- 外したスターを「元に戻す」と、付け直した時刻で先頭へ移る。→ 計画で受け入れた。元の時刻を覚える仕組みは足さない。

## Migration Plan

サーバーの起動時に移行の037が走る。列の追加、既存のスターへの時刻の書き込み、索引、`list_views` の作り直しを1つの移行で行う。
前の版へ戻すときは、戻す前に「スター」の並び順を新しい順か古い順に変えておく。前の版は `starred` の並び順を知らない。
