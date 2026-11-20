# Proposal

## Why

購読フィードの設定の画面は、最後の成功と失敗の理由だけを出す。次の取得の時刻と、続けて失敗した回数は、APIが返していても画面にない。
そのため、一時的な障害か、移転や配信の終了かを見分けにくい（Issue #127）。

## What Changes

- 一時停止していない購読フィードの行に「次の取得」と、その日時を出す。日時が過ぎていれば、日時の代わりに「まもなく」と出す。
- 2回以上続けて取得に失敗した購読フィードの行に「n回続けて失敗」と出す。1回目の失敗では回数を出さない。
- APIとサーバーには手を入れない。

## Capabilities

### New Capabilities

なし。

### Modified Capabilities

- `web-settings`：要件「購読フィードの一覧」に、続けて失敗している購読フィードと次の取得の場面を足す。

## Impact

- `apps/web/src/settings/FeedsPage.tsx`：行の取得の状況の表示
- `apps/web/src/settings/feeds-settings.test.tsx`：表示のテスト
- APIとサーバー：変えない
