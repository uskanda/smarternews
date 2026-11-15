# Proposal

## Why

語の色付けの設定で、まとまりを動かしたあとにまとまりを追加または削除すると、動かしたまとまりの「上へ」か「下へ」へフォーカスが移り、画面もスクロールする。入力欄で文字を打っていた人は、フォーカスを奪われる。移動の記録が消えずに残り、先頭と末尾の判定が変わるたびにフォーカスを移す処理がもう一度走るためである。

## What Changes

- まとまりを動かした直後に一度だけ、動かしたまとまりの操作へフォーカスを移す。そのあと、移動の記録を消す。
- あとでまとまりの並びが変わっても、フォーカスは動かない。
- 押せなくなったボタンの代わりにもう一方へフォーカスを移す今の動きは変えない。

## Capabilities

### New Capabilities

なし。

### Modified Capabilities

- `web-settings`：要件「語のまとまりの並べ替えの操作」に、動かしたあとの追加と削除でフォーカスが移らないシナリオを足す。

## Impact

- `apps/web/src/settings/TermHighlightsPage.tsx` と `apps/web/src/settings/term-highlights.test.tsx`。
- API、データ、Androidアプリには影響しない。
