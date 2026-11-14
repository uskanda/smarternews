# Tasks

## 1. 共通関数

- [x] 1.1 `apps/web/src/lib/download.test.ts`にテストを書き、今の手順では落ちることを確かめる。クリックの直後には解放しないこと、`REVOKE_DELAY_MS`のあとに同じURLで1回解放すること、リンクにファイル名が付くことを確かめるテストである
- [x] 1.2 `apps/web/src/lib/download.ts`に`saveBlob`と`REVOKE_DELAY_MS`を作り、1.1のテストが通ることを確かめる

## 2. 画面の置き換え

- [x] 2.1 `FeedsPage.tsx`のOPMLの書き出しを`saveBlob`に置き換え、`feeds-settings.test.tsx`の書き出しのテストが通ることを確かめる
- [x] 2.2 `SettingsPage.tsx`の設定ファイルの書き出しを`saveBlob`に置き換え、`settings.test.tsx`の書き出しのテストが通ることを確かめる

## 3. 全体の確認

- [x] 3.1 `make verify`が通ることを確かめる
