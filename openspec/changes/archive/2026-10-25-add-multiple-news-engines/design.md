# Design

## Context

動機はproposal.mdのWhyを参照する。

- `newsSearch` は `config.ts` の `configSchema` の中のstrictObjectで、`engine` と `maxResultsPerQuery` の2項目を持つ。知らない項目はzodの誤りになる。`parseConfig` はzodの誤りを「`config.yaml is invalid:`」に続く、項目の場所と理由の行として `ConfigError` に載せる。
- 収集の処理（`run.ts` の `collect`）は、取得元を1つずつ `attempt` で試す。`attempt` は、例外を受けると `ctx.failures` に段階、対象、理由を積み、次の取得元へ進む。ニュース検索の段階の名前は `news-search`、対象は検索語である。
- `collectNews` は1回の呼び出しで1つの検索先に問い合わせる。Google Newsの結果だけが転送用のURLの解決を要する。
- Web、アプリ、APIは、実行履歴の失敗の対象を文字列のまま表示する。段階の名前は `packages/client/src/labels.ts` が表示用の名前に変える。

## Goals / Non-Goals

**Goals:**

- 古い `engine` の書き方の設定ファイルを、書き換えずに読める。
- 読み込んだあとの `Config` には、検索先の一覧だけを持たせる。収集の処理は古い書き方を知らずに済む。

**Non-Goals:**

- 検索先ごとに検索語や言語を変えること。検索語と言語はトピックの設定のまま、すべての検索先で共通に使う。
- 複数の検索先への要求を並行して送ること。今と同じく1件ずつ順に送る。

## Decisions

### D1. 設定の形と古い書き方の読み替え

`newsSearch` の入力の形は、`engine`（1つの名前、省略可）、`engines`（名前の一覧、省略可）、`maxResultsPerQuery` の3項目にする。
読み込んだあとの形は `{ engines: NewsEngine[]; maxResultsPerQuery: number }` にする。

zodの検査は次の順に行い、どれも項目の場所つきで `ConfigError` の行になる。

1. `engines` は、1件以上で、重複のない、`google-news` または `bing-news` の一覧であること。
2. `engine` と `engines` が両方書かれていないこと。誤りの場所は `newsSearch` とする。
3. 読み替え：`engines` があればそれを使い、`engine` だけなら `[engine]`、どちらもなければ `["google-news"]` にする。

古い `engine` を受け付ける処理は、この読み替えの1か所だけに置く。
別案として、値に1つの名前と一覧のどちらも書ける `engine` を検討した。単数形の項目名に一覧が入ると紛らわしいので採らない（grilling.mdの第2ラウンドQ6）。

### D2. 収集の順と失敗の対象

ニュース検索が有効なトピックでは、検索語ごとに、`engines` の並び順で検索先を1つずつ `attempt` で試す。
1回の `attempt` は1つの検索先と1つの検索語の組を扱う。実行履歴の取得元を試した数（`ctx.sources.attempted`）も、この組の数で数える。

失敗の段階の名前は `news-search` のままにする。対象は `<検索先の名前>: <検索語>`（例：`bing-news: ランサムウェア`）にする。
段階の名前を検索先ごとに分ける案もあった。その案では、表示用の名前の表と、段階で絞る処理にも手を入れる必要がある。対象に検索先の名前を足す方法なら、画面とAPIを変えずに済む。

`maxResultsPerQuery` は `collectNews` の中で1回の呼び出しごとに適用している。そのため、検索先ごとの件数の上限は、`collectNews` を変えずに満たせる。

### D3. テストの差し替え

テスト用の取得の差し替え（`testing/pipeline.ts`）に、Google NewsとBing Newsの記録済みの応答を両方置けるようにする。既定の検索先は、今の `bing-news` のままにする。
仕様の各Scenarioは、検索先ごとに応答を返す、遅らせる、失敗させる差し替えで確かめる。

## Risks / Trade-offs

- 両方の検索先を使うと、候補の数と関連の判定の回数が増える。対策として、既定値はGoogle Newsだけにする。増えるのは、利用者が `engines` を書いたときだけである。判定済みのURLは次の実行から除外され、元のURLが同じ結果は1件にまとまる。
- Bing Newsが返すMSNへの転載は、元の記事とURLが違うため別の候補になる。この変更では扱わず、記事の生成のときに同じ話題として1つにまとめる。転載が目立てば、出典名で除外する変更を別に行う。
- ニュース検索の要求が倍になり、1回の実行に時間がかかる。2つの検索先は別のホストなので、ホストごとの間隔の待ちは重ならない。検索語は1トピックあたり最大8つなので、増える要求は1トピックにつき最大8件である。

## Migration Plan

- データベースの移行はない。
- 既存の設定ファイルは、書き換えずに前と同じ動きをする。
- 両方の検索先を使うには、リリースのあとに利用者が `config.yaml` の `engine` を `engines: [google-news, bing-news]` に書き換え、サーバーを再起動する。
- 戻すときは、`engines` を前の版が読める `engine` の1行に戻してから、前の版に戻す。
