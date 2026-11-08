# Proposal

## Why

購読フィードの取得は、enclosureとMedia RSS（`media:` の要素）を読まずに捨てている。
YouTubeのフィードの記事は、説明が `media:group` の中にしかないので、本文が空になる。音声の配信のフィードでは、音声へのリンクが消える。一覧のサムネイル（#49）も、取り出す元がない（issueの126番、Web UIの監査のR-03）。

## What Changes

- 購読フィードの取得で、RSSの `enclosure`、`media:content`、`media:thumbnail` と、`media:group` の中の同じ要素を、配信記事の添付として読む。添付は本文とは別に保存する。
- 項目に内容がないときだけ、`media:description` を本文の代わりに使う。`type="html"` の説明は今の変換を通し、それ以外はプレーンテキストとして段落、改行、http(s)のリンクを残してMarkdownにする。
- 説明から作った本文は、今の書き換えの規則に従う。添付だけが変わったときは、添付だけを書き換え、翻訳とフィルターの判定はそのまま残す。
- 記事の詳細のAPIに `attachments` を足す。画像の添付は、画像の中継のURLで読み込めるようにする。
- WebとAndroidアプリの本文の画面で、本文の下に「添付」の一覧を出す。画像は中継を通して出し、動画のサムネイルは記事のページへのリンクにする。音声、動画、その他はリンクにし、横に種類と大きさを書く。再生と埋め込みはしない。
- 添付はRSSに載せず、LLMにも渡さない。

## Capabilities

### New Capabilities

なし。

### Modified Capabilities

- `feed-subscriptions`: 添付の読み取りと保存、説明を本文の代わりに使う規則、添付だけが変わったときの扱いを足す
- `image-proxy`: 画像の添付も中継を通して読み込むことを足す
- `http-api`: 記事の詳細の `attachments` を足す
- `web-reader`: 本文の下の添付の一覧を足す
- `mobile-reader`: 本文の下の添付の一覧を足す

## Impact

- `packages/core`: フィードのパーサー（`sources/feed.ts`）と説明の変換（`feeds/content.ts`）を変える。
- `packages/core`: 保存（`feeds/ingest.ts`、`db/articles.ts`）と移行（`022_article_attachments.sql`）を変える。
- `packages/core`: APIの型（`api.ts`）と画像の中継の書き換え（`images/rewrite.ts`）を変える。
- `packages/client`: 添付の描き方を決める処理（`attachments.ts`）を足す。
- `apps/web`、`apps/mobile`: 添付の一覧の部品を足し、本文の画面に置く。
- `DESIGN.md`: 添付の一覧の決まりを足す。
- RSSの出力とLLMのタスクは変えない。
