# Spec Delta

## MODIFIED Requirements

### Requirement: 購読フィードの登録

フィードのURLを指定した登録を受けたとき、サーバーはそのURLを取得し、フィードとして読めた場合に限って購読フィードを保存しなければならない（MUST）。

#### Scenario: フィードを登録する

- **WHEN** Atomのフィードを返すURLを指定して登録する
- **THEN** 購読フィードが保存され、名前はそのフィードのタイトルになり、配信されている項目が配信記事として保存される

#### Scenario: JSON Feedを登録する

- **WHEN** JSON Feed 1.1の文書を返すURLを指定して登録する
- **THEN** 購読フィードが保存され、名前はそのフィードのタイトルになり、項目が識別子、著者、本文を持つ配信記事として保存される

#### Scenario: フィードでないURL

- **WHEN** フィードの指定を持たないHTMLのページのURLを指定して登録する
- **THEN** サーバーは登録を拒否し、フィードとして読めなかったことを返し、購読フィードは増えない

### Requirement: ページからのフィードの発見

フィードを探す要求でHTMLのページのURLを受けたとき、サーバーはそのページが指定するフィードのURLとタイトルの一覧を返さなければならない（MUST）。

#### Scenario: フィードを2つ指定するページ

- **WHEN** RSSとAtomのフィードを1つずつ指定するページのURLで、フィードを探す要求をする
- **THEN** サーバーは2つのフィードのURLとタイトルを返し、購読フィードは増えない

#### Scenario: JSON Feedを指定するページ

- **WHEN** 型が `application/feed+json` のlinkの要素を持つページのURLで、フィードを探す要求をする
- **THEN** サーバーはそのJSON FeedのURLとタイトルを返す

#### Scenario: フィードそのもののURL

- **WHEN** フィードを返すURLで、フィードを探す要求をする
- **THEN** サーバーはそのURLとフィードのタイトルを1件だけ返す

#### Scenario: JSON FeedそのもののURL

- **WHEN** JSON Feedを返すURLで、フィードを探す要求をする
- **THEN** サーバーはそのURLとJSON Feedのタイトルを1件だけ返す

## ADDED Requirements

### Requirement: JSON Feedの条件付きの取得

JSON Feedの購読フィードを取得するとき、サーバーはXMLのフィードと同じく、前回の応答の検証子を付けた条件付きの要求を送らなければならない（MUST）。

#### Scenario: 変わっていないJSON Feed

- **WHEN** 前回の取得でETagを受け取ったJSON Feedの購読フィードを取得し、相手が304を返す
- **THEN** サーバーはそのETagを付けて要求し、取得の結果を「変更なし」として記録する

### Requirement: よくある場所からのフィードの発見

ページのlinkの要素からフィードが1件も見つからないとき、サーバーはよくある6か所を順に取得し、フィードとして読めた最初の1件のURLとタイトルを返さなければならない（MUST）。
6か所は、そのURLのオリジンの直下の `/feed`、`/rss.xml`、`/feed.xml`、`/atom.xml`、`/index.xml`、`/feed.json` で、この順に試す。

#### Scenario: 3番目の場所にあるフィード

- **WHEN** linkの要素を持たないページのURLで探し、`/feed` が404、`/rss.xml` がHTMLのページ、`/feed.xml` がRSSのフィードを返す
- **THEN** サーバーは `/feed.xml` とそのタイトルの1件だけを返し、`/atom.xml` より後の場所は要求しない

#### Scenario: どこにもフィードがない

- **WHEN** linkの要素を持たないページのURLで探し、6か所のどれもフィードとして読めない
- **THEN** サーバーは空の一覧を返す

### Requirement: linkの要素があるときの試行の省略

ページのlinkの要素からフィードが1件以上見つかったとき、サーバーはよくある場所を要求してはならない（MUST NOT）。

#### Scenario: linkの要素でフィードを案内するページ

- **WHEN** RSSのフィードを1つ指定するページのURLで探す
- **THEN** サーバーはそのフィードだけを返し、よくある場所を要求しない
