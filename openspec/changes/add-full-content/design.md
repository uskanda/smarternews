# Design

## Context

動機はproposal.mdのWhyにある。ここでは、方式を決めるのに要る現状だけを書く。

- 配信記事は、生成記事と同じ `articles` の表に入っている。配信された内容は、保存の前に `convertContent`（`packages/core/src/feeds/content.ts`）でMarkdownへ変換し、`body` に置く。語だけの文字列は `content_text` に置き、ストップワードの判定に使う。
- 自動の要約（`packages/core/src/feeds/summarize.ts`）は、`SummaryWorker` が1件ずつ動かす。記事のページは `PageFetcher` で取得する。
  本文の文字列は、`extractArticle`（`packages/core/src/sources/extract.ts`）が `@mozilla/readability` で取り出す。
  取り出した文字列は要約の入力にだけ使い、捨てている。
- `PageFetcher` は `robots.txt` に従い、下の `Fetcher` が取得先の制限、ホストごとの間隔、User-Agent、応答の大きさと時間の上限を受け持つ。
- 本文の翻訳（`packages/core/src/translation/service.ts`）は、記事の `body` を段落に分けて訳し、`article_translations` に保存する。訳の途中で `body` が変わったときは保存しない。
- 記事の詳細は、`body` から `renderMarkdown` で `bodyHtml` を作って返す。配信記事では画像を残す。

## Goals / Non-Goals

**Goals:**

- 記事のページの取得を、全文と要約で1回にまとめる。全文と要約の処理が、同じ記事のページを別々に取得しない。
- 配信された内容（`body`、`content_text`）は変えない。ストップワード、書き換えの検出、一覧の抜粋は、いまのまま動く。
- 全文の取得では、LLMを呼ばない。

**Non-Goals:**

- 全文をRSSに載せること。配信記事は、いまと同じくRSSに載らない。
- 画像のプロキシ。#66で扱う。
- RSSのないサイトからの記事の取得。#61で扱う。
- サイトごとに取り出しの方式を変える設定。

## Decisions

### 全文は、記事の行の列に、配信された内容と別に保存する

移行で次の列を足す。表の作り直しは要らない。

- `feeds`: `fetch_full_content`（0か1）、`fetch_full_content_since`（有効にした時刻。無効のときは空）
- `articles`: `full_content`（Markdown）、`full_content_text`（語だけの文字列）、`full_content_at`（取得した時刻）
- `articles`: `full_content_status`（空、`fetched`、`failed`）
- `articles`: `full_content_error`（失敗の理由の種類）、`full_content_error_detail`（HTTPステータスなどの詳細）

全文は記事と1対1で、記事と一緒に保存期間で消える。そのため、別の表にはしない。
`body` を全文で上書きする案は採らない。上書きすると、配信された内容への切り替え、ストップワードの判定、項目の書き換えの検出が、配信された内容を失うためである。
移行の番号は、実装のときに、そのときの最後の番号の次にする。並行して書いているほかの変更も、移行を足す見込みがあるためである。

### 全文の待ちは、列の値から問い合わせで求める

待ち行列の表は作らない。自動の要約の `CAN_BE_SUMMARIZED` と同じ形で、次の条件に当たる記事を、保存した時刻の新しい順に1件取る。

- 由来が配信記事である（`a.origin = 'feed'`）。
- 購読フィードの全文の自動の取得が有効で、記事の `created_at` が `fetch_full_content_since` より後である。
- `full_content_status` が空である。
- 未読である。
- ストップワードで隠れていない。スターのある記事は除かない。

### 取り出しは `extractArticle` を広げ、変換は `convertContent` を使う

`extractArticle` に、Readabilityが返す本文のHTML（`content`）を返す項目を足す。
全文の処理は、そのHTMLを `convertContent(html, page.url, outputLanguage)` でMarkdownと語だけの文字列に変換する。配信された内容と同じ規則が、そのまま全文にも当たる。長さの上限 `MAX_CONTENT_CHARS` も同じである。
取り出した語だけの文字列の文字数が、記事の `content_text` の文字数より少ないとき、失敗として `shorter` を記録する。比べる文字数は、空白をまとめたあとの文字数である。配信された内容が空の記事では、取り出せた本文は常に長いので、保存する。
取り出せた文字列が空のときは `no-content` を記録する。

失敗の理由の種類は次のとおり。APIもこの値を返し、画面が文に直す。

| 種類 | 当たるとき |
|---|---|
| `no-url` | 記事にURLがない |
| `robots` | `robots.txt` が禁じている |
| `blocked` | 取得先の制限に当たる |
| `http` | 2xxでない状態を返した。詳細にステータスを置く |
| `not-html` | HTMLでない応答を返した |
| `timeout` | 時間内に応答しない |
| `error` | そのほかの取得の失敗。詳細に内容を置く |
| `no-content` | 本文を取り出せない |
| `shorter` | 取り出した本文が配信された内容より短い |

`PageFetcher` はいま、取得先の制限と時間切れを `error` にまとめている。`FetchError` に種類を持たせ、`PageResult` で `blocked` と `timeout` を分ける。

### 取得は1本の列で行い、頼まれた記事を先にする

`packages/core/src/feeds/full-content.ts` に `FullContentWorker` を足す。`SummaryWorker` と同じく、一定の間隔で待っている記事を見て、1件ずつ取得する。
`PageFetcher` は `pagesPerRun` を無限、`remember: false` で作り、日が替わるたびに作り直す。`robots.txt` を読み直すためである。
頼まれた取得、自動の取得、自動の要約からの取得は、どれもこの部品の `fetchFor(id)` を通す。`fetchFor` は1本のPromiseの鎖に並べ、同時に2件を取得しない。
頼まれた記事は、いま取得中の1件が終わった直後に割り込み、自動で待つ記事より先に取得する。
同じ記事を2度頼まれたときは、進行中のPromiseを返す。翻訳の `#underWay` と同じ方式である。

1日の上限は設けない（grilling.mdのround 2 Q5）。同じホストへの負荷は、`Fetcher` のホストごとの間隔で抑える。

自動の要約の列に全文の取得を載せる案は採らない。要約にはLLMの1日の上限があるため、上限に達した日は全文の取得まで止まってしまう。

### 自動の要約は、全文の列を通してページを読む

`summarize.ts` の `textOf` を次の順に変える。

1. 全文があれば、`full_content_text` を入力にし、もとは `page` とする。ページは取得しない。
2. 全文の取得に失敗した記事では、配信された内容を入力にし、もとは `feed` とする。ページは取得しない。
3. 購読フィードの全文の自動の取得が有効で、まだ取得していない記事では、全文を取得する処理（`<FullContentWorker>`）の完了を待ち、1か2に従う。
4. それ以外の記事は、いまと同じくページを取得し、本文を保存しない。

`SummaryWorker` は `FullContentWorker` を受け取る。要約の1日の上限の確認は、いまと同じくページの取得の前に行う。

### 頼まれた取得のAPIは、取得が終わってから応答する

`POST /api/v1/articles/:id/full-content` を足す。応答は次のどちらかである。

- `{ "status": "fetched", "fullContent": { "body", "bodyHtml", "fetchedAt" } }`
- `{ "status": "failed", "error": { "reason", "detail" } }`

生成記事は400（`invalid`）、存在しない記事は404を返す。全文を保存済みの記事は、取得せずに `fetched` を返す。
取得の時間は、`Fetcher` の応答の時間の上限と、ホストごとの間隔で決まる。数秒から十数秒かかるので、画面は待っている間、取得の途中であることを示す。
状態を取り直す方式（要約の依頼と同じ形）は採らない。全文の取得はLLMを待たず、1回の応答で結果を返せるためである。

記事の詳細には、次の項目を足す。

- `fullContent`: `{ body, bodyHtml, fetchedAt }` または `null`。`bodyHtml` は `renderMarkdown(body, { images: true })` で作る。
- `fullContentStatus`: `none`、`waiting`、`fetched`、`failed` のいずれか。`waiting` は、待ちの問い合わせの条件に当たる記事である。
- `fullContentError`: `{ reason, detail }` または `null`。

購読フィードの一覧、登録、変更の項目として `fetchFullContent` を足す。有効にした時刻は `fetch_full_content_since` に記録する。

### 全文を保存したら、本文の訳を消す

全文を保存するとき、同じトランザクションで `article_translations` の行を消す。タイトルの訳（`translated_title`）は残す。
`translateArticle` は、全文があれば `full_content` を、なければ `body` を分けて訳す。訳の途中で変わったかどうかの確認も、訳した方の列で行う。
画面は、全文が届いたあとに記事を取り直す。訳がなくなっているので、いまの「開いたときの本文の翻訳」の処理が、全文を訳す操作を呼ぶ。

### 書き換えとストップワードは、配信された内容だけを見る

項目の書き換え（`ingest.ts` の `rewrite`）は、全文の列に触れない。全文は取得し直さない（grilling.mdのround 2 Q6）。
`applyStopWords` は、いまと同じく `title` と `content_text` だけを見る。全文は、ストップワードの判定に使わない。
全文があとから届いて、読んでいる記事が一覧から急に隠れることを避けるためである。

### 画面は、表示する方を記事ごとの一時的な状態で持つ

Webの `ArticleView` とアプリの `ArticleScreen` に、配信された内容を表示しているかどうかの状態を持たせる。記事が替わると、全文の表示へ戻す。保存はしない。
全文のある記事では全文を、ない記事では配信された内容を表示する。全文を表示しているときは、元のページから取得した全文であることを、内容の前に小さく示す。
Webでは、`apps/web/src/reader/ReaderPage.tsx` の `useHotkeys` に `w` のキーを足す。`apps/web/src/shell/Shell.tsx` の `KEYS` に `["w", "全文の取得と、配信された内容との切り替え"]` を足す。
アプリでは、本文の画面の上部に、1つのボタンを置く。全文がなければ取得、あれば切り替えとして働く。

全文を待つ記事を開いたとき、画面は全文を取得する操作を呼ぶ。開くと記事は既読になり、自動の取得の対象から外れるためである。自動の要約の「開いた記事の要約の依頼」と同じ考え方である（grilling.mdのround 2 Q4）。

全文を取得する操作の呼び出しは、`packages/client` に足す。WebとアプリはこれをReact Queryから使う。

### 設定ファイルには、有効な購読フィードにだけ書く

`settings-file.ts` の購読フィードの項目に `fetchFullContent: true` を足す。自動の要約と同じく、有効なときだけ書く。
読み込みで書かれていないときは、新しい購読フィードでは無効、すでにある購読フィードでは保存済みの値を保つ。
読み込みで有効にしたときも、`fetch_full_content_since` は読み込みの時刻にする。すでにある配信記事の全文は取得しない。

## Risks / Trade-offs

- Readabilityが、本文でない部分を取り出す → 配信された内容より短いものは失敗にする。長い誤りは残るため、利用者がいつでも配信された内容へ切り替えられるようにする。
- 配信元のサイトへの要求が増える → 対象は、設定を入れた購読フィードの、設定のあとに届いた未読の記事と、利用者が頼んだ記事だけにする。取得は1件ずつで、ホストごとの間隔と `robots.txt` に従う。
- 時間切れのような一時的な失敗でも、自動では取得し直さない → 失敗の理由を表示し、利用者が `w` またはボタンで取得し直せる。
- データベースが大きくなる → 全文は1件あたり `MAX_CONTENT_CHARS`（100,000文字）までで、スターのない記事は90日で消える。
- 全文の画像を表示すると、配信元以外のサイトへも要求が出る → 画像は配信された内容の画像と同じ規則（`https:` だけ、リファラーを送らない）で読み込む。プロキシは#66で扱う。
- 翻訳のAPIに送る文字数が増える → 1件あたり20,000文字の上限と、月の上限がそのまま当たる。
- 頼まれた取得の応答が、自動の取得の待ちで遅れる → 頼まれた記事は、取得中の1件の直後に割り込む。待つのは最長で1件分である。

## Migration Plan

1. 移行で列を足す。既存の購読フィードは全文の自動の取得が無効、既存の記事は `full_content_status` が空になる。
2. サーバーの起動で `FullContentWorker` を `SummaryWorker` より先に作り、`SummaryWorker` に渡す。
3. 戻すときは、前の版のサーバーを動かす。足した列は前の版から読まれないので、そのまま残してよい。

## Open Questions

- 全文の自動の取得が無効な購読フィードで、自動の要約がページを取得したときに、取り出した本文を全文として保存するか。この設計では保存しない（仕様の「取得した本文を保存しないこと」をこの範囲で残す）。保存すると、要約だけを有効にした購読フィードの記事も全文で表示されるので、表示が変わる。interviewでは決めていない。
- 自動の取得が一時的な理由（`timeout`、`http` の5xx）で失敗したとき、あとで1回だけやり直すか。この設計ではやり直さず、利用者の操作に任せる。interviewでは決めていない。
- 全文を待つ記事を開いたときに、画面が全文の取得を頼むこと。round 2 Q4の「自動の要約と同じ扱い」から導いたが、interviewで直接は問うていない。
