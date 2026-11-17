# Tasks

## 1. 先に失敗するテスト

- [x] 1.1 `reader.test.tsx` に、トピックの区画の位置のテストを足し、実装の前に失敗することを確かめる。区画が見出しと出典より後ろ、「記事の操作」より前にあることを確かめるテストである
- [x] 1.2 `reader.test.tsx` に、補足の行のボタンのテストを足し、実装の前に失敗することを確かめる。スターと既読が切り替わり、`aria-pressed` と末尾のボタンの言葉も変わることを確かめるテストである

## 2. 見た目の値

- [x] 2.1 `DESIGN.md` に `button-small` の値と説明を足し、`pnpm run check:tokens` が通ることを確かめる

## 3. 実装

- [x] 3.1 `Button` に `size`（`md` が既定、`sm` が小さい寸法）を足し、型の確認が通ることを確かめる
- [x] 3.2 `ArticleView` のトピックの区画を、出典の下、末尾のボタンの並びの前へ移す。1.1のテストが通ることを確かめる
- [x] 3.3 `ArticleView` の補足の行の末尾に、`size="sm"` のスターと既読のボタンを「スターと既読」のグループとして置く。1.2のテストが通ることを確かめる
- [x] 3.4 `ArticleView` の末尾のボタンの並びを「記事の操作」のグループにする。名前でボタンを探す既存のテストを、並びを指定する形に書き換える。対象は `reader.test.tsx`、`shell.test.tsx`、`order.test.tsx`、`feeds.test.tsx` である。Webのテストがすべて通ることを確かめる

## 4. 全体の確認

- [x] 4.1 `make verify` の各段を実行し、この変更が新しい失敗を足していないことを確かめる。lint、型、テスト、ビルド、`check:tokens`、`designmd lint` は通った。`check:private` は、実行の環境が置く空のファイル（`.bash_profile` など）を読めずに止まった。textlintと用語の検査は、mainにある `add-feed-articles-list` の文書だけで失敗した
- [x] 4.2 `openspec validate move-article-topics-down --strict` が通ることを確かめる
