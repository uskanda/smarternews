# Tasks

どの作業も、失敗するテストを先に書いてから実装する。テストは実際のLLMと外部サイトを呼ばず、記録済みの応答で動かす。

## 1. データベースと全体設定

- [x] 1.1 `packages/core` に、次の空いている番号の移行を足す。足すのは3つの列と1つの索引である。列は、購読フィードの表の `last_new_item_at`、記事の表の `opened_at`、全体設定の表の `stale_feed_days`（既定60）である。索引は `(feed_id, created_at)` の部分索引である。`packages/core/src/db/database.test.ts` で次を確かめる。登録済みの購読フィードには、配信記事の保存の時刻の最大値が入る。配信記事のない購読フィードは値なしのままである。既読の記事の開いた時刻も値なしのままである
- [x] 1.2 `packages/core/src/api.ts` の全体設定に `staleFeedDays` を足し、1から365の整数だけを受け付ける。`packages/core/src/db/settings.ts` で読み書きする。既定値60、再起動のあとの保持、0と30.5の拒否を `settings.test.ts` で確かめる
- [x] 1.3 `packages/core/src/settings-file.test.ts` で、設定ファイルの書き出しに日数が入ることと、日数のないファイルの読み込みが保存済みの値を変えないことを確かめる
- [x] 1.4 `docs/api.md` の全体設定の表に `staleFeedDays` を足す

## 2. 新しい項目と更新の止まった判定

- [x] 2.1 `packages/core/src/feeds/ingest.ts` の `storeItems` に、新しい項目の判定を足す。`seenBefore` と保存済みの記事のどちらにもない識別子があれば、`last_new_item_at` へ取得の時刻を書く。`ingest.test.ts` で次を確かめる。新しい項目で時刻が変わる。公開日時が2年前の項目でも変わる。重複として記録される項目でも変わる。登録のときに時刻が入る。書き換えられた項目、削除した記事の項目、変更のない応答では変わらない
- [x] 2.2 `packages/core/src/db/feeds.ts` の購読フィードの型に、`stale`、`lastNewItemAt`、`recentArticleCount` を足す。`listFeeds` と `findFeed` がこれらを返す。`stale` は2つの条件で決める。有効であることと、`coalesce(last_new_item_at, created_at)` から日数が過ぎたことである。`feeds.test.ts` で、仕様の判定の場面をすべて確かめる。場面は、61日と59日、日数を90日にした場合、項目のないフィード、失敗し続けるもの、無効なものである
- [x] 2.3 `packages/core/src/feeds/poller.test.ts` で、更新の止まった購読フィードが有効のまま取得され続けることを確かめる
- [x] 2.4 `GET /api/v1/feeds` の応答に3つの項目が入ることを、`apps/server/src/feeds-api.test.ts` で確かめる。`docs/api.md` の購読フィードの項目に足す

## 3. 開いた時刻

- [x] 3.1 `packages/core/src/db/articles.ts` に、開いた時刻を初めの1回だけ書く関数を足す。生成記事と配信記事、2回目の記録、既読の状態が変わらないことを `articles.test.ts` で確かめる
- [x] 3.2 `articles.test.ts` で、既読と未読を変える処理が `opened_at` に触れないことを確かめる。対象は、既読の変更、一括の既読、重複の既読の連動、未読に戻す操作、続報での書き換えである
- [x] 3.3 `packages/core/src/api.ts` の記事の一覧と詳細の各記事に `openedAt` を足す。`apps/server` に `POST /api/v1/articles/:id/open` を足し、応答で開いた時刻を返す。存在しない記事で対象が存在しないことを返すことも含め、`apps/server/src/articles.test.ts` で確かめる
- [x] 3.4 `docs/api.md` に、操作と応答の `openedAt` を足す。更新の前の記事は開いた時刻を持たないことも書く

## 4. 購読フィードの統計

- [x] 4.1 `packages/core/src/db/feeds.ts` に、直近30日の統計を数える関数を足す。問い合わせには由来の条件（`origin = 'feed'`）を付ける。一覧の `recentArticleCount` も同じ関数の条件から数える。`feeds.test.ts` で次を確かめる。届いた数、開いた数、スターの数を数える。31日前の記事を数えない。スターのある記事はフィルターの数に入れない。フィルターを削除すると数が0に戻る。重複の除去を無効にすると重複の数が0になる。両方で隠れる記事は両方に数える
- [x] 4.2 `apps/server` に `GET /api/v1/feeds/:id/stats` を足す。応答の形と、存在しない購読フィードで対象が存在しないことを返すことを、`apps/server/src/feeds-api.test.ts` で確かめる。統計の要求でLLMのアダプターが呼ばれないことも確かめる
- [x] 4.3 `docs/api.md` に統計の操作と各項目の意味を書く。フィルターの数は、いまのフィルターでの数であることも書く

## 5. 共有の処理

- [x] 5.1 `packages/client/src/api.ts` に、記事を開いたことを記録する呼び出しと、購読フィードの統計の呼び出しを足す。送る要求の形を `api.test.ts` で確かめる

## 6. Webの本文のペイン

- [x] 6.1 `apps/web/src/reader/ReaderPage.tsx` の開いた記事を既読にする処理で、`openedAt` が空なら記録の呼び出しを送る。送ったあと、取得済みの記事の `openedAt` を書き換える。`reader.test.tsx` で、実物のAPIに対して次を確かめる。一覧で選ぶと記録される。`j` で移ると記録される。最近読んだ記事の一覧から開くと記録される。一括の既読では記録されない。同じ記事を開き直しても要求は1回である
- [x] 6.2 `reader.test.tsx` で、記録の要求が失敗したときの表示を確かめる。本文が表示され、既読になり、誤りの表示は出ない

## 7. Webの設定

- [x] 7.1 `apps/web/src/settings/FeedsPage.tsx` の `FetchState` に、更新が止まっていることの言葉の印を足す。行に、直近30日の件数と、最後に新しい項目が現れた日時を足す。新しい項目がまだないときの言葉も足す。無効な購読フィードに印が出ないこと、行に開いた数とスターの数が出ないことを含め、`feeds-settings.test.tsx` で確かめる。色を足すときは、先に `DESIGN.md` へ足し、`pnpm run tokens` で反映する
- [x] 7.2 `FeedsPage.tsx` の購読フィードの一覧の上に、問題のある購読フィードを先頭へ並べる切り替えを足す。更新の止まった購読フィードと失敗している購読フィードを、左のペインの並びを保ったまま先頭へ移す。切り替えの状態は画面の中だけに持ち、ブラウザーには覚えさせない。入れたときと切ったときの並び、画面を開き直すと切れた状態に戻ること、左のペインの並びが変わらないことを `feeds-settings.test.tsx` で確かめる
- [x] 7.3 `EditFeed` に、直近30日の統計の区画を足す。5つの数、開いた数とスターの数の隣の整数の割合、最後に新しい項目が現れた日時を出す。届いた記事が0のときは、割合の代わりに届いた記事がないことを出す。いま取得したあとに数が新しくなることを含め、`feeds-settings.test.tsx` で確かめる
- [x] 7.4 `apps/web/src/settings/SettingsPage.tsx` に、更新が止まったとみなす日数の入力欄を足す。既定の表示60、保存したあとに一覧の印が変わること、範囲の外の値で入力欄の近くに誤りが出ることを `settings.test.tsx` で確かめる

## 8. アプリ

- [x] 8.1 `apps/mobile/src/reader/ArticleScreen.tsx` で、表示中の記事（`currentId`）が変わり、その記事の `openedAt` が空なら記録の呼び出しを送る。先に読み込んだ隣の記事では送らない。行を押したとき、本文を払って移ったとき、通知から開いたときに記録されることを `article.test.tsx` で確かめる
- [x] 8.2 `actions.test.tsx` と `list.test.tsx` で、行を払って既読にしたとき、長押しの操作で既読にしたとき、一括の既読のときに記録されないことを確かめる。記録の要求が失敗しても誤りが出ないことを `article.test.tsx` で確かめる

## 9. 全体の確認

- [x] 9.1 `make verify` が通ることを確かめる
- [x] 9.2 `apps/server` の確認用のサーバーを、作業用の設定とデータのディレクトリを使い、空いているポートで起動する。プロバイダーは `/bin/false` に向ける。購読フィードの一覧の印、並べ替え、統計の区画、開いた記事の数の増え方を画面で確かめる。確かめたあと、起動のときに控えたPIDでサーバーを止める
