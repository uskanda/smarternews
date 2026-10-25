# Tasks

どの作業も、失敗するテストを先に書いてから実装する。

## 1. サーバーの保存

- [x] 1.1 `packages/core` に移行を足し、`list_views` の表と一意の索引を作る。番号は、実装の時点で空いている次の番号にする。移行の前の行が変わらないことと、項目の種類と識別子の組の検査を `packages/core/src/db/database.test.ts` で確かめる
- [x] 1.2 `packages/core/src/api.ts` に、項目の鍵の解釈と、表示の設定のスキーマを足す。鍵は `listKey` と同じ文字列である。`unread` から `feed-12` までの全種類を解釈でき、`recently-read` と不正な文字列を断ることを `packages/core/src/api.test.ts` で確かめる
- [x] 1.3 `packages/core/src/db/` に表示の設定の読み出しと変更を足す。次を新しいテストファイルで確かめる。行のない項目は新しい順である。既定値に戻すと行が消える。存在しないカテゴリと購読フィードは対象なしで断る。イベントのカテゴリは不正な入力で断る
- [x] 1.4 1.3のテストファイルで、カテゴリと購読フィードの削除で行が消えることを確かめる。カテゴリの削除ではその下の「AI生成」の行も消え、カテゴリなしへ移った購読フィードの行は残ることも確かめる

## 2. 記事の一覧のAPI

- [x] 2.1 `packages/core/src/api.ts` の一覧のパラメーターに `order` を、一覧の応答に `asOf` を足す。最近読んだ記事の一覧と検索の結果の応答にも `asOf` を足す
- [x] 2.2 `packages/core/src/db/articles.ts` の `listArticles` に、古い順の並び、その続きの条件、向きを持つ続きの値を足す。`articles.test.ts` で次を確かめる。古い順に並ぶ。続報で更新した生成記事が末尾へ移る。120件が50件ずつ重複なく古い順で返る。向きのない続きの値は新しい順として読める。向きの違う値は断る
- [x] 2.3 `kind=event` と `recentlyRead=true` に `order` を付けた要求を断ることを `articles.test.ts` で確かめる
- [x] 2.4 `apps/server` に `GET /api/v1/list-views` と `PATCH /api/v1/list-views/:key` を足す。読み出し、変更、対象なしと不正な入力の応答を、新しいテストファイル `apps/server/src/list-views-api.test.ts` で確かめる
- [x] 2.5 `apps/server/src/articles.test.ts` で、古い順の最初の50件だけを読み、応答の `asOf` で一括の既読を要求すると120件が既読になることを確かめる。そのあとに作った記事が未読のままであることも確かめる
- [x] 2.6 `docs/api.md` に、`order` のパラメーター、応答の `asOf`、`list-views` の操作を足す。一括の既読の説明は、`asOf` を渡す書き方に改める

## 3. 設定ファイル

- [x] 3.1 `packages/core/src/api.ts` の設定ファイルのスキーマに `listViews` を足し、読み込みの結果に `listViewsUpdated` を足す
- [x] 3.2 `packages/core/src/settings-file.ts` の書き出しで、行のある項目だけを書く。カテゴリは識別名、購読フィードはURLで指し、既定値の設定は省く。`settings-file.test.ts` で、何も変えていないサーバーの書き出しに `listViews` がないことも確かめる
- [x] 3.3 `packages/core/src/settings-file.ts` の読み込みで、カテゴリと購読フィードを保存したあと、`listViews` を結び付けて保存する。`settings-file.test.ts` で次を確かめる。同じファイルで登録する購読フィードに結び付く。ファイルにない項目は変わらない。どこにもない対象、イベントのカテゴリ、同じ項目の2回の記載では、ファイル全体を拒否する
- [x] 3.4 `settings-file.test.ts` で、書き出したファイルを空のサーバーへ読み込み、書き出し直すと同じ内容になることを確かめる
- [x] 3.5 `docs/api.md` の設定ファイルの説明に `listViews` を足す。`examples/` に設定ファイルの例があれば、特定の利用者に依存しない値で足す

## 4. 共有の処理

- [x] 4.1 `packages/client/src/api.ts` に、表示の設定の読み出しと変更の呼び出しを足し、一覧の呼び出しが `order` を送ることを `api.test.ts` で確かめる
- [x] 4.2 `packages/client/src/nav.ts` に、項目と表示の設定の一覧から並び順を返す関数と、並び順のメニューを出すかを決める関数を足す。`nav.test.ts` で次を確かめる。イベントのカテゴリと最近読んだ記事では、新しい順でメニューを出さない。`buildNav` が作る全項目の `listKey` が、サーバーの鍵の解釈を通る
- [x] 4.3 `packages/client/src/merge.ts` の `mergeKept` に向きを足す。古い順の一覧で、読んだ記事を残した行が古い順の位置に入ることを `merge.test.ts` で確かめる

## 5. Web

- [x] 5.1 `apps/web/src/api/queries.ts` に、表示の設定の問い合わせと、すぐに書き換えて失敗したら戻す変更を足す。一覧の問い合わせの鍵に `order` を入れる
- [x] 5.2 `apps/web/src/reader/ReaderPage.tsx` の一覧のペインの上部に、並び順のメニューを置く。見た目は `DESIGN.md` の項目のメニューにそろえ、足りない値は先に `DESIGN.md` へ足して `pnpm run tokens` で反映する。次を `reader.test.tsx` で実物のAPIに対して確かめる。メニューにいまの並び順が出る。選ぶと先頭から並べ直し、本文は変わらない。キーボードだけで選べる
- [x] 5.3 `reader.test.tsx` と `search.test.tsx` で、イベントの一覧、最近読んだ記事、検索の結果でメニューを出さないことを確かめる。古い順のカテゴリを開いたまま検索した結果が新しい順であることも確かめる
- [x] 5.4 `reader.test.tsx` で、項目を開いたときに保存済みの並び順で表示することを確かめる。既読を含める切り替えで並び順が変わらないこと、`j` が次に古い記事へ進むことも確かめる
- [x] 5.5 `ReaderPage.tsx` の一括の既読の時刻を、最初のページの `asOf` に変える。古い順で50件だけ読み込んだ一覧の一括の既読で、120件が既読になることを `reader.test.tsx` で確かめる。新しい順の一括の既読の既存のテストが通ることも確かめる
- [x] 5.6 `reader.test.tsx` で、古い順の一覧の新しい記事が、60秒ごとの再取得で末尾へ現れることを確かめる。読んでいる本文と選択が変わらないことも確かめる
- [x] 5.7 `reader.test.tsx` で、並び順の保存に失敗したとき、一覧とメニューが元に戻り、失敗が知らされることを確かめる

## 6. アプリ

- [x] 6.1 `apps/mobile/src/api/queries.ts` に、表示の設定の問い合わせと変更を足し、一覧の問い合わせの鍵に `order` を入れる。前面に戻ったときの取得し直しを `list.test.tsx` で確かめる
- [x] 6.2 `apps/mobile/src/reader/ListScreen.tsx` の一覧の画面の上部に、並び順のメニューを置く。いまの並び順が出ること、選ぶと先頭から並べ直すことを `list.test.tsx` で確かめる。イベントの一覧、最近読んだ記事、検索の結果で出さないことは、`list.test.tsx` と `search.test.tsx` で確かめる
- [x] 6.3 `list.test.tsx` で、保存済みの並び順で項目を開くことと、既読を含める切り替えで並び順が変わらないことを確かめる。本文を左へ払うと次に古い記事へ移ることは `article.test.tsx` で確かめる
- [x] 6.4 `ListScreen.tsx` の一括の既読の時刻を、最初のページの `asOf` に変える。古い順で50件だけ読み込んだ一覧の一括の既読で、120件が既読になることを `actions.test.tsx` で確かめる
- [x] 6.5 `list.test.tsx` で、古い順の一覧を引いて更新すると、新しい記事が末尾へ加わり先頭が変わらないことを確かめる。保存に失敗したときは元へ戻ることも確かめる

## 7. 仕上げ

- [x] 7.1 `README.md` と `README.ja.md` の読み方の説明に、項目ごとの古い順の並びを足す
- [x] 7.2 `make verify` が通ることを確かめる
