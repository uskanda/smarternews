# Tasks

## 1. 移行の番号と理由の種類

- [x] 1.1出典の理由の移行を、024番から `026_ref_reasons.sql` に移す。同じ番号の移行がないことと、出典の理由の移行のテストを `packages/core/src/db/database.test.ts` で確かめる
- [x] 1.2移行の028で、`candidates` の表に `reason_code` の列を足し、過去の候補に理由の種類を入れる。両言語の5種類の文と、判定の理由と、保留中の候補の扱いを `database.test.ts` で確かめる
- [x] 1.3 `NewCandidate` に `reasonCode` を足し、`rejectCandidates` が種類と出力の言語を受け取るようにする。プログラムの4つの場面で種類が保存されることを `collect.test.ts`、`select.test.ts`、`events.test.ts` で確かめる。判定による除外ではNULLになることも確かめる
- [x] 1.4 `listTrialCandidates` を列で見分けるように変え、`programReasonCode` を消す。`candidates.test.ts` と `trial.test.ts` で確かめる
- [x] 1.5用語集に「理由の種類」と「トピックの成績」を足す。用語の検査で確かめる

## 2. 成績の集計とAPI

- [x] 2.1 `api.ts` に `TOPIC_STATS_DAYS`、`topicStatsSchema`、`rankTopicStats` を足す。並び順を `packages/core/src/db/topicStats.test.ts` で確かめる
- [x] 2.2 `db/topicStats.ts` に `topicStats` を書く。候補の数を、取得元ごと、理由の種類ごと、30日の境目について確かめる（`topicStats.test.ts`）
- [x] 2.3記事の数を `topicStats.test.ts` で確かめる。配信記事を数えないこと、作った記事と更新した記事、開いた記事とスターと外れを見る
- [x] 2.4上位3サイト、候補0件のトピック、存在しないカテゴリを `topicStats.test.ts` で確かめる
- [x] 2.5 `GET /api/v1/categories/:id/topic-stats` を足す。応答の形、404、LLMを呼ばないことを `apps/server/src/topic-stats-api.test.ts` で確かめる
- [x] 2.6 `packages/client` に `topicStats` を足す。要求するURLと応答の読み取りを `packages/client/src/api.test.ts` で確かめる
- [x] 2.7 `docs/api.md` の表に1行と、成績の節と `curl` の例を足す

## 3. Webの画面

- [x] 3.1カテゴリの画面のトピックの区画の後に「トピックの成績」の区画を置く。区画の位置、行の数、行のリンクを `apps/web/src/settings/settings.test.tsx` で確かめる
- [x] 3.2「問題のあるトピックを先頭へ」の切り替えを置く。並び順が変わって戻ることを `settings.test.tsx` で確かめる
- [x] 3.3トピックの追加、保存、削除、解釈し直し、外れとスターの付け外しのあとに成績を問い合わせ直す。追加したトピックの行が現れることを `settings.test.tsx` で確かめる
- [x] 3.4実行の詳細の「トピックごとにまとめる」の見出しごとに「このトピックの成績」のリンクを足す。リンク先と、移った先で行まで送ることを `apps/web/src/runs/runs.test.tsx` で確かめる

## 4. 全体の確認

- [ ] 4.1 `make verify` を通す
- [x] 4.2 `openspec validate add-topic-stats --strict` を通す
