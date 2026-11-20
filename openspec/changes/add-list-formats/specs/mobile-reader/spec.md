# Spec Delta

## ADDED Requirements

### Requirement: 並び順の変更でのWebの形式の保持

アプリで項目の並び順を変えたとき、アプリは、Webで選んだその項目の一覧の形式を変えてはならない（MUST NOT）。

#### Scenario: Webで展開にした項目

- **WHEN** Webで古い順と「展開」にしたカテゴリAを、アプリで新しい順に変える
- **THEN** カテゴリAの並び順は新しい順になり、Webでの形式は「展開」のままである
