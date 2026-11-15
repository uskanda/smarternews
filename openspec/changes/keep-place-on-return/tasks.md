# Tasks

どの作業も、失敗するテストを先に書いてから実装する。

## 1. スクロール位置を覚える仕組み

- [ ] 1.1 `apps/web/src/lib/scroll-memory.ts` に `useScrollMemory` を作る。履歴の項目ごとに位置が分かれること、`ready` まで戻さないこと、`replace` の後も位置が残ることを、`apps/web/src/lib/scroll-memory.test.tsx` のテストで確かめる

## 2. 実行の詳細

- [ ] 2.1 `apps/web/src/runs/RunPage.tsx` で、「トピックごとにまとめる」を `?group=topic` に持ち、外側の領域で `useScrollMemory` を使う。トピックを直して戻ったときにまとめた表示と位置が戻ること、切り替えで履歴が増えないこと、URLで開けることを、`apps/web/src/runs/runs.test.tsx` のテストで確かめる

## 3. ダイジェスト

- [ ] 3.1 `apps/web/src/digests/DigestPage.tsx` で、狭い画面の領域と広い画面の一覧・本文の領域に `useScrollMemory` を使う。根拠の記事から戻ったときに位置が戻ること（狭い画面と広い画面）と、新しく開いたときは先頭から表示されることを、`apps/web/src/digests/digests.test.tsx` のテストで確かめる

## 4. フィルター

- [ ] 4.1 `apps/web/src/settings/FiltersPage.tsx` で、開いた「隠している記事」を `?shown=` に持ち、ページの領域で `useScrollMemory` を使う。記事を開いて戻ったときに一覧が開いたままで位置が戻ること、`?shown=` で直接開けて存在しない番号を無視することを、`apps/web/src/settings/filters.test.tsx` のテストで確かめる

## 5. 確認

- [ ] 5.1 `apps/web` を実際のブラウザーで幅390pxと広い画面で開き、3つの流れで戻る動きを確かめる
- [ ] 5.2 `make verify` を通し、`openspec validate keep-place-on-return --strict` が通ることを確かめる
