# Spec Delta

## ADDED Requirements

### Requirement: 購読フィードの配信の終了の提供

購読フィードを返すとき、APIは、配信の終了の時刻（`goneAt`）を返さなければならない（MUST）。
値は、続けて受けた410のうち最初のものの時刻とする。配信の終了が記録されていない購読フィードでは `null` とする。
購読フィードの一覧、1つの購読フィードの取得、即時の取得の結果の、どれでも同じ値を返す。

#### Scenario: 410を返した購読フィード

- **WHEN** 購読フィードの即時の取得が410で失敗する
- **THEN** 結果の購読フィードの `goneAt` は失敗の時刻になり、`enabled` は `true` のままである

#### Scenario: ほかの失敗の購読フィード

- **WHEN** 購読フィードの即時の取得が503で失敗する
- **THEN** 結果の購読フィードの `goneAt` は `null` である

### Requirement: Retry-Afterに従う次の取得の時刻の提供

購読フィードを返すとき、APIは、次の取得の時刻（`nextFetchAt`）を、Retry-Afterの示す時刻より前にしてはならない（MUST NOT）。

#### Scenario: Retry-Afterを付けた429のあと

- **WHEN** 購読フィードの取得が、Retry-Afterの「7200」を付けた429で失敗したあと、その購読フィードを要求する
- **THEN** `nextFetchAt` は失敗の2時間後になる
