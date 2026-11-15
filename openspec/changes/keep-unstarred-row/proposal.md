# Proposal

## Why

スターの一覧で、開いている記事のスターを外すと、一覧の再取得でその行がすぐに消える。続けて `j` を押すと、選んでいた記事が一覧にないため、一覧の1件目へ移る。読んでいた位置を失う（Issue #94）。

## What Changes

- スターの一覧でスターを外した行を、別の項目へ移るか更新を選ぶまで、スターのない見た目で一覧に残す。
- 残った行から `j` と `k` で隣の記事へ移れる。
- 残った行でもう一度スターを付けると、スターが付き直り、行は1つのままである。
- Androidアプリとサーバー、ほかの一覧でのスターの切り替えには手を入れない。

## Capabilities

### New Capabilities

なし。

### Modified Capabilities

- `web-reader`：スターの一覧でのスターの切り替えの要件を足す。

## Impact

- `apps/web/src/reader/ReaderPage.tsx`：`setStar` で、スターの一覧の外した行を残す
- `apps/web/src/reader/reader.test.tsx`：スターの一覧のテスト
- APIとサーバー：変えない
