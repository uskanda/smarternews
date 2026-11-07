# Design

## Context

APIの400の誤りは、欄ごとに `path` と英語の `message` だけを返していた。`message` は `zod` や手書きの `DomainError` が作る文である。画面は、これを「この値は保存できません（英語の理由）」と包んで出すか、英語の文を正規表現で読んで日本語に変えていた。誤りの種類を表す値はなかった。動機は `proposal.md` の「Why」を参照する。

## Goals / Non-Goals

**Goals:**

- 誤りの種類と範囲の境界を、サーバーが機械の読める形で返す。
- 日本語の文を作る場所を `packages/client` の1か所にし、WebとAndroidアプリが同じ文を使う。
- 画面での検査と、サーバーの誤りの変換が、同じ誤りに同じ文を出す。

**Non-Goals:**

- `message` の英語の文を変えること。CLIとログが使う。
- Androidアプリの入力フォームを作ること。今のアプリには接続画面のほかに入力フォームがない。
- 検索欄とトークンの画面。値の制約がないか、すでに自前で検査している。

## Decisions

### 誤りの種類は省略できる `code` として足す

`FieldError` に `code`、`minimum`、`maximum`、`unit` を足す。どれも省略できるので、今までのアプリはそのまま動く。
種類の一覧は `packages/core/src/errors.ts` の `FIELD_ERROR_CODES` に置き、`apiErrorSchema` もそれを使う。`packages/client` の型は `code?: string` とし、新しいサーバーが知らない種類を返しても読める。

- 案B（アプリの側で欄ごとに決まった文を返す）は採らない。1つの欄に別の種類の誤りが起きたときに、間違った文を出すからである。
- 案C（英語の `message` を正規表現で読む）は採らない。`zod` の版が上がって文言が変わると、知らせなく誤った文を出すからである。

### `zod` の誤りから写す

`zodFieldErrors` が、`zod` 4の誤りを次のように写す。

| `zod` の誤り | `code` |
|---|---|
| `invalid_type` | `required`。ただし整数でない数（`expected: "int"`）は `format` |
| `too_small`、`too_big` | 同じ名前。境界の値と、`origin` から作る `unit` を足す |
| `invalid_format` | `format` |
| `invalid_value` | `invalid_value` |
| `custom` | `params.code` が一覧にあればそれ、なければ `custom` |
| ほか | 付けない |

`unit` は、`string` が `chars`、`number` と `int` が `number`、`array` と `set` が `items` である。
`refine` と `superRefine` は、`params: { code }` で種類を名乗る。CSSセレクターでないものは `format`、残すフィルターの全体は `not_allowed`、空の引用は `required` である。

### 手書きの誤りにも種類を付ける

`DomainError` の欄には、次の種類を付ける。設定ファイルの購読フィードの誤りは、内側の誤りの種類を引き継ぐ。

| `code` | 付ける誤り |
|---|---|
| `unknown_time_zone` | タイムゾーンの名前 |
| `no_such_item` | `before`、`categoryId`、フィルターの範囲、設定ファイルの指す先 |
| `not_allowed` | 種別、セレクターの有無、イベントのカテゴリ |
| `unreachable` | URLを取得できない |
| `no_items` | セレクターで記事を抜き出せない |
| `format` | 正規表現、CSSセレクター |

### 範囲は名前付きの定数で共有する

範囲の値は `packages/core/src/api.ts` から出す。たとえば `MAX_ARTICLES_PER_RUN`、`WINDOW_HOURS_MAX`、`WINDOW_DAYS_MAX` である。
スキーマ、画面の説明文、画面の検査が同じ値を使うので、片方だけが変わることはない。

### 日本語の文は `packages/client` の関数が作る

`packages/client/src/messages.ts` に次を置く。

- `describeProblem`：誤りの種類と境界、欄の名前から文を作る。欄の名前のほかに、数の欄の両方の境界と、形の誤りのあとに続ける補足の文を受け取れる。サーバーは破られた境界だけを返すので、数の欄は画面の知る境界で範囲を言う。
- `fieldMessage`：400の誤りから、その欄の誤りを探して文にする。`schedule.1` のような要素の誤りは親の欄の誤りとして扱い、何番目かを文に入れる。
- `checkWholeNumber`、`checkRequired`、`checkText`、`checkTimes`：送る前の検査。文は `describeProblem` で作るので、サーバーの誤りの変換と同じになる。
- `settingsFileProblem`：設定ファイルの誤りを、キーの並びと日本語の理由で1行にする。欄の名前には、ファイルのキーの名前をそのまま使う。

`unreachable` の英語の理由が既知の取得の失敗なら、購読フィードの一覧と同じ `feedErrorLabel` の文も出す。既知の失敗は、HTTPのステータス、時間切れ、`robots.txt` などである。知らない理由は出さない。

### 画面はどのフォームも同じ形にする

各フォームは `noValidate` を持ち、送る前に検査し、誤りの文を欄ごとに状態として持つ。欄を変えると、その欄の誤りを消す。
欄の誤りは、自前の検査の文を先に出し、なければサーバーの誤りの文を出す。
共有する補足の文は `apps/web/src/settings/checks.ts` に置く。欄ごとの誤りをまとめる関数も同じファイルに置く。
`AddFeedForm`、`PageSelectors`、`FilterForm` にある欄ごとの日本語の文は残す。誤りの種類で選べる文は、種類で選ぶ。それ以外は `describeProblem` の文にし、英語の文を出す経路をなくす。

## Risks / Trade-offs

- ［`zod` の版が上がり、誤りの種類や `params` の扱いが変わる］→ `zodFieldErrors` の写し方を、`packages/core` とサーバーのテストで確かめる。知らない誤りは種類なしになり、画面は値を保存できないと表示するので、英語は出ない。
- ［サーバーの検査と画面の検査がずれる］→ 範囲は同じ定数から取る。時刻とURLの形の検査は画面とサーバーで別に書く。ずれたときも、サーバーの誤りの変換が受ける。
- ［種類のない誤りの文が具体的でない］→ 新しい誤りを足すときに種類を付ける。`docs/api.md` に種類の一覧を載せる。

## Migration Plan

APIは省略できる項目を足すだけなので、サーバーとアプリの更新の順は問わない。古いアプリは `code` を読まず、今までどおり動く。
