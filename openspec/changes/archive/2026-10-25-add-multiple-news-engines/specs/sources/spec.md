## ADDED Requirements

### Requirement: 複数の検索先への問い合わせ

`config.yaml` に複数の検索先が指定されているとき、クローラーは、ニュース検索が有効なトピックの検索語ごとに、指定されたすべての検索先で検索しなければならない（MUST）。

#### Scenario: 2つの検索先で検索する

- **WHEN** 検索先にGoogle NewsとBing Newsを指定し、検索語が1つのトピックで実行する
- **THEN** その検索語でGoogle NewsとBing Newsの両方に検索の要求が送られ、両方の結果が候補になる

#### Scenario: 2つの検索先が同じページを返す

- **WHEN** Google NewsとBing Newsの結果に、同じ元のページを指す結果が1件ずつ含まれる
- **THEN** その2件は1件の候補にまとまる

### Requirement: 検索先ごとの件数の上限

クローラーは、検索語1つについて、検索先ごとに新しい順で最大 `maxResultsPerQuery` 件の結果を候補にしなければならない（MUST）。

#### Scenario: 2つの検索先が上限を超える結果を返す

- **WHEN** `maxResultsPerQuery` が10で、2つの検索先がそれぞれ15件の結果を返す
- **THEN** 検索先ごとに新しい10件、合わせて最大20件が候補になる

### Requirement: 検索先の既定値

`config.yaml` に検索先が指定されていないとき、クローラーはGoogle Newsだけで検索しなければならない（MUST）。

#### Scenario: 検索先を書かずに起動する

- **WHEN** `config.yaml` の `newsSearch` に検索先を書かずにサーバーを起動し、ニュース検索が有効なトピックで実行する
- **THEN** 検索の要求はGoogle Newsにだけ送られる

### Requirement: 1つの検索先を指定する古い書き方

`config.yaml` の `newsSearch.engine` に1つの検索先が書かれているとき、クローラーはその検索先だけで検索しなければならない（MUST）。

#### Scenario: 古い書き方でBing Newsを指定する

- **WHEN** `newsSearch.engine` に `bing-news` と書いてサーバーを起動し、ニュース検索が有効なトピックで実行する
- **THEN** サーバーは起動し、検索の要求はBing Newsにだけ送られる

### Requirement: 検索先の指定の誤りの検出

`config.yaml` の検索先の指定が誤っているとき、サーバーは起動を中止し、誤っている箇所を示さなければならない（MUST）。
誤りは、`engine` と `engines` の両方を書くこと、空の一覧、同じ検索先が2回以上ある一覧、知らない検索先の名前の4つである。

#### Scenario: 新旧の書き方を両方書く

- **WHEN** `newsSearch` に `engine` と `engines` の両方を書いて起動する
- **THEN** サーバーは起動せず、`newsSearch` の検索先の指定が誤っていることを表示する

#### Scenario: 空の一覧

- **WHEN** `newsSearch.engines` を空の一覧にして起動する
- **THEN** サーバーは起動せず、`newsSearch.engines` が誤っていることを表示する

#### Scenario: 重複した一覧

- **WHEN** `newsSearch.engines` に `bing-news` を2回書いて起動する
- **THEN** サーバーは起動せず、`newsSearch.engines` が誤っていることを表示する

#### Scenario: 知らない名前

- **WHEN** `newsSearch.engines` に、Google NewsとBing Newsのどちらでもない名前を書いて起動する
- **THEN** サーバーは起動せず、`newsSearch.engines` が誤っていることを表示する

### Requirement: 検索先ごとの失敗の隔離

1つの検索先への検索が失敗したとき、クローラーは、同じ検索語で他の検索先から得た結果を候補にしなければならない（MUST）。

#### Scenario: Google Newsだけが応答しない

- **WHEN** 検索先にGoogle NewsとBing Newsを指定し、ある検索語でGoogle Newsへの検索が時間内に応答しない
- **THEN** その検索語のBing Newsの結果は候補になる

### Requirement: 検索先の失敗の記録

1つの検索先への検索が失敗したとき、クローラーは、その検索先の名前、検索語、失敗の理由を実行履歴に記録しなければならない（MUST）。

#### Scenario: 失敗した検索先がわかる

- **WHEN** 検索先にGoogle NewsとBing Newsを指定し、ある検索語でBing Newsへの検索だけが失敗する
- **THEN** 実行履歴の失敗には、Bing Newsであることと、その検索語と理由が残り、Google Newsの失敗は記録されない
