# Spec Delta

## ADDED Requirements

### Requirement: 出典のサイトの成績の提供

`GET /api/v1/categories/:id/site-stats` を受けたとき、APIは、期間の始まり（`since`）、ホスト名ごとの成績、除外中のサイトを返さなければならない（MUST）。成績は、直近30日にそのカテゴリの候補があったホスト名ごとに返す。各ホスト名の成績は次の数を持つ。

- 候補、採用、除外
- 記事：採用した候補からできた記事
- 開いた記事、スター、外れ：記事のうち、開いた時刻がある記事、今スターがある記事、外れの印がある記事

ホスト名は候補の多い順に並べ、候補の数が同じならホスト名の順にする。ホスト名が不明の候補は、空のホスト名の1行にまとめ、候補の数が同じ行の中では最後に置く。

#### Scenario: 成績を求める

- **WHEN** カテゴリCで直近30日に `example.org` の候補が3件あり、そのうち1件を採用して記事を1件作り、2件を除外した状態で、Cの出典のサイトの成績を要求する
- **THEN** `example.org` の行は、候補3件、採用1件、除外2件、記事1件になる

#### Scenario: 31日前の候補

- **WHEN** 31日前に集めた候補だけを持つサイトがある状態で成績を要求する
- **THEN** そのサイトの行は返らない

#### Scenario: 除外中のサイト

- **WHEN** カテゴリCで `example.org` を除外した状態で、Cの出典のサイトの成績を要求する
- **THEN** 除外中のサイトの一覧に `example.org` が入る

#### Scenario: 存在しないカテゴリ

- **WHEN** 存在しないカテゴリの出典のサイトの成績を要求する
- **THEN** 404が返る

### Requirement: 出典のサイトの成績でのLLMの扱い

出典のサイトの成績を求められたとき、APIはLLMを呼んではならない（MUST NOT）。

#### Scenario: 成績を求めても呼ばない

- **WHEN** 候補と記事のあるカテゴリの出典のサイトの成績を要求する
- **THEN** LLMのタスクは1回も呼ばれない

### Requirement: サイトの除外の操作

`PUT /api/v1/categories/:id/blocked-sites/:host` を受けたとき、APIは、ホスト名を候補と同じ形にそろえて除外の一覧に入れなければならない（MUST）。すでに一覧にあるホスト名なら、一覧を変えない。

#### Scenario: 大文字と www. のついたホスト名

- **WHEN** カテゴリCに対して `PUT /api/v1/categories/:id/blocked-sites/WWW.Example.org` を送る
- **THEN** Cの除外の一覧に `example.org` が入る

#### Scenario: ホスト名にならない値

- **WHEN** ホスト名に `a b` を送る
- **THEN** 400が返り、除外の一覧は変わらない

#### Scenario: 存在しないカテゴリ

- **WHEN** 存在しないカテゴリに対してサイトを除外する
- **THEN** 404が返る

### Requirement: サイトの除外をやめる操作

`DELETE /api/v1/categories/:id/blocked-sites/:host` を受けたとき、APIは、そろえたホスト名を除外の一覧から外さなければならない（MUST）。一覧にないホスト名なら、404を返す。

#### Scenario: 除外をやめる

- **WHEN** カテゴリCの除外の一覧に `example.org` がある状態で、`DELETE /api/v1/categories/:id/blocked-sites/example.org` を送る
- **THEN** 204が返り、Cの除外の一覧から `example.org` が外れる

#### Scenario: 一覧にないホスト名

- **WHEN** 除外の一覧にないホスト名の除外をやめる
- **THEN** 404が返る

### Requirement: トピックの成績のサイトの除外

APIは、トピックの成績の除外の内訳で、理由の種類 `blocked-site` の候補をサイトの除外として数えなければならない（MUST）。

#### Scenario: サイトの除外の数

- **WHEN** トピックの候補のうち2件が除外したサイトの候補として除外された状態で成績を要求する
- **THEN** サイトの除外は2件になり、判定での除外には数えられない

### Requirement: よく除外されるサイトのホスト名

APIは、トピックの成績のよく除外されるサイトを、候補のホスト名で数えなければならない（MUST）。ホスト名が不明の候補と、除外したサイトとして除外された候補は数えない。

#### Scenario: サイト名の違う同じホスト名

- **WHEN** サイト名が「Example」の候補と「Example News」の候補が、どちらもホスト名 `example.org` で除外された状態で成績を要求する
- **THEN** よく除外されるサイトに `example.org` が2件として入る
