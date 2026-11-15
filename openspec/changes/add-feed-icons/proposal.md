# Proposal

## Why

左のペインは、購読フィードを文字の名前だけで示す。名前の長い購読フィードは省略され、見分けにくい（Issue #222）。
サイトのアイコンを名前の前に出せば、名前を読まずに見分けられる。
一覧の行には出さない。フィードの記事の行にだけ画像が付き、主役のまとめた記事より目立つためである（`PRODUCT.md`）。

## What Changes

- サーバーは、購読フィードのアイコンを、フィードの記述、サイトのHTML、`/favicon.ico` の順に探し、見つけた元のURLを `feeds` に記録する。
- 探すのは、初めて取得できたときと、前に探してから30日を過ぎたあとの取得のときである。探すのに失敗しても、取得は失敗にしない。
- APIの購読フィードに `iconUrl` を足す。中身は署名した中継のパスで、元のURLは出さない。
- 画像の中継は、ICOの画像を受け付け、`image/x-icon` として返す。
- Webの左のペインで、購読フィードの名前の前に、文字の高さのアイコンを出す。アイコンのない行も同じ幅を空ける。
- 一覧の行（`ArticleRow`）とAndroidのドロワーは変えない。

## Capabilities

### New Capabilities

なし。

### Modified Capabilities

- `image-proxy`：ICOの画像を受け付ける要件を足す。
- `feed-subscriptions`：アイコンを探す順番と時機、探すのに失敗したときの扱い、APIでの出し方の要件を足す。
- `web-shell`：左のペインの購読フィードのアイコンの要件を足す。

## Impact

- `packages/core/src/images/format.ts`：ICOの判別
- `packages/core/src/sources/feed.ts`：Atomの `<icon>` とJSON Feedの `favicon` の読み取り
- `packages/core/src/feeds/icon.ts`（新規）：アイコンを探す処理
- `packages/core/src/feeds/ingest.ts`：登録と取得のあとにアイコンを探す
- `packages/core/src/db/migrations/032_feed_icons.sql`（新規）、`packages/core/src/db/feeds.ts`：`icon_url` と `icon_checked_at` の列
- `packages/core/src/api.ts`、`packages/core/src/images/rewrite.ts`、`apps/server/src/app.ts`：`iconUrl` を中継のパスで返す
- `apps/web/src/shell/Shell.tsx`：左のペインのアイコン
- Androidのアプリ：変えない
