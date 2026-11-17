# Spec Delta

## ADDED Requirements

### Requirement: トピックのLLM検索を減らしているかどうか

トピックの応答は、そのトピックのLLM検索を1日1回に減らしているかどうかを `llmSearchReduced` で示さなければならない（MUST）。
LLM検索が無効のトピックでは、値は `false` とする。

#### Scenario: 減らしている

- **WHEN** LLM検索が3回続けて新しい候補を0件で終えたトピックを要求する
- **THEN** 応答の `llmSearchReduced` は `true` である

#### Scenario: 減らしていない

- **WHEN** LLM検索の直近の試行で新しい候補が見つかったトピックを要求する
- **THEN** 応答の `llmSearchReduced` は `false` である

### Requirement: LLM検索を元に戻す操作

`POST /api/v1/topics/:id/llm-search/restore` を受けたとき、APIは、そのトピックのLLM検索を元に戻し、トピックを返さなければならない（MUST）。
存在しないトピックを指定したとき、APIはHTTPステータス404を返す。

#### Scenario: 元に戻す

- **WHEN** LLM検索を減らしたトピックの元に戻す操作を要求する
- **THEN** 応答のトピックの `llmSearchReduced` は `false` で、注意の一覧からそのトピックのLLM検索の項目が消える

#### Scenario: 存在しないトピック

- **WHEN** 存在しないトピックの元に戻す操作を要求する
- **THEN** APIはHTTPステータス404を返す
