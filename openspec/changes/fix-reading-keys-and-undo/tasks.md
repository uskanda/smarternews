# Tasks

どの作業も、失敗するテストを先に書いてから実装する。

## 1. 入力中の判定（#87）

- [x] 1.1 `apps/web/src/lib/keys.test.ts` にテストを足す。checkbox、radio、buttonの `INPUT` と `SELECT` にフォーカスがあるときは `j` が働き、textの `INPUT` では働かないことを確かめる。足したテストが失敗することを確かめる
- [x] 1.2 `isTyping` と、`Space` を部品に渡す判定を、要素の種類で分ける。1.1のテストが通ることを確かめる
- [x] 1.3 `apps/web/src/reader/reader.test.tsx` にテストを足す。「既読も表示」を押してから `j` を押すと次の記事が開くこと、「重要度4以上だけ」で `Space` を押しても本文が送られないことを確かめ、通ることを確かめる

## 2. メニューと左のペインのキー（#91）

- [x] 2.1 `apps/web/src/shell/order.test.tsx` に、項目のメニューを開いて `j` を押しても記事が変わらないテストを足す。失敗を確かめてから、メニューの中身に `data-hotkeys="off"` を付けて通す
- [x] 2.2 `apps/web/src/lib/keys.test.ts` にテストを足す。`data-hotkeys="nav"` の中では `Shift+J`、`/`、`?`、`g a` が働き、`j`、`s`、`Space`、`Shift+A` は働かないことを確かめる。失敗を確かめてから、`keys.ts` に印の扱いを足して通す
- [x] 2.3 `apps/web/src/shell/Shell.tsx` の狭い画面の項目の引き出しに、`data-hotkeys="nav"` を付ける。`apps/web/src/shell/shell.test.tsx` で、引き出しを開いて `s` を押しても背後のスターが変わらないこと、`Shift+J` で次の項目が開くことを確かめる

## 3. 一覧の表示位置と一括の既読の条件（#88、#97）

- [x] 3.1 `apps/web/src/reader/reader.test.tsx` に、一覧をスクロールしてから別の一覧を開くと先頭から表示されるテストを足す。失敗を確かめてから、`listKey` が変わったらスクロールの位置を0にする処理を足して通す
- [x] 3.2 `apps/web/src/reader/reader.test.tsx` に、120件の一覧で読み込んだ50件を既読にしても、一括の既読のボタンと `Shift+A` が使えるテストを足す。失敗を確かめてから、ボタンを出す条件に続きのページの有無を足して通す

## 4. 知らせの表示時間とキー（#109）

- [x] 4.1 `apps/web/src/shell/toast.tsx` のテストのファイル（apps/web/src/shell/toast.test.tsx）を作る。マウスを載せている間とフォーカスがある間は、表示時間を過ぎても知らせが消えないことを確かめる。失敗を確かめてから、知らせの処理を直して通す
- [x] 4.2 `ToastProvider` のテストを同じファイルに足す。操作のある知らせの間は `z` で操作が走り、知らせがないときは何も起きないことを確かめる。失敗を確かめてから、`z` を割り当てて通す
- [x] 4.3 `apps/web/src/shell/Shell.tsx` の `KEYS` に `z` を載せる。`apps/web/src/shell/shell.test.tsx` のキー操作の一覧のテストで、`z` の行が出ることを確かめる

## 5. 取り消しの件数と失敗（#90）

- [x] 5.1 `packages/core/src/api.ts` に上限の定数 `MAX_MARK_UNREAD` を置き、`markUnreadSchema` で使う。サーバーの既存のテストが通ることを確かめる
- [x] 5.2 `packages/client/src/api.test.ts` にテストを足す。6000件の識別子を5000件と1000件の2回に分けて送り、戻した件数を足して返すこと、途中の失敗を失敗として返すことを確かめる。失敗を確かめてから `markUnread` を直して通す
- [x] 5.3 `apps/web/src/reader/reader.test.tsx` にテストを足す。取り消しが失敗したら「既読を取り消せませんでした」と「もう一度試す」が出て、押すと同じ識別子で送り直すことを確かめる。失敗を確かめてから `apps/web/src/reader/ReaderPage.tsx` を直して通す
- [x] 5.4 `apps/web/src/reader/reader.test.tsx` にテストを足す。一括の既読で次の項目へ移り、そこで読んだ行が取り消しのあとも残ることを確かめる。失敗を確かめてから、取り消しのあとは残した行を消さずに読み直すように直して通す

## 6. 確認

- [x] 6.1 `make verify` が通ることを確かめる
- [ ] 6.2 `apps/server` の確認用のサーバーを、作業用の設定とデータのディレクトリと空いたポートで起動する。設定のプロバイダーは `/bin/false` に向ける。ブラウザーで1から5の動きを確かめ、起動のときに控えたPIDでサーバーを止める
