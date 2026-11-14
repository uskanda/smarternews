# Proposal

## Why

OPMLと設定ファイルの書き出しは、リンクのクリックの直後にBlob URLを解放している。Safariでは、ダウンロードが始まる前にURLが無効になり、書き出しに失敗する場合がある。web-settingsの「OPMLの書き出しの操作」と「設定ファイルの書き出し」の要求は、ファイルをブラウザーに保存させることを求めている。

## What Changes

- ファイルをブラウザーに保存させる共通関数`saveBlob(blob, filename)`を`apps/web/src/lib/download.ts`に足す。Blob URLの解放は、クリックから40秒（`REVOKE_DELAY_MS`）遅らせる。
- OPMLの書き出し（`FeedsPage.tsx`）と設定ファイルの書き出し（`SettingsPage.tsx`）を、この関数に置き換える。エラー処理は変えない。
- アプリ（`apps/mobile`）は変えない。

## Capabilities

### New Capabilities

なし。

### Modified Capabilities

なし。web-settingsの「OPMLの書き出しの操作」と「設定ファイルの書き出し」の要求に、実装を合わせる変更である。要求は変わらないので、`.openspec.yaml`に`skip_specs: true`を置く。

## Impact

- `apps/web/src/lib/download.ts`（新規）と`apps/web/src/lib/download.test.ts`（新規）
- `apps/web/src/settings/FeedsPage.tsx`の`Opml`の書き出し
- `apps/web/src/settings/SettingsPage.tsx`の設定ファイルの書き出し
- APIとサーバーは変わらない
