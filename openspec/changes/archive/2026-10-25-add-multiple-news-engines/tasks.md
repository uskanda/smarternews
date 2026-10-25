# Tasks

どの作業も、失敗するテストを先に書いてから実装する。テストは実際の検索先とLLMを呼ばず、記録済みの応答で動かす。

## 1. 設定の読み込み

- [x] 1.1 `packages/core/src/config.ts` の `newsSearch` に `engines` を足し、読み込んだあとの形を `engines` の一覧にする。手順は `design.md` のD1に従う。何も書かないときは `["google-news"]` になることを `config.test.ts` で確かめる。`engine: bing-news` が `["bing-news"]` になることと、`engines` の2つの検索先がその順で残ることも確かめる
- [x] 1.2 `config.test.ts` で、仕様 `sources` の「検索先の指定の誤りの検出」の4つの場面を確かめる。`engine` と `engines` の両方、空の一覧、重複した一覧、知らない名前のそれぞれで `ConfigError` になることを確かめる。誤りの行には `newsSearch` または `newsSearch.engines` の場所が出る
- [x] 1.3 `examples/config.example.yaml` の `newsSearch` を `engines` の書き方に改め、両方の検索先を使う書き方をコメントで示す。例のファイルを読み込むテストが通ることを確かめる

## 2. 収集

- [x] 2.1 `packages/core/src/testing/pipeline.ts` の差し替えが、Google NewsとBing Newsの記録済みの応答を両方返せるようにする。差し替えの `engine` の指定は `engines` に改める。既存の収集のテストが変わらず通ることを確かめる
- [x] 2.2 `packages/core/src/pipeline/run.ts` で、検索語ごとに `engines` の並び順で検索先を1つずつ試す。仕様 `sources` の「複数の検索先への問い合わせ」の2つの場面と「検索先ごとの件数の上限」をテストで確かめる。取得元を試した数が、検索語と検索先の組の数になることも確かめる
- [x] 2.3 `packages/core/src/pipeline/run.ts` で、ニュース検索の失敗の対象を `<検索先の名前>: <検索語>` にする。仕様 `sources` の「検索先ごとの失敗の隔離」と「検索先の失敗の記録」の場面をテストで確かめる。テストは、一方の検索先を遅らせる差し替えと、失敗させる差し替えを使う。実行の状態が「一部失敗」になることも確かめる
- [x] 2.4 `packages/core/src/pipeline` の収集のテストで、仕様 `sources` の「検索先の既定値」と「1つの検索先を指定する古い書き方」の場面を確かめる。差し替えに届いたURLから、要求が指定した検索先のホストにだけ送られたことを確かめる

## 3. 文書

- [x] 3.1 `README.md` と `README.ja.md` のニュース検索の説明を、2つの検索先を同時に使える書き方に改める。`engines` の書き方、`maxResultsPerQuery` が検索先ごとに適用されること、両方を使うと関連の判定の回数が増えることを書く。古い `engine` の書き方が読めることも書く

## 4. 全体の確認

- [x] 4.1 `make verify` が通ることを確かめる
- [x] 4.2 `engines: [google-news, bing-news]` を書いた設定でサーバーが起動することを確かめる。サーバーは、作業用のディレクトリを設定とデータに使い、空いたポートで待ち受けさせる。プロバイダーは `/bin/false` に向け、実物のLLMを呼ばない。確かめたあと、起動のときに控えたPIDでサーバーを止める
