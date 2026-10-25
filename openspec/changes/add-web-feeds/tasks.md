# Tasks

どの作業も、失敗するテストを先に書いてから実装する。テストは実際のLLMと外部サイトを呼ばず、差し替えたアダプターと取得元、記録済みの応答で動かす。

## 1. データベースと型

- [x] 1.1 `packages/core` に、次の空いている番号の移行を足す。足すのは、`feeds` の表の `<format>`（`feed` か `page`、既定 `feed`）と `<page_selectors>` の列である。`packages/core/src/db/database.test.ts` で、登録済みの購読フィードが `feed` になり、セレクターの組を持たないことを確かめる
- [x] 1.2 `packages/core/src/api.ts` に、セレクターの組のスキーマを足す。`item` は必須、`title`、`link`、`date` は省略可で、どれも300文字までとする。CSSセレクターとして読めない値は、その項目の名前を付けて拒否する。購読フィードの型に `format` と `selectors` を、登録の入力に `format` と `selectors` を、変更の入力に `selectors` を足す。`api.test.ts` で、`div[` の拒否、項目のセレクターのない組の拒否、`format` を省いた登録がいまと同じに読まれることを確かめる
- [x] 1.3 `packages/core/src/db/feeds.ts` で、`format` とセレクターの組を読み書きする。`feed` の購読フィードへのセレクターの組の変更を拒否する。`feeds.test.ts` で、保存と読み出しの往復と、その拒否を確かめる

## 2. ページからの抜き出しと取得

- [x] 2.1 `packages/core/src/feeds/page.ts` に、HTML、ページのURL、セレクターの組から `ParsedSubscription` を作る処理を足す。`packages/core/src/feeds/page.test.ts` で次を確かめる。タイトルとリンクの省略時の扱い、相対のリンクの絶対化、リンクかタイトルのない項目の除外、項目の文章を内容に入れないこと、スクリプトで描く記事を抜き出さないこと、要素のない組で0件になることである
- [x] 2.2 `packages/core/src/feeds/page.ts` に日時の読み取りを足す。`packages/core/src/feeds/page.test.ts` で、読める形を確かめる。形は、`datetime` の属性、ISO 8601、`YYYY-MM-DD`、`YYYY/MM/DD`、`.` で区切った年月日、`YYYY年M月D日` である。時差のない日時を全体設定のタイムゾーンで読むことも確かめる。3時間前のような読めない文字列が日時なしになることも確かめる
- [x] 2.3 `packages/core/src/feeds/ingest.ts` の `fetchFeed` と `subscribe` を、`format` で分ける。`page` のときは、`PageFetcher` でページを取得し、2.1の処理で読む。`FeedPoller` に、1日ごとに作り直す `PageFetcher` を持たせる。`ingest.test.ts` で次を確かめる。登録で記事が未読で保存され、名前がページのタイトルになる。記事を抜き出せないページの登録を拒否する。`robots.txt` が禁じるページの登録を、ページへの要求なしに拒否する。登録のあとで禁じられたら、理由を失敗として記録する。日時のない記事が取得の時刻で並ぶ。要素がない取得を失敗として記録し、理由が `no element matches the item selector` になり、最後に成功した時刻と最後に新しい項目が現れた時刻を変えない。セレクターの組を直したあとの取得で失敗の理由が消える。条件付きの要求のヘッダーを送らない
- [x] 2.4 `ingest.test.ts` と `poller.test.ts` で、Webページの購読フィードの登録と取得でLLMのアダプターが1度も呼ばれないことを確かめる。更新の止まったWebページの購読フィードが取得され続け、LLMの呼び出しが増えないことも確かめる。`poller.test.ts` で、要素のない取得が続くと、ほかの失敗と同じく次の取得までの間隔を2倍ずつ延ばすことを確かめる
- [x] 2.5 `packages/core/src/feeds/opml.ts` の書き出しを `format = 'feed'` に限る。`opml.test.ts` で、同じカテゴリのAtomのフィードだけが書かれることを確かめる

## 3. セレクターの提案のタスクと上限

- [x] 3.1 `packages/core/src/config.ts` の `limits` に `selectorProposalsPerDay`（既定50、0以上）を足す。`llmCallsPerDay` の既定を350にする。`tasks` に `proposeSelectors` を足す。`resolveAssignment` で、このタスクに `smart` を優先させる。`config.test.ts` で次を確かめる。既定の値が350と50になる。`providers` を書かない設定では提案が `smart`、判定と集約が `fast` になる。`smart` のない設定では `tasks.default` になる
- [x] 3.2 `packages/core/src/llm/tasks.ts` に `proposeSelectors` を足す。出力は1つから3つの候補とし、`check` で各セレクターを空の文書に当てて検査する。HTMLは `material()` で囲み、位置で数えるセレクターを避けるよう指示する。`tasks.test.ts` で、出力のスキーマ、CSSセレクターとして読めない出力の拒否、プロンプトに `material` の囲みがあることを確かめる
- [x] 3.3 `packages/core/src/llm/runner.ts` に、その日の提案の呼び出しを数える関数を足す。`#spend` で、提案の1日の上限と `llmCallsPerDay` の両方を比べる。`runner.test.ts` で次を確かめる。上限に達した日は `LlmLimitError` になる。提案が `callsToday` に数えられる。`llmCallsPerDay` に達した日は提案を呼ばない。やり直しの2回目も1回と数える。要約の数に入らない
- [x] 3.4 `docs/providers.md` に、タスク `proposeSelectors`、既定の割り当て、`selectorProposalsPerDay`、`llmCallsPerDay` との関係を書く。`README.md` と `README.ja.md` の `llmCallsPerDay` の既定を350に直し、提案の1日の上限を足す。`examples/config.example.yaml` に同じ値を書く

## 4. 候補と見本の作成

- [x] 4.1 LLMに渡すHTMLを整える処理を足す。取り除くのは、`script`、`noscript`、`template`、`style`、`rel` が `stylesheet` の `link`、`iframe`、`embed`、`object` の要素である。`style` の属性、`on` で始まる属性、コメントも取り除き、50,000文字で切る。テストで、取り除く要素と属性、`class` と `id` を残すこと、120,000文字のHTMLが先頭の50,000文字になることを確かめる
- [x] 4.2 `packages/core/src/feeds/infer.ts` に、リンクの多い領域からの推定を足す。`packages/core/src/feeds/infer.test.ts` で、記録したページの見本のHTMLから記事の一覧の候補が出ることを確かめる。`nav` の中のリンクの並びを候補にしないこと、`time` の要素で日時のセレクターを付けることも確かめる。リンクが1つしかないページでは、候補が空になる
- [x] 4.3 `packages/core/src/feeds/propose.ts` に、候補の処理を足す。順は、ページの取得、提案、元のHTMLへの当てはめ、推定への切り替え、見本の作成である。見本の処理も同じファイルに置く。`packages/core/src/feeds/propose.test.ts` で次を確かめる。成功した提案が `usedModel` 真で返る。提案の1日の上限に達するとアダプターを呼ばずに推定で返る。時間切れと2回の不正な出力でも推定で返る。どの提案も記事を抜き出せないときも推定で返る。候補が空でもエラーにならない。見本が件数と10件までの記事を返す。見本でアダプターが呼ばれない

## 5. API

- [x] 5.1 `apps/server/src/app.ts` に、候補と見本の2つの操作を足す。パスは `POST /api/v1/feeds/page/candidates` と `POST /api/v1/feeds/page/preview` である。`apps/server/src/feeds-api.test.ts` で次を確かめる。応答の形がそろう。上限に達した日も200で返る。`robots.txt` が禁じるページと404のページで、入力が不正であることを返す。`div[` の見本の要求が400で、ページへの要求が発生しない
- [x] 5.2 `app.ts` の購読フィードの登録と変更で `format` と `selectors` を受け、一覧と詳細で返す。`feeds-api.test.ts` で次を確かめる。登録のあとの一覧が種類とセレクターの組を返す。Atomのフィードの購読フィードへのセレクターの組の変更が400になる。セレクターの組の変更が次の取得から使われ、変更の前の配信記事が残る
- [x] 5.3 `docs/api.md` に、2つの操作、登録と変更の `format` と `selectors`、一覧の項目、OPMLにWebページの購読フィードを書かないことを書く

## 6. 設定ファイル

- [x] 6.1 `packages/core/src/settings-file.ts` で、Webページの購読フィードを `selectors` とともに書き出し、読み込みで登録する。`settings-file.test.ts` で次を確かめる。カテゴリの下にセレクターの組つきで書かれる。空のサーバーへの読み込みで登録され、取得を待たない。往復で内容が一致する
- [x] 6.2 `settings-file.ts` で、URLの一致する購読フィードと種類が違う項目と、CSSセレクターとして読めない項目を、位置を示して拒否する。`settings-file.test.ts` で、拒否のときにほかのカテゴリと購読フィードも保存されないことを確かめる

## 7. 共有の処理

- [x] 7.1 `packages/client/src/api.ts` に、候補と見本の呼び出しを足し、購読フィードの型に `format` と `selectors` を足す。送る要求の形を `api.test.ts` で確かめる

## 8. Webの購読フィードの設定の画面

- [x] 8.1 `apps/web/src/settings/FeedsPage.tsx` の追加で、フィードが見つからないときに「このページを購読する」ボタンを出す。押すと候補を求め、待つ間の表示、候補ごとの見本、LLMを使わなかったことの一文を出す。全文の自動の取得の切り替えは入った状態で始め、本文を全文の取得で得ることをそばで説明する。テストは実物のAPIに対して動かし、次を確かめる。ボタンを押すまで候補の要求が出ない。2つ目の候補を選んで登録できる。上限に達した日は、一文が誤りでない見た目で出る。提案が成功したときは一文が出ない
- [x] 8.2 `FeedsPage.tsx` で、候補が空のときに項目、タイトル、リンク、日時のセレクターの欄と「見本を見る」ボタンを出す。テストで、見本を確かめてから登録できることと、記事を抜き出せない組では追加を選べないことを確かめる
- [x] 8.3 `FeedsPage.tsx` の編集の画面で、`format` が `page` のときだけ、セレクターの組の欄、「見本を見る」、「候補を出し直す」を出す。テストで次を確かめる。候補を出し直して選んだ組が保存される。日時のセレクターを足して保存できる。Atomのフィードの購読フィードではこれらが出ない

## 9. 規則の文書

- [x] 9.1 `AGENTS.md` の「コードに書かれていない規則」で、LLMを呼ばない規則に例外を書き足す。例外は、利用者が候補を求めたときのセレクターの提案のタスクだけである。購読フィードの取得、記事の抜き出し、配信記事の保存では呼ばないことは残す。`make verify` の文書の検査が通ることを確かめる

## 10. 結合の確認

- [x] 10.1 `apps/server/src/e2e.test.ts` に、Webページの購読フィードの一連の流れを足す。流れは、候補を求め、選んで登録し、記録したページの変化で新しい記事が届くまでである。OPMLに出ず、設定ファイルに出ることを確かめる。候補の要求だけがアダプターを呼ぶことも確かめる
- [x] 10.2 `make verify` が通ることを確かめる
