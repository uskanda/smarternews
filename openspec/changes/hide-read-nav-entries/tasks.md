# Tasks

## 1. 共通のパッケージの判定

- [x] 1.1 `packages/client/src/nav.ts` に `hideEmptyEntries` を足す。`nav.test.ts` で、未読0の項目が消えること、上の段と開いている項目が残ることを確かめる
- [x] 1.2 `nav.test.ts` で、失敗と更新停止の購読フィードが親ごと残り、一時停止は消えることを確かめる。件数がないと何も消えないこと、`childState` が元のままであることも確かめる
- [x] 1.3 `nav.ts` に、保存のキーの `HIDE_READ_STORAGE_KEY`、`HIDE_READ_ON`、`parseHideRead` を足し、`nav.test.ts` で値の読み方を確かめる
- [x] 1.4 `order.test.ts` で、隠したあとのモデルを渡した `stepTarget` が未読0の項目を飛ばすことを確かめる

## 2. Webの設定の値

- [x] 2.1 `apps/web/src/lib/hide-read.ts` を作り、`testing/setup.ts` でテストごとに状態を消す。`hide-read.test.ts` で、保存と消去を確かめる。知らない値のときと保存先のないときは、オフになることも確かめる
- [x] 2.2 `SettingsPage.tsx` の「この端末の設定」の区画に、チェックボックスと説明を足す。`settings.test.tsx` で、初めはオフで、選ぶとサーバーへ送らずに保存されることを確かめる

## 3. 左のペインとキー操作

- [x] 3.1 `Shell.tsx` に `useNavModels` を足し、`Nav` の描画、ドラッグ、項目のメニューで隠したあとのモデルを使う。`shell.test.tsx` で、オフでは全部が出ること、オンで未読0の項目が消えることを確かめる
- [x] 3.2 `shell.test.tsx` で、オンのとき、失敗した購読フィードと開いている項目が残り、別の一覧へ移ると開いていた項目が消えることを確かめる
- [x] 3.3 Shift+JとShift+Kで隠したあとのモデルを使い、`shell.test.tsx` で、隠した項目を飛ばすことを確かめる

## 4. 全体の確認

- [x] 4.1 `openspec validate hide-read-nav-entries --strict` が通り、テスト、型の検査、lint、ビルドが通ることを確かめる
