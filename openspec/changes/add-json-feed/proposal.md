# Proposal

## Why

サーバーはJSON Feedを読めない。フィードの発見も、ページのlinkの要素のうちXMLの3つの型しか見ない。
そのため、JSON Feedしか出さないサイトや、linkの要素でフィードを案内しないサイトは、Webページとしての購読になり、条件付きの要求を使えない。

## What Changes

- JSON Feed 1.1と1.0を、購読フィードとトピックのフィードの両方で読めるようにする。
- フィードの取得の要求のAcceptの見出しに `application/feed+json` を足す。
- フィードの発見で、linkの要素の型 `application/feed+json` を認める。
- linkの要素からフィードが1件も見つからないとき、オリジンの直下のよくある6か所を順に試し、読めた最初の1件を返す。
- 追加の画面のURL欄の案内文を、よくある場所も探すことが分かる文に変える。
- どの処理もLLMを呼ばない。

## Capabilities

### New Capabilities

なし。

### Modified Capabilities

- `feed-subscriptions`：購読フィードの登録でJSON Feedを読む。ページからのフィードの発見で、`application/feed+json` の型と、よくある場所からの発見を加える。
- `sources`：トピックのフィードからの収集でJSON Feedを読む。

## Impact

- `packages/core/src/sources/feed.ts`：JSON Feedの読み取りを足し、`parseFeed` と `parseSubscription` から使う。Acceptの見出しを変える。
- `packages/core/src/feeds/discover.ts`：型の追加と、よくある場所の試行。
- `packages/core/src/feeds/ingest.ts`：Acceptの見出しを変える。
- `apps/web/src/settings/AddFeedForm.tsx`：案内文。
- 発見でlinkの要素のないページを探すと、同じホストへ最大6件の要求が増える。Fetcherのホストごとの間隔のため、最悪で約6秒かかる。
