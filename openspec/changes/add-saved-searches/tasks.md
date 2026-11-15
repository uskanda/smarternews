# Tasks

## 1. サーバーの保存と件数

- [x] 1.1 `saved-searches.test.ts` に保存した検索のテストを書き、失敗することを確かめる。対象は、読み書き、並べ替え、入力の誤り、削除の連動、未読数である
- [x] 1.2 `032_saved_searches.sql`、`db/saved-searches.ts`、`api.ts`、`getCounts` を実装し、1.1のテストが通ることを確かめる

## 2. APIと設定ファイル

- [x] 2.1 `saved-searches-api.test.ts` と `settings-file.test.ts` にテストを書き、失敗することを確かめる。対象は、APIの各操作と誤り、件数の応答、設定ファイルの往復と重複と誤りである
- [x] 2.2 `/saved-searches` の経路、`packages/client` のAPIの呼び出し、設定ファイルの読み書きを実装し、2.1のテストが通ることを確かめる
- [x] 2.3 `docs/api.md`、README、設定ファイルの例に保存した検索を書き、例の読み込みのテストが通ることを確かめる

## 3. 左のペインのモデル

- [x] 3.1 `nav.test.ts` と `order.test.ts` に、モデル、隠す処理、キー、一覧の操作、Shift+J/Kのテストを書き、失敗することを確かめる
- [x] 3.2 `nav.ts` と `order.ts` に保存した検索を足し、Androidの型を合わせ、3.1のテストと型の検査が通ることを確かめる

## 4. Web

- [x] 4.1 `saved-searches.test.tsx` に、左のペイン、一覧、保存、メニューのテストを書き、失敗することを確かめる
- [x] 4.2 `/s/:id` の経路、一覧、左のペインの区切りとメニュー、「検索を保存」を実装し、4.1のテストが通ることを確かめる

## 5. 全体の確認

- [x] 5.1 `make verify` のlint、型の検査、テスト、ビルド、textlintが通ることを確かめる
- [x] 5.2 `openspec validate add-saved-searches --strict` が通ることを確かめる
