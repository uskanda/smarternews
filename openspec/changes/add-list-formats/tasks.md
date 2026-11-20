# Tasks

## 1. 保存とAPI

- [x] 1.1 `045_list_formats.sql` で `list_views` に `format` 列を足す。既存の行が `standard` のまま残り、知らない値を拒むことを `database.test.ts` で確かめる
- [x] 1.2 `api.ts` に `listFormatSchema` を足し、表示の設定、部分更新、設定ファイルの項目に `format` を足す。`list-views.ts` で、渡されなかった値を残し、両方が既定に戻った行だけを消す。`list-views.test.ts` で確かめる
- [x] 1.3 `settings-file.ts` で `format` を書き出しと読み込みに足す。既定を書かないこと、古いファイルで形式が残ること、知らない形式を拒むこと、往復を `settings-file.test.ts` で確かめる
- [x] 1.4 `PATCH /list-views/:key` が `{ format }` を受け、並び順を残すことを `list-views-api.test.ts` で確かめる。知らない形式と、表示の設定を持たない項目を拒むことも確かめる。clientの `api.test.ts` も直す
- [x] 1.5 `docs/api.md` と `examples/settings.example.yaml` に `format` を書く

## 2. 画面への先行の反映

- [x] 2.1 `listFormatOf`、`FORMAT_OPTIONS`、`FORMAT_LABELS`、`withViewChange` をclientに足し、`nav.test.ts` で確かめる
- [x] 2.2 `useListSortChange`（Web）を `useListViewChange` に広げ、アプリの `useListSortChange` も `withViewChange` を使う。アプリで並び順を変えても形式が残ることを `list.test.tsx` で確かめる

## 3. 形式のメニューとタイトルのみ

- [x] 3.1 `SortMenu` の作りを `ChoiceMenu` に移し、並び順の隣に `FormatMenu` を置く。選んだ形式の保存と、失敗したときに戻ること、メニューを出さない一覧を `formats.test.tsx` で確かめる
- [x] 3.2 `ArticleRow` に1段の行を足す。出すものと出さないもの、行を押すと本文のペインに開くことを `formats.test.tsx` で確かめる

## 4. 展開

- [x] 4.1 `ExpandedArticle` で記事を並べ、本文のペインを閉じる。表示範囲に入るまで記事を取得せず、入ったら本文を出して開いた記録を送ることを `formats.test.tsx` で確かめる
- [x] 4.2 `useArticleList` に1ページの件数を渡し、展開の形式では10件ずつ読み込む。末尾に近づくと続きを読み込むことを `formats.test.tsx` で確かめる
- [x] 4.3 `formats.test.tsx` で、展開の形式の操作を確かめる。対象の記事、`j`・`k`・`Space`・`Shift+Space`、`s`・`m`、見出しを押したときの既読、スクロールで既読にする設定、パスで指定した記事の表示である
- [x] 4.4 `README.md`、`README.ja.md`、`DESIGN.md` に3つの形式を書く

## 5. 仕上げ

- [x] 5.1 `make verify` の検査を通し、`openspec validate add-list-formats --strict` を通す。Webを起動して3つの形式を目で確かめる
