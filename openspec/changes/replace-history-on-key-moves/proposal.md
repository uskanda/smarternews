# Proposal

## Why

Web の画面では、`j` と `k` で記事を移るたびに、ブラウザーの履歴が1つ増える。
40件読むと、一覧から出るまでに戻る操作が40回要る。
2026-11-06の Web UI の監査で見つけた項目である（issue #113、監査ID U-06）。

## What Changes

- キーで記事を移るとき、記事が開いていれば、ブラウザーの履歴を置き換える。記事が開いていなければ、これまでどおり履歴を足す。
- 対象のキーは `j`・`k` と、本文の端で次または前の記事へ移る `Space`・`Shift+Space` である。
- 注釈の一覧での `j`・`k` も同じ扱いにする。
- 一覧の行を押したときと、「この話題の前の記事」のリンクは、これまでどおり履歴を足す。

## Capabilities

### New Capabilities

なし。

### Modified Capabilities

- `web-shell`: キーボードでの記事の移動で、ブラウザーの履歴をどう扱うかを足す

## Impact

- `apps/web/src/reader/ReaderPage.tsx`：キーでの記事の移動で、記事が開いていれば履歴を置き換える。
- `apps/web/src/reader/AnnotationList.tsx`：注釈の一覧のキーでの移動で、同じように置き換える。
- `apps/web/src/testing/harness.tsx`：ブラウザーの履歴を使って画面を描くオプションと、戻る操作を足す。
- API と Android アプリに変更はない。
