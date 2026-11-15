# Design

## Context

検索（`searchArticles`）は、全文検索の表 `article_search` で語を照合し、カテゴリか購読フィードで絞り込み、未読だけにもできる。結果の画面は `/search?q=&category=&feed=&unread=true` のURLを持つ。
左のペインは `packages/client/src/nav.ts` の1つのモデル（`NavModel`）から描き、項目の種類（`ListTarget`）ごとに、キー、一覧の絞り込み、一括の既読や並び順のメニューを出すかが決まる。
件数のAPI（`getCounts`）は、`articles` を1回集計して、未読の総数、カテゴリごと、購読フィードごとの数を返す。終了したイベントは未読に数えない。
語の色付けの表 `term_groups` は、位置の列と `orderTermGroups`・`moveTermGroup` で並びを持ち、`/term-groups` のAPIと設定ファイルで往復する。

## Goals / Non-Goals

**Goals:**

- 検索語と絞り込みを保存し、Webの左のペインに未読数つきで並べる。
- 未読数を、開いたときの一覧の件数と同じ規則で数える。
- 項目のキー移動、隠す設定、メニューを、他の一覧と同じに扱う。

**Non-Goals:**

- Androidの引き出しへの表示と保存の操作（Q1）。
- 保存した検索の結果での一括の既読（Q6）。
- 保存した検索のドラッグでの並べ替え。並べ替えは項目のメニューで行う。
- LLMの呼び出し。

## Decisions

### 表

`032_saved_searches.sql` で表 `saved_searches` を作る。列は `id`、`name`、`query`、`category_id`、`feed_id`、`position`、`created_at` である。
`category_id` と `feed_id` は、それぞれ `categories` と `feeds` を `ON DELETE CASCADE` で参照し、CHECK制約でどちらか1つまでにする。絞り込みの対象を消したとき、絞り込みだけを外すと名前と中身が食い違うため、保存した検索ごと消す。
名前の一意は求めない。同じ条件の二重の保存も拒まない。

### 読み書き

`packages/core/src/db/saved-searches.ts` に、`listSavedSearches`、`createSavedSearch`、`updateSavedSearch`、`deleteSavedSearch`、`orderSavedSearches`、`moveSavedSearch` を置く。並べ替えは `orderTermGroups` と `moveTermGroup` と同じ作りである。
作成では、検索語を `parseSearchTerms` で確かめ（空と200文字超を拒む）、カテゴリと購読フィードの存在を確かめる。両方の指定は入力の型で拒む。
名前は前後の空白を除いて1文字から100文字までとする。更新できるのは名前だけである。

### 数え方

`searchArticles` の条件を組み立てる部分を `searchConditions(query)` に切り出す。検索の結果の取得と、保存した検索の数え上げは、この関数を共有する。
`getCounts` は、保存した検索ごとに、その条件に `unread: "true"` を加えた `SELECT count(*)` を1回ずつ実行し、`savedSearches: [{ id, unread }]` に入れる。終了したイベントも数える。これは検索の結果と同じで、件数のAPIのほかの数とは違う（Q8）。
保存した検索の数は利用者が手で足すだけなので、件数の読み出しのたびに数回の問い合わせが増えても許容できる。

### APIの型

`api.ts` に `savedSearchSchema`（`id`、`name`、`query`、`categoryId`、`feedId`）、`savedSearchCreateSchema`、`savedSearchUpdateSchema`（名前だけ）、`savedSearchMoveSchema` を足す。
`countsSchema` に `savedSearches` を足し、`.default([])` にする。古いサーバーの応答も読める。
経路は `GET/POST /saved-searches`、`PATCH/DELETE /saved-searches/:id`、`POST /saved-searches/:id/move` で、`/term-groups` に合わせる。

### 設定ファイル

`savedSearches` の項目は、`name`、`query`、`scope` を持つ。`scope` はフィルターの項目と同じく、カテゴリをスラッグ（`{ category }`）で、購読フィードをURL（`{ feed }`）で指し、絞り込みがないときは書かない。
読み込みでは、名前、検索語、絞り込みのすべてが同じものがあればそれを使い、なければ作る。ファイルの順を先に、ほかをあとに並べる。指す先がないときはファイル全体を拒む。

### 左のペインのモデル

`ListTarget` に `{ type: "savedSearch"; savedSearchId }` を足す。キーは `search-<id>`、Webのパスは `/s/<id>` である。
`NavModel` に `savedSearches: NavEntry[]` を足し、`buildNav` は `savedSearches` を任意の入力として受ける。Androidは渡さないので、引き出しは何も変わらない。
`hideEmptyEntries` は、未読が0の保存した検索を隠し、開いている項目は残す。`stepTarget` は上の段のあと、カテゴリの前に保存した検索を通る。
`hasReadToggle` は真、`hasListControls` と `hasSortMenu` は偽にする。`targetFilter` と `targetScope` は保存した検索には使わない（空を返す）。`nextTarget` は上の段と同じく移らない。

### Webの一覧

経路 `s/:savedSearchId/:articleId?` に、`ReaderPage` の `view="savedSearch"` を当てる。保存した検索の条件で `useArticleSearch` を呼び、既読も表示する切り替え（`read=1`）がオフなら `unread: "true"` を足す。
検索の結果と同じく、行に抜粋を出し、語を色付けする。スクロールで既読にする機能は、検索の結果と同じく働かせない。見出しは保存した検索の名前である。
保存した検索がないID（削除された、または別の端末で消した）を開いたときは「この保存した検索はありません。」と出す。

### 左のペインの表示とメニュー

上の段の `ul` と「カテゴリ」の間に、見出し「保存した検索」と項目の `ul` を置く。項目が0件（隠した結果を含む）なら区切りごと出さない。
項目のメニュー（右クリック、メニューキー、Shift+F10）は、「名前を変更」「上へ移動」「下へ移動」「削除」を持つ。名前の変更は `FormDialog`、削除の確認は `ConfirmDialog` を使う。開いている項目を削除したら「未読」へ移る。
移動は、一覧をすぐに並べ替えてからサーバーへ送り、失敗したら元に戻して知らせる。カテゴリと購読フィードの並べ替え（`useNavMoves`）と同じ作りである。

### 検索の結果からの保存

検索の結果の画面の見出しの操作に「検索を保存」のボタンを置く。押すと `FormDialog` で名前を尋ね、既定は検索語である。検索語が空のときはボタンを押せない。
保存すると、そのときの検索語とカテゴリまたは購読フィードの絞り込みで作成し、保存した検索の一覧と件数を読み直し、知らせを出す。

## Risks / Trade-offs

- 件数の読み出しのたびに、保存した検索の数だけ全文検索の問い合わせが増える。保存した検索が数十を超える使い方は想定しない。
- 保存した検索の未読数は終了したイベントを含むため、「未読」の数とは足し合わない。項目は別の区切りに置くので、合計と比べる読み方はされにくい。
- 古いWebの画面は件数の `savedSearches` を無視し、古いサーバーへの新しい画面は空として読む。
