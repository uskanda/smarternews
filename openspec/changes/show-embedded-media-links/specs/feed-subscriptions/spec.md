# Spec Delta

## MODIFIED Requirements

### Requirement: 内容の変換

サーバーは、項目の内容のHTMLを、段落、見出し、リスト、引用、強調、リンク、画像だけを残した形に変換して保存しなければならない（MUST）。
`src` がhttp(s)の `iframe`、`video`、`audio` の要素は、元のアドレスへのリンクだけの段落に変え、枠は残さない。`src` のない `video` と `audio` は、http(s)の `src` を持つ最初の `source` の子をリンク先にする。
リンクの文字は出力言語に従い、日本語では「埋め込み（ホスト名）」、英語では「Embedded content (host)」とする。

#### Scenario: スクリプトと埋め込みを含む内容

- **WHEN** 内容に `script` の要素と、`src` が `https://video.example/1` の `iframe` の要素を含む項目を、出力言語を日本語にして取得する
- **THEN** 保存された内容に、スクリプトと枠は含まれず、段落の文章と、`https://video.example/1` への「埋め込み（video.example）」のリンクだけの段落が残る

#### Scenario: sourceの子で指す動画

- **WHEN** 内容に、`src` がなく、`src` がhttpsの `source` の子を持つ `video` の要素を含む項目を取得する
- **THEN** 保存された内容には、その `source` の `src` へのリンクだけの段落が残る

#### Scenario: http(s)でない埋め込み

- **WHEN** 内容に、`src` が `javascript:` で始まる `iframe` の要素を含む項目を取得する
- **THEN** 保存された内容に、その埋め込みとリンクは含まれない

#### Scenario: 幅が1の枠

- **WHEN** 内容に、`width="1"` で `src` がhttpsの `iframe` の要素を含む項目を取得する
- **THEN** 保存された内容に、その埋め込みとリンクは含まれない

#### Scenario: objectとembed

- **WHEN** 内容に、`data` または `src` がhttpsの `object` と `embed` の要素を含む項目を取得する
- **THEN** 保存された内容に、それらの要素とリンクは含まれない

#### Scenario: 照合に使う文章

- **WHEN** 内容に、`src` がhttpsの `iframe` の要素を含む項目を取得する
- **THEN** ストップワードの照合で使う文章は、埋め込みのリンクの文字とアドレスを含まない

#### Scenario: 暗号化されていない画像

- **WHEN** 内容に `http:` の画像と `https:` の画像を1つずつ含む項目を取得する
- **THEN** 保存された内容には、両方の画像が元のURLのまま残る
