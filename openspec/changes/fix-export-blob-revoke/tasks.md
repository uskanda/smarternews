# Tasks

## 1. 共通関数

- [ ] 1.1 `apps/web/src/lib/download.test.ts`に、クリックの直後には解放せず、`REVOKE_DELAY_MS`のあとに同じURLで1回解放し、リンクにファイル名が付くことのテストを書き、落ちることを確かめる
- [ ] 1.2 `apps/web/src/lib/download.ts`に`saveBlob`と`REVOKE_DELAY_MS`を作り、1.1のテストが通ることを確かめる

## 2. 画面の置き換え

- [ ] 2.1 `FeedsPage.tsx`のOPMLの書き出しを`saveBlob`に置き換え、`feeds-settings.test.tsx`の書き出しのテストが通ることを確かめる
- [ ] 2.2 `SettingsPage.tsx`の設定ファイルの書き出しを`saveBlob`に置き換え、`settings.test.tsx`の書き出しのテストが通ることを確かめる

## 3. 全体の確認

- [ ] 3.1 `make verify`が通ることを確かめる
