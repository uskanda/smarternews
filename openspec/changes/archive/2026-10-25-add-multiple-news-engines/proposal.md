# Proposal

## Why

ニュース検索は、`config.yaml` で選んだ1つの検索先にしか問い合わせない。
生成記事の候補の大半はニュース検索から来るので、検索先が1つだと、その検索先が載せないサイトの記事は候補にならない。
Google Newsの転送用URLの解決が動かなくなると、ニュース検索の候補はすべて本文を取得できなくなる。
Google NewsとBing Newsを同時に使えば、候補を集めるサイトが増え、一方の検索先が動かなくなっても収集が続く。

## What Changes

- `config.yaml` の `newsSearch.engines` に、使う検索先を一覧で書けるようにする。ニュース検索が有効なトピックでは、検索語ごとに一覧のすべての検索先へ問い合わせる。
- `maxResultsPerQuery` は検索先ごとに適用する。
- 検索先と検索語の組を1つの取得元として扱う。一方の検索先が失敗しても、もう一方の結果は候補になる。実行履歴の失敗には、検索先の名前と検索語が残る。
- 何も書かないときの既定値は、今と同じGoogle Newsだけにする。
- 今の `newsSearch.engine` は、1項目の一覧として読み続ける。
- `engine` と `engines` の両方、空の一覧、重複した一覧、知らない名前のいずれかが書かれていると、サーバーは起動を中止する。
- 例の設定ファイルとREADMEを `engines` の書き方に改める。

画面、API、データベースは変えない。候補の種類はニュース検索のままで、どの検索先が見つけたかは記録しない。

## Capabilities

### New Capabilities

なし。

### Modified Capabilities

- `sources`: ニュース検索が、設定した複数の検索先に問い合わせる。検索先の指定の既定値と誤りの扱い、検索先ごとの件数の上限と失敗の隔離を足す。

## Impact

- `packages/core/src/config.ts`: `newsSearch` の設定の形と、古い書き方の読み替え、誤りの検出。
- `packages/core/src/pipeline/run.ts`: 検索語と検索先の組ごとに取得元を試す。
- `packages/core/src/sources/news-search.ts`: 1回の呼び出しで1つの検索先を受け取る形は変えない。
- `packages/core/src/testing/pipeline.ts`: テストは2つの検索先の記録済みの応答で動かす。
- `examples/config.example.yaml`、`README.md`、`README.ja.md`: 設定の書き方。
- 既存の設定ファイルは書き換えなしで動く。両方の検索先を使うには、利用者が `engines` を書く。
- 両方の検索先を使うと、候補の数と関連の判定の回数が増える。判定済みのURLは次の実行から除外される。
