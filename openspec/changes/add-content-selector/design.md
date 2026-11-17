# Design

## Context

動機はproposal.mdのWhyにある。ここでは、方式を決めるのに要る現状だけを書く。

- `extractArticle`（`packages/core/src/sources/extract.ts`）は、ページから題、本文の文字列、本文のHTML、公開日時を取り出す。本文はReadabilityの結果だけである。全文の取得のほか、自動の要約と生成記事の処理も呼ぶ。
- 全文の処理の `contentOf`（`packages/core/src/feeds/full-content.ts`）は、取り出したHTMLを `convertContent` でMarkdownへ変換する。配信された内容より短いときは `shorter` で失敗にする。全文を保存済みの記事は、取得し直さない。
- 失敗の理由の列（`full_content_error`）には、種類を並べたCHECK制約がある。種類を足すには `articles` の表の作り直しが要る。
- Webページの購読フィードのセレクターは、`cssSelectorSchema` で書き方を確かめ、`checkSelectorsUsable` でページを読む仕組みで使えるかを確かめてから保存する。
- 全文を待つ記事は、列の値から問い合わせで求める（`WAITING_FOR_FULL_CONTENT`）。待ち行列の表はない。

## Goals / Non-Goals

**Goals:**

- Readabilityが本文を誤るサイトで、利用者が購読フィードごとに本文の要素を指定できる。
- 指定を直したとき、これから読む記事で直った結果が得られる。
- 生成記事の処理と、指定のない購読フィードの結果を変えない。

**Non-Goals:**

- 本文に含めない要素を指定する設定（除外のセレクター）。
- 記事ごとに全文を取得し直す操作。
- アプリでの本文のセレクターの設定。
- LLMによるセレクターの提案。

add-full-contentのNon-Goalsにあった「サイトごとに取り出しの方式を変える設定」を、この変更で見直す。方式はReadabilityと本文のセレクターの2つに限り、セレクターが当たらないときはReadabilityに戻す。

## Decisions

### 取り出しは `extractArticle` に省略できる引数を足す

`extractArticle(html, url, maxChars, contentSelector?)` とする。
指定があり、`querySelector` で当たる最初の要素の文字列が空でないときは、その要素の `outerHTML` を `html` に、空白をまとめた文字列を `text` にする。Readabilityは呼ばない。
入れ子の要素に当たっても最初の1つしか使わないので、同じ文が2度入ることはない。
当たる要素がないとき、文字列が空のとき、またはセレクターが例外を投げたときは、いまと同じくReadabilityの結果を返す。保存の前に使えないセレクターを断るので、例外は古い値か仕組みの差でだけ起きる。
題と公開日時の取り方は変えない。Readabilityは渡した文書を書き換えるので、セレクターを先に試す。
結果に `matched`（セレクターの要素を使ったかどうか）を足し、見本が表示に使う。
生成記事の呼び出し元は引数を渡さないので、動きは変わらない。

当たらないときを失敗とする案（Q1のA）は採らない。利用者が、Readabilityに戻す案を選んだ。

### 保存は `feeds` の列1つ

移行 `041_feed_content_selector.sql` で `feeds` に `content_selector TEXT` を足す。NULLは指定なしである。`articles` の表は作り直さない。
APIの `feedSchema` には `contentSelector: string | null` を足す。`feedFields` に `contentSelector: cssSelectorSchema.nullable().optional()` を足し、登録と変更の両方で受ける。変更で `null` を送ると指定なしに戻る。
保存の前に、`checkSelectorsUsable` と同じ仕組みで、ページを読む仕組みで使えない値を断る。誤りの項目は `contentSelector` とする。

### 変えたときは、同じトランザクションで未読の記事の全文を消す

`updateFeed` は、送られた `contentSelector` がいまの値と違うとき（解除を含む）だけ、その購読フィードの `is_read = 0` の配信記事の全文の列を空にする。
対象の列は `full_content` で始まる6つ（本文、文字列、時刻、状態、理由、詳細）である。
本文の訳（`article_translations`）も、同じ記事について消す。全文を保存したときの訳は全文の訳であり、`saveFullContent` も保存のときに訳を消している。
消した記事は `full_content_status` が空なので、全文の自動の取得が有効で、待つ条件に合えば、自動の取得の対象に戻る。そのほかの記事は、開いて全文を頼むと取得される。
サーバーは、購読フィードの変更のあとに全文の取得の処理の `tick` を呼び、次の周期の30秒を待たずに始める。
自動の要約は消さない。要約は記事ごとに1度だけ作る決まりで、消すとLLMの利用枠を使うためである。

既読の記事を残す理由は、Q2で決めたとおり、読み終えた記事のためにページの消えた全文を失う危険を取らないことである。

### 全文と要約での使用

`articleForFullContent` と `nextArticleForFullContent` は、購読フィードの `content_selector` も読む。`contentOf` は、それを `extractArticle` に渡す。`shorter` の判定は変えない。
要約が自分でページを読むとき（全文を保存せず、全文の自動の取得が無効なとき）も、`articleForFullContent` が返す本文のセレクターを `extractArticle` に渡す。

### 見本は、取得と取り出しと変換を通し、何も保存しない

`POST /feeds/:id/content-preview`（本文は `{ contentSelector: string | null }`）を足す。
そのフィードの配信記事で、URLのある記事のうち保存の新しい1件を選び、全文の取得と同じ `PageFetcher`（`robots.txt` に従う）でページを取得する。取り出しと変換は `contentOf` と同じ手順で行い、保存の段だけを行わない。
応答は次の3つのどれかである。

- `{ status: "no-article" }`：URLのある記事がない。
- `{ status: "failed", article, error }`：ページを読めない、または本文を取り出せない。`error` は全文の失敗と同じ形である。
- `{ status: "ok", article, matched, markdown, chars, shorter }`：`markdown` は変換した本文の先頭1000文字である。`chars` は空白をまとめた本文の文字数で、`shorter` は配信された内容より短いかどうかである。

`article` は記事のid、タイトル、URLである。
全文の取得の処理の列には並ばない。利用者がボタンで1回だけ求める操作であり、Webページの購読フィードのセレクターの見本と同じく、その場で取得する。

### Webの画面

購読フィードの編集のフォームの、全文の取得の切り替えの下に「本文のセレクター」の欄を置く。値は保存するときに送り、変わっていなければ送らない。空の欄は `null` として送る。
欄の下に「見本を見る」ボタンを置き、結果を欄の下に表示する。見本は保存しない。
誤りは、ほかの欄と同じく `fieldMessage` で欄のそばに出す。

## Risks / Trade-offs

- セレクターが当たらないページでは、Readabilityの誤った結果に黙って戻る。見本で当たったかどうかを確かめられるので、利用者が直しどきを知る手段は見本である。
- 消した全文は、ページが消えた記事では戻らない。対象を未読の記事に限って、危険を小さくした。
- 本文のセレクターで取り出した要素には、広告や共有のボタンが残ることもある。Readabilityは、それらを除いていた。スクリプトと危険な要素は変換の規則で除くので、安全の面の差はない。
