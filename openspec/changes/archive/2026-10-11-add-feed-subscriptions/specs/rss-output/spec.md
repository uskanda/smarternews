# Spec Delta

## ADDED Requirements

### Requirement: 配信記事の除外

サーバーは、RSSに配信記事を含めてはならない（MUST NOT）。

#### Scenario: 購読フィードのあるカテゴリのRSS

- **WHEN** 生成記事が2件と配信記事が10件あるカテゴリのRSSを要求する
- **THEN** RSSには生成記事の2件だけが含まれる

#### Scenario: 全体のRSS

- **WHEN** カテゴリなしの配信記事がある状態で、全体のRSSを要求する
- **THEN** RSSに配信記事は含まれない
