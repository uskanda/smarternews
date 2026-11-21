# Spec Delta

## ADDED Requirements

### Requirement: 記事の詳細の配信元の分類

記事の詳細の要求を受けたとき、APIは、配信記事の配信元の分類を、配信元が並べた順の文字列の配列（`feedCategories`）として返さなければならない（MUST）。
配信元の分類のない配信記事と生成記事には、空の配列を返す。

#### Scenario: 分類を持つ配信記事

- **WHEN** 配信元の分類が「Tech」「AI」の配信記事の詳細を要求する
- **THEN** `feedCategories` は `["Tech", "AI"]` で返る

#### Scenario: 保存した分類を読めない

- **WHEN** 保存した配信元の分類のJSONを読めない配信記事の詳細を要求する
- **THEN** `feedCategories` は空の配列で返り、ほかの項目はいつもどおり返る

### Requirement: フィルターの条件の分類の欄

APIは、フィルターの条件の欄として、`title`、`content`、`author`、`url` に加えて `feedCategories` を受け付けなければならない（MUST）。

#### Scenario: 分類の欄の条件を登録する

- **WHEN** 欄が `feedCategories`、照合の方法が正規表現、値が `^PR$` の条件で隠すフィルターを登録する
- **THEN** フィルターは登録され、一覧の条件の欄に `feedCategories` が返る
