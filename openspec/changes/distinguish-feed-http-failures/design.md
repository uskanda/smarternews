# Design

## Context

購読フィードの取得は `packages/core/src/feeds/ingest.ts` の `fetchFeed` が行う。2xxと304以外の応答では `HTTP status N: url` という文字列のエラーを投げる。
`recordFetchFailure` は、それを `last_error` に入れて `failure_count` を1つ増やす。
次の取得の時刻は保存しない。`db/feeds.ts` の `nextFetchFrom` が、求めるたびに計算する。元にするのは、最後の取得の時刻と、失敗の回数で2倍に延ばした間隔である。
`dueFeeds` とAPIの `nextFetchAt` は、この値を使う。
Webページの購読フィードの取得は `PageFetcher` を通り、HTTPの失敗は `PageResult` の `http` の結果として返る。この結果は、応答のヘッダーを持っていなかった。
画面の状態の判定は、`packages/client` の `feedState` に1か所でまとまっている（show-feed-fetch-stateの変更）。動機は `proposal.md` の「Why」を参照する。

## Goals / Non-Goals

**Goals:**

- 計算で求める次の取得の時刻へ、Retry-Afterの時刻を組み込む。`dueFeeds`、`nextFetchAt`、画面の「次の取得」は、同じ1つの値を使う。
- 410を、表示用の文字列でなく列で判定できるようにする。
- 失敗の理由の文字列と、登録のときの拒否の文言は変えない。

**Non-Goals:**

- 410での自動の無効化（add-feed-statsの決定、`grilling.md` のQ2）。
- 手動の取得でRetry-Afterを守ること（Q5）。
- 全文の取得でRetry-Afterを使うこと（Q6）。
- Androidアプリの表示。アプリは取得の状態を表示していない。
- LLMの呼び出し。

## Decisions

### 2つの列を足す

スキーマの変更 `022_feed_http_failures.sql` で、`feeds` に `retry_after_until` と `gone_at` を足す。
`retry_after_until` は、Retry-Afterの示す、次の取得を始めてよい最も早い時刻である。失敗のたびに上書きする（Retry-Afterがなければ空にする）。成功すると空にする。
`gone_at` は、410なら `coalesce(gone_at, 今)`、410以外の失敗と成功なら空にする。「続けて受けた410のうち最初の時刻」を、列1つで持てる。
失敗の種類を表す列（Q1のC）にしなかったのは、画面で区別するのが410だけだからである。

### 次の取得の時刻は遅いほう

`nextFetchFrom` は、2倍に延ばした間隔による時刻と `retry_after_until` の、遅いほうを返す。Retry-Afterの示す時刻のほうが早ければ、今と同じ間隔に従う。
時刻を保存せずに計算する今の作りは変えない。取得周期を変えたとき、次の取得の時刻がすぐに新しい周期で求まるからである。

### HTTPの失敗を FeedHttpError にする

`download` と `downloadPage` は、HTTPの失敗で `FeedHttpError`（`status` と、Retry-Afterの生の値を持つ）を投げる。メッセージは今と同じ `HTTP status N: url` にする。`feedErrorLabel` と登録のときの拒否の文言は、このメッセージを読むので、変わらない。
`fetchFeed` の `catch` 節が、このエラーから `gone` と `retryAfterUntil` を取り出し、`recordFetchFailure` に渡す。Retry-Afterを読むのは、429と503のときだけである。

### Retry-Afterを読む関数は純粋関数

`fetch/retry-after.ts` の `parseRetryAfter(value, now)` は、0以上の整数の秒数か、HTTPの日付を読む。結果は `now` から24時間までに切り詰める。読めない値と、`now` より後でない時刻は `null` にする。
日付として読むのは英字を含む値だけにする。`-60` や `1.5` を `Date.parse` が日付として読んでしまうのを避けるためである。

### PageResult に省略してよい retryAfter を足す

`PageResult` の `http` の結果に `retryAfter?: string` を足す。ヘッダーがないときは項目そのものを持たせない。全文の取得は、この値を読まない。

### 画面の状態 gone

`FeedState` に `gone` を足し、強さの順を `gone > failed > stale > paused` にする。`feedState` は `goneAt !== null` なら `gone` を返す。410の失敗では `lastError` も入っているので、`gone` を先に判定する。
一覧の上の帯は、エラーの色で配信の終了と日付を出し、「設定で登録を解除する」と「いま取得」を置く。登録の解除は、削除する件数を見せて確認する今の設定の画面で行う（Q3）。
左のペインの印は、取得の失敗と同じ三角の形とエラーの色にし、読み上げ名で区別する。設定の画面では「取得に失敗」の代わりに「配信終了」の印を出す。絞り込み（`needsLook`）は `lastError` を見ているので、そのまま対象になる。

### 仕様の差分の置き場所

左のペインの印の要件は、show-feed-fetch-stateの変更で `web-reader` に置かれた。今回の印の要件も `web-reader` に置き、`web-shell` は変えない。
show-feed-fetch-stateの要件は、まだ `openspec/specs/` に取り込まれていない。そのため、今回の差分は既存の要件を書き換えず、ADDEDの要件として足す。

## Risks / Trade-offs

- サイトが毎回24時間を指定する：自動の取得は1日1回になる。手動の「いま取得」はすぐに取得するので、利用者は直ったことを確かめられる。
- 410のあとにサイトが配信を再開する：次の成功で `gone_at` が消え、取得周期も元に戻る。自動で無効にしないので、取りこぼさない。
- 503のRetry-Afterで保守の作業が長引く：上限の24時間で切り詰めるので、取得が止まり続けることはない。
