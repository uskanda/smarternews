# Proposal

## Why

2026-11-06のWeb UIの監査（B-16）で、左のペインの並べ替えを続けると、表示が古い並びに戻ることがあると分かった。
移動は互いに待たずに送られ、応答は届いた順にキャッシュへ書かれる。購読フィードの60秒ごとの再取得は、移動の前の並びで楽観的な更新を上書きできる。1回目の移動が失敗すると、その移動の前の並びを書き戻すため、2回目の移動の表示まで消える。
アプリの引き出しの並べ替えも、同じ作りで同じ不具合を持つ。

## What Changes

- 共有のパッケージに、移動の送信を1本の列で順に実行する仕組みを足す。列が空になったときの最後の応答だけを返し、1つが失敗したら待っている送信を捨てて1回だけ知らせる。
- Webとアプリの並べ替えのフックで、移動を列に入れて順に送る。移動の前と列が動いている間は、カテゴリと購読フィードの一覧の実行中の取得を取り消す。
- 失敗のときは、失敗した移動の前の並びを書き戻さず、2つの一覧をサーバーから取り直す。知らせは1回だけ出す。
- APIとサーバーは変えない。

## Capabilities

### New Capabilities

なし。

### Modified Capabilities

- `web-shell`：要件「並べ替えの失敗の扱い」に、続けた移動の応答の逆転、再取得との競合、続けた移動の失敗のシナリオを足す。
- `mobile-shell`：要件「並べ替えの失敗の扱い」に、続けた移動の失敗のシナリオを足す。

## Impact

- `packages/client/src/order.ts`（移動の列）
- `apps/web/src/shell/order.tsx`、`apps/mobile/src/shell/order.tsx`（`useNavMoves`）
- Webとアプリのテストの土台（`apps/web/src/testing/harness.tsx`、`apps/mobile/src/testing/app.tsx`）に、応答を止めておく手段を足す
- 共有のパッケージのテスト：`packages/client/src/order.test.ts`
- 画面のテスト：`apps/web/src/shell/order.test.tsx`、`apps/mobile/src/shell/order.test.tsx`
