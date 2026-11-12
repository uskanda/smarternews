# Tasks

実装した環境では依存パッケージを導入できず、テスト、型の検査、lint、ビルドを実行できなかった。
そのため、テストは書いたが、先に失敗することと、実装のあとに通ることは確かめていない。確かめる作業は6に残してある。

## 1. 共有のモデル

- [x] 1.1 `nav.test.ts` と `order.test.ts` に、項目の並び、未読数、キーの往復、絞り込み、一括の既読の範囲、重要度の切り替えのテストを書く
- [x] 1.2 `nav.ts` に `feeds` の項目と `hasImportanceFilter` を足す。同じ内容の検査をNodeで直接実行し、通ることを確かめる

## 2. 表示の設定

- [x] 2.1 `api.test.ts`、`list-views.test.ts`、`list-views-api.test.ts`、`database.test.ts`、`settings-file.test.ts` に、`feeds` の並び順の保存、マイグレーションのあとに既存の行が残ること、設定ファイルの書き出しと読み込みのテストを書く
- [x] 2.2 `api.ts` の表示の設定の対象と設定ファイルの `list` に `feeds` を足し、`031_list_views_feeds.sql` で表を作り直す。マイグレーションは、NodeのSQLiteで030までの表に適用し、既存の行と制約が残ることを確かめる

## 3. Web

- [x] 3.1 `shell.test.tsx`、`order.test.tsx`、`feeds.test.tsx`、`advance.test.tsx` に、項目の表示、配信記事だけが並ぶこと、重要度の切り替えが出ないこと、一括の既読のあとに移らないことのテストを書く
- [x] 3.2 `/feeds` のルート、`View` と見出し、重要度の切り替えの除外を足す

## 4. Android

- [x] 4.1 引き出しと一覧のテスト（`shell.test.tsx`、`order.test.tsx`、`feeds.test.tsx`、`actions.test.tsx`）に、「購読フィード」の項目と一覧のテストを書く
- [x] 4.2 一覧の見出しと重要度の切り替えの除外を足す

## 5. 文書

- [x] 5.1 `docs/api.md` の表示の設定と `listViews` の説明、READMEの項目の説明に `feeds` を足す
- [x] 5.2 `openspec validate add-feed-articles-list --strict` が通ることを確かめる

## 6. 実行できる環境での確認

- [ ] 6.1 `make verify` が通ることを確かめる
- [ ] 6.2 作業用のデータと空きポートでサーバーを起動し、Webで「購読フィード」を開いて、未読数、一覧、並び順の保存、一括の既読を確かめる
