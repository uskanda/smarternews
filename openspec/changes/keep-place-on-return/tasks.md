# Tasks

どの作業も、失敗するテストを先に書いてから実装する。

## 1. スクロール位置を覚える仕組み

- [x] 1.1 `apps/web/src/lib/scroll-memory.ts` に `useScrollMemory` を作る。`apps/web/src/lib/scroll-memory.test.tsx` のテストで次を確かめる。履歴の項目ごとに位置が分かれること。`ready` まで戻さないこと。`replace` の後も位置が残ること

## 2. 実行の詳細

- [x] 2.1 `apps/web/src/runs/RunPage.tsx` で、「トピックごとにまとめる」を `?group=topic` に持ち、外側の領域で `useScrollMemory` を使う。`apps/web/src/runs/runs.test.tsx` のテストで次を確かめる。トピックを直して戻ったときに、まとめた表示と位置が戻ること。切り替えで履歴が増えないこと。URLで開けること

## 3. ダイジェスト

- [x] 3.1 `apps/web/src/digests/DigestPage.tsx` で、狭い画面の領域と広い画面の一覧・本文の領域に `useScrollMemory` を使う。`apps/web/src/digests/digests.test.tsx` のテストで次を確かめる。根拠の記事から戻ったときに位置が戻ること（狭い画面と広い画面）。新しく開いたときは先頭から表示されること

## 4. フィルター

- [x] 4.1 `apps/web/src/settings/FiltersPage.tsx` で、開いた「隠している記事」を `?shown=` に持ち、ページの領域で `useScrollMemory` を使う。`apps/web/src/settings/filters.test.tsx` のテストで次を確かめる。記事を開いて戻ったときに一覧が開いたままで位置が戻ること。開閉で履歴が増えないこと。`?shown=` で直接開け、存在しない番号を無視すること

## 5. 確認

- [x] 5.1 `apps/web` を実際のブラウザーで幅390pxと広い画面で開き、3つの流れで戻る動きを確かめる
- [x] 5.2 `make verify` を通し、`openspec validate keep-place-on-return --strict` が通ることを確かめる
