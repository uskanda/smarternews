# Spec Delta

## ADDED Requirements

### Requirement: 添付の読み取り

購読フィードを取得したとき、サーバーは、項目のenclosureとMedia RSSの要素を、その配信記事の添付として保存しなければならない（MUST）。
読む要素は、RSSの `enclosure`、`media:content`、`media:thumbnail` と、`media:group` の中の同じ要素である。
添付は、URL、種類（画像、音声、動画、その他）、MIMEの型、大きさ、題を持つ。種類は、`medium` の属性を先に見て、なければMIMEの型で決める。`media:thumbnail` は画像として読み、サムネイルであることを記録する。
添付は本文とは別に保存し、配信記事の内容には混ぜない。RSS 2.0、RSS 1.0、Atomのどの形式でも同じに扱う。

#### Scenario: 音声の配信のフィード

- **WHEN** `type="audio/mpeg"` と `length="12345678"` の `enclosure` を持つ項目を取得する
- **THEN** 配信記事には、種類が音声で、MIMEの型が `audio/mpeg`、大きさが12345678バイトの添付が1つ保存され、内容にはその音声へのリンクが入らない

#### Scenario: 動画のフィード

- **WHEN** `media:group` の中に `media:thumbnail` と `media:content` を持つAtomの項目を取得する
- **THEN** 配信記事には、サムネイルの画像と、動画のページの添付が保存される

### Requirement: 添付のURLの制限

添付のURLが相対のとき、サーバーは、項目のページのURLを基準に絶対のURLへ直して保存しなければならない（MUST）。
サーバーは、http(s)以外のURLの添付、長すぎるURLの添付、同じ項目の中ですでに読んだURLの添付を保存してはならない（MUST NOT）。1つの項目の添付は20件までとする。

#### Scenario: スクリプトのURL

- **WHEN** `javascript:` で始まるURLの `media:content` を持つ項目を取得する
- **THEN** その添付は保存されない

#### Scenario: 同じURLの重複

- **WHEN** 同じ音声のURLを `enclosure` と `media:content` の両方に持つ項目を取得する
- **THEN** 添付は1つだけ保存される

### Requirement: 説明を本文の代わりに使う規則

項目に内容がないとき、サーバーは、`media:description` を内容の代わりに変換して保存しなければならない（MUST）。説明は、項目の直下、`media:group`、最初の `media:content` の順に探す。
`type="html"` の説明は、内容と同じ変換を通す。それ以外の説明はプレーンテキストとして扱い、空行で段落を分け、行の改行を残し、http(s)のURLだけをリンクにする。説明の中のHTMLの記号は、文字として残す。
項目に内容があるときは、説明を使ってはならない（MUST NOT）。

#### Scenario: 説明だけを持つ動画の項目

- **WHEN** 内容がなく、`media:group` の中に2行と空行と1行の説明を持つ項目を取得する
- **THEN** 配信記事の内容は、改行を残した1つめの段落と、2つめの段落になる

#### Scenario: 説明の中のURL

- **WHEN** 説明に `https://example.com/more` と `javascript:alert(1)` を含む項目を取得する
- **THEN** `https://example.com/more` だけがリンクになり、`javascript:alert(1)` は文字のまま残る

#### Scenario: 内容のある項目

- **WHEN** `description` と `media:description` の両方を持つRSSの項目を取得する
- **THEN** 配信記事の内容は `description` から作られる

### Requirement: 説明から作った本文の書き換え

内容が空のまま保存した配信記事の項目が、説明を持って再び配信されたとき、サーバーは、それを内容の書き換えとして扱わなければならない（MUST）。翻訳は、書き換えられた項目の訳の規則に従って消え、フィルターは判定し直す。

#### Scenario: 変更の前に保存した動画の記事

- **WHEN** 本文が空の配信記事の項目が、内容のフィルターに当たる語を含む説明を持って配信される
- **THEN** 配信記事の内容は説明から作ったものに置き換わり、その配信記事は一覧から隠れる

### Requirement: 添付だけが変わったときの扱い

タイトル、内容、著者が同じで添付だけが変わった項目を取得したとき、サーバーは、配信記事の添付だけを新しいものに置き換えなければならない（MUST）。このとき、サーバーは、翻訳を消してはならず、フィルターを判定し直してもならない（MUST NOT）。

#### Scenario: 音声のファイルが差し替わる

- **WHEN** 翻訳した配信記事の項目が、別の音声のURLの `enclosure` を持って配信される
- **THEN** 配信記事の添付は新しい音声のURLになり、本文の翻訳は残る

### Requirement: 添付をRSSとLLMに渡さないこと

サーバーは、配信記事の添付を、RSSの出力に載せてはならず、LLMへの要求に含めてもならない（MUST NOT）。

#### Scenario: 添付のある配信記事の要約

- **WHEN** 音声の添付を持つ配信記事の自動の要約を作る
- **THEN** LLMへの要求に、添付のURLと題は含まれない
