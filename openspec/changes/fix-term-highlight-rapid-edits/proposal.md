# Proposal

## Why

語の色付けのページでは、同じまとまりの語を応答の前に続けて削除すると、先に削除した語が画面に戻る。サーバーでは削除済みなので、もう一度消すと404になる。「上へ」「下へ」を応答の前に続けて押しても、1回分しか動かない。
どちらも、描画した時点のまとまりの値から次の値を計算しているためである。2026-11-06のWeb UIの監査の項目B-15で見つかった。

## What Changes

- 語の削除は、応答のあとで、画面が読むまとまりの一覧の今の値から語を除く。続けて削除しても、先に削除した語は戻らない。
- 「上へ」「下へ」は、押すたびに画面を先に1つ動かす。要求は1つずつ順に送る。押した回数だけ動く。
- 並べ替えに失敗したら、まだ送っていない移動は捨てる。画面をサーバーの並びに戻し、`並べ替えられませんでした。もう一度試してください。`と1回知らせる。
- テストの仕組みの`renderApp`に、要求ごとに応答を待たせたり失敗させたりできる任意の指定を足す。
- APIとサーバーは変えない。

## Capabilities

### New Capabilities

なし。

### Modified Capabilities

- `web-settings`の「色付けの語の削除の操作」と「語のまとまりの並べ替えの操作」に、応答の前に続けて操作したときと、並べ替えに失敗したときのシナリオを足す。

## Impact

- `apps/web/src/settings/TermHighlightsPage.tsx`の`useStore`、`removeTerm`、`move`
- `apps/web/src/testing/harness.tsx`の`RenderOptions`
- `apps/web/src/settings/term-highlights.test.tsx`のテスト
