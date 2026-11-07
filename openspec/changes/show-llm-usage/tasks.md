# Tasks

どの作業も、失敗するテストを先に書いてから実装する。

## 1. 呼び出しの記録の保存期間

- [x] 1.1 `purgeExpired` に `keepCallsSince` を足し、`llm_calls` を消す境目を、30日を引いた日時と `keepCallsSince` の早いほうにする。仕様 `runs` の「LLMの呼び出しの記録の保存期間」の各場面を `retention.test.ts` で確かめる
- [x] 1.2 `Scheduler` に `budgetResetDay` を足して予算の期間の初日を渡し、`runtime.ts` から設定の締め日を渡す。締め日を渡した `Scheduler` の掃除が期間の呼び出しを残すことを `scheduler.test.ts` で確かめる

## 2. 実行ごとの集計

- [x] 2.1 `runSchema` に `costUsd`、`unknownCostCalls`、`callsByTask` を足し、`db/runs.ts` の実行を返すすべての関数が `llm_calls` の集計を付ける。仕様 `http-api` の「実行ごとの金額の提供」と「実行ごとのタスクごとの呼び出しの提供」の各場面を `runs-api.test.ts` で確かめる
- [x] 2.2 `docs/api.md` の実行の項に、足した欄を書く

## 3. 利用量の集計とAPI

- [x] 3.1 `usageSchema` と `db/usage.ts` の `usageReport`、`TaskRunner` の `usageStatus` を書く。カテゴリごとの行、実行に属さない行、UTCの日ごとの行（和が `spentUsd` と一致すること）、見込みと予算を超えるかどうかを `usage.test.ts` で確かめる
- [x] 3.2 `GET /api/v1/usage` を足す。仕様 `http-api` の「利用量の内訳の提供」の場面と、返る形を `settings-api.test.ts` で確かめる
- [x] 3.3 `docs/api.md` に `/usage` を、`docs/providers.md` に利用量の区画のことを書く

## 4. 画面

- [x] 4.1 `packages/client` に `usage` の呼び出し、`TASK_LABEL`、`projectionLabel`、`runCostLabel` を足す。見込みの文を `labels.test.ts` で確かめる
- [x] 4.2 `RunsPage.tsx` に金額の列を、`RunPage.tsx` に金額、金額のわからない呼び出し、タスクごとの呼び出しの表を足す。仕様 `web-runs` の各場面を `runs.test.tsx` で確かめる
- [x] 4.3 `SettingsPage.tsx` に区画「利用量」を足し、区画のリンクにも足す。横棒の決まりを `DESIGN.md` に書く。仕様 `web-settings` の各場面を `runs.test.tsx` と `settings.test.tsx` で確かめる

## 5. 全体の確認

- [x] 5.1 `make verify` の各段と `openspec validate show-llm-usage --strict` を通す。段は、lint、型、テスト、ビルド、`DESIGN.md`、textlint、用語である
