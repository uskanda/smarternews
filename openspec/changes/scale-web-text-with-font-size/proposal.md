# Proposal

## Why

Webの画面は書体の大きさをpxで指定しているため、ブラウザーの文字の大きさの設定を反映しない。
PRODUCT.mdは、文字の大きさを200%にしても内容が欠けず、横方向にスクロールしないことを求めている。
設定を反映させると、390px幅では記事の一覧の見出しが縮まないボタンに押されて欠け、引き出しの項目の名前も大きく省略される（Issue #122）。

## What Changes

- DESIGN.mdから書き出すWeb向けの書体の大きさを、pxからremに換算する（16pxを1rem）。DESIGN.mdの値とAndroidアプリの定数はpxのまま。
- ペインの数を切り替える幅を、emの条件（68.75emと45em）にする。既定の文字では今と同じ1100pxと720pxで切り替わる。ペインの幅と、保存する幅の形式はpxのまま。
- Spaceで本文を送る量から引く1行の高さを、実行時の文字の大きさに合わせる。
- 記事の一覧の見出しの行は、見出しに6文字ほどの幅が残らないときだけ、ボタンを次の行へ送る。
- 引き出しの幅を、80vwと12.5rem（既定の文字で200px）の小さいほうにする。
- DESIGN.mdの書体とLayoutの節に、Webでの文字の大きさへの追従と引き出しの幅を書く。

## Capabilities

### New Capabilities

なし。

### Modified Capabilities

- `web-shell`：文字の大きさの設定への追従、文字の大きさに応じたペインの数の切り替え、記事の一覧の見出しの行の折り返し、引き出しの幅の要件を足す。

## Impact

- `scripts/design-tokens.ts`、`scripts/design-tokens.test.ts`：書体の大きさのremへの換算と、引き出しの幅の変数
- `apps/web/src/styles/tokens.css`：作り直す。`sizes.ts` と `apps/mobile/src/theme/tokens.ts` は変わらない
- `apps/web/src/lib/layout.ts`、`apps/web/src/testing/setup.ts`：emの切り替えの条件と、テスト用の `matchMedia`
- `apps/web/src/reader/ReaderPage.tsx`：Spaceで送る量と、見出しの行の折り返し
- `apps/web/src/shell/Shell.tsx`：引き出しの幅
- `DESIGN.md`：書体とLayoutの節の説明
- APIとサーバー、Androidアプリ：変えない
