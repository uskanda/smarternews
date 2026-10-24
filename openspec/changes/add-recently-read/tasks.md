# Tasks

どの作業も、失敗するテストを先に書いてから実装する。

## 1. サーバー

- [x] 1.1 `packages/core` に移行を足し、記事の表に `read_at` の列と部分索引を足す。番号は空いている次の番号にする。移行の前から既読の行は空のままであることを、`packages/core/src/db/database.test.ts` で確かめる
- [x] 1.2 `packages/core/src/db/articles.ts` で `read_at` を書く。対象は `setArticleFlags`、`markArticlesRead`、`markArticlesUnread`、`reviseArticle` の4つである。`articles.test.ts` で次を確かめる。未読から既読で時刻が入る。既読の記事への既読の変更では時刻が変わらない。未読に戻すと消え、続報でも消える
- [x] 1.3 `packages/core/src/api.ts` の記事の要約に `readAt` を、一覧のパラメーターに `recentlyRead` を足す。`listArticles` に、7日以内の条件、既読の時刻の順、その時刻による続きの値を足す。終了したイベントを含めることと、ほかの絞り込みとの組み合わせを断ることも足す。どれも `articles.test.ts` で確かめる
- [x] 1.4 `apps/server` の既読の変更と一括の既読の呼び出しで、`clock()` の時刻を渡す。既読の変更、一括の既読、取り消しのあとの `readAt` と、`recentlyRead=true` の一覧を `apps/server/src/articles.test.ts` で確かめる
- [x] 1.5 `docs/api.md` に、`recentlyRead` のパラメーターと、応答の `readAt` を足す

## 2. 共有の処理

- [x] 2.1 `packages/client/src/nav.ts` の `ListTarget` に最近読んだ記事を足し、`buildNav` の `views` の「AI生成」のあとに「最近読んだ記事」を置く。`nav.test.ts` で次を確かめる。`listKey` と `parseListKey` は `recently-read` を扱う。`targetFilter` は `recentlyRead` を返す。`hasReadToggle` は偽を返す
- [x] 2.2 `packages/client` に、一括の既読と重要度4以上の切り替えを出すかどうかを項目から決める関数を足し、最近読んだ記事で偽になることを `nav.test.ts` で確かめる
- [x] 2.3 `packages/client/src/merge.ts` の `mergeKept` に並びの鍵を渡せるようにする。既読の時刻で並べたとき、未読に戻した残す行が元の位置に入ることを `merge.test.ts` で確かめる
- [x] 2.4 `packages/client/src/api.ts` の一覧の呼び出しが `recentlyRead` を送ることを `api.test.ts` で確かめる

## 3. Web

- [x] 3.1 Webの左のペイン（`apps/web/src/shell/Shell.tsx`）に「最近読んだ記事」を数字なしで出し、`/recently-read` で開く。並び順と、ドラッグで動かないことを `shell.test.tsx` と `order.test.tsx` で確かめる
- [x] 3.2 Webの一覧の画面（`apps/web/src/reader/ReaderPage.tsx`）で、最近読んだ記事の一覧を表示し、一括の既読、既読を含める切り替え、重要度4以上の切り替えを出さない。記事がないときの表示と「未読」を開く操作を足す。`reader.test.tsx` で、実物のAPIに対して確かめる
- [x] 3.3 `apps/web/src/reader/ArticleRow.tsx` に、出す時刻の種類を渡せるようにし、最近読んだ記事の一覧で既読の時刻を出す。生成記事と配信記事の行の両方を `reader.test.tsx` で確かめる
- [x] 3.4 `reader.test.tsx` で、最近読んだ記事の一覧で未読に戻した行について次を確かめる。未読の見た目で残る。60秒ごとの再取得でも残る。更新のあとは消える
- [x] 3.5 `reader.test.tsx` で、ブラウザーを再読み込みしても、最近読んだ記事の一覧と開いていた記事が表示し直されることを確かめる

## 4. アプリ

- [x] 4.1 `apps/mobile/src/shell/DrawerContent.tsx` の引き出しに「最近読んだ記事」を数字なしで出す。並び順と、長押しでドラッグが始まらないことを `shell.test.tsx` と `order.test.tsx` で確かめる
- [x] 4.2 `apps/mobile/src/reader/useReaderList.ts` と `ListScreen.tsx` で、最近読んだ記事の一覧を表示する。この一覧では、一括の既読、既読を含める切り替え、重要度4以上の切り替えを出さない。記事がないときの表示と「未読」を開く操作を足し、`list.test.tsx` で確かめる
- [x] 4.3 `apps/mobile/src/reader/ArticleRow.tsx` で、最近読んだ記事の一覧だけ既読の時刻を出すことを `list.test.tsx` で確かめる
- [x] 4.4 `actions.test.tsx` で、行を払う操作、長押しの操作、本文の画面のどれを使って未読に戻しても、行が未読の表示で残ることを確かめる。引いて更新すると消えることも確かめる

## 5. 確認

- [x] 5.1 Webで一括の既読をしてから「最近読んだ記事」を開き、記事ごとに未読へ戻せることを確かめる。サーバーは、作業用のデータと空いたポートを使って起動する。サーバーは起動のときに控えたPIDで止める
- [x] 5.2 `make verify` を通し、`openspec validate add-recently-read --strict` が通ることを確かめる
