# Tasks

## 1. 中継でのICO

- [ ] 1.1 `format.test.ts` に、ICOの判別と、SVGとHTMLを引き続き拒むテストを先に書き、失敗することを確かめる
- [ ] 1.2 `format.ts` の `sniffImageType` にICOを足し、`proxy.ts` の `Accept` に `image/x-icon` を足して、1.1のテストが通ることを確かめる

## 2. フィードの記述のアイコン

- [ ] 2.1 `feed.test.ts` に、Atomの `<icon>` とJSON Feedの `favicon` を取り出し、RSSの `<image>` を使わないテストを先に書き、失敗することを確かめる
- [ ] 2.2 `feed.ts` の `ParsedSubscription` に `iconUrl` を足し、2.1のテストが通ることを確かめる

## 3. アイコンを探す処理

- [ ] 3.1 `icon.test.ts` に、探す順番、画像でない応答を飛ばすこと、robots.txtが禁じるURLを取得しないこと、何も見つからないときのnullのテストを先に書き、失敗することを確かめる
- [ ] 3.2 `discover.ts` から `<link>` の読み取りを `pageLinks` として切り出し、`PageFetcher` に `allows` を足し、`icon.ts` の `findFeedIcon` を書いて、3.1のテストが通ることを確かめる

## 4. 保存と取得への組み込み

- [ ] 4.1 `ingest.test.ts` に、登録と初回の取得でだけ探すこと、30日を過ぎた取得と304で探し直すこと、探すのに失敗しても取得が成功のまま残ることのテストを先に書き、失敗することを確かめる
- [ ] 4.2 `032_feed_icons.sql` で2列を足し、`db/feeds.ts` に読み書きを足し、`ingest.ts` に組み込んで、4.1のテストが通ることを確かめる

## 5. API

- [ ] 5.1 `feeds-api.test.ts` に、`iconUrl` が署名した中継のパスで元のURLを含まないこと、`image-proxy.test.ts` に、ICOが `image/x-icon` で返ることのテストを先に書き、失敗することを確かめる
- [ ] 5.2 `feedSchema` に `iconUrl` を、`rewrite.ts` に `relayFeedIcon` を足し、`app.ts` の `Feed` を返すすべてのエンドポイントで通して、5.1のテストが通ることを確かめる

## 6. Webの左のペイン

- [ ] 6.1 Webのテストに、アイコンがあるときに `<img>` が出ること、nullのときにも枠が空くこと、一覧の行にアイコンが出ないことのテストを先に書き、失敗することを確かめる
- [ ] 6.2 `Shell.tsx` の `ListItem` に枠とアイコンを足し、6.1のテストが通ることを確かめる

## 7. 全体の確認

- [ ] 7.1 使い捨てのサーバーで、アイコンを持つローカルのフィードを購読し、左のペインにアイコンが出ることと、CSPに反しないことを画面で確かめる
- [ ] 7.2 `make verify` と `openspec validate add-feed-icons --strict` が通ることを確かめる
