# Proposal

## Why

生成記事を開くと、見出しの前にトピックの区画が出る。当てはまるトピックが多い記事ほど、見出しが下がる。
スターを付ける、未読に戻す、外れの印を付けるには、出典の下までスクロールする。外れの印は末尾に、直す先のトピックは上部にあり、続けて行う操作が本文の両端に分かれている。
`link-topics-to-editor` で決めた区画の位置（補足の行のすぐ下）を見直す。

## What Changes

- トピックの区画を、補足の行の下から、出典の区画の下、末尾のボタンの並びの前へ移す。見出し、リンク、2行で切る表示、出さない条件は変えない。
- 本文の上部の補足の行の末尾に、スターと既読を切り替える小さなボタンを置く。末尾の同じボタンは残す。
- `DESIGN.md` に小さなボタン `button-small` を足す。
- 末尾のボタンの並びに、読み上げ名「記事の操作」を付ける。

## Capabilities

### New Capabilities

なし。

### Modified Capabilities

- `web-reader`: 要件「当てはまったトピックの表示」の位置を改める。要件「本文の上部のスターと既読の操作」を足す。

## Impact

- `DESIGN.md`（`button-small` の値と説明）
- `apps/web/src/ui/controls.tsx`（`Button` の寸法の指定）
- `apps/web/src/reader/ArticleView.tsx`（区画の位置、上部のボタン、末尾の並びの読み上げ名）
- Webのテスト（`reader.test.tsx`、`shell.test.tsx`、`order.test.tsx`、`feeds.test.tsx`）
- APIとデータベース、Androidアプリ、キーの操作は変えない
