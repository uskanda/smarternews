# Tasks

どの作業も、失敗するテストを先に書いてから実装する。
テストは実際のAPIを呼ばない。SDKに渡す `fetch` を差し替えて、記録済みの応答で動かす。

## 1. 記録の形と設定

- [x] 1.1 `018_llm_costs.sql` の移行で、`llm_calls` にトークン数、`web_searches`、`cost_usd`、`billable` の列を足す。`runs` には `stopped_by` を足す。今までの行が `billable = 0` と空の `stopped_by` で残ることを `database.test.ts` で確かめる
- [x] 1.2 `packages/core/src/config.ts` に `adapter: anthropic` のプロバイダーを足す。項目は `model`、`apiKeyEnv`、`effort`、`maxWebSearches`、`pricing` とする。`config.test.ts` で、既定の値と、`effort` の範囲外の値の拒否を確かめる。`providers` を書かないときに `claude-cli` のままであることも確かめる
- [x] 1.3 `config.ts` の `limits` に `monthlyBudgetUsd`、`budgetWarnRatio`、`budgetResetDay` を足す。既定の値と、`budgetResetDay` の1から31の範囲を `config.test.ts` で確かめる
- [x] 1.4 `packages/core/src/time.ts` に予算の期間を求める関数を足す。`time.test.ts` で、specの3つの例（締め日が10日、締め日の前日の23時、締め日が31日の2月）を確かめる。締め日が31日のときの3月の期間も確かめる

## 2. 単価と金額

- [x] 2.1 `packages/core/src/llm/pricing.ts` に、design.mdの表のモデルの単価と道具の版を置き、公開価格の確認日をコメントで残す。`pricing.test.ts` で、specの0.03米ドルと0.05米ドルの例を確かめる。`claude-haiku-5-5` のプロンプトが100,000トークンを超えたときの単価も確かめる
- [x] 2.2 `pricing` の上書きを、項目ごとに表の値へ重ねる処理を足す。表にないモデルで4種類のトークン数の単価がそろわないとき、`buildProviders` は `ConfigError` を投げる。その文にプロバイダーの名前とモデルが出ることを `providers.test.ts` で確かめる
- [x] 2.3 `apiKeyEnv` の環境変数が空のとき、`buildProviders` は `ConfigError` を投げる。その文にプロバイダーの名前と環境変数の名前が出て、キーの値が出ないことを `providers.test.ts` で確かめる

## 3. アダプター

- [x] 3.1 `LlmAdapter` の `complete` の戻り値を `{ answer, usage }` に変え、`usage` を持つ例外 `LlmCallError` を足す。`claude-cli` と `openai-compatible` は `usage: null` を返す。今の `claude-cli.test.ts` と `openai-compatible.test.ts` が通ることを確かめる
- [x] 3.2 `packages/core` の依存に `@anthropic-ai/sdk` を足す。`pnpm install` のあとで `pnpm-lock.yaml` が更新されることを確かめる
- [x] 3.3 `packages/core/src/llm/anthropic.ts` を足す。`anthropic.test.ts` で、記録済みの応答を使って要求の形を確かめる。要求はモデル、`max_tokens`、システムのプロンプト、構造化出力のスキーマを持つ。`effort` は設定したときだけ入り、検索以外では道具が入らない。答えがJSONとして返り、`usage` に4種類のトークン数が入ることも確かめる
- [x] 3.4 `anthropic.ts` で、構造化出力に送るスキーマから受け付けられない制約を取り除き、各オブジェクトに `additionalProperties: false` を付ける。今の7つのタスクのスキーマを変換した結果について、取り除く対象のキーワードが残らないことを `anthropic.test.ts` で確かめる
- [x] 3.5 `anthropic.ts` の検索のタスクで、`web_search` に `max_uses` を付けて `web_fetch` と並べ、道具の版を単価の表から選ぶ。`pause_turn` の応答では要求を送り直し、使用量を合計する。送り直しの3回の上限と、`web_search_requests` の値が `usage` に入ることを `anthropic.test.ts` で確かめる
- [x] 3.6 `anthropic.ts` で、`stop_reason` が `max_tokens` か `refusal` のとき、`usage` を付けた `LlmCallError` を投げる。JSONを解析できないときも同じにする。401の応答の例外の文にAPIキーが出ないことを、`anthropic.test.ts` で確かめる
- [x] 3.7 `buildProviders` で `anthropic` のプロバイダーを作り、単価を持たせる。`describe` の結果のプロバイダーに `billable` を足す。`anthropic` が検索できると申告し、`billable` が真であることを `providers.test.ts` で確かめる

## 4. 記録と予算の判定

- [x] 4.1 `TaskRunner` の記録で、トークン数、`web_searches`、`cost_usd`、`billable` を保存する。`runner.test.ts` で、出力が検証で不合格となってやり直したとき、2回分の金額が残ることを確かめる。時間切れの呼び出しは `billable = 1` で空の `cost_usd`、`claude-cli` の呼び出しは `billable = 0` になることも確かめる
- [x] 4.2 `TaskRunner` の `#spend` で、金額のかかるプロバイダーの呼び出しの前に予算を判定する。期間の合計が月の予算以上なら `LlmLimitError("budget")` を投げる。`runner.test.ts` で、合計が99.99米ドルの状態ではLLMを呼び、その次の呼び出しで例外を投げることを確かめる。`claude-cli` のプロバイダーは呼べることと、次の期間には `anthropic` のプロバイダーをまた呼べることも確かめる
- [x] 4.3 `TaskRunner` に、予算の期間、合計、タスク別とプロバイダー別の金額、金額のわからない呼び出しの件数を返す関数を足す。記録のないタスクとプロバイダーの金額が0になることを `runner.test.ts` で確かめる
- [x] 4.4 `pipeline/run.ts` で、`LlmLimitError` の `scope` を `runs.stopped_by` に保存する。`write.test.ts` で、実行あたり、1日、月の予算のそれぞれで止まった実行の `stopped_by` と、成功した実行の空の値を確かめる
- [x] 4.5 `retries.test.ts` で、予算に達した期間のやり直しが「上限で停止」で終わり、それ以上やり直されないことを確かめる
- [x] 4.6 `summarize.test.ts` で、予算に達した期間の配信記事が要約されずに残ることを確かめる。`translation/service.test.ts` で、LLMでの翻訳が翻訳できなかった結果を返すことを確かめる

## 5. API

- [x] 5.1 `packages/core/src/api.ts` の `providerStatusSchema` に `budget` を、プロバイダーの行に `billable` を足す。`runSchema` には `stoppedBy` を足す。型を `api.test.ts` で確かめる
- [x] 5.2 `apps/server/src/app.ts` の `GET /api/v1/providers` で `budget` を返し、実行履歴で `stoppedBy` を返す。応答にAPIキーが入らないことを含めて、`runs-api.test.ts` で確かめる
- [x] 5.3 `docs/api.md` に `budget` と `stoppedBy` の説明を足す。書いた `curl` の例を、作業用のサーバーで動かして確かめる

## 6. 共有の処理

- [x] 6.1 `packages/client/src/labels.ts` に、止まった上限の種類ごとの説明の文を足す。種類が空の「上限で停止」には今の文を返す。米ドルを小数点以下2桁で整形する関数も足し、`labels.test.ts` で確かめる

## 7. Web

- [x] 7.1 `DESIGN.md` の部品に `banner-warning` を足す。`designmd lint DESIGN.md` が誤りなしで通ることと、`pnpm run check:tokens` が通ることを確かめる。部品の値はCSSに書き出されないので、画面は `warning` の色の値を使う
- [x] 7.2 `apps/web/src/settings/SettingsPage.tsx` の「プロバイダー」の区画に、予算の期間、合計と月の予算、タスク別とプロバイダー別の表を出す。区画には `id="providers"` を付ける。specの金額の表示を、実物のAPIを相手に `settings.test.tsx` で確かめる
- [x] 7.3 `SettingsPage.tsx` の「プロバイダー」の区画に、金額のわからない呼び出しの件数と、予算の警告を出す。`settings.test.tsx` で、85%と100%の警告の文を確かめる。金額のわからない呼び出しがないときは件数の表示が出ないことも確かめる
- [x] 7.4 `apps/web/src/shell/Shell.tsx` で、合計が警告の割合以上のとき、画面の上部に警告を出し、`/settings#providers` へ移れるようにする。`shell.test.tsx` で、85米ドルで出て50米ドルで出ないことと、リンクで区画へ移ることを確かめる
- [x] 7.5 `apps/web/src/runs/RunPage.tsx` で、上限で停止した実行の説明を `packages/client` の文にする。月の予算で止まった実行に次の予算の期間の初日が出ることを、`runs.test.tsx` で確かめる

## 8. アプリ

- [x] 8.1 `apps/mobile/src/settings/SettingsScreen.tsx` の「上限で停止」の説明を、`packages/client` の文にする。回数の上限と月の予算のそれぞれの文を `settings.test.tsx` で確かめる

## 9. 文書と例

- [x] 9.1 `examples/config.example.yaml` に、コメントにした `anthropic` のプロバイダーの例と、`limits` の予算の3つの設定を足す。例の設定を作業用のサーバーで読み込み、起動できることを確かめる
- [x] 9.2 `docs/providers.md` に、`anthropic` のアダプター、APIキーの渡し方、`effort`、`maxWebSearches`、`pricing` の説明を足す。予算の期間と上限の説明も足す
- [x] 9.3 `README.md` と `README.ja.md` のLLMの説明に、APIのアダプターと月の予算を足す

## 10. 確認

- [x] 10.1 `anthropic` のプロバイダーを、記録済みの応答を返す偽のAPIに向けた作業用のサーバーで実行する。設定の画面の金額と、画面の上部の警告を確かめる（金額と止まった上限はAPIの応答で確かめた。画面はWebのテストで確かめ、ブラウザーでは見ていない）。サーバーは作業用の設定とデータ、空いたポートで起動し、起動のときに控えたPIDで止める。実際のAPIは呼ばない
- [x] 10.2 `make verify` を通し、`openspec validate use-anthropic-api --strict` が通ることを確かめる
