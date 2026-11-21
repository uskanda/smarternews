# Design

## Context

購読フィードのパーサー（`parseSubscription`）は、項目のタイトル、リンク、識別子、著者、内容、添付を読み、分類は捨てている。
フィルターの照合（`filters/match.ts`）は、欄ごとに1つの文字列を、部分一致か正規表現で比べる。欄は `title`、`content`、`author`、`url` の4つである。
保存済みの項目の書き換えは、タイトル、内容、著者を比べ、変わったときにフィルターを照合し直す。動機は `proposal.md` の「Why」を参照する。

## Goals / Non-Goals

**Goals:**

- 項目の分類を配信元の分類として保存し、フィルターの欄にし、本文の画面に出す。
- 製品のカテゴリと紛れない名前にする。用語集で「配信元の分類」と決める（`grilling.md` のQ1）。

**Non-Goals:**

- 配信元の分類での一覧の絞り込みや、分類ごとの一覧。
- 利用者が付けるタグの機能（`add-mentions` で後回しにしたもの）。
- 変更の前に保存し、配信元のフィードからもう消えた記事の分類を埋めること。
- RSSの出力に分類を載せること、LLMに分類を渡すこと。
- Webページの購読フィードの分類。ページには決まった分類の要素がないので、空のままにする。

## Decisions

### 名前は「配信元の分類」、APIでは feedCategories

用語集に「配信元の分類」（en: feed category）を足す。避けたい別名に「タグ」を書く。
「ラベル」は、ほかの変更の文書が画面の部品の名前の意味で使っているので、別名には書かない。書くと、用語の検査がそれらの文書を誤りとして報告する。
画面の欄の見出しは短く「分類」とする。フィルターの条件の欄に並ぶので、製品のカテゴリと紛れない。

### 読み取りはパーサーで済ませる

`SubscriptionItem` に `categories: string[]` を足す。RSSとRSS 1.0では `rssCategories` が `category` と `dc:subject` を読む。Atomでは `atomCategories` が `category` の `label`（なければ `term`）を読む。JSON Feedは `jsonItem` が `tags` の文字列を読む。
XMLのパーサーの `isArray` に `category` と `dc:subject` を足し、要素が1つでも並びとして受け取る。RSSの `category` は `domain` 属性を持つことがあるので、`textOf` で本文の文字だけを取る。
`tidyCategories` が、値を `plainText` にかけてHTMLの要素を除き、空白をまとめる。空の値は保存しない。同じ値（大文字と小文字は区別する）は、最初の1つだけを保存する。上限は `MAX_CATEGORIES = 20` と `MAX_CATEGORY_CHARS = 100` で、際限なく並べるフィードへの備えであり、設定ではない。

`add-json-feed` は、JSON Feedのタグを読まないと決めていた。この変更で読むことにする（`grilling.md` のQ4）。読まないでおくと、JSON Feedの購読フィードの配信記事だけが、分類の条件に合わなくなるからである。添付と画像を読まない決定は変えない。

### 分類は articles の feed_categories の列にJSONで置く

`048_article_feed_categories.sql` で `articles` に `feed_categories TEXT` を足す。中身は文字列のJSONの配列で、分類がないときはNULLにする。
生成記事と、変更の前に保存した記事はNULLのままである。読み出し（`getArticle`）は、NULL、読めないJSON、配列でない値を空の配列にし、文字列でない要素を捨てる。

### 分類の変化は書き換えとして照合し直す

`storeItems` は、保存済みの記事の分類を保存する値（JSONの文字列）で比べる。違えば `UPDATE articles SET feed_categories = ?` で書き換え、`applyFilters` で照合し直す。
翻訳とタイトルの訳は、タイトルと内容の差でだけ消える。分類だけの差では消さない。訳は分類を含まないからである。
この仕組みで、変更の前に保存した記事も、フィードに残っていれば次の取得で分類を得る（`grilling.md` のQ6）。

### 照合は値ごとに行う

`filterFieldSchema` に `feedCategories` を足す。`filter_conditions` の欄はJSONの文字列なので、移行はいらない。
`MatchableArticle` に `feedCategories: string[]` を足す。`Texts` は、文字列の欄と並びの欄を分けずに、どの欄も「値の並び」として持つ。文字列の欄は値が1つの並びで、値のない欄は空の並びである。
条件は、並びの値のどれかが合えば合ったとみなす。正規表現は値ごとに試すので、`^` と `$` は1つの値の両端を指す（`grilling.md` のQ2）。値をつないで照合しないので、値をまたぐ部分一致は起きない。
`articleTexts` は `feed_categories` を読み、読めない値を空の並びにする。
add-feed-rules のルールは、フィルターと同じ条件と照合を使う。そのため、ルールの照合で記事を読む `ruleArticles` も `feed_categories` を読み、ルールの条件にも「分類」の欄を書ける。

### 画面の表示

Webの `ArticleView` は、著者の `span` の後ろに、分類を「、」でつないだ `span` を置く。アプリの `ArticlePage` は、`meta` の配列の著者の後ろに同じ文字列を足す。分類がないときは何も出さない。
Webの `FilterForm` は、`FIELDS` と `FIELD_LABEL` に `feedCategories`（「分類」）を足す。フィルターの一覧の条件の表示も、同じ見出しを使う。

## Risks / Trade-offs

- 分類だけが変わる項目を毎回配信するフィードでは、取得のたびにフィルターを照合し直す。→ 1件ずつの照合で、内容が変わったときと同じ費用である。
- 同じ分類が大文字と小文字だけ違って並ぶことがある。→ 表示は配信元のとおりに残し、照合は大文字と小文字を区別しないので、フィルターには影響しない。
- 変更の前に保存し、もう配信されない記事には分類が入らない。→ issueで扱わないと決めた。
