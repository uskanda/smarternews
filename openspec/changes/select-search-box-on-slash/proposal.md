# Proposal

## Why

検索のあとに別の一覧へ移っても、検索欄には前の語が残る。`/` で欄へ移って打つと、前の語に続けて文字が入る（「Blog」のあとに `x` を打つと「Blogx」になる。issue #210）。
また、欄の見える名前はプレースホルダーの「記事を検索」だけで、その色は指定されておらず、白地で4.5対1に届かないおそれがある。

## What Changes

- `/` で検索欄へ移ったとき、欄の文字をすべて選ぶ。広い画面でも、狭い画面で `/` が開いたペインでも、すでに開いているペインでも同じに働く。
- 狭い画面で「項目」ボタンからペインを開いたときと、クリック・Tabで欄へ入ったときの動きは変えない。
- 検索欄のプレースホルダーの色を、補足の文字の色 `on-surface-muted` にする。
- `DESIGN.md` の `on-surface-muted` の説明に、入力欄のプレースホルダーにも使うことを足す。

## Capabilities

### New Capabilities

なし。

### Modified Capabilities

- `web-shell`: 要件「検索欄へ移るキー」に、`/` で移ったときに欄の語を全選択することと、そのシナリオを足す。要件「左のペインの検索欄」に、プレースホルダーの色を足す

## Impact

- `apps/web/src/shell/Shell.tsx`：`/` のキーの処理と、検索欄の `className`。
- `apps/web/src/reader/search.test.tsx`：テストの追加。
- `DESIGN.md`：`on-surface-muted` の説明。
- サーバー、API、`packages/client`、Androidアプリに変更はない。
