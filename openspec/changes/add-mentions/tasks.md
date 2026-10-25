# Tasks

どの作業も、失敗するテストを先に書いてから実装する。テストは実際のLLMと外部サイトを呼ばない。アダプターを差し替え、記録済みの応答で動かす。

## 1. 抜き出した名前の検証

- [x] 1.1 `packages/core/src/mentions.ts` に、`Mention` の型、種類の値、`mentionKey` を書く。大文字と小文字、全角と半角、前後の空白、続いた空白の違いが同じ値になることをテストで確かめる。略称と正式な名前、名前の一部が別の値になることも確かめる
- [x] 1.2 `packages/core/src/mentions.ts` に `parseMentions` を書く。仕様 `llm-tasks` の「抜き出した名前の種類」「抜き出した名前の件数」「抜き出した名前だけが不正な出力」の各場面を、入出力のテストで確かめる。仕様 `mentions` の「1つの記事の中の同じ名前」の場面も確かめる。同じ名前を除いてから10件を数えることと、名前の前後の空白を除くことも確かめる

## 2. タスクとランナー

- [x] 2.1 `packages/core/src/llm/tasks.ts` の `TaskDefinition` に任意の `wire` を足す。`write` と `summarize` の `output` に、何でも受ける任意の `mentions` を足す。`wire` には名前と種類の一覧を足す。`wire` から作ったJSON Schemaに件数と文字数の上限がなく、種類の列挙があることをテストで確かめる。ほかのタスクのJSON Schemaが変わらないことも確かめる
- [x] 2.2 `write` と `summarize` のプロンプトに、`design.md` の3つの指示を足す。仕様 `llm-tasks` の「本文の生成のタスクの抜き出した名前」「抜き出した名前の書き方」の指示がプロンプトに入ることをテストで確かめる。テストは `packages/core/src/llm/tasks.test.ts` に置く。書き直しのプロンプトにも入ることを確かめる
- [x] 2.3 `packages/core/src/llm/runner.ts` の `run` で、`wire` があればそれからJSON Schemaを作る。`write` と `summarize` の結果に `parseMentions` の結果を付ける。仕様 `llm-tasks` の「出力の検証」「検証に通らない出力の破棄」の各場面を、記録済みの応答でテストする。名前だけが不正な出力で呼び出しが1回であること、2回目の出力の名前を使うことを確かめる
- [x] 2.4 `wire` から作ったスキーマが、`claude` コマンドの `--json-schema` にそのまま渡ることを確かめる。OpenAI互換HTTPの `response_format` に渡ることも確かめる。テストは `packages/core/src/llm/claude-cli.test.ts` と `openai-compatible.test.ts` に置く

## 3. 保存

- [x] 3.1 `packages/core/src/db/migrations` に、抜き出した名前の移行を足す。番号は、実装の時点で取り込み済みの最後の移行の次に付ける。表 `article_mentions`、種類の `CHECK`、主キー、`(article_id, name_key)` の一意、`(name_key, article_id)` の索引を作る。既存のデータベースを移して、記事の数と検索の結果が変わらず、名前の行が0件であることをテストで確かめる。仕様 `mentions` の「機能を入れる前の記事の除外」の場面も確かめる
- [x] 3.2 `packages/core/src/db/mentions.ts` に `replaceMentions` と、記事ごとの読み出しを書く。記事の削除で名前が消えること、購読フィードとカテゴリの削除で連動して消えることをテストで確かめる。仕様 `mentions` の「記事の削除と抜き出した名前」の各場面も確かめる
- [x] 3.3 `writeStories` で、`insertArticle` と `reviseArticle` のあとに `replaceMentions` を呼ぶ。置き場は `packages/core/src/pipeline/run.ts` である。`mentions` が `null` のときの扱いは `design.md` に従う。仕様 `mentions` の「生成記事の抜き出した名前の保存」「書き直した生成記事の名前の置き換え」の各場面を、記録済みの応答でテストする。「書き直しで名前が不正なときの保持」の場面も同じく確かめる。同じイベントを別の見出しで見つけたときの書き直しも確かめる
- [x] 3.4 `packages/core/src/feeds/summarize.ts` で、`saveAutoSummary` と `replaceMentions` を1つのトランザクションにまとめる。仕様 `mentions` の「配信記事の抜き出した名前の保存」の各場面をテストで確かめる。開いた記事の要約の依頼で保存した要約にも名前が付くことを確かめる
- [x] 3.5 `packages/core/src/feeds/ingest.ts` の書き換えと、自動の要約を無効にする処理が、名前に触れないことをテストで確かめる。仕様 `mentions` の「書き換えられた配信記事の名前の保持」「要約を止めたときの名前の保持」の各場面が対象である
- [x] 3.6 `llm-tasks` の仕様の「名前を抜き出すための呼び出しの禁止」の各場面を、実行と要約のテストで確かめる。呼び出しの記録の行を数える。記事を書く実行と要約の呼び出しの回数が、変更の前と同じであることを確かめる

## 4. 名前の記事の一覧とAPI

- [x] 4.1 `packages/core/src/api.ts` に、`mentions` の項目のスキーマと、名前の記事の一覧の要求のスキーマを足す。記事の詳細のスキーマに `mentions` を足す。名前の上限が100文字で、空白だけの名前を拒否することをスキーマのテストで確かめる
- [x] 4.2 `packages/core/src/db/mentions.ts` に `listMentionArticles` を書く。条件は `design.md` のとおりで、並びと続きの値は `pageArticles` を使う。仕様 `mentions` の「同じ名前の判定」「名前の記事の一覧に入る記事」「名前の記事の一覧の並び」の各場面をテストで確かめる。「名前の記事の一覧での隠した配信記事の除外」「名前の記事の一覧での隠した重複の除外」の各場面も確かめる。スターのある配信記事と注釈のある配信記事がフィルターで隠れないことは、この2つの場面に含まれる
- [x] 4.3 `packages/core/src/db/articles.ts` の記事の詳細に、保存した順の `mentions` を足す。記事の一覧の応答が変わらないことをテストで確かめる
- [x] 4.4 `apps/server/src/app.ts` に `GET /api/v1/mentions/articles` を足す。仕様 `http-api` の「記事の詳細での抜き出した名前の提供」「名前の記事の一覧の操作」「名前の記事の一覧の分割」「名前の入力の拒否」の各場面を、サーバーを通したテストで確かめる。仕様 `mentions` の「LLMを使わない名前の記事の一覧」の場面も確かめる
- [x] 4.5 `packages/core/src/db/search.test.ts` で、仕様 `article-search` の「抜き出した名前を照合しないこと」の各場面を確かめる
- [x] 4.6 `packages/client/src/api.ts` に名前の記事の一覧の呼び出しを足し、応答のスキーマでの検証をテストで確かめる。`packages/client/src/mentions.ts` に `groupMentions` を書き、人、組織、製品、地名の順に分け、同じ種類の中で保存した順を保つことをテストで確かめる
- [x] 4.7 `docs/api.md` の「Articles」に記事の詳細の `mentions` を、新しい節に名前の記事の一覧の操作を書く。書いた例の要求を、テスト用のサーバーに送って確かめる

## 5. 見た目の定義

- [x] 5.1 `DESIGN.md` に部品 `mention-link` と、種類の見出しの書式を足す。語の色付けの `term-badge` と形で見分けられ、色付けの色を使わないことを文章に書く。`designmd lint DESIGN.md` が誤りなしで通ることを確かめる
- [x] 5.2 `pnpm run tokens` を流して、`apps/web/src/styles/tokens.css` と `apps/mobile/src/theme/tokens.ts` に反映する。`pnpm run check:tokens` が通ることを確かめる

## 6. Web

- [x] 6.1 `apps/web/src/reader/Mentions.tsx` を作り、`ArticleView.tsx` の本文の下に置く。名前は `/mentions/<記事の識別子>?name=<名前>` へのリンクにする。仕様 `web-reader` の「本文の下の抜き出した名前の表示」「抜き出した名前のない記事の表示」「抜き出した名前の安全な表示」の各場面をテストで確かめる。全文、配信された内容、訳のどれを出している間も、内容の下に出ることを確かめる
- [x] 6.2 `apps/web/src/App.tsx` に `mentions/:articleId?` のルートを、`ReaderPage.tsx` に `view="mention"` を足す。仕様 `web-reader` の「名前を押したときの一覧」「名前の記事の一覧の1行」「名前の記事の一覧で出さない操作」の各場面を、実物のAPIに対するテストで確かめる。「名前の記事の一覧をスクロールしても既読にしないこと」「名前の記事の一覧に記事がないときの表示」の各場面も確かめる。続きの読み込みと、`j` と `k` での行の移動も確かめる
- [x] 6.3 `apps/web` のテストで、仕様 `web-shell` の「名前の記事の一覧の画面のURL」「キーボードでの抜き出した名前の操作」の各場面を確かめる。`apps/web/src/shell/Shell.tsx` の `KEYS` が変わらないことも確かめる

## 7. アプリ

- [x] 7.1 `apps/mobile/src/reader/Mentions.tsx` を作り、`ArticlePage.tsx` の本文の下に置く。仕様 `mobile-reader` の「本文の画面での抜き出した名前の表示」「アプリでの抜き出した名前の安全な表示」の各場面をテストで確かめる。読み上げの名前が種類と名前になることも確かめる
- [x] 7.2 `apps/mobile/app/mention.tsx` を足す（`design.md` のとおり、`(main)` の外に置く）。一覧は、検索の結果の画面と同じ部品で出す。仕様 `mobile-reader` の「アプリで名前を押したときの一覧」「アプリの名前の記事の一覧の1行」「アプリの名前の記事の一覧で出さない操作」の各場面をテストで確かめる。「アプリの名前の記事の一覧をスクロールしても既読にしないこと」「アプリの名前の記事の一覧に記事がないときの表示」の各場面も確かめる
- [ ] 7.3 `apps/mobile` をエミュレーターで動かし、本文の画面で名前を押して一覧を開き、記事を開いてから戻る操作で元の記事へ戻れることを確かめる。読み上げで名前の種類が伝わることも確かめる

## 8. 全体の確認

- [x] 8.1 `apps/server` を作業用のディレクトリと空いているポートで起動する。プロバイダーは、記録済みの応答を返すテスト用のアダプターか `/bin/false` に向ける。Webで、名前のある生成記事と配信記事を開く。名前の記事の一覧、戻る操作、再読み込みの動きを確かめる。サーバーは起動のときに控えたPIDで止める
- [x] 8.2 `packages/core` の記録済みの応答で、本文の生成のタスクと要約のタスクの出力の長さを、変更の前後で比べる。増えた長さをPRに書く
- [x] 8.3 `make verify` を通し、`openspec validate add-mentions --strict` が通ることを確かめる
