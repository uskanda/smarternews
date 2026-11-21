# Spec Delta

## ADDED Requirements

### Requirement: 配信元の分類の読み取り

購読フィードを取得したとき、サーバーは、項目の分類を、その配信記事の配信元の分類として保存しなければならない（MUST）。
読む要素は、RSS 2.0とRSS 1.0の `category` と `dc:subject`、Atomの `category`、JSON Feedの `tags` である。Atomの `category` は、`label` の属性があれば `label` を、なければ `term` を読む。
配信元の分類は、フィードが並べた順に保存する。

#### Scenario: 複数の分類を持つRSSの項目

- **WHEN** `category` を「Tech」と「Science」の2つ、`dc:subject` を「AI」の1つ持つ項目を取得する
- **THEN** 配信記事の配信元の分類は「Tech」「Science」「AI」になる

#### Scenario: Atomの名前と識別子

- **WHEN** `term="tech"` と `label="Technology"` を持つ `category` と、`term="science"` だけを持つ `category` を持つAtomの項目を取得する
- **THEN** 配信記事の配信元の分類は「Technology」「science」になる

#### Scenario: JSON Feedのタグ

- **WHEN** `tags` に「Tech」と「AI」を持つJSON Feedの項目を取得する
- **THEN** 配信記事の配信元の分類は「Tech」「AI」になる

### Requirement: 配信元の分類の整え方

サーバーは、配信元の分類の値から、HTMLの要素と前後の空白を除いて保存しなければならない（MUST）。
サーバーは、空の値と、同じ項目の中ですでに読んだ値を保存してはならない（MUST NOT）。1つの項目の配信元の分類は20個まで、1つの値は100文字までとする。

#### Scenario: 空白と重複

- **WHEN** `category` に、前後に空白のある「Tech」と、空白のない「Tech」と、空の値を持つ項目を取得する
- **THEN** 配信記事の配信元の分類は「Tech」の1つになる

#### Scenario: 際限なく並べるフィード

- **WHEN** 30個の異なる `category` を持つ項目を取得する
- **THEN** 配信記事には、先頭の20個だけが保存される

### Requirement: 配信元の分類だけが変わったときの扱い

保存済みの項目の配信元の分類が変わっていたとき、サーバーは、配信記事の配信元の分類を新しいものに置き換え、フィルターを照合し直さなければならない（MUST）。
タイトル、内容、著者が同じで配信元の分類だけが変わったとき、サーバーは、翻訳を消してはならない（MUST NOT）。
この変更の前に保存した配信記事も、項目が再び配信されたときに同じ規則で配信元の分類を得る。

#### Scenario: 変更の前に保存した配信記事

- **WHEN** 配信元の分類のない配信記事の項目が、分類「PR」を持って再び配信され、分類に「PR」を含むという隠すフィルターがある
- **THEN** 配信記事の配信元の分類は「PR」になり、その配信記事は一覧から隠れる

#### Scenario: 翻訳した配信記事の分類が変わる

- **WHEN** 本文を翻訳した配信記事の項目が、分類だけを変えて配信される
- **THEN** 配信記事の配信元の分類は新しくなり、本文の翻訳は残る
