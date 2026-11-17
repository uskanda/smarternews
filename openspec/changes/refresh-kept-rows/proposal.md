# Proposal

## Why

未読の一覧に残した行は、既読にした時点の写しのまま表示される。そのため、あとから届いた続報の新しい見出しや未読の状態、LLMの翻訳の見出しが行に出ず、利用者は続報を見落とす。既読やスターの変更が失敗しても、アプリでは残した行が戻らず、表示がサーバーとずれる。

## What Changes

- 一覧を取り直したとき、取得した行にある記事は取得した行を使う。取得した行の更新の時刻が残した行より新しければそのまま使い、続報は新しい見出しの未読の行で出る。更新の時刻が同じか古ければ、残した行の既読とスターだけを重ねる。
- 取得した行にない記事は、これまでどおり残した行を使う。最近読んだ記事の一覧では、取得した行にある記事は取得した行の既読の時刻で並ぶ。
- 記事のキャッシュに書いた変更を、残した行にも届ける。翻訳の見出し、開いた時刻、失敗したときの既読やスターの巻き戻しが対象である。WebとAndroidアプリの両方を変える。
- アプリで既読やスターの変更が失敗したとき、記事の詳細を読み込んでいない行も元に戻す。
- Webでスクロールして既読にした行は、すでに残した行も今の一覧の行から写し直す。
- アプリに失敗の知らせは足さない。

## Capabilities

### New Capabilities

なし。

### Modified Capabilities

- `web-reader`：「読んだ記事の一覧への残留」に、残した行が続報、翻訳の見出し、失敗の巻き戻しを反映するシナリオを足す。
- `mobile-reader`：「読んだ記事を一覧に残す動き」に、同じ3つのシナリオを足す。

## Impact

- `packages/client/src/merge.ts`の`mergeKept`
- `apps/web/src/api/queries.ts`と`apps/mobile/src/api/queries.ts`の`patchArticle`。購読するフック`useArticlePatchListener`を足す
- `apps/web/src/reader/ReaderPage.tsx`の残した行の扱い
- `apps/mobile/src/reader/session.tsx`と、`apps/mobile/src/api/queries.ts`の`useArticleFlags`
- APIとサーバーは変わらない
