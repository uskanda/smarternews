# Tasks

どの作業も、失敗するテストを先に書いてから実装する。

## 1. ホスト名と候補

- [x] 1.1 `fetch/url.ts` に `siteHost`、`candidateHost`、`normalizeHost` を足し、`url.test.ts` で確かめる。大文字、`www.`、`www.` 以外の先頭の部分、`news.google.com` と出典サイトのURL、ホスト名にならない値を見る
- [x] 1.2 `sources/llm-search.ts` のサイト名を `siteHost` に置き換え、`llm-search.test.ts` で確かめる
- [x] 1.3 `RawCandidate` に `siteUrl` を足し、`sources/news-search.ts` でGoogleの結果の `<source url>` を取り込む。`news-search.test.ts` で確かめる

## 2. データ

- [x] 2.1 `pipeline/reasons.ts` に `blocked-site` を足し、`reasons.test.ts` で文を確かめる。`028` の移行のテストを、`028` の時点の種類に絞る
- [x] 2.2 `034_site_hosts.sql` と `sn_candidate_host` を足す。`database.test.ts` で、保存済みの候補のホスト名、未解決の候補の空のホスト名、`blocked-site` を許すCHECK、`candidate_topics` が残ることを確かめる
- [x] 2.3 `insertCandidate` が `site_host` を保存するようにする

## 3. 実行

- [x] 3.1 `pipeline/run.ts` の `collect` で、除外の一覧にあるホスト名の候補を `blocked-site` で保存し、既読にする。`collect.test.ts` で、判定のタスクに送らないこと、日付のない候補より前に落ちること、別のカテゴリでは落ちないこと、ページを取得しないことを確かめる
- [x] 3.2 `listTrialCandidates` が `blocked-site` の候補を除くことを `candidates.test.ts` で確かめる

## 4. 集計とAPI

- [x] 4.1 `api.ts` に `siteStatsSchema` と `blockedSiteSchema` を足す。`TopicStatsCounts` に `blockedSite` を足し、`topRejectedSites` の項目を `host` に変える
- [x] 4.2 `db/sites.ts` に `siteStats`、`blockSite`、`unblockSite`、`blockedHosts` を作る。`sites.test.ts` で各数、並び、期間、除外中のサイト、存在しないカテゴリを確かめる
- [x] 4.3 `db/topicStats.ts` でサイトの除外の件数とホスト名での集計を、`topicStats.test.ts` で確かめる
- [x] 4.4 `apps/server/src/app.ts` に3つの経路を足し、`site-stats-api.test.ts` で応答、ホスト名のそろえ方、400と404を確かめる
- [x] 4.5 `packages/client` に3つの呼び出しを足し、`api.test.ts` で確かめる
- [x] 4.6 `docs/api.md` に新しい操作と、トピックの成績の変わった項目を書く

## 5. 画面

- [x] 5.1 `AddFeedForm` に `discoverUrl` を足し、開いたときに探し、1つでも選ぶ欄に出すことを確かめる
- [x] 5.2 `SiteStats.tsx` を作り、カテゴリの画面に置く。区画の表示、除外、取り消し、フィードを探すダイアログの初期値（ニュースとイベントのカテゴリ）を `site-stats.test.tsx` で確かめる
- [x] 5.3 `TopicStats.tsx` にサイトの除外の件数を出し、よく除外されるサイトをホスト名で出す

## 6. 確認

- [x] 6.1 `/bin/false` にプロバイダーを向けた使い捨てのサーバーで画面を開き、区画を目で確かめる
- [x] 6.2 `make verify` を通し、`openspec validate add-site-stats --strict` が通ることを確かめる
