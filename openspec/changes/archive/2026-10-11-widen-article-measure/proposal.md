# Proposal

## Why

Webの画面の本文は、1行を36字までに抑えている。幅1920pxの画面では、本文のペインが約1340pxあるのに、文字の幅は612pxで止まり、右側が大きく空く。
利用者から、文字が表示される領域を広げてほしいという要望があった。

## What Changes

- 記事の本文のペインで、文字の幅の上限を36emから52emに広げる。1行は52字前後になる。
- 本文のペインが上限より広いとき、本文をペインの中央に寄せる。余白が右だけに偏らない。
- 記事用の幅を、`DESIGN.md` に新しい値として足す。設定と実行履歴の画面は、いまの `measure`（36em）のまま変えない。

仕様の要件は変わらない。行の長さは `DESIGN.md` が持つ値で、`web-reader` の仕様には書いていない。

## Capabilities

### New Capabilities

なし。

### Modified Capabilities

なし。

## Impact

- `DESIGN.md` の間隔の値と、本文の行の長さの説明。
- `apps/web` の本文の表示。`DESIGN.md` から作るCSSと、Androidアプリ向けの値も作り直される。Androidアプリの表示は変わらない。
