# Design

## Context

フィードの文書は `packages/core/src/sources/feed.ts` の2つの関数が読む。購読フィードは `parseSubscription`、トピックのフィードは `parseFeed`（`collectFeed` が使う）である。どちらもXMLとして読み、RSS 2.0、RSS 1.0、Atomでなければ「the document is not a feed」のエラーを投げる。

フィードの発見は `packages/core/src/feeds/discover.ts` の `discoverFeeds` が行う。URLがフィードならその1件を返し、そうでなければページのlinkの要素から、XMLの3つの型のものだけを集める。Fetcherは同じホストへの要求の間を既定で1秒あける。

## Goals / Non-Goals

**Goals:**

- JSON Feedの判定と項目の読み方を1か所にまとめ、2つの関数から使う。
- 購読フィードの取得、条件付きの要求、配信記事の保存の流れは変えない。

**Non-Goals:**

- `application/json` の型のlinkの要素を認めること。
- `/blog/` のようなパスの下の場所を試すこと。
- JSON Feedの添付（`attachments`）、画像、タグを読むこと。

## Decisions

### JSON Feedの判定

`parseJsonFeed(text)` は、本文の先頭の空白を除いた文字が `{` のときだけ `JSON.parse` を試す。読めたオブジェクトの `version` が文字列で、`https://jsonfeed.org/version/` で始まるときにJSON Feedとみなし、そうでなければ `null` を返す。
`parseFeed` と `parseSubscription` は、XMLとして読む前にこれを試す。`null` ならいまのXMLの処理に進むので、XMLのフィードの結果は変わらない。

代わりに応答のContent-Typeで分ける案もあった。サーバーが `text/plain` や `application/octet-stream` で返すこともあるので、本文で判定する。

### 項目の読み方

1つの `jsonItem` が `SubscriptionItem` を作り、`parseFeed` はそのうちの `FeedItem` の欄だけを使う。

- title：`title` を `plainTitle` にかける。
- url：`url`。ないときは `external_url`。
- publishedAt：`date_published`。ないときは `date_modified`。
- snippet：`summary`、`content_text`、`content_html` の順に、最初にある値を `plainText` にかける。`summary` と `content_text` は平文なので、先に特殊文字を文字参照に置き換え、中の `<` をタグとして消さないようにする。
- key：`id`。数のときも文字列にする（1.0では数のことがある）。
- author：`authors` の先頭の `name`。ないときは1.0の `author` の `name`。
- contentHtml：`content_html`。ないときは `content_text` の `&`、`<`、`>`、`"` を文字参照に置き換え、空の行で段落に分け、段落の中の改行を `<br>` にしたもの。後の処理は `contentHtml` を信頼しないHTMLとして変換するので、ここで消毒はしない。
- siteUrl：`home_page_url`。http(s)のときだけ使う。

値の型が想定と違う欄（文字列でない `title` など）は、ないものとして扱う。

### よくある場所の試行

`discoverFeeds` は、linkの要素からの結果が空のときだけ、ページの応答の `url` を基準に6か所のURLを作り、順に `fetcher.get` で取得する。応答の `url` は転送の後のURLなので、オリジンも転送の後のものになる。
取得のエラー、200番台でない状態、`parseSubscription` が投げたエラーは、黙って次へ進む。読めた最初の1件を、その場所の応答の転送の後のURLを `normalizeUrl` にかけたものと、フィードのタイトルで返す。

6か所を並べて要求する案もあった。Fetcherはホストごとに間隔をあけるので速くならず、見つかった後の要求が無駄になるので、順に試す。

### Acceptの見出し

`fetchXml` と `ingest.ts` の `FEED_ACCEPT` に `application/feed+json` を足す。`*/*` があるので、なくても受け取れるが、内容の交渉をするサーバーに意図を伝える。

## Risks / Trade-offs

- linkの要素のないページの発見が遅くなる。要求は最大6件で、最悪で約6秒かかる。画面はいまの「探しています」の状態のまま待つ。件数はissueの「数件だけ」に収めた。
- サイトによっては、よくある場所のURLを別の用途に使っている。フィードとして読めたものだけを返すので、誤って購読されることはない。利用者は返った候補を見てから登録する。
- 大きなJSONもある。Fetcherの `maxBytes` の上限で、読む大きさを抑える。
