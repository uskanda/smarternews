# Design

## Context

フィードの読み取りは `packages/core/src/sources/feed.ts` にまとまっている。購読フィード（`parseSubscription`）とトピックのフィード（`parseFeed`、`collectFeed`）が、同じ `rssItem` と `atomEntry` を使う。日時と文字参照は `sources/text.ts` の `parseDate` と `decodeEntities` が受け持つ。
外部への要求はすべて `fetch/http.ts` の `Fetcher` を通る。サーバーはクロール用の `Fetcher` を1つ作り、ページ、フィード、翻訳のAPIで共有する。大きさの上限は、作るときに1つだけ受け取る。画像の中継は、`getBytes` に呼び出しごとの上限を渡している。
Webページの購読フィードの日時（`feeds/page.ts` の `parsePageDate`）は、時差のない日時を全体設定のタイムゾーンで読む。

## Goals / Non-Goals

**Goals:**

- フィードの日時、文字参照、guid、Atomの添付、応答の大きさの5点を、仕様の差分のとおりに直す。

**Non-Goals:**

- ページの公開日時（`sources/extract.ts`）の読み方は変えない。略称の置き換えは同じ関数を通るのでここにも当てはまるが、時差のない日時は今のままプロセスのタイムゾーンで読む。
- ニュース検索の結果の日時に、全体設定のタイムゾーンは渡さない。検索先は時差つきの日時を返す。
- 保存済みの配信記事の公開日時とタイトルは直さない。

## Decisions

### 日時：略称を時差に置き換えてから読む

`parseDate(value, timeZone?)` は、末尾の英字の略称を表で引き、`+0900` の形の時差に置き換えてから `Date` で読む。表にない略称（`IST` など）は置き換えず、Nodeが読めなければ `null` になる。米国の略称と `GMT`、`UT`、`Z` は、今もNodeが読めるので表に入れない。
時差のない日時は、2つの形だけを見分ける。ISOの形（`2026-10-20`、`2026-10-20T09:00:00`）と、RFC 822の形で時差のないもの（`Mon, 02 Jan 2006 15:04:05`）である。これらは `time.ts` の `zonedToUtc` で、全体設定のタイムゾーンとして読む。`timeZone` を渡さない呼び出し（`extract.ts`、ニュース検索）は今のまま `Date` に任せる。

- 代案：日時のライブラリーを足す。読む形が増えるが、依存が増え、略称の解釈はライブラリーごとに違う。表を自分で持つほうが、`IST` を読まない決定を守りやすい。

タイムゾーンは、`parseFeed`、`parseSubscription`、`collectFeed` の最後の引数 `timeZone` で渡す。呼び出し元の `ingest.ts` は `getSettings(db).timeZone` を、`pipeline/run.ts` は `ctx.settings.timeZone` を渡す。引数を省いたときは `UTC` で読む。フィードの探索はタイトルしか使わないので省く。

### 文字参照：`entities` の `decodeHTMLStrict`

`decodeEntities` は `entities/decode` の `decodeHTMLStrict` を呼ぶ。名前つきと数値の文字参照を、HTMLの表で解く。`;` で終わらない文字参照は解かないので、`AT&T` のような文字列は今と同じ結果になる。
数値の文字参照の扱いはHTMLの規則に従う。`&#0;` と範囲外の値はU+FFFDになり、`&#150;` は `–` になる。今までは文字列のまま残していた。

- 代案：表をリポジトリに置く、よく出る名前だけを手書きする。第1ラウンドQ1で退けた。

### リンク：パーマリンクのguid

`rssItem` は、`link` が空のとき、guidが `isPermaLink="false"` でなく、`http(s)` のURLとして読めるなら、そのguidをURLにする。RSS 1.0の項目はguidを持たないので変わらない。項目の識別子は今までどおりguidなので、保存済みの項目は次の取得で元のページのURLが付く（`storeItems` の `moved`）。

### 添付：Atomの `link rel="enclosure"`

`attachmentsOf` は、RSSのenclosureのあとに、`link` の要素のうち `rel="enclosure"` のものを読む。URLは `href` から、題は `title` から取る。種類は、RSSのenclosureと同じくMIMEの型で決める。上限、URLの制限、重複の除外は、ほかの添付と同じ `add` を通す。

### 大きさ：`Fetcher` の `get` に呼び出しごとの上限

`RequestOptions` に `maxBytes` を足し、`get` はそれがあれば使う。`FetcherOptions` に `feedMaxBytes`（省略時は `maxBytes`）を足し、`fetcher.feedMaxBytes` で読めるようにする。フィードを取る呼び出しは、`{ maxBytes: fetcher.feedMaxBytes }` を渡す。`ingest.ts` の `download`、`feed.ts` の `fetchXml`、`discover.ts` の `discoverFeeds` と `commonFeed` である。`runtime.ts` は `config.fetch.feedMaxBytes` をクロール用の `Fetcher` に渡す。
フィードの探索は、指定されたURLがフィードかページかを取得の前に知らない。そこでフィードの上限で取得し、フィードとして読めなかった応答がページの上限を超えるときは、ページとして読まずに拒否する。大きなHTMLを解析しないためである。

- 代案：フィード用の `Fetcher` を別に作る。ホストごとの間隔が別勘定になり、同じホストのフィードとページが間隔なしで続くので退けた。
- 代案：上限を各呼び出し元の引数で渡す。`FeedDeps`、`discoverFeeds`、`collectFeed`、ニュース検索の依存のすべてに値を通す必要があり、テストの組み立ても増える。上限は取得の作法の一部なので、作法を持つ `Fetcher` に置く。

## Risks / Trade-offs

- ［10MBのフィードの解析は、メモリを数十MB使う］→ 既定は承認どおり10MBにする。`--max-old-space-size=256` で足りないときは、`fetch.feedMaxBytes` を下げられる。
- ［数値の文字参照の結果が変わる（`&#0;` がU+FFFDになる）］→ HTMLの規則どおりで、表示の上の害はない。
- ［`IST` の項目は公開日時なしのまま］→ 第1ラウンドQ3の決定。`IST` を使うフィードを購読するときに見直す。

## Migration Plan

設定の移行は要らない。`fetch.feedMaxBytes` を書かない `config.yaml` は既定の10MBで動く。戻すときは前の版に戻すだけでよく、データベースは変わらない。
