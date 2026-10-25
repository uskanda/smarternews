# Tasks

どの作業も、失敗するテストを先に書いてから実装する。

## 1. サーバー

- [x] 1.1 `packages/core/src/api.ts` に、識別子と `updatedAt` の組を1件以上500件以下で並べる本文の型を足す。`POST /articles/mark-read` の本文は、今の範囲の形とこの形のどちらかとして検証する。両方の項目を混ぜた本文と501件の本文が断られることを、`packages/core` の型のテストで確かめる
- [x] 1.2 `packages/core/src/db/articles.ts` に `markSeenArticlesRead` を足す。`articles.test.ts` で次を確かめる。未読で版が新しくない記事だけが既読になり、`read_at` が入る。続報で版が進んだ記事は未読のまま残る。すでに既読の記事の `read_at` は変わらない。存在しない識別子は飛ばす。重複の除去が有効な間は、残した配信記事の重複も既読になり、返す識別子に入る
- [x] 1.3 `apps/server/src/app.ts` の `POST /articles/mark-read` で、新しい形の本文を `markSeenArticlesRead` に渡す。時刻は `clock()` の値を使う。`apps/server/src/articles.test.ts` で、応答の `ids` と400になる本文を確かめる。既読にしたあとの最近読んだ記事の一覧も確かめる
- [x] 1.4 `docs/api.md` の `mark-read` の説明に、識別子と `updatedAt` を並べる形を足す。500件の上限と、続報で更新された記事を既読にしないことも書く。書いた `curl` の例を、作業用のサーバーで動かして確かめる

## 2. 共有の処理

- [x] 2.1 `packages/client/src/api.ts` に、識別子と版を並べて既読にする呼び出しを足す。`request` は `keepalive` を受け取れるようにする。送る本文と `keepalive` の指定を `api.test.ts` で確かめる
- [x] 2.2 `packages/client` に、上端を越えた行を前回の位置との差で求める関数（`packages/client/src/scroll-read.ts`）を足す。`packages/client/src/scroll-read.test.ts` で次を確かめる。上端より下にあった行が上へ出ると越えた行になる。一度に30行を飛び越えても全部が越えた行になる。前回見ていない行は、先頭に足されて上にあっても越えた行にならない。既読の行と除外の集合の行は返さない
- [x] 2.3 `packages/client` で、越えた行をまとめて送る `createReadQueue` を足す。時計と待ち時間の仕組みを差し替えたテストで次を確かめる。1秒待って送る。100件で待たずに送る。離れるときは待たずに送る。失敗した組を呼び出し元へ返す
- [x] 2.4 `packages/client` で、保存のキー `SCROLL_READ_STORAGE_KEY` と、保存した値を有効と無効に読み替える関数を足す。読めない値が無効になることをテストで確かめる

## 3. Web

- [x] 3.1 `apps/web/src/lib/scroll-read.ts` で、設定を `localStorage` へ保存して購読する処理を足す。再読み込みで残ることと、保存できないときは無効になることを、`apps/web/src/lib` のテストで確かめる
- [x] 3.2 `apps/web/src/settings/SettingsPage.tsx` の「配色」の区画を「この端末の設定」の区画に置き換える。区画には、配色の選択とチェックボックス「スクロールした記事を既読にする」を並べる。区画の説明と、配色の選択の操作への説明の付け方を、`settings.test.tsx` で確かめる。区画の名前で探している今のテストも直す
- [x] 3.3 `apps/web/src/reader/ReaderPage.tsx` で、設定が有効な間、一覧の `scroll` から越えた行を求める。その行は既読の見た目にして `kept` へ残し、`createReadQueue` で送る。`reader.test.tsx` で、実物のAPIを相手に次を確かめる。3件が既読になり未読数が減る。一部が見えている行は未読のまま。配信記事の行も既読になる。取り消しの知らせは出ない。設定が無効の間は何も変わらない
- [x] 3.4 `ReaderPage.tsx` で、`m` のキーと本文の画面の操作で未読に戻した記事を、除外の集合へ入れる。集合は `listKey` が変わるときと更新で消す。`reader.test.tsx` で、未読に戻した記事が送っても未読のまま残ることと、更新のあとと別の項目から戻ったあとは既読になることを確かめる
- [x] 3.5 `ReaderPage.tsx` で、設定が有効な間だけ、「さらに読み込む」の下へ一覧の高さの余白を置く。5件の一覧で5件目まで既読になることと、無効の間は余白がないことを `reader.test.tsx` で確かめる
- [x] 3.6 `ReaderPage.tsx` で、最近読んだ記事の一覧、検索の結果の画面、イベントの一覧では判定と余白を動かさない。3つの一覧のそれぞれで、送っても記事が未読のまま残ることを、`reader.test.tsx` と `search.test.tsx` で確かめる
- [x] 3.7 `ReaderPage.tsx` で、送る前に別の項目へ移ったときと、`pagehide` と `visibilitychange` のときは、待たずに送る。`pagehide` では `keepalive` を付ける。別の項目へ移っても既読になることを `reader.test.tsx` で確かめる
- [x] 3.8 `ReaderPage.tsx` で、既読の要求が失敗したら行を未読の見た目に戻す。`shell/toast.tsx` で、既読にできなかったこととやり直す操作を出す。サーバーが応答しない状態で、行が戻り、やり直すと既読になることを `reader.test.tsx` で確かめる
- [x] 3.9 `README.md` と `README.ja.md` のWebの画面の説明に、スクロールで既読にする設定と「この端末の設定」の区画を足す

## 4. アプリ

- [x] 4.1 `apps/mobile/src/settings/scroll-read.ts` で、設定を `AsyncStorage` へ保存して購読する処理を足し、起動時に配色と一緒に読む。`settings.test.tsx` で次を確かめる。開き直しで残る。読み終わるまでは無効である。接続の解除で消えない
- [x] 4.2 `apps/mobile/src/settings/SettingsScreen.tsx` の「配色」の `Section` を「この端末の設定」にする。配色の `Choice` と `Toggle` の「スクロールした記事を既読にする」を並べる。「通知」の区画は動かさない。`settings.test.tsx` で次を確かめる。区画の説明が表示される。切り替えの読み上げ用の名前と状態が読み上げられる。通知の設定は「通知」の区画に残る
- [x] 4.3 `apps/mobile/src/reader/ListScreen.tsx` の `FlatList` で、`onViewableItemsChanged` から越えた行を求める。その行は既読の表示にして `session.keep` へ残し、`createReadQueue` で送る。`list.test.tsx` で次を確かめる。3件が既読になり未読数が減る。配信記事の行も既読になる。取り消しの知らせは出ない。無効の間は何も変わらない
- [x] 4.4 `apps/mobile/src/reader/useReaderList.ts` で、払う操作、長押しの操作、本文の画面で未読に戻した記事を、除外の集合へ入れる。集合は、引いて更新するときと別の一覧へ移るときに消す。`actions.test.tsx` で、未読に戻した記事が送っても未読のまま残ることと、引いて更新したあとと別の一覧から戻ったあとは既読になることを確かめる
- [x] 4.5 `ListScreen.tsx` で、設定が有効な間だけ、`ListFooterComponent` の下へ一覧の高さの余白を置く。`onEndReachedThreshold` には余白のぶんを足す。`list.test.tsx` で、最後の行まで既読になることと、続きの読み込みの時機が変わらないことを確かめる
- [x] 4.6 `ListScreen.tsx` で、最近読んだ記事の一覧、検索の結果の画面、イベントの一覧では判定と余白を動かさない。3つの一覧のそれぞれで、送っても記事が未読のまま残ることを `list.test.tsx` と `search.test.tsx` で確かめる
- [x] 4.7 `ListScreen.tsx` で、別の一覧へ移るときと、`AppState` が背面に移るときは、待たずに送る。失敗したら行を未読の表示に戻し、`ui/toast.tsx` で既読にできなかったこととやり直す操作を出す。`list.test.tsx` で確かめる
- [x] 4.8 `README.md` と `README.ja.md` のAndroidアプリの説明に、スクロールで既読にする設定と「この端末の設定」の区画を足す

## 5. 確認

- [x] 5.1 Webで設定を入れて未読の一覧を素早く送り、通り過ぎた記事が既読になって最近読んだ記事の一覧に出ることを確かめる。そこから未読に戻せることも確かめる。サーバーは、作業用の設定とデータ、空いたポートで起動し、起動のときに控えたPIDで止める。`config.yaml` のプロバイダーは `/bin/false` に向ける
- [ ] 5.2 Androidのエミュレーターで同じ操作を確かめ、Webの設定とは別に切り替わることを確かめる
- [x] 5.3 `make verify` を通し、`openspec validate add-scroll-to-read --strict` が通ることを確かめる
