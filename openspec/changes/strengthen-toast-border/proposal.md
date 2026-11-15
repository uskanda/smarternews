# Proposal

## Why

2026-11-13のWeb UIの監査（U-13）で、知らせの枠が薄いと分かった。知らせは白い地に `outline` の1pxの枠で、白い一覧と本文の上に出る。枠と白の差は約1.4対1で、影も背後の暗転もないので見落としやすい。
「取り消す」は10秒で消える知らせにしかないので、見落とすと一括の既読を取り消せない。

## What Changes

- DESIGN.mdのYAMLに部品 `toast` を足し、Componentsに知らせの行を足す。枠を `outline-strong` にする理由も書く。
- Webの知らせの枠を `outline` から `outline-strong` に変える。太さ1px、影なし、背後の暗転なしは変えない。

## Capabilities

### New Capabilities

なし。

### Modified Capabilities

- `web-shell`: 知らせの境目を、白い紙面の上でも見分けられる差で示す要件を足す。

## Impact

- DESIGN.md（YAMLの `components:`、`## Components`）
- `apps/web/src/shell/toast.tsx`、`apps/web/src/shell/toast.test.tsx`
- Androidアプリは変えない
