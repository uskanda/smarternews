# Design

## Context

`scripts/design-tokens.ts` は、DESIGN.mdの書体の大きさをpxのまま `apps/web/src/styles/tokens.css` に書く。
同じpxの値から、`apps/web/src/styles/sizes.ts`（行の高さの数）と `apps/mobile/src/theme/tokens.ts`（Androidアプリの定数）も作る。
ペインの数は `apps/web/src/lib/layout.ts` が `(min-width: 1100px)` と `(min-width: 720px)` で決める。
ペインの幅は `apps/web/src/lib/panes.ts` がpxの数で計算し、利用者が変えた幅をpxで保存する。
記事の一覧の見出しの行は、見出しが `min-w-0 truncate`、ボタンの組が `shrink-0` で、既定の380pxのペインでも見出しには約112pxしか残らない。
引き出しの幅は `w-[min(80vw,var(--spacing-nav))]` である。

## Goals / Non-Goals

**Goals:**

- ブラウザーの文字の大きさの設定に、書体とペインの数の切り替えを追従させる。
- 390px幅の文字200%で、記事の一覧の見出しと引き出しの項目の名前が欠けないようにする。
- 既定の文字の大きさでは、今の見た目を変えない。

**Non-Goals:**

- ペインの幅と範囲を文字の大きさに比例させること。保存する幅の形式も変えない。
- 間隔（`xs` から `2xl`）と指で押す部品の高さをremにすること。
- Androidアプリの書体。

## Decisions

### Web向けの書き出しだけをremにする

DESIGN.mdの値はpxのまま残し、`renderTokens` が書く `font-size` と、pxで書かれた `letter-spacing` を、16pxを1remとして換算する。
DESIGN.mdをremで書き直す案もあった。Androidアプリの定数と `sizes.ts` はpxの数を要るので、書き出しの側で換算するほうが変更が小さい。

### ペインの数の切り替えをemにする

条件を `(min-width: 68.75em)` と `(min-width: 45em)` にする。メディアクエリのemはブラウザーの文字の大きさの設定を単位にするので、文字を拡大すると、ページの拡大と同じように2ペイン、1ペインへ移る。
書体だけをremにすると、広い窓で文字を200%にしても3ペインのままで、本文の1行が15文字ほどになる。
テスト用の `matchMedia` は、emの条件を1emを16pxとして読む。

### Spaceで送る量

`lineHeights["body-lg"]` は既定の文字でのpxの数である。ルートの要素の計算済みの文字の大きさを16で割った比を掛けて、実行時の1行の高さにする。

### 見出しの行の折り返し

行を `flex-wrap` にし、見出しを `basis-[6em] grow` にする。見出しが6emを取れないときだけ、ボタンの組が次の行へ移る。
ボタンの組の中も `flex-wrap` にする。390px幅の文字200%では、2つのボタンが1行に並ばないためである。
1ペインのときだけ2行にする案と、常に2行にする案もあった。幅に収まるかで折り返せば、280pxまで狭めたペインと、2ペインで文字を拡大した場合も同じ仕組みで直る。

### 引き出しの幅

`renderTokens` は、`spacing.nav` がpxのとき、それをremに換算した `--spacing-drawer`（12.5rem）を書き出す。値の出どころをDESIGN.mdだけに保つためである。
引き出しの幅は `w-[min(80vw,var(--spacing-drawer))]` にする。既定の文字では200pxのままで、390px幅の文字200%では312pxになる。

## Risks / Trade-offs

- 2ペインで文字を拡大したときの記事の一覧は380pxのままで、1行に入る文字は減る。見出しの行は折り返しで欠けを防ぐ。
- jsdomは配置を計算しないので、折り返しと幅の見た目そのものはテストで確かめられない。クラスが付くことだけをテストし、見た目はプルリクエストで手で確かめてもらう。
