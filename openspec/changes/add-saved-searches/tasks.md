# Tasks

## 1. サーバーの保存と件数

- [ ] 1.1 `saved-searches.test.ts` と `search.test.ts` と `database.test.ts` に、読み書き、並べ替え、入力の誤り、カテゴリと購読フィードの削除に伴う削除、未読数（絞り込み、既読、フィルターで隠した記事、隠れた重複、終了したイベント）のテストを書き、失敗することを確かめる
- [ ] 1.2 `032_saved_searches.sql`、`db/saved-searches.ts`、`api.ts` の型、`searchConditions` の切り出しと `getCounts` の `savedSearches` を実装し、1.1のテストが通ることを確かめる

## 2. APIと設定ファイル

- [ ] 2.1 `saved-searches-api.test.ts` と `settings-file.test.ts` に、作成、更新、削除、移動、入力の誤り、`/counts` の `savedSearches`、設定ファイルの往復と重複と誤りのテストを書き、失敗することを確かめる
- [ ] 2.2 `/saved-searches` の経路、クライアントのAPIの呼び出し、設定ファイルの書き出しと読み込みを実装し、2.1のテストが通ることを確かめる
- [ ] 2.3 `docs/api.md` に保存した検索のAPIと件数の応答と設定ファイルの項目を書く

## 3. 左のペインのモデル

- [ ] 3.1 `nav.test.ts` と `order.test.ts` に、`buildNav`、`hideEmptyEntries`、`listKey` と `parseListKey` の往復、`hasReadToggle`・`hasListControls`・`hasSortMenu`、`stepTarget` のテストを書き、失敗することを確かめる
- [ ] 3.2 `nav.ts` と `order.ts` に保存した検索を足し、Androidの型を合わせ、3.1のテストと型の検査が通ることを確かめる

## 4. Web

- [ ] 4.1 `saved-searches.test.tsx` に、区切りと未読数、0件で区切りが出ないこと、結果からの保存、項目を開くと未読だけになること、一括の既読が出ないこと、Shift+J/K、メニューでの名前の変更・削除・移動、隠す設定のテストを書き、失敗することを確かめる
- [ ] 4.2 `/s/:id` の経路、`ReaderPage` の保存した検索、左のペインの区切りとメニュー、「検索を保存」を実装し、4.1のテストが通ることを確かめる

## 5. 全体の確認

- [ ] 5.1 `make verify` が通ることを確かめる
- [ ] 5.2 `openspec validate add-saved-searches --strict` が通ることを確かめる
