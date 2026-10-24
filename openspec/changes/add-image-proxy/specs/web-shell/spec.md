## MODIFIED Requirements

### Requirement: 画像の読み込みの制限

サーバーは、画面のHTMLの応答に、同じオリジンのもの以外の画像の読み込みを禁じるContent-Security-Policyを付けなければならない（MUST）。

#### Scenario: 暗号化されていない画像

- **WHEN** 画面が `http:` で始まるURLの画像を読み込もうとする
- **THEN** ブラウザーはその画像を読み込まない

#### Scenario: 他のサイトの暗号化された画像

- **WHEN** 画面が、他のサイトの `https:` で始まるURLの画像を直接読み込もうとする
- **THEN** ブラウザーはその画像を読み込まない

#### Scenario: 中継のURLの画像

- **WHEN** 画面が、同じオリジンにある中継のURLの画像を読み込もうとする
- **THEN** ブラウザーはその画像を読み込む
