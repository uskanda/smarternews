# Tasks

どの作業も、失敗するテストを先に書いてから実装する。

## 1. 直近の実行

- [x] 1.1 `apps/web/src/runs/runs.test.tsx` に、直近の実行の行のテストを書く。成功した実行の状態、作成と更新の数、`/runs/:id` へのリンク、失敗した実行の「失敗」、「いますぐ実行」のあとの実行中の状態、実行がないときの「まだ実行していません」を確かめる
- [x] 1.2 `apps/web/src/settings/CategoryPage.tsx` の `RunNow` に、直近の実行の行を足す

## 2. 区画へのリンク

- [x] 2.1 `apps/web/src/settings/settings.test.tsx` に、`nav`「カテゴリの区画」のテストを書く。5つのリンクがあり、各リンクの先の区画があることを確かめる。アドレスで区画を指定して開いたときと、リンクを選んだときのスクロールも確かめる
- [x] 2.2 `CategoryPage.tsx` の見出しの下に区画のリンクを置き、5つの区画にidを付ける（`TopicStats.tsx` を含む）。`useScrollToHash` は、トピックと成績を読み込んだあとに動かす

## 3. 確認

- [x] 3.1 `make verify` の各検査を通し、`openspec validate show-latest-run-on-category --strict` が通ることを確かめる
