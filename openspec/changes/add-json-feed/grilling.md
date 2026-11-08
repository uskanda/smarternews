# grilling 記録: add-json-feed

GitHubのissueの135番のコメントで、1ラウンドの質問（Q1〜Q5）に答えた記録である。
issueは、JSON Feedを読めず、フィードの発見がページのlinkの要素の3つの型しか見ないという、Web UIの監査の項目（R-15）である。
JSON Feedしか出さないサイトはWebページとしての購読になり、条件付きの要求を使えない。

## 決定

| 決定 | 選択 | 出典 |
|---|---|---|
| JSON Feedを読む範囲 | 購読フィード（`parseSubscription`）とトピックのフィード（`parseFeed`）の両方で読む。判定の処理は1か所にまとめる（A） | 第1ラウンド Q1 |
| 読むJSON Feedの版 | 1.1と1.0の両方を読む。`version` が `https://jsonfeed.org/version/` で始まる文書をJSON Feedとみなす（A） | 第1ラウンド Q2 |
| ページのlinkの要素で認める型 | `application/feed+json` だけを足す。`application/json` は足さない（A） | 第1ラウンド Q3 |
| linkの要素がないときに試す場所 | オリジンの直下の `/feed`、`/rss.xml`、`/feed.xml`、`/atom.xml`、`/index.xml`、`/feed.json` の6か所を、この順に試す。フィードとして読めた最初の1件を、転送の後のURLとフィードのタイトルを付けて返す。404、HTMLのページ、読めない文書は黙って次へ進む（A） | 第1ラウンド Q4 |
| 追加の画面の案内文 | `サイトのURLを入れると、そのページが案内しているフィードと、よくある場所のフィードを探します。` に変える（A） | 第1ラウンド Q5 |

## 計画で決めたこと

承認を求めた計画（issueのコメント）で、次を決めた。利用者は変更なしで承認した。

| 決定 | 選択 |
|---|---|
| JSON Feedの判定 | 本文の先頭の空白を除いた文字が `{` で、JSONとして読め、`version` が上の条件に合うとき |
| 項目の読み方 | title は `title`。url は `url`、なければ `external_url`。公開日時は `date_published`、なければ `date_modified`。抜粋は `summary`、`content_text`、`content_html` をプレーンテキストにしたものの順。識別子は `id` を文字列にしたもの。著者は `authors` の先頭の `name`、なければ1.0の `author` の `name`。本文は `content_html`、なければ `content_text` の特殊文字を文字参照に置き換え、段落に分けたHTML。サイトのURLは `home_page_url` がhttp(s)のときだけ |
| 読めない文書 | いまと同じ「the document is not a feed」のエラーにする |
| Acceptの見出し | フィードの取得のAcceptの見出しに `application/feed+json` を足す |
| どこにもないとき | 空を返す。画面はいまと同じく「Webページとして購読」の案内を出す |
| LLM | どの処理もLLMを呼ばない |

## 後回しにしたもの

- `/blog/` のようにパスの下に置いたサイトのための、その下の場所の試行（Q4のB）
- `application/json` の型のlinkの要素（Q3のB）

## 状態

frontierは空。共有理解に到達した。利用者はQ1〜Q5に答え、続く計画を2026-11-07に承認した。
