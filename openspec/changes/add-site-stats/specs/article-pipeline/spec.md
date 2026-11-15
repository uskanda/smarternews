# Spec Delta

## ADDED Requirements

### Requirement: 除外したサイトの候補の除外

除外の一覧にあるホスト名の候補が得られたとき、クローラーは、判定と日付の確認より前に、その候補を理由「除外したサイト」と種類 `blocked-site` で除外しなければならない（MUST）。対象は、フィード、ニュース検索、LLM検索のすべての候補とする。

#### Scenario: 除外したサイトの候補

- **WHEN** カテゴリCの除外の一覧に `example.org` があり、Cの実行で `https://www.example.org/a` の候補が得られる
- **THEN** その候補は理由「除外したサイト」と理由の種類 `blocked-site` で保存され、判定のタスクに渡されない

#### Scenario: 公開日時のない候補

- **WHEN** 除外の一覧にあるサイトの候補が、公開日時を持たない
- **THEN** その候補の理由の種類は `no-date` ではなく `blocked-site` になる

#### Scenario: 別のカテゴリ

- **WHEN** カテゴリCの除外の一覧に `example.org` があり、カテゴリDの実行で `https://example.org/a` の候補が得られる
- **THEN** その候補はDの判定のタスクに渡される

### Requirement: 除外したサイトの候補の既読

除外したサイトの候補を除外したとき、クローラーは、その候補のURLを既読として記録しなければならない（MUST）。

#### Scenario: 次の実行

- **WHEN** 除外したサイトの候補を除外したあと、同じURLが次の実行でも得られる
- **THEN** その候補は次の実行の候補にならない

### Requirement: 除外したサイトの候補のページ

除外したサイトの候補について、クローラーはそのページを取得してはならない（MUST NOT）。

#### Scenario: ページを取得しない

- **WHEN** 除外の一覧にあるサイトの候補だけが得られる実行が終わる
- **THEN** そのページは1回も取得されない

### Requirement: 移行より前の候補のホスト名

ホスト名を足す移行のとき、サーバーは、保存済みの候補に、URLから求めたホスト名を入れなければならない（MUST）。URLがGoogleニュースの転送用のURLのままの候補は、ホスト名を不明（空）にする。

#### Scenario: 保存済みの候補

- **WHEN** URLが `https://www.example.org/a` の候補を保存した状態で移行する
- **THEN** その候補のホスト名は `example.org` になる

#### Scenario: 解決できなかった候補

- **WHEN** URLが `https://news.google.com/rss/articles/abc` の候補を保存した状態で移行する
- **THEN** その候補のホスト名は空になる
