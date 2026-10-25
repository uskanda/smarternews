# Design

## Context

動機は `proposal.md` の「Why」を見よ。ここでは、設計を決める今の作りだけを書く。

- タスクの定義は `packages/core/src/llm/tasks.ts` にある。各タスクは、zodの出力のスキーマ `output` と、プロンプトを作る `build` を持つ。本文の生成のタスクは `write`、要約のタスクは `summarize` である。
- `packages/core/src/llm/runner.ts` の `run` は、`output` から作ったJSON Schemaをプロバイダーへ渡す。応答は `output.safeParse` で検証する。合わなければ1回だけやり直し、2回とも合わなければ `TaskFailedError` を投げる。`claude` コマンドのアダプターは `--json-schema` でスキーマを渡す。OpenAI互換HTTPのアダプターは、`response_format` の `strict: true` で渡すか、システムの指示に書く。
- 生成記事は `packages/core/src/pipeline/run.ts` の `writeStories` が、`write` の出力から保存する。新しい記事は `insertArticle`、続報による書き直しは `reviseArticle` で、どちらも1つのトランザクションの中で呼ぶ。`reviseArticle` は同じ記事の行を書き換える。イベントの欄は、新しい値がないときに前の値を残す（`coalesce`）。
- 配信記事の要約は `packages/core/src/feeds/summarize.ts` の `summarizeNext` が1件ずつ作り、`saveAutoSummary` で保存する。開いた記事の要約の依頼も、同じ処理を通る。
- 生成記事と配信記事は、どちらも `articles` の表に入っている。記事の一覧と検索は、`packages/core/src/db/articles.ts` の `pageArticles` で並びと続きの値を作る。フィルターで隠れているかは `hiddenByFilters(alias)`、重複として隠れているかは `hiddenDuplicate(alias)` が決める。検索（`searchArticles`）は、購読フィードを指定しないとき、この2つで記事を除く。
- 記事に付く表（例：`annotations`）は、`articles(id)` を `ON DELETE CASCADE` で参照し、記事とともに消える。データベースは `PRAGMA foreign_keys = ON` で開く。
- 照合のための正規化は、`packages/core/src/search/text.ts` の `normalizeForMatch`（NFKCと小文字化）である。検索とフィルターの「含む」がこれを使う。
- Webの一覧のルートは `apps/web/src/App.tsx` にある。検索の結果は `search/:articleId?` に `?q=` を付けたURLで、`ReaderPage` の `view="search"` が描く。アプリは、検索の結果を `apps/mobile/app/(main)/search.tsx`、本文を `apps/mobile/app/article/[id].tsx` で描く。
- 移行は001から017まである。古い移行は書き換えない。

## Goals / Non-Goals

**Goals:**

- 抜き出した名前の検証を、タスクの本体の検証から切り離す。名前の誤りで、やり直しの呼び出しを増やさず、記事と要約を失わない。
- 名前の記事の一覧に、検索の結果と同じ見える条件と並びを使う。隠した配信記事と重複の扱いを、ほかの一覧とずらさない。
- 抜き出した名前を、記事の保存、書き直し、要約の保存と同じトランザクションで書く。

**Non-Goals:**

- 名前を登録して追う機能と、タグの提案（grillingで後回し）。
- 機能を入れる前の記事からの抽出（round 1 Q6）。移行は空の表を作るだけにする。
- 検索の索引に抜き出した名前を入れること（round 2 Q8）。
- RSSに抜き出した名前を載せること。RSSには自前の要約と出典リンクだけを載せる規則があり、決定にも含まれない。
- 設定ファイルの書き出しと読み込みに抜き出した名前を含めること。抜き出した名前は記事の一部である。
- 名前の記事の一覧のためのキー。本文の下の名前はリンクにし、`Tab` と `Enter` で操作する。
- 名前の記事の一覧での絞り込み（カテゴリ、購読フィード、未読だけ）。決定は「既読を含め、新しい順」だけである。

## Decisions

### 抜き出した名前は、タスクの本体と別に検証する

`write` と `summarize` の出力に `mentions` の項目を足す。項目の形は、`{ name: string, kind: "person" | "organization" | "product" | "place" }` の一覧である。

検証は2段に分ける。

1. 本体の検証：`output` のzodのスキーマでは、`mentions` を、何でも受ける任意の項目（zodの `unknown`）にする。やり直すかどうかは、この結果だけで決める（仕様 `llm-tasks` の「出力の検証」）。
2. 名前の検証：本体が通った出力の `mentions` を、`packages/core/src/mentions.ts` に置く純粋な関数 `parseMentions(raw)` で検証する。結果は、正しい名前の一覧か、不正を表す `null` である。

`parseMentions` の規則は次のとおりである。

- 一覧でない、名前か種類のない項目がある、名前を前後の空白を除いて空か100文字を超える、種類が4つのどれでもない。このどれかに当たれば、一覧全体を `null` にする（仕様 `llm-tasks` の「抜き出した名前だけが不正な出力」）。
- 名前は前後の空白を除いて保存する。
- 正規化した名前が同じ項目は、最初の1件だけを残す。
- 残った項目のうち、先頭の10件だけを返す（round 4 Q5、仕様 `llm-tasks` の「抜き出した名前の件数」）。

ランナーは、`write` と `summarize` の出力に、`parseMentions` の結果を `mentions: Mention[] | null` として付けて返す。
本体のやり直しで2回目の出力を採用したときは、2回目の出力の名前を使う。

次の案は採らない。

- `output` の中で `mentions` を厳密に検証する。名前の誤りで本体ごとやり直しになり、呼び出しが増える。決定（round 1 Q2、round 2 Q5）に反する。
- 項目ごとに不正なものだけを捨てる。決定は「名前の一覧だけを捨てる」で、項目の選別は決めていない。不正な項目があるときは、ほかの項目も信用しにくい。
- 10件を超えた出力を不正とする。プロンプトで10件までと指示しても、超えることはある。超えた分を捨てれば、決定の「10件まで」を守ったまま名前を失わない。

### プロバイダーへ渡すスキーマには、名前の形を載せる

`output` の `mentions` を何でも受ける項目にすると、プロバイダーへ渡すJSON Schemaから名前の形が消え、モデルへの手がかりがなくなる。そこで `TaskDefinition` に、プロバイダーへ渡すためだけのスキーマ `wire` を任意で足す。`wire` があるタスクでは、ランナーは `wire` からJSON Schemaを作り、検証には `output` を使う。

`wire` の `mentions` は、名前の文字列と種類の列挙の一覧で、必須の項目にする。件数と文字数の上限は `wire` に書かない。OpenAI互換HTTPの `strict: true` は件数の上限を扱えないことがあり、`claude` コマンドがスキーマに合わない応答を失敗として返すと、本体ごとやり直しになるためである。件数はプロンプトで指示し、`parseMentions` で切る。

プロンプトには、次を足す。

- 書いた記事（要約のタスクでは入力の記事）に出てくる、人、組織、製品、地名の名前を、重要なものから10件まで挙げる。
- 名前は正式な書き方で、出力言語で書く。出力言語での決まった書き方がなければ原語のまま書く。略称と愛称は正式な名前に直す。
- 出てこなければ空の一覧にする。

### 抜き出した名前は、記事に付く1つの表に置く

新しい移行（`<018_mentions.sql>`。番号は、実装の時点で取り込み済みの最後の移行の次に付け直す）で、表 `article_mentions` を足す。

| 列 | 内容 |
|---|---|
| `article_id` | `articles` の識別子。記事の削除に連動して消える（`ON DELETE CASCADE`） |
| `position` | 出力の順。0から9 |
| `name` | 表示する名前。出力の名前の前後の空白を除いたもの |
| `name_key` | 正規化した名前。同じ名前の判定と、名前の記事の一覧の照らし合わせに使う |
| `kind` | `person`、`organization`、`product`、`place` のいずれか（`CHECK`） |

主キーは `(article_id, position)` とし、`(article_id, name_key)` を一意にする。名前の記事の一覧のために、`(name_key, article_id)` の索引を置く。

正規化は `packages/core/src/mentions.ts` の `mentionKey(name)` に置く。`normalizeForMatch` のあとで前後の空白を除き、続いた空白を1つにする（仕様 `mentions` の「同じ名前の判定」）。検索とフィルターと同じ `normalizeForMatch` を使うのは、大文字と小文字、全角と半角の扱いを、利用者から見て1つにするためである。

`articles` の表に名前をJSONの列で持つ案は採らない。名前の記事の一覧は「この名前を持つ記事」を引く問い合わせで、JSONの列では索引を使えない。

種類は `name_key` に含めない。同じ名前が記事によって別の種類で抜き出されても、同じ名前の記事の一覧に入れる（round 4 Q6、仕様 `mentions` の「同じ名前の判定」）。決定（round 1 Q3）は、名前の文字列だけを照らし合わせて同じ名前とみなす。種類は、本文の下で分けて並べるために使う。

### 保存は、記事と要約と同じトランザクションで行う

`packages/core/src/db/mentions.ts` に、`replaceMentions(db, articleId, mentions)` を置く。記事の行の名前を消してから、新しい名前を入れる。

- 新しい生成記事：`writeStories` のトランザクションの中で、`insertArticle` のあとに呼ぶ。`mentions` が `null` のときは呼ばない。
- 続報による書き直し：同じトランザクションの中で、`reviseArticle` のあとに呼ぶ。`mentions` が `null` のときは呼ばず、前の名前を残す（round 4 Q4、仕様 `mentions` の「書き直しで名前が不正なときの保持」）。空の一覧のときは呼び、名前をすべて消す。同じイベントを別の見出しで見つけて書き直すときも、同じ扱いにする。前の名前を残すのは、書き直した本文も前の事実を含み、前の名前が多くの場合そのまま当てはまるからである。イベントの欄で、新しい値がないときに前の値を残すのと同じ扱いである。
- 配信記事の要約：`saveAutoSummary` と `replaceMentions` を1つのトランザクションにまとめる。`mentions` が `null` のときは、要約だけを保存する。

配信記事の書き換えの処理（`packages/core/src/feeds/ingest.ts`）は、抜き出した名前に触れない。要約を保つのと同じく、名前も保たれる。

### 名前の記事の一覧は、検索と同じ見える条件と並びで引く

`packages/core/src/db/mentions.ts` に `listMentionArticles(db, query, now)` を置く。条件は次のとおりで、並びと続きの値は `pageArticles` に任せる。

```sql
a.id IN (SELECT article_id FROM article_mentions WHERE name_key = ?)
AND NOT hiddenByFilters(a) AND NOT hiddenDuplicate(a)
```

生成記事と配信記事の両方を対象にするので、由来の条件は付けない。終了したイベントも除かない。

検索と同じ条件にするのは、名前の記事の一覧が検索と同じく「記事全体から探す」一覧だからである（round 4 Q7）。仕様は `mentions` の「名前の記事の一覧での隠した配信記事の除外」「名前の記事の一覧での隠した重複の除外」である。スターのある配信記事と注釈のある配信記事は、`hiddenByFilters` が隠さないので、この一覧にも出る。

- フィルターで隠した配信記事を出すと、利用者が隠すと決めた記事が、名前をたどったときだけ現れる。
- 重複を出すと、同じ記事が2行並ぶ。ただし重複は要約を待たない。名前を持つ重複は、重複と記録される前に要約された記事だけである。

保存期間で記事が消えると、名前も連動して消える。一覧に、消えた記事は現れない。名前があることで記事を残すことはしない。名前はLLMが付けたもので、利用者が残すと決めた印ではないからである。

### API

| 方法 | パス | 内容 |
|---|---|---|
| `GET` | `/api/v1/articles/:id` | 応答に `mentions`（`{ name, kind }` の一覧、保存した順）を足す |
| `GET` | `/api/v1/mentions/articles?name=…&limit=…&cursor=…` | 名前の記事の一覧。応答の形は記事の一覧と同じ |

`name` は、前後の空白を除いて空のとき、または正規化したあとで100文字を超えるときに400で拒否する（仕様 `http-api` の「名前の入力の拒否」）。上限は `parseMentions` の名前の上限と同じにする。どの記事にもない名前は、空の一覧を返す。

記事の一覧の行（`articleSummarySchema`）には、名前を足さない。一覧の応答が大きくなり、行に名前を出す決定もない。

### Webは、検索と同じ形のURLで一覧を出す

`apps/web/src/App.tsx` に、`mentions/:articleId?` のルートを足し、名前は `?name=` で持つ。`ReaderPage` に `view="mention"` を足す。

- 本文の下の名前は、`/mentions/<今の記事の識別子>?name=<名前>` へのリンクにする。押すと中央のペインが名前の記事の一覧になり、本文のペインには元の記事が残る。ブラウザーの戻る操作で、元の一覧とURLに戻る（仕様 `web-shell` の「名前の記事の一覧の画面のURL」）。
- リンクにするので、`Tab` で止まり、`Enter` で開く。新しいキーは足さないので、`apps/web/src/shell/Shell.tsx` の `KEYS` は変えない。
- 一覧の上部には名前を出す。一括の既読、既読を含める切り替え、重要度4以上の切り替え、並び順のメニューは出さない。`ReaderPage.tsx` が検索の結果でこれらを出さない判定（`isSearch` など）に、`mention` を足す。スクロールで既読にする処理も、検索の結果と同じく止める。
- 本文の下の区画は、`apps/web/src/reader/Mentions.tsx` に置く。種類の見出しは「人」「組織」「製品」「地名」とし、この順で並べる。名前は `Markdown` を通さず、Reactの文字として描く。

種類ごとに分ける処理は、Webとアプリで同じにするため、`packages/client/src/mentions.ts` の `groupMentions(mentions)` に置く。

名前の見た目は、`DESIGN.md` に部品 `mention-link` を足して決める。語の色付けの `term-badge` と見分けられる形にし、色付けの色は使わない。値を足したあとで `pnpm run tokens` でCSSに反映する。

### アプリは、名前の記事の一覧の画面を足す

`apps/mobile/app/(main)/mention.tsx` を足し、名前を検索の結果の画面と同じ形の引数で受ける。本文の画面の名前を押すと、この画面を重ねて開く。端末の戻る操作で本文の画面に戻る。

一覧の行と続きの読み込みは、検索の結果の画面と同じ部品（`ListScreen.tsx`、`useReaderList.ts`）を使う。本文の画面の区画は `apps/mobile/src/reader/Mentions.tsx` に置き、名前を `Text` で描く。読み上げの名前は「組織、日本銀行」のように種類と名前にする。

## Risks / Trade-offs

- 出力が長くなり、呼び出しの時間が延びる → 名前は10件までで、1件は短い。本文の生成のタスクと要約のタスクの時間を、変更の前後で記録済みの応答の長さから見積もり、PRに書く。呼び出しの時間の上限に近づくようなら、上限の値を見直す。
- `claude` コマンドが、`wire` のスキーマに合わない応答を失敗として返す → `wire` の `mentions` には件数と文字数の上限を書かない。種類の列挙だけが残る。種類の誤りで失敗が増えるかを、実行履歴の失敗の理由で見る。増えるときは、`wire` の種類を文字列にし、`parseMentions` だけで検証する。
- LLMが、同じ組織を記事によって日本銀行と日銀のように書き分ける → 決定どおり、プログラムは完全一致だけを見る。プロンプトで正式な名前に直すよう指示する。揺れの多い名前は、利用者が別の名前を押して探す。
- 同じ名前の別の対象（同名の人など）が、1つの一覧に混ざる → 決定は完全一致であり、区別しない。種類は一覧の照らし合わせに使わないので、同名の企業と製品も混ざる。
- 名前に、取得したページの文字列が入る → 名前は外部の内容を読んだLLMの出力である。Webとアプリは文字として描き、リンクの宛先は自前のURLだけにする。名前は100文字までに切る。

## Migration Plan

1. 移行で `article_mentions` を作る。既存の記事は名前を持たないまま残る。LLMは呼ばない。
2. 新しい版のサーバーが記事を書き、要約を保存すると、その記事から名前を持つ。続報で書き直された古い生成記事も、そのときに名前を持つ。
3. 戻すときは、前の版のサーバーを動かす。前の版は `article_mentions` を読まないので、表が残っても動く。

