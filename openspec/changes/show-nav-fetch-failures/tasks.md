# Tasks

## 1. 左のペインの失敗の1行

- [x] 1.1 `shell.test.tsx` に、カテゴリの失敗、カテゴリと件数の失敗、取り直しだけの失敗のテストを先に書き、失敗することを確かめる
- [x] 1.2 `Shell.tsx` の `useNavModels` が失敗の状態を返すようにし、`NavFetchFailure` を検索欄の下に置き、1.1のテストが通ることを確かめる

## 2. 本文側の失敗の表示

- [x] 2.1 `reader.test.tsx` に、カテゴリや購読フィードが失敗しているときにその一覧のURLを開くテストを先に書き、失敗することを確かめる
- [x] 2.2 `ReaderPage.tsx` で、`読み込み中…` の代わりに `ErrorNotice` を出し、2.1のテストが通ることを確かめる

## 3. 「読み直す」で取り直す範囲

- [x] 3.1 `reader.test.tsx` に、`r` で失敗していたカテゴリが取り直されるテストと、成功しているカテゴリと購読フィードは取り直されないテストを先に書き、失敗することを確かめる
- [x] 3.2 `refresh` で、状態が `error` の `["categories"]` と `["feeds"]` を無効にし、3.1のテストが通ることを確かめる

## 4. 全体の確認

- [x] 4.1 `make verify` と `openspec validate show-nav-fetch-failures --strict` が通ることを確かめる
