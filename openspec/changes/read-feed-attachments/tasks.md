# Tasks

どの作業も、失敗するテストを先に書いてから実装する。

## 1. 読み取り

- [x] 1.1 `parseSubscription` で、`enclosure`、`media:content`、`media:thumbnail` と、`media:group` の中の要素を添付として読む。内容がないときは `media:description` を返す。形式（RSS 2.0、YouTubeのAtom、RSS 1.0）を `feed.test.ts` で確かめる
- [x] 1.2 `feed.test.ts` で、重複、http(s)以外のURL、相対のURL、数とURLの長さの上限を確かめる
- [x] 1.3 `plainDescriptionHtml` と `convertDescription` を `content.ts` に足す。段落、改行、http(s)だけのリンク、エスケープを `content.test.ts` で確かめる

## 2. 保存とAPI

- [x] 2.1 `022_article_attachments.sql` で `articles` に `attachments` の列を足し、`storeItems` で新しい記事と書き換えに添付を保存する。説明から作った本文、変更の前に保存した記事の書き換え、添付だけの変化を `ingest.test.ts` で確かめる
- [x] 2.2 `articleSchema` に `attachments` を足し、`getArticle` で返す。読めないJSONを空の配列にすることを `ingest.test.ts` で確かめる
- [x] 2.3 `relayArticleImages` で画像の添付に中継のURLを入れる。`rewrite.test.ts` と、サーバーの `image-proxy.test.ts` で確かめる
- [x] 2.4 `rss.test.ts` で、添付がRSSに載らないことを確かめる。`summarize.test.ts` で、LLMに渡らないことを確かめる

## 3. 画面

- [x] 3.1 `packages/client` に `attachmentDisplays` と `formatFileSize` を書き、`attachments.test.ts` で確かめる
- [x] 3.2 Webの `Attachments` を作り、本文の下に置く。仕様 `web-reader` の場面を `attachments.test.tsx` で確かめる
- [x] 3.3 Androidアプリの `Attachments` を作り、本文の下に置く。仕様 `mobile-reader` の場面を `attachments.test.tsx` で確かめる
- [x] 3.4 `DESIGN.md` に添付の一覧の決まりを足す

## 4. 全体の確認

- [x] 4.1 `make verify` の各段（lint、型、テスト、ビルド、`DESIGN.md`、textlint、用語）を通す
