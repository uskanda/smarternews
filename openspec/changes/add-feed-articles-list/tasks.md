# Tasks

実装した環境では依存パッケージを導入できず、テスト、型の検査、lint、ビルドを実行できなかった。
そのため、テストは書いたが、先に失敗することと、実装のあとに通ることは確かめていない。確かめる作業は6に残してある。

## 1. 共有のモデル

- [x] 1.1 `nav.test.ts` と `order.test.ts` に、項目の並びと未読数、キーの往復と絞り込み、一括の既読の範囲と重要度の切り替えのテストを書く
- [x] 1.2 `nav.ts` に `feeds` の項目と `hasImportanceFilter` を足す。同じ内容の検査をNodeで直接実行し、通ることを確かめる

## 2. 表示の設定

- [x] 2.1 `api.test.ts`、`list-views.test.ts`、`list-views-api.test.ts` にテストを書く。`database.test.ts` と `settings-file.test.ts` にも書く。`feeds` の並び順の保存と、移行のあとに既存の行が残ることを確かめる。設定ファイルの書き出しと読み込みも確かめる
- [x] 2.2 `api.ts` の表示の設定の対象と設定ファイルの `list` に `feeds` を足し、`031_list_views_feeds.sql` で表を作り直す。移行は、NodeのSQLiteで030までの表に適用し、既存の行と制約が残ることを確かめる

## 3. Web

- [x] 3.1 `shell.test.tsx`、`order.test.tsx`、`feeds.test.tsx`、`advance.test.tsx` にテストを書く。項目の表示と、配信記事だけが並ぶことを確かめる。重要度の切り替えが出ないことと、一括の既読のあとに移らないことも確かめる
- [x] 3.2 `/feeds` のルート、`View` と見出し、重要度の切り替えの除外を足す

## 4. Android

- [x] 4.1 `shell.test.tsx`、`order.test.tsx`、`feeds.test.tsx`、`actions.test.tsx` の引き出しと一覧のテストに、「購読フィード」を足す
- [x] 4.2 `feeds` の一覧に見出しを足し、重要度の切り替えを除く

## 5. 文書

- [x] 5.1 `docs/api.md` の表示の設定と `listViews` の説明、READMEの項目の説明に `feeds` を足す
- [x] 5.2 `openspec validate add-feed-articles-list --strict` が通ることを確かめる

## 6. 実行できる環境での確認

- [ ] 6.1 `make verify` が通ることを確かめる
- [ ] 6.2 Webで「購読フィード」を確かめる。作業用のデータと空きポートでサーバーを起動する。未読数と一覧、並び順の保存と一括の既読を見る
