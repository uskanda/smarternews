## ADDED Requirements

### Requirement: 続報の停止の印の変更

`PATCH /api/v1/articles/:id` が `followUpsStopped` を含むとき、サーバーは生成記事の続報の停止の印をその値に変えなければならない（MUST）。印の変更は、記事の既読の状態を変えてはならない（MUST NOT）。

#### Scenario: 続報を止める

- **WHEN** 未読の生成記事に `{"followUpsStopped":true}` を送る
- **THEN** 応答の `followUpsStopped` は `true` になり、`isRead` は `false` のまま残る

#### Scenario: 停止を解除する

- **WHEN** 続報の停止の印のある記事に `{"followUpsStopped":false}` を送る
- **THEN** 応答の `followUpsStopped` は `false` になる

### Requirement: 続報の停止の印の提供

記事の詳細の応答は、続報の停止の印があるかを `followUpsStopped` で示さなければならない（MUST）。配信記事では常に `false` とする。

#### Scenario: 記事の詳細を読む

- **WHEN** 続報の停止の印のある生成記事の詳細を要求する
- **THEN** 応答の `followUpsStopped` は `true` になる

### Requirement: 配信記事での続報の停止の拒否

`followUpsStopped` を含む要求が配信記事に送られたとき、サーバーは400を返し、何も変えてはならない（MUST）。誤りの項目は `followUpsStopped`、理由のコードは `not_allowed` とする。

#### Scenario: 配信記事の続報を止めようとする

- **WHEN** 配信記事に `{"followUpsStopped":true}` を送る
- **THEN** 400が返り、記事の印は変わらない

### Requirement: 成績の印による除外の数

トピックの成績の応答は、`rejectedByMark` で除外された候補の数を示さなければならない（MUST）。数えるのは、理由の種類が `missed-follow-up` か `stopped-follow-up` の候補である。記事にならなかった候補の数は、この数を含む。

#### Scenario: 印による除外を数える

- **WHEN** トピックの候補のうち、`missed-follow-up` が2件、`stopped-follow-up` が1件、基準未満が1件除外された状態で成績を要求する
- **THEN** `rejectedByMark` は3、`belowMinimum` は1になる
