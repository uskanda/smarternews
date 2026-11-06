# Tasks

どの作業も、失敗するテストを先に書いてから実装する。

## 1. 状態の判定

- [x] 1.1 `packages/client/src/feed-state.ts` に `feedState`、`strongestFeedState`、`FEED_STATE_LABEL` を書く。重なったときの強さの順と、一時停止した購読フィードの扱いを `feed-state.test.ts` で確かめる
- [x] 1.2 `buildNav` のフィードの項目に `state`、グループに `childState` を持たせる。問題のない項目とグループがその値を持たないことと、グループのいちばん強い状態を `nav.test.ts` で確かめる

## 2. 一覧の上部の行

- [x] 2.1 `apps/web/src/lib/fetch-now.ts` の `useFetchFeedNow` に、設定の画面の「いま取得」の処理を移し、`FeedRow` から使う。`feeds-settings.test.tsx` の「fetching a feed now」が通ることで確かめる
- [x] 2.2 `FeedStatusBanner` を作り、購読フィードの一覧の見出しの下に置く。仕様 `web-reader` の「購読フィードの一覧の取得の状態」の各場面を `feeds.test.tsx` で確かめる
- [x] 2.3 `DESIGN.md` の `banner-error` の決まりを直し、一覧の上部の行の決まりを足す。`designmd lint DESIGN.md` が通ることで確かめる

## 3. 左のペインの印

- [x] 3.1 `Shell.tsx` に `FeedStateIcon` を作り、`ListItem` の名前と未読数の間に置く。仕様 `web-reader` の「左のペインの購読フィードの取得の状態の印」の各場面を `shell.test.tsx` で確かめる
- [x] 3.2 `Shell.tsx` で、折りたたんだカテゴリの行に `childState` の印を出す。仕様 `web-reader` の「カテゴリの下の項目の折りたたみ」の新しい場面を `shell.test.tsx` で確かめる
- [x] 3.3 `DESIGN.md` の `nav` の節に、状態のアイコンと折りたたんだカテゴリの行での扱いを足す。`designmd lint DESIGN.md` が通ることで確かめる

## 4. 設定の画面の行き先

- [x] 4.1 `FeedRow` に `id="feed-<識別子>"` と、名前の要素の `tabIndex={-1}` を付け、ハッシュの行へスクロールしてフォーカスを移す。仕様 `web-settings` の「即時の取得の操作」の新しい場面を `feeds-settings.test.tsx` で確かめる

## 5. 全体の確認

- [x] 5.1 `make verify` の各段（lint、型、テスト、ビルド、`DESIGN.md`、textlint、用語）を通す
