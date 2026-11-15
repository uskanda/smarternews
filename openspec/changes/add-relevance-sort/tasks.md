# Tasks

## 1. 保存の形

- [x] 1.1 移行033で、`articles` と `feeds` に関連度の列と索引を足し、`list_views` を作り直して `relevance` を許す。移行の前からある行が残り、`rank_at` が入ることを `database.test.ts` で確かめる

## 2. 関連度の計算

- [x] 2.1 行動の値を求めて購読フィードと記事に保存する関数を `db/relevance.ts` に足す。最大を1とする比べ方、10件未満のフィードの平均、記録がないときの0、隠した記事を数えないことを `relevance.test.ts` で確かめる
- [x] 2.2 語の一致を照合し直す関数を `db/term-matches.ts` に足す。NFKCと小文字の正規化、翻訳した見出しと要約での一致、全記事の照合し直しを `term-matches.test.ts` で確かめる
- [x] 2.3 配信記事の保存、見出しの書き換え、翻訳した見出しの保存、色付けの語とまとまりの追加と削除、購読フィードの登録から、2.1と2.2の関数を呼ぶ。それぞれの時点で値が入ることをテストで確かめる
- [x] 2.4 スケジューラーが起動直後と24時間ごとに行動の値と語の一致を計算し直すようにし、`scheduler` のテストで確かめる

## 3. 一覧のAPI

- [x] 3.1 `listSortSchema` に `relevance` を足し、一覧の要約に `rankAt` を足す。`listArticles` で関連度順に並べ、続きの値に向きを入れる。並びと続きの取得、断る要求を、coreとserverの `articles.test.ts` で確かめる
- [x] 3.2 表示の設定と設定ファイルで `relevance` を保存し、読み書きできることを `list-views-api.test.ts` と `settings-file.test.ts` で確かめる
- [x] 3.3 `docs/api.md`、`README.md`、`README.ja.md` の並び順の説明に関連度順を足す

## 4. Webとアプリ

- [x] 4.1 関連度順のとき、`mergeKept` は `rankAt` の順に並べ直し、`targetFilter` は `order=relevance` を付ける。`merge.test.ts` と `nav.test.ts` で確かめる
- [x] 4.2 Webの `SortMenu` に「関連度順」を足し、選ぶと関連度順で取得し直すことをWebのテストで確かめる
- [x] 4.3 アプリの並び順のメニューに「関連度順」を足し、アプリのテストで確かめる

## 5. 仕上げ

- [x] 5.1 `make verify` を通し、`openspec validate add-relevance-sort --strict` を通す
