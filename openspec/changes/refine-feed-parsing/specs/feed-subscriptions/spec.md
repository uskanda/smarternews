# Spec Delta

## ADDED Requirements

### Requirement: 地域の略称で時差を示す公開日時

項目の日時が末尾に地域の略称を持つとき、サーバーは、その略称の時差で公開日時を読み取らなければならない（MUST）。
読む略称は、`JST`、`KST`、`CET`、`CEST`、`BST`、`WET`、`WEST`、`EET`、`EEST`、`MSK`、`HKT`、`SGT`、`AEST`、`AEDT`、`NZST`、`NZDT` である。`BST` は英国の夏時間（+01:00）として読む。

#### Scenario: 日本時間の略称

- **WHEN** 日時が `Mon, 02 Jan 2006 15:04:05 JST` の項目を取得する
- **THEN** その配信記事の公開日時は、2006年1月2日6時4分5秒（UTC）である

#### Scenario: 中央ヨーロッパ時間の略称

- **WHEN** 日時が `Mon, 02 Jan 2006 15:04:05 CET` の項目を取得する
- **THEN** その配信記事の公開日時は、2006年1月2日14時4分5秒（UTC）である

### Requirement: 複数の地域が使う略称

項目の日時が末尾に `IST` を持つとき、サーバーは、その日時を公開日時として読み取ってはならない（MUST NOT）。
`IST` は、インド、アイルランド、イスラエルが使い、時差を1つに決められないためである。その項目は、公開日時のない項目として扱う。

#### Scenario: IST の日時

- **WHEN** 日時が `Mon, 02 Jan 2006 15:04:05 IST` の項目を取得する
- **THEN** その配信記事は公開日時を持たず、取得の時刻の位置に並ぶ

### Requirement: 時差のない公開日時

項目の日時が時差を持たないとき、サーバーは、その日時を全体設定のタイムゾーンの時刻として読み取らなければならない（MUST）。

#### Scenario: 時差のないISOの日時

- **WHEN** 全体設定のタイムゾーンが `Asia/Tokyo` で、日時が `2026-10-20T09:00:00` の項目を取得する
- **THEN** その配信記事の公開日時は、2026年10月20日0時（UTC）である

### Requirement: タイトルと抜粋の文字参照

サーバーは、項目のタイトルと抜粋に含まれる文字参照を、HTMLの名前付きの文字参照の表と数値の形で解かなければならない（MUST）。
名前の大文字と小文字は区別する。表にない名前の文字参照は、その文字列のまま残す。

#### Scenario: ダッシュと三点リーダー

- **WHEN** タイトルが `A &mdash; B&hellip;` の項目を取得する
- **THEN** その配信記事のタイトルは `A — B…` である

#### Scenario: 大文字と小文字の違う名前

- **WHEN** タイトルが `&Eacute;t&eacute;` の項目を取得する
- **THEN** その配信記事のタイトルは `Été` である

### Requirement: パーマリンクのguidを元のページに使うこと

RSSの項目が `link` を持たず、`http` か `https` のURLの形のguidを持つとき、サーバーは、そのguidを元のページのURLとして保存しなければならない（MUST）。

#### Scenario: link のない項目

- **WHEN** `link` を持たず、guidが `https://example.org/posts/1` の項目を取得する
- **THEN** その配信記事の元のページのURLは `https://example.org/posts/1` である

### Requirement: パーマリンクでないguidの扱い

RSSの項目のguidが `isPermaLink="false"` を持つとき、サーバーは、そのguidを元のページのURLとして保存してはならない（MUST NOT）。

#### Scenario: isPermaLink が false のguid

- **WHEN** `link` を持たず、`isPermaLink="false"` のguidが `https://example.org/?p=1` の項目を取得する
- **THEN** その配信記事は元のページのURLを持たない

### Requirement: Atomのenclosureの添付

Atomの項目が `rel="enclosure"` のリンクを持つとき、サーバーは、そのリンクを配信記事の添付として保存しなければならない（MUST）。
添付のURL、MIMEの型、大きさ、題は、リンクの `href`、`type`、`length`、`title` から読む。添付の並びでは、RSSのenclosureと同じく先頭に置く。

#### Scenario: ポッドキャストのAtomのフィード

- **WHEN** `rel="enclosure"`、`type="audio/mpeg"`、`length="12345678"` のリンクを持つAtomの項目を取得する
- **THEN** 配信記事には、種類が音声で、MIMEの型が `audio/mpeg`、大きさが12345678バイトの添付が1つ保存される

### Requirement: フィードの応答の大きさの上限

サーバーは、購読フィードの取得とフィードの探索に、ページの上限とは別に設定したフィードの応答の大きさの上限を適用しなければならない（MUST）。
フィードの上限の既定は10MB（10,000,000バイト）とし、設定で変えられる。Webページの購読フィードの取得と全文の取得には、ページの上限を適用する。

#### Scenario: ページの上限より大きいフィード

- **WHEN** ページの上限が2MB、フィードの上限が10MBの設定で、5MBのフィードを登録する
- **THEN** 購読フィードが保存され、配信されている項目が配信記事として保存される

#### Scenario: フィードの上限より大きいフィード

- **WHEN** フィードの上限が10MBの設定で、12MBのフィードを登録する
- **THEN** サーバーは登録を拒否し、応答が上限より大きいことを返す
