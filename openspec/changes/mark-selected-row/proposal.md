# Proposal

## Why

2026-11-06のWeb UIの監査（U-08）で、一覧の選択中の行が淡い地の色だけで示されていると分かった。通常の行との差は約1.17対1で、形の手がかりがない。
行をクリックしてから `j` や `k` で移ると、選択は移るのにフォーカスの枠は前の行に残り、2つの位置がずれる。未読と既読も太さと色だけで示しており、読み上げでは区別できない。

## What Changes

- DESIGN.mdの `selected` と `list-row` の説明に、選択中の行の右端に引く `primary` の3pxの縦線と、未読の行の読み上げ用の「未読。」を書き足す。注釈とイベントの一覧の行も同じ扱いにする。
- 記事・イベント・注釈の3つの一覧で、選択中の行の右端に縦線を引く。
- `j` と `k`、または本文の末尾での Space で記事や注釈を移ったとき、フォーカスが一覧の中にあったなら、選んだ行のリンクへフォーカスを移す。本文やページ全体にフォーカスがあるときは動かさない。
- 記事とイベントの一覧で、未読の行の見出しの前に、読み上げ用の「未読。」を足す。既読の行には何も足さない。

## Capabilities

### New Capabilities

なし。

### Modified Capabilities

- `web-reader`: 選択中の行を地の色に加えて形でも示す要件と、未読の行を読み上げでも伝える要件を足す。
- `web-shell`: キーで記事や注釈を移ったときに、一覧の中のフォーカスを選んだ行へ移す要件を足す。

## Impact

- DESIGN.md（`selected` の色の説明、`list-row` の部品の説明）
- `apps/web/src/reader/ArticleRow.tsx`、`EventList.tsx`、`AnnotationList.tsx`、`ReaderPage.tsx`
- Webの画面のテスト（`reader.test.tsx`、`annotations.test.tsx`）
- navの項目の一覧とAndroidアプリは変えない。
