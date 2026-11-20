# Design

## Context

候補は `candidates` の表に入り、サイト名（`site_name`）を持つ。サイト名の出どころは取得元で違う。フィードはフィードの題名、ニュース検索は検索結果の出典の名前、LLM検索はURLのホスト名から `www.` を取ったものである。
Googleニュースの結果は転送用のURLで、`resolveGoogleNewsUrl` が元のURLに解決する。解決できないと、候補のURLは `news.google.com` のままで、本文を取得しない（`fetchable = 0`）。RSSの各項目は `<source url="...">` で出典サイトのURLを持つが、いまは名前だけを読んでいる。

実行の処理（`pipeline/run.ts` の `collect`）は、取得元から集めた候補を既読のURLで絞る。ニュースのカテゴリでは、公開日時のない候補を `no-date` で除外してから、残りを判定のタスクに送る。
理由の種類（`reason_code`）は `028` で足した列で、CHECK制約で5つの値に限っている。SQLiteはCHECKを変えられないので、値を足すには表を作り直す。

トピックの成績（`db/topicStats.ts`）は、よく除外されるサイトを `site_name` で数えている。カテゴリの画面（`apps/web/src/settings/CategoryPage.tsx`）は、トピックの区画の後に `TopicStatsSection` を置く。
購読フィードの追加の欄は `AddFeedForm` で、記事の一覧のダイアログ（`AddFeedDialog`）でも使っている。外枠は `FormDialog` である。

## Goals / Non-Goals

**Goals:**

- 候補をURLのホスト名でそろえて数え、除外する。
- 除外したサイトの候補を、判定のタスクとページの取得の前に除外する。
- カテゴリの画面で、サイトごとの成績を見て、除外、取り消し、フィードの探索ができる。

**Non-Goals:**

- Androidアプリでの表示と操作（grilling Q8）。
- 登録ドメインでのまとめ（grilling Q3）。
- サイトの成績の30日より前の推移。
- 除外の一覧を設定ファイルの書き出しと読み込みに含めること。除外は画面からすぐ戻せる操作で、カテゴリの設定ではない。

## Decisions

### ホスト名の関数

`packages/core/src/fetch/url.ts` に2つの関数を足す。

- `siteHost(url)`：URLのホスト名を小文字にし、末尾の `.` と先頭の `www.` を取る。URLとして読めなければ空文字を返す。
- `candidateHost(url, siteUrl)`：`siteHost(url)` が `news.google.com` なら、出典サイトのURLのホスト名を返し、それもなければ空文字を返す。それ以外は `siteHost(url)` を返す。

LLM検索のサイト名は `siteHost` に置き換える。
APIのパスで受けたホスト名は `normalizeHost(value)` でそろえる。英数字、`.`、`-` 以外を含む値と、空になる値は、`invalid` の誤りにする。

### 候補の出典サイトのURL

`RawCandidate` に任意の `siteUrl` を足す。ニュース検索のGoogleの結果は、`item.source` の `@_url` を入れる。Bingの結果は、元のURLがそのまま候補のURLになるので入れない。
`siteUrl` は保存しない。保存するのは、そこから求めたホスト名だけである。

### 移行 `042_site_hosts.sql`

先頭に `-- foreign_keys: off` を書き、表を作り直す移行として動かす。

- `candidates` を `candidates_new` として作り直す。列はそのままで、`reason_code` のCHECKに `blocked-site` を加え、`site_host TEXT NOT NULL DEFAULT ''` を足す。行はIDごと移し、`site_host` は `sn_candidate_host(url)` で埋める。3つの索引も作り直す。`candidate_topics` は表の名前で参照しているので、作り直したあとも同じ表を指す。
- `sn_candidate_host` は `openDatabase` が登録するSQLの関数で、`candidateHost(url, null)` を返す。移行の前に登録するので、移行の中で使える。
- `blocked_sites` を作る。列は `category_id`、`host`、`created_at`、主キーは `(category_id, host)` である。カテゴリを削除すれば、一覧も消える（`ON DELETE CASCADE`）。

### 理由の種類 `blocked-site`

`pipeline/reasons.ts` の `REASON_CODES` に `blocked-site` を足す。文は「除外したサイト」と "site blocked in this category" である。
`028` の移行のテストは、`028` の時点の5つの種類だけを確かめるように絞る。

### 実行での除外

`collect` で、既読のURLで絞った直後、ニュースかイベントかを分ける前に、カテゴリの除外の一覧を1回読む。一覧にあるホスト名の候補は、`store` で `rejected`、理由「除外したサイト」、種類 `blocked-site` として保存する。`store` は既読の記録もする。
`ctx.stats.collected` はこれまでどおり既読で絞ったあとの数で、除外した候補もそれに含む。除外した候補は `ctx.stats.rejected` に数える。

`insertCandidate` は `site_host` を受け取る。`store` は `candidateHost(candidate.url, candidate.siteUrl)` を渡す。

### トピックの試しと書き換えの提案

トピックの試し（`listTrialCandidates`）は、`no-date` と同じく `blocked-site` の候補を除く。どちらも判定を通っていないからである。
書き換えの提案に渡す除外は、理由の種類のない候補（判定による除外）だけなので、変えなくてよい。

### 出典のサイトの成績

`db/sites.ts` に `siteStats(db, categoryId, now)` を作る。直近30日（`TOPIC_STATS_DAYS`）に集めたカテゴリの候補を `site_host` でまとめ、次を数える。

- 候補、採用（`status = 'accepted'`）、除外（`status = 'rejected'`）
- 記事：`article_id` のある候補の、記事のIDの重複を除いた数
- 開いた記事、スター、外れ：その記事のうち、`opened_at` がある、`starred = 1`、`misses` に行がある数

候補の多い順、同じならホスト名の順に並べる。ホスト名が空の行は、同じ数の行の中で最後に置く。各行は、除外中かどうか（`blocked`）を持つ。応答は、期間の始まり、行の配列、除外中のサイトの一覧（ホスト名と除外した時刻、ホスト名の順）である。
除外中のサイトは、直近30日に候補がなくても一覧に入る。

同じファイルに `blockSite`、`unblockSite`、`blockedHosts` を置く。`blockSite` は、すでにあれば作った時刻を変えない（`INSERT OR IGNORE`）。`unblockSite` は、一覧になければ `not_found` の誤りにする。どちらも、カテゴリがなければ `not_found` の誤りにする。

### トピックの成績

`TopicStatsCounts` に `blockedSite` を足し、`reason_code = 'blocked-site'` を数える。`topicRejected` の合計にも足す。記事にならなかった候補だからである。
`topRejectedSites` は `site_host` で数え、項目の名前を `host` に変える。空のホスト名と `blocked-site` の候補は数えない。除外したサイトは利用者がすでに扱ったので、上位に出し続けると、まだ扱っていないサイトが隠れるからである。

### API

- `GET /api/v1/categories/:id/site-stats`：`siteStatsSchema` の応答。
- `PUT /api/v1/categories/:id/blocked-sites/:host`：除外し、`{ host, blockedAt }` を返す。
- `DELETE /api/v1/categories/:id/blocked-sites/:host`：除外をやめ、204を返す。

`packages/client` に `siteStats`、`blockSite`、`unblockSite` を足す。

### 画面

`apps/web/src/settings/SiteStats.tsx` に `SiteStatsSection` を作り、カテゴリの画面の `TopicStatsSection` の次に置く。

- 見出しは「出典のサイト」。期間の始まりの日を説明に入れる。
- 除外中のサイトがあれば、先頭に「除外中のサイト」の一覧を置き、各行に「除外をやめる」を置く。
- その下に、サイトの行を全件並べる。各行は、ホスト名と、`dl` で7つの数を持つ。トピックの成績と同じ並べ方にする。開いた記事、スター、外れは、記事の数に対する件数と割合で示す。ホスト名が空の行は「不明」と出し、操作を置かない。
- 除外中のサイトの行は「除外中」の印を付け、「このサイトを候補から除く」の代わりに何も置かない。取り消しは先頭の一覧で行う。
- 除外と取り消しは確認を出さず、終わったら知らせを出し、成績を問い合わせ直す。失敗は `ErrorNotice` で区画に出す。
- ボタンの名前は見える文言のまま（「このサイトを候補から除く」など）にし、どのサイトのボタンかは、ホスト名の見出しを `aria-describedby` で結んで伝える。名前にホスト名を入れると、見える文言と読み上げる名前が食い違うからである。
- 除外したあとは、先頭の一覧のそのサイトの「除外をやめる」へフォーカスを移す。取り消したあとは、そのサイトの行の「このサイトを候補から除く」へ移し、行がなければ区画の見出しへ移す。押したボタンが消えて、フォーカスが行き場を失わないようにするためである。

「このサイトのフィードを探す」は、`FormDialog` で `AddFeedForm` を開く。見出しは「購読フィードを追加」にする。
`AddFeedForm` に `discoverUrl` を足す。渡されたときは、URLの欄にその値を入れ、開いたときに1回だけ発見の処理を呼ぶ。
見つかったフィードが1つでも、選ぶ欄に出して、利用者が「選んだフィードを追加」を選ぶまで購読しない。利用者が欄に打ち込んで送信したときは、これまでどおり1つなら購読する。開いただけで購読フィードが増えると、要約や翻訳の切り替えを選ぶ前に登録されてしまうからである。
カテゴリの初期値は、ニュースのカテゴリならそのカテゴリ、イベントのカテゴリなら「なし」である。

トピックの成績の内訳に「サイトの除外」を足す。よく除外されるサイトは `host` を出す。

## Risks / Trade-offs

- ［候補の表の作り直しが長くかかる］→ 候補は30日で消えるので、行の数は限られる。作り直しの前に、移行の仕組みがデータベースの写しを取る。
- ［Googleの転送用のURLを解決したあとで除外する］→ 解決のための取得は除外の前に起きる。判定のタスクとページの取得は起きないので、LLMの呼び出しは減る。解決の前に除外すると取得元の処理に一覧を渡す必要があり、今回は採らない。
- ［サイトを除外すると、そのサイトの記事がまったく届かなくなる］→ 除外中のサイトは区画の先頭に並べ、すぐに取り消せる。取り消したあとも、すでに既読にした候補は戻らない。
- ［`topRejectedSites` の項目の名前を変える］→ 使っているのはWebの画面だけで、同じ変更で直す。`docs/api.md` に書く。
- ［ホスト名の不明な保存済みの候補が残る］→「不明」の1行にまとめる。候補は30日で消えるので、いずれなくなる。
