# Tasks

## 1. 書体の書き出し

- [x] 1.1 `scripts/design-tokens.test.ts` に、書き出しのテストを先に書き、失敗することを確かめる。対象は、`font-size` がremで出ること、引き出し用の変数が出ること、Androidアプリの定数がpxの数のままであることである
- [x] 1.2 `scripts/design-tokens.ts` を直し、`pnpm run tokens` で `tokens.css` を作り直して、1.1のテストが通ることを確かめる

## 2. ペインの数の切り替え

- [x] 2.1 emの条件で、幅1100pxと720pxを境にペインの数が変わるテストを先に書き、失敗することを確かめる
- [x] 2.2 `layout.ts` の条件をemにし、テスト用の `matchMedia` がemを読めるようにして、2.1のテストが通ることを確かめる

## 3. 記事の一覧と引き出し

- [x] 3.1 `reader.test.tsx` に、ルートの文字の大きさが32pxのとき、Spaceで送る量から引く1行の高さが2倍になるテストを先に書き、失敗することを確かめる
- [x] 3.2 `ReaderPage.tsx` のSpaceで送る量を直し、3.1のテストが通ることを確かめる
- [x] 3.3 `reader.test.tsx` と `shell.test.tsx` に、見出しの行の折り返しと引き出しの幅の指定のテストを先に書き、失敗することを確かめる
- [x] 3.4 `ReaderPage.tsx` の見出しの行と `Shell.tsx` の引き出しの幅を直し、3.3のテストが通ることを確かめる

## 4. 文書と全体の確認

- [x] 4.1 `DESIGN.md` の書体とLayoutの節に、remでの書き出し、emでの切り替えの幅、引き出しの幅を書く
- [x] 4.2 `make verify` と `openspec validate scale-web-text-with-font-size --strict` が通ることを確かめる
