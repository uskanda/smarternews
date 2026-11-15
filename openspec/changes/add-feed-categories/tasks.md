# Tasks

どの作業も、失敗するテストを先に書いてから実装する。

## 1. 用語

- [x] 1.1 `openspec/glossary.yml` に「配信元の分類」を足す

## 2. 読み取り

- [x] 2.1 `parseSubscription` で、RSSとRSS 1.0の `category` と `dc:subject`、Atomの `category`、JSON Feedの `tags` を読む。Atomは `label` を先に、なければ `term` を読む。`domain` 属性のある `category` を含めて `feed.test.ts` で確かめる
- [x] 2.2 `feed.test.ts` で、空白、空の値、重複、HTMLの要素、数と長さの上限を確かめる

## 3. 保存とAPI

- [x] 3.1 `032_article_feed_categories.sql` で `articles` に `feed_categories` の列を足す。`storeItems` で、新しい記事と保存済みの記事に分類を保存する
- [x] 3.2 `ingest.test.ts` で、変更の前に保存した記事が次の取得で分類を得ることを確かめる。分類だけの変化で照合し直し、翻訳を消さないことも確かめる
- [x] 3.3 `articleSchema` に `feedCategories` を足し、`getArticle` で返す。読めないJSONを空の配列にすることを確かめる

## 4. 照合

- [x] 4.1 `filterFieldSchema` に `feedCategories` を足し、`MatchableArticle`、`Texts`、`compileConditions` で値ごとに照合する。`^Tech$`、部分一致、分類のない記事を `match.test.ts` で確かめる
- [x] 4.2 `articleTexts` で `feed_categories` を読む。フィルターの登録のときに保存済みの記事を照合し直すことを `db/filters.test.ts` で確かめる

## 5. 画面と文書

- [x] 5.1 Webの `FilterForm` に「分類」の欄を足し、テストで確かめる
- [x] 5.2 Webの `ArticleView` で著者の横に分類を出し、テストで確かめる
- [x] 5.3 `ArticlePage`（アプリ）で著者の横に分類を出し、テストで確かめる
- [x] 5.4 `README.ja.md` の条件の欄の一覧に「分類」を足す。`README.md` と `docs/api.md` もそろえる

## 6. 全体の確認

- [x] 6.1 `make verify` の各段（lint、型、テスト、ビルド、`DESIGN.md`、textlint、用語）を通す。textlintと用語は、この変更の文書に指摘がない（`add-feed-articles-list` の既存の指摘は残る）
