# Proposal

## Why

Webの一覧で`j`か`k`を押すたびに、すべての行を描き直す。行ごとに語の色付けの判定で本文を正規化し直し、日付も整形し直す。読み込んだ行が数百になると、キーへの反応が遅くなるおそれがある（issue #106、監査ID B-20）。

## What Changes

- 語の色付けの判定（行に出すバッジの語グループ）を、文字列ごとに覚える。共有パッケージなので、Androidアプリにも効く。
- 記事の行をメモ化する。現在時刻は分の単位に丸め、一覧で1回だけ求めて渡す。
- `j`や`k`で移ったときに描き直す行は、選択が外れた行と選択された行の2つだけになる。
- 見た目と振る舞いは変わらない。

## Capabilities

### New Capabilities

なし。

### Modified Capabilities

なし。見た目も振る舞いも変わらない、速さだけの修正である。`.openspec.yaml`に`skip_specs: true`を置く。

## Impact

- `packages/client/src/highlight.ts`の`groupsIn`
- `apps/web/src/reader/ArticleRow.tsx`
- `apps/web/src/reader/ReaderPage.tsx`の一覧の描画
- `packages/client/src/highlight.test.ts`と`apps/web/src/reader/reader.test.tsx`のテスト
- APIとサーバーは変わらない
