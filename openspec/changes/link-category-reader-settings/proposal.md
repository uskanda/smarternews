# Proposal

## Why

カテゴリの一覧から、そのカテゴリの設定へ進む操作がない。「設定」を開き、カテゴリの一覧から同じ名前を探して押す必要がある。
カテゴリの設定の画面から、記事の一覧へ進むリンクもない。購読フィードには両方向の入口がある（Issue #196、Web UIの監査のU-02）。

## What Changes

- カテゴリの記事の一覧、「AI生成」の一覧、イベントの一覧の上部に、「カテゴリの設定」のリンクを置く。
- カテゴリの設定の画面の見出しの下に、一覧へのリンクを置く。文言は、ニュースのカテゴリでは「記事の一覧」、イベントのカテゴリでは「イベントの一覧」とする。無効のカテゴリにも出す。
- 左のペインのカテゴリの行のメニューに、「カテゴリの設定」を足す。「AI生成」の行と「未分類」には、いまのままメニューを出さない。
- Androidアプリには手を入れない。

## Capabilities

### New Capabilities

なし。

### Modified Capabilities

- `web-reader`：一覧からカテゴリの設定へのリンクの要件を足す。
- `web-settings`：カテゴリの設定から一覧へのリンクの要件を足す。
- `web-shell`：カテゴリのメニューに「カテゴリの設定」を足す。

## Impact

- `apps/web/src/reader/ReaderPage.tsx`、`apps/web/src/reader/EventList.tsx`：一覧の上部のリンク
- `apps/web/src/settings/CategoryPage.tsx`：見出しの下のリンク
- `apps/web/src/shell/order.tsx`：左のペインのメニュー
- `apps/web/src/lib/paths.ts`：カテゴリの設定の画面のパス
- APIとサーバー：変えない
