# Design

## Context

動機は`proposal.md`のWhyを参照する。決定は`grilling.md`にある。

- LLMの呼び出しは `TaskRunner`（`packages/core/src/llm/runner.ts`）が一手に引き受ける。プロンプトの組み立て、出力の検証、1回のやり直し、回数の上限、時間の上限、`llm_calls` への記録をここで行う。アダプター（`LlmAdapter`）は `complete()` で、解析済みのJSONを返すだけである。
- 本番の呼び出しは10月で1日40回前後、月438回である。割り当ては判定と集約が `fast`、解釈、検索、本文の生成が `smart` である。
- Messages APIの応答に金額は入らない。返るのは `usage` の4種類のトークン数と `server_tool_use.web_search_requests` だけなので、金額はサーバーが単価から計算する。
- Messages APIの構造化出力（`output_config.format`）は、`minLength`、`maxLength`、`minimum`、`maximum` のような制約を含むスキーマを受け付けない。どのオブジェクトにも `additionalProperties: false` が要る。今のスキーマは、zodのスキーマから `z.toJSONSchema` で作っている。
- 2026年10月の公開価格（100万トークンあたり、米ドル）は次のとおり。Web検索は1,000回あたり10米ドル（1回0.01米ドル）で、ページの取得はトークン代だけである。

| モデル | 入力 | キャッシュの書き（5分） | キャッシュの読み | 出力 |
|---|---|---|---|---|
| `claude-haiku-5-5`（プロンプトが100,000トークン以下） | 0.10 | 0.125 | 0.01 | 0.50 |
| `claude-haiku-5-5`（プロンプトが100,000トークン超） | 0.50 | 0.625 | 0.05 | 2.50 |
| `claude-sonnet-5-5` | 2 | 2.50 | 0.10 | 10 |
| `claude-opus-5-5` | 4 | 5 | 0.20 | 20 |
| `claude-sonnet-4-6` | 3 | 3.75 | 0.30 | 15 |
| `claude-haiku-4-5` | 1 | 1.25 | 0.10 | 5 |

## Goals / Non-Goals

**Goals:**

- アダプターの差し替えだけで、タスクの入力、出力、検証の手順を変えずにAPIへ移れるようにする。
- 予算の判定と記録を `TaskRunner` の1か所に置き、実行、要約、翻訳のどの経路でも同じ判定を通す。

**Non-Goals:**

- プロンプトのキャッシュ、Batch API、拒否されたときの別モデルへの切り替え（`fallbacks`）は使わない。
- Anthropicの請求の実額との突き合わせはしない。表示するのは、サーバーが単価から計算した見込みの額である。

## Decisions

### アダプターは使用量も返す

`LlmAdapter` の `complete` の戻り値を、`{ answer, usage }` に変える。`usage` は、4種類のトークン数とWeb検索の回数を持ち、金額のかからないアダプターは `null` を返す。
`claude-cli` と `openai-compatible` は `usage: null` を返す。
応答を受けたあとの失敗（拒否、出力の上限、JSONの解析の失敗）では、アダプターは `usage` を持つ例外 `LlmCallError` を投げる。こうすると、課金された呼び出しの金額を、失敗でも記録できる。
時間切れと中断では `usage` がわからないので、金額は空になる。

代わりの案は、アダプターが自分で `llm_calls` に書く方式だった。記録と予算の判定が2か所に分かれるので採らない。

### `anthropic` のアダプター

アダプターは `packages/core/src/llm/anthropic.ts` に置く。
`@anthropic-ai/sdk` の `messages.create()` で要求を送り、応答の全体を一度に受け取る。
`TaskRunner` の時間の上限（既定180秒、検索は300秒）はSDKのHTTPの時間の上限よりずっと短いので、応答を逐次受け取る方式にはしない。記録済みの応答をJSONのまま使えるので、テストも単純になる。打ち切りは `TaskRunner` の `AbortSignal` をSDKの要求の `signal` に渡して行う。

- `max_tokens` は16,000とする。`stop_reason` が `max_tokens` または `refusal` のときは、`usage` を付けた `LlmCallError` を投げる。`TaskRunner` は今のとおり、これをタスクの失敗として扱う。
- 思考は指定しない（どのモデルでも既定で有効になる）。`effort` を設定したときだけ `output_config.effort` に入れる。
- 出力は `output_config.format` に `json_schema` で渡す。送る前に、スキーマから受け付けられない制約を取り除き、すべてのオブジェクトに `additionalProperties: false` を付ける。取り除いた制約は、今のとおり `TaskRunner` がzodで検証する。答えは、最後の `text` のブロックをJSONとして解析して返す。
- 検索のタスクでは、`web_search` と `web_fetch` に、同じ `max_uses`（`maxWebSearches`、既定5）を付けて渡す。
- 道具の版は単価の表に持つ。`claude-sonnet-5-5` と `claude-opus-5-5` は `web_search_20260209` と `web_fetch_20260209` を使う。
- ほかのモデルは `web_search_20250305` と `web_fetch_20250910` を使う。
- `stop_reason` が `pause_turn` のときは、応答の `content` を `assistant` の発言として足して、同じ要求を送り直す。送り直しは3回までとし、使用量は合計する。
- SDKの自動のやり直し（`maxRetries`）は既定の2回のままにする。429と5xxは課金されず、やり直しの時間も `TaskRunner` の時間の上限に含まれる。
- APIキーは、SDKの `Anthropic` を作るときにだけ渡す。例外の文言にキーが入らないことを、401の記録済みの応答のテストで確かめる。

拒否されたときの `fallbacks` は使わない。切り替え先のモデルの単価で計算し直す必要があり、ニュースの判定と要約で拒否が起きることはまれだからである。拒否はタスクの失敗として実行履歴に残る。

代わりの案は、`openai-compatible` のアダプターでAnthropicのOpenAI互換の窓口を呼ぶ方式だった。検索の道具と使用量の詳細が使えないので採らない。

### 単価の表と上書き

`packages/core/src/llm/pricing.ts` に、Contextの表のモデルの単価と道具の版を持つ。`claude-haiku-5-5` は、プロンプトの長さ（入力、キャッシュの読み、キャッシュの書きの合計）が100,000トークンを超えた呼び出しに、高いほうの単価を使う。
キャッシュの書きは5分の単価で数える。このサーバーは1時間のキャッシュを指定しないからである。

プロバイダーの設定の `pricing` は、表の値を項目ごとに上書きする。
表にないモデルでは、4種類のトークン数の単価がすべて必須になる。Web検索の単価は、書かなければ0.01米ドルとする。
表にないモデルで4つがそろわないとき、`buildProviders` は `ConfigError` を投げ、プロバイダーの名前とモデルを示す。

金額は、呼び出しごとに米ドルの浮動小数点数で `llm_calls.cost_usd` に保存する。合計はSQLの `sum` で求め、表示のときに小数点以下2桁へ丸める。

### 予算の期間と判定

`packages/core/src/time.ts` に、時刻と締め日から予算の期間（初日のUTCの0時と、次の期間の初日のUTCの0時）を求める関数を足す。締め日にあたる日がない月は、その月の末日を初日にする。

`TaskRunner` の `#spend` で、今の回数の判定に続けて予算を判定する。割り当てたプロバイダーが金額のかかるもの（単価を持つもの）のときだけ、期間の `cost_usd` の合計が月の予算以上なら `LlmLimitError("budget")` を投げる。
判定は呼び出しの前の合計で行う。要約と翻訳も `TaskRunner` の `run` を通るので、同じ判定を受ける。

- 実行：`pipeline/run.ts` は今のとおり `LlmLimitError` を「上限で停止」にし、例外の `scope` を `runs.stopped_by` に保存する。
- 要約：`summarize.ts` は今のとおり `LlmLimitError` で回を終える。次に要約を試すのは次の見回りで、期間が変わるまでは呼ばれない。
- 翻訳：`translation/service.ts` は今のとおり `LlmLimitError` を、翻訳できなかった結果に変える。

### 記録の形と移行

移行 `018_llm_costs.sql` で、`llm_calls` に次の列を足す。表を作り直さない `ALTER TABLE ... ADD COLUMN` だけなので、起動のときの `VACUUM INTO` の写しは要らない。

- `input_tokens`、`output_tokens`、`cache_read_tokens`、`cache_write_tokens`、`web_searches`（いずれも `INTEGER`、空を許す）
- `cost_usd`（`REAL`、空を許す）
- `billable`（`INTEGER NOT NULL DEFAULT 0`）：金額のかかるプロバイダーへの呼び出しなら1

金額のわからない呼び出しは、`billable = 1 AND cost_usd IS NULL` の行として数える。今までの行は `billable = 0` になり、合計に入らない。

同じ移行で `runs` に `stopped_by TEXT CHECK (stopped_by IN ('run', 'day', 'budget'))` を足す。今までの「上限で停止」の行は空のままで、画面は種類のわからない上限として、今の説明（呼び出し回数の上限）を出す。

### APIと画面

`GET /api/v1/providers` の応答に `budget` を足す。項目は次のとおり。

- `periodStart` と `periodEnd`（期間の初日と最終日、`YYYY-MM-DD`）
- `spentUsd`、`monthlyBudgetUsd`、`warnRatio`
- `unknownCostCalls`
- `byTask` と `byProvider`

プロバイダーの行には `billable` を足す。
`Run` の型に `stoppedBy`（`"run" | "day" | "budget" | null`）を足す。

`packages/client` に、止まった上限の種類の説明の文言と、米ドルの整形の関数を置く。Webとアプリはこれを使う。

Webでは、設定の画面の「プロバイダー」の区画に、期間、合計と月の予算、タスク別とプロバイダー別の表、金額のわからない呼び出しの件数、警告を出す。区画には `id="providers"` を付ける。
画面の上部の警告は、シェルが `useProviders` の結果から出す。`useProviders` は今も定期的に取得し直しているので、期間が変われば警告は消える。警告は `/settings#providers` へのリンクを持つ。
警告の文字の色は、`DESIGN.md` の `warning` を使う。
画面の上部の警告のために、`DESIGN.md` の部品に `banner-error` と並べて `banner-warning` を足す。部品の値はCSSに書き出されないので、画面は `warning` の色の値で描く。

アプリは、設定の画面の直近の実行の説明だけを、`packages/client` の文言に替える。

### 設定の形

```yaml
providers:
  fast:
    adapter: anthropic
    model: claude-haiku-5-5
    apiKeyEnv: ANTHROPIC_API_KEY   # 既定もこの名前
    effort: low                    # low | medium | high。書かなければ指定しない
  smart:
    adapter: anthropic
    model: claude-sonnet-5-5
    effort: medium
    maxWebSearches: 5              # 検索のタスクの1回の呼び出しでの上限
    # pricing:                     # 100万トークンあたりの米ドル。表の値に重ねる
    #   inputPerMTok: 2
    #   outputPerMTok: 10
    #   cacheReadPerMTok: 0.1
    #   cacheWritePerMTok: 2.5
    #   webSearchPerSearch: 0.01
limits:
  monthlyBudgetUsd: 100
  budgetWarnRatio: 0.8
  budgetResetDay: 1                # 1から31
```

## Risks / Trade-offs

- 単価の表が古くなる → 値の改定は `pricing` で上書きできる。表の値は公開価格の確認日とともにコメントに残す。
- 計算した額が請求の実額とずれる → 時間切れの呼び出しは件数を画面に出す。Anthropicの請求の基準時刻もUTCの0時とは限らない。警告の割合（既定0.8）を、ずれの余裕として使う。
- 要約、翻訳、実行が同時に呼んで予算を少し超える → 判定は呼び出しの前なので、同時に走る呼び出しの数だけ超えうる。超える額は数回分の呼び出しの金額で、月の予算に比べて小さい。
- 構造化出力から取り除いた制約をLLMが守らない → 今のとおりzodで検証し、合わなければ1回やり直す。やり直しの金額も記録される。
- 思考を有効にしたままで出力のトークンが増える → `effort` で抑える。切り替えたあとの1週間の金額をタスク別の表で見て、設定を見直す。
- Haiku 5.5での検索の版 → 動的な絞り込みのない版を使う。本番の割り当てでは検索は `smart` なので、影響は小さい。

## Migration Plan

1. この変更をリリースすると、移行 `018` が列を足す。設定を変えないかぎり、呼び出しは `claude` コマンドのままである。
2. 利用者は、個人の `config.yaml` で `fast` と `smart` を `adapter: anthropic` に書き換え、`budgetResetDay` を10にする。
   ユーザー単位のサービスの環境には、`ANTHROPIC_API_KEY` を渡す。
3. 再起動して、次の定時の実行のあとで、設定の画面のタスク別の金額と実行履歴を確かめる。
4. 戻すときは、`config.yaml` の `adapter` を `claude-cli` に戻して再起動する。足した列は残っても動作に影響しない。
