# Tasks

## 1. 共通のパッケージの判定

- [x] 1.1 `packages/client/src/nav.ts` に `hideEmptyEntries` を足し、`nav.test.ts` で、未読0の項目が消えること、上の段が残ること、失敗と更新停止の購読フィードが親ごと残ること、一時停止が消えること、開いている項目が親ごと残ること、件数がないと何も消えないこと、`childState` が元のままであることを確かめる
- [x] 1.2 保存のキー `HIDE_READ_STORAGE_KEY`、`HIDE_READ_ON`、`parseHideRead` を `nav.ts` に足し、`nav.test.ts` で値の読み方を確かめる
- [x] 1.3 `order.test.ts` で、隠したあとの model を渡した `stepTarget` が未読0の項目を飛ばし、開いている項目からは動けることを確かめる

## 2. Webの設定の値

- [x] 2.1 `apps/web/src/lib/hide-read.ts` を作り、`testing/setup.ts` でテストごとに状態を消す。`hide-read.test.ts` で、保存、消去、知らない値と保存先のないときにオフになることを確かめる
- [x] 2.2 設定の「この端末の設定」にチェックボックスと説明を足し、`settings.test.tsx` で、初めはオフで、選ぶとサーバーへ送らずに `smarternews.nav.hideRead` が `on` になることを確かめる

## 3. 左のペインとキー操作

- [x] 3.1 `Shell.tsx` に `useNavModels` を足し、`Nav` の描画、ドラッグ、項目のメニューと、Shift+JとShift+Kで隠したあとの model を使う。`shell.test.tsx` で、オフでは全部が出ること、オンで未読0の購読フィードとカテゴリが消え、失敗した購読フィードと開いている項目が残り、別の一覧へ移ると消えること、Shift+Jが隠した項目を飛ばすことを確かめる

## 4. 全体の確認

- [x] 4.1 `make verify` と `openspec validate hide-read-nav-entries --strict` が通ることを確かめる
