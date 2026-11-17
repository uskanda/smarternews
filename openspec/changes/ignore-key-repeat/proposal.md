# Proposal

## Why

Webの画面で `Shift+A` を押し続けると、キーの繰り返しの入力で、移った先の一覧も続けて既読になる。
取り消せるのは最後の1回分だけである。`m`、`s`、`h`、`o` も、押し続けると繰り返される。
2026-11-13のWeb UIの監査で見つけた項目である（issue #185、監査ID B-03）。

## What Changes

- キーを押し続けて繰り返しの入力が来たとき、繰り返し動くのは移動のキー（`j`、`k`、Space、Shift+Space）だけにする。
- ほかのキーは、押し続けても最初の1回だけ動く。`Shift+J` と `Shift+K` も繰り返さない。
- 無視した繰り返しの入力は、`g` の2打目の待ちを消費しない。

## Capabilities

### New Capabilities

なし。

### Modified Capabilities

- `web-shell`: 押し続けたキーの扱いの要件を足す

## Impact

- `apps/web/src/lib/keys.ts`：`onKeyDown` で、繰り返してよいキー以外の繰り返しの入力を無視する。
- `apps/web/src/lib/keys.test.ts`：繰り返しの入力のテストを足す。
- `useHotkeys` を呼ぶ側、APIとAndroidアプリに変更はない。
