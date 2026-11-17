# Design

## Context

購読フィードの取得は `packages/core/src/feeds/ingest.ts` の `fetchFeed` が行う。取得は `Fetcher`（`fetch/http.ts`）を通り、`#send` が301、302、303、307、308を最大5回まで自分でたどる。返すのは最後のURLだけで、途中の状態コードは捨てていた。
Webページの購読フィードも `PageFetcher`（`fetch/pages.ts`）から同じ `Fetcher` の `get` を通る。
配信記事は `feed_id` と `item_key`（項目の識別子。無ければ項目のURL）で見分けている。購読フィードのURLは識別に使っていないので、URLを変えても配信記事は残る。
更新の要求（`PATCH /feeds/:id`）は同期の `updateFeed` を直接呼び、スキーマ `feedUpdateSchema` は `url` を除いていた。
動機は `proposal.md` の「Why」を参照する。

## Goals / Non-Goals

**Goals:**

- 恒久的な転送の行き先を、取得の層の1か所で求める。
- 手動の変更は、登録と同じ検査と保存の流れ（`firstFeed`、`firstPage`、`storeItems`）を使う。
- URLの変更の後も、スター、注釈、既読を残す。

**Non-Goals:**

- Androidアプリでの表示（`grilling.md` のQ1）。
- 2つの購読フィードの統合（Q3）。
- 設定ファイルの読み込みでのURLの変更。
- LLMの呼び出し。

## Decisions

### 行き先は Fetcher が求める

`#send` は、最初の要求から続く301と308の行き先を `permanentUrl` として返す。302、303、307を受けたら、それより後の転送は数えない。転送が無いか、最初が一時的な転送なら `null` である。
`HttpResponse` と `BytesResponse` に `permanentUrl` を足し、`PageResult` の成功の結果にも渡す。
転送の状態コードを知っているのは `#send` だけなので、ここで求めるのがいちばん単純である。

### 4つの列

スキーマの変更 `032_feed_url_moves.sql` で、`feeds` に次の列を足す。

- `move_target`：数えている行き先。
- `move_count`：同じ行き先への転送が続けて起きた、成功した取得の数。
- `moved_from`：書き換える前のURL。
- `moved_at`：書き換えた時刻。

APIの `Feed` には `movedFrom` と `movedAt` だけを出す。数は内部の状態なので出さない。

### 数え方

`fetchFeed` は、取得に成功したとき（項目を保存したときと304のとき）、`recordFetchSuccess` と同じトランザクションで `followMove` を呼ぶ。

- 行き先が `null` か、正規化すると今のURLと同じ：数を0に戻し、行き先を空にする。
- 行き先を正規化したものが、ほかの購読フィードのURL：何もしない（Q3）。
- 行き先が数えている行き先と違う：行き先を入れ替えて、数を1にする。
- 同じ：数を1つ増やす。3になったら、`url` を行き先に書き換え、`moved_from` と `moved_at` を記録し、数と行き先を空にする。

失敗のときは `followMove` を呼ばないので、数は変わらない（Q7）。Webページの購読フィードでは、セレクターで記事を取り出せないと `parsePage` が投げて失敗になるので、記事を取り出せた取得だけが数に入る（Q8）。
304の応答も数える。条件付きの値に一致したことは、行き先が同じフィードを配っている証拠になる。

### 手動の変更は changeFeedUrl

`ingest.ts` に `changeFeedUrl(deps, id, patch)` を足す。URLを正規化し、今のURLと同じなら `updateFeed` に任せる。違えば、登録済みのURLを拒否し、`firstFeed` か `firstPage` で取得する。
Webページの購読フィードの検査には、要求のセレクターを使う。要求に無ければ、今のセレクターを使う。
検査に通ったら、1つのトランザクションで次のことをする。

- `updateFeed` でほかの変更を保存する。
- URLを書き換えて、取得の記録の列を空にする。
- `storeItems` で項目を保存し、`recordFetchSuccess` で成功を記録する。

`updateFeed` は同期の処理のまま、URLを受け取らない（型は `Omit<FeedUpdate, "url">`）。サーバーの `PATCH /feeds/:id` は、要求に `url` があるときだけ `changeFeedUrl` を `poller.exclusive` の中で呼ぶ。登録と同じく、取得の直列化に従わせるためである。

### 画面

`EditFeed` の先頭にURLの欄を足す。URLが変わったときだけ `url` を送る。URLを送って待つ間は、保存のボタンを押せなくし、確かめている途中であることをボタンの文言で示す。サーバーの `url` の欄のエラーは、既存の `fieldMessage` でURLの欄の下に出す。
URLの欄が編集の欄の最初の入力欄になるので、編集を開いたときのフォーカスは「URL」の欄に移る。「その場の編集の欄を開いたときのフォーカス」（align-inline-edit-focus）は最初の入力欄へ移すと定めている。そのため、要件は変えず、align-inline-edit-focusとadd-settings-shortcutsの購読フィードのシナリオの「名前」を「URL」に直す。
`FetchState` は、`movedAt` があれば、「転送によりURLを変更」と、日時と元のURLを文で出す。`feedState` の判定は変えないので、問題のある購読フィードの判定には入らない。

## Risks / Trade-offs

- 一時的な誤りで301を3回返すサイト：書き換わるが、元のURLが画面に残るので、利用者は手で戻せる。
- 手放されたドメインへの転送：行き先でフィードとして読めた取得だけを数えるので、フィードを配らないページへは書き換わらない。
- 識別子が無く、リンクが相対の項目：項目のURLは購読フィードのURLを基準に解決するので、ホストが変わると別の項目として保存される。識別子のある項目と、リンクが絶対の項目は残る。
- 書き換えの前に書き出した設定ファイルを読み込む：元のURLの購読フィードが新しくできる。その転送先は登録済みなので書き換わらず、取得を続ける。読み込みは利用者の操作でだけ走る。
