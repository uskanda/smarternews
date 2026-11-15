# Tasks

## 1. 中継でのICO

- [x] 1.1 `format.test.ts` に、ICOの判別と、SVGとHTMLを引き続き拒むテストを先に書き、失敗することを確かめる
- [x] 1.2 `format.ts` の `sniffImageType` にICOを足し、`proxy.ts` の `Accept` に `image/x-icon` を足して、1.1のテストが通ることを確かめる

## 2. フィードの記述のアイコン

- [x] 2.1 `feed.test.ts` に、Atomの `<icon>` とJSON Feedの `favicon` を取り出し、RSSの `<image>` を使わないテストを先に書き、失敗することを確かめる
- [x] 2.2 `feed.ts` の `ParsedSubscription` に `iconUrl` を足し、2.1のテストが通ることを確かめる

## 3. アイコンを探す処理

- [x] 3.1 `icon.test.ts` に、探す順番、画像でない応答を飛ばすこと、robots.txtが禁じるURLを取得しないこと、何も見つからないときのnullのテストを先に書き、失敗することを確かめる
- [x] 3.2 `discover.ts` から `<link>` の読み取りを `pageLinks` として切り出す。`PageFetcher` に `allows` を足す
- [x] 3.3 `icon.ts` の `findFeedIcon` を書いて、3.1のテストが通ることを確かめる

## 4. 保存と取得への組み込み

- [x] 4.1 `ingest.test.ts` に、登録と初回の取得でだけ探すこと、30日を過ぎた取得と304で探し直すこと、探すのに失敗しても取得が成功のまま残ることのテストを先に書き、失敗することを確かめる
- [x] 4.2 `032_feed_icons.sql` で2列を足し、`db/feeds.ts` に読み書きを足し、`ingest.ts` に組み込んで、4.1のテストが通ることを確かめる

## 5. API

- [x] 5.1 `image-proxy.test.ts` に、`Feed` を返すどの応答でも `iconUrl` が署名した中継のパスで、元のURLを含まないことのテストを先に書く
- [x] 5.2 5.1のテストに、アイコンの中継のパスが `image/x-icon` で返ることを足し、失敗することを確かめる
- [x] 5.3 `feedSchema` に `iconUrl` を、`rewrite.ts` に `relayFeedIcon` を足す
- [x] 5.4 `app.ts` の `Feed` を返すすべてのAPIで `relayFeedIcon` を通し、5.1と5.2のテストが通ることを確かめる

## 6. Webの左のペイン

- [x] 6.1 Webのテストに、アイコンがあるときに `<img>` が出ること、nullのときにも枠が空くこと、一覧の行にアイコンが出ないことのテストを先に書き、失敗することを確かめる
- [x] 6.2 `Shell.tsx` の `ListItem` に枠とアイコンを足し、6.1のテストが通ることを確かめる

## 7. 全体の確認

- [x] 7.1 Webの画面を使い捨てのサーバーで開き、アイコンを持つローカルのフィードを購読して、左のペインにアイコンが出ることと、CSPに反しないことを確かめる
- [x] 7.2 `make verify` と `openspec validate add-feed-icons --strict` が通ることを確かめる
