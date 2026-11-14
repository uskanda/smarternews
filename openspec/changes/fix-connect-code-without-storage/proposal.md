# Proposal

## Why

サイトのデータの保存を拒否したブラウザーでは、設定の画面の「アプリ接続用のQRコードを表示する」を押しても何も起きない。画面はページの中の変数のトークンで動くが、ボタンの処理はlocalStorageからトークンを読み、その値が空になるため。2026-11-06のWeb UIの監査で見つけた（監査ID：B-19、issue #105）。

## What Changes

- 画面の全体で共有する文脈へ、使っているトークンを返す関数を足す。APIの呼び出しが使っているのと同じ値を返す。
- 接続用のQRコードの部品は、localStorageではなく、この関数からトークンを得る。
- 保存できるブラウザーでの動きは変わらない。

## Capabilities

### New Capabilities

- なし

### Modified Capabilities

- `web-settings`：「接続用のQRコードの表示」に、ブラウザーへの保存ができない状態のシナリオを足す。

## Impact

- `apps/web/src/app/context.ts`、`apps/web/src/App.tsx`、`apps/web/src/settings/ConnectCode.tsx`
- テスト：`apps/web/src/settings/settings.test.tsx`
- APIとAndroidアプリは変わらない
