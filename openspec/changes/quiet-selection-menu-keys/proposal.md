# Proposal

## Why

本文の文字を選んで右クリックで開くメニューの背後で、`j`、`k`、`s`、`m`、`Shift+A` などが働く。
メニューを開いたまま `j` を押すと、背後で次の記事へ移る。
左のペインの項目のメニューには対策があるが、あとから入ったこのメニューには付いていない。
2026-11-13のWeb UIの監査で見つけた項目である（issue #189、監査ID B-07）。

## What Changes

- 本文で選んだ文字列のメニューを開いている間、1文字のキーによる記事と項目の操作を受け付けない。
- メニューの中の矢印キー、Enter、Escapeは、これまでどおりメニューの操作に使う。

## Capabilities

### New Capabilities

なし。

### Modified Capabilities

- `web-shell`：「メニューを開いている間のキー操作の無効化」の対象に、本文で選んだ文字列のメニューを足す

## Impact

- `apps/web/src/reader/Annotations.tsx`：選んだ文字列のメニューに、キー操作を止める印を足す。
- APIとAndroidアプリに変更はない。
