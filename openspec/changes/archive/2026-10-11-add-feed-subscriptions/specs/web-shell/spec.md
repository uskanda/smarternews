# Spec Delta

## ADDED Requirements

### Requirement: 画像の読み込みの制限

サーバーは、画面のHTMLの応答に、同じオリジンとHTTPSのもの以外の画像の読み込みを禁じるContent-Security-Policyを付けなければならない（MUST）。

#### Scenario: 暗号化されていない画像

- **WHEN** 画面が `http:` で始まるURLの画像を読み込もうとする
- **THEN** ブラウザーはその画像を読み込まない

### Requirement: 画像の読み込みでの情報の秘匿

画面は、他のサイトの画像を読み込むとき、遷移元のURLを送ってはならない（MUST NOT）。

#### Scenario: 配信記事の画像

- **WHEN** 配信記事の本文にある他のサイトの画像が表示される
- **THEN** その画像への要求に、遷移元のURLは含まれない
