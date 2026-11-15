# Proposal

## Why

翻訳と全文の取得がどちらも有効な購読フィードで、全文を待つ記事を開くと、画面が「翻訳できませんでした」を出し、原文を表示する。
先に送った抜粋の翻訳の文字数やLLMの呼び出しも捨てられる。Web UIの監査（B-04）で見つかった。

## What Changes

- サーバーは、記事の本文を翻訳して保存する直前に元の文（題と、全文または配信された内容）が変わっていたら、新しい文で一度だけ翻訳し直す。2回目も変わっていたら、今までどおり失敗する。
- 翻訳し直しは、同じ記事の進行中の翻訳を待つ依頼にも及ぶ。途中で届いた2つ目の依頼も、新しい文の訳を受け取る。
- Webの画面は、全文の取得中と、記事が全文を待っている間は、本文を翻訳する操作を呼ばない。全文が届いたら全文を、取得に失敗したときと依頼に応答がなかったときは配信された内容を翻訳する。
- 待つ間、画面は翻訳の途中の表示を出さず、全文の取得の途中の表示だけを出す。

## Capabilities

### New Capabilities

なし。

### Modified Capabilities

- `feed-subscriptions`: 翻訳の途中で元の文が変わったときに、一度だけ翻訳し直す要件を足す
- `web-reader`: 全文を待つ間と取得中は本文の翻訳を求めない要件を足す

## Impact

- `packages/core/src/translation/service.ts`（記事の翻訳）とそのテスト
- `apps/web/src/api/queries.ts`（`useArticleTranslation`）
- `apps/web/src/reader/ArticleView.tsx`とそのテスト`apps/web/src/reader/full-content.test.tsx`
- APIの形は変わらない。Androidアプリは変えない
