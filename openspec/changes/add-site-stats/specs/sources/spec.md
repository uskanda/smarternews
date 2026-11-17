# Spec Delta

## ADDED Requirements

### Requirement: 候補のホスト名

クローラーは、候補のURLのホスト名を、小文字にして先頭の `www.` だけを取った形で、その候補のサイトとして保存しなければならない（MUST）。`www.` 以外の部分が違うホスト名は、別のサイトとする。

#### Scenario: www. を取る

- **WHEN** URLが `https://WWW.Example.org/a` の候補を保存する
- **THEN** その候補のホスト名は `example.org` になる

#### Scenario: 先頭の部分が違うホスト名

- **WHEN** URLが `https://blog.example.org/a` の候補と `https://example.org/b` の候補を保存する
- **THEN** 2つの候補のホスト名は、`blog.example.org` と `example.org` で異なる

### Requirement: Googleニュースの出典サイトのURL

Googleニュースで検索したとき、クローラーは、各結果の出典サイトのURL（`<source url>`）を候補とともに取り込まなければならない（MUST）。

#### Scenario: 解決できない転送用のURL

- **WHEN** 出典サイトのURLが `https://example.org` で、転送用のURLを元のページのURLに解決できない結果を候補にする
- **THEN** その候補のURLは転送用のURLのままで、ホスト名は `example.org` になる

#### Scenario: 解決できた転送用のURL

- **WHEN** 出典サイトのURLが `https://example.org` で、転送用のURLが `https://blog.example.org/a` に解決できた結果を候補にする
- **THEN** その候補のホスト名は、解決したURLの `blog.example.org` になる

### Requirement: LLM検索のサイト名

LLM検索の結果を候補にするとき、クローラーは、URLのホスト名を候補と同じ形にそろえてサイト名にしなければならない（MUST）。

#### Scenario: 大文字のホスト名

- **WHEN** 検索のタスクが `https://WWW.Example.org/a` を返す
- **THEN** その候補のサイト名は `example.org` になる
