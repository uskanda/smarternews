# Proposal

## Why

すべての購読フィードを、いま取得する操作がない。あるのは購読フィードごとの「いま取得」だけである。
朝に画面を開いたとき、利用者は最大で取得周期の分だけ遅れた内容を読むことになる（Issue #131、2026-11-06のWeb UIの監査のR-11）。

## What Changes

- サーバーに、一括の即時の取得を足す。有効な購読フィードの次の取得の時刻を今にそろえ、既存の定期の取得の列で1件ずつ取得する。取得の直列化と、ホストごとの間隔は変えない。
- 取得周期と、失敗で延びた間隔は待たない。Retry-Afterで待っている購読フィードと、一時停止中の購読フィードには要求を出さない。
- APIに、一括の即時の取得の操作を足す。取得の終わりを待たずに、求めた件数と飛ばした件数を返す。購読フィードの応答に、取得の求めの時刻を足す。
- Webの左のペインの「カテゴリ」の見出しの行と、設定の購読フィードの画面の一覧の上に、一括の取得のボタンを置く。
- 取得が終わるまで、2つのボタンは`取得中…`になる。押した画面は、終わったときに結果を知らせ、未読の数と記事の一覧を読み直す。
- Androidアプリには手を入れない。キーボードのキーは足さない。

## Capabilities

### New Capabilities

なし。

### Modified Capabilities

- `feed-subscriptions`：一括の即時の取得の要件を足す。対象、Retry-Afterで待つものを飛ばすこと、直列化を守ることである。
- `http-api`：一括の即時の取得の操作と、購読フィードの取得の求めの時刻の提供を足す。
- `web-settings`：購読フィードの一覧の画面の、一括の取得の操作を足す。
- `web-shell`：左のペインの一括の取得の操作、取得中の表示、終わりの知らせを足す。

## Impact

- `packages/core`：移行 `031`（`feeds` の `fetch_requested_at`）、`db/feeds.ts`、`feeds/poller.ts`、`api.ts`。次の取得の時刻の計算、求めの記録と消去、取得の途中の求めの扱い、応答の型を変える
- `apps/server/src/app.ts`：`POST /api/v1/feeds/fetch`
- `packages/client`：`fetchAllFeeds`
- `apps/web`：`lib/fetch-now.ts`、`api/queries.ts`、`settings/FeedsPage.tsx`、`shell/Shell.tsx`
- `docs/api.md`、`DESIGN.md`
- LLMの呼び出しは増えない。取得するのは既存の購読フィードの取得の処理である
