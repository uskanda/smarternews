# Proposal

## Why

ダイジェストは時刻ごとに、期間内の記事から作る。ある名前の1か月分、検索の結果、スターの記事のように、利用者が選んだ集まりをまとめる手段はない。
GitHubのissueの233番は、Webの一覧からその一覧の記事をまとめたダイジェストを作れるようにすることを求めている。

## What Changes

- Webの名前の記事の一覧、検索の結果、スターの一覧に「この一覧をまとめる」を足す。
- サーバーは、対象（名前、検索語と絞り込み、スター）の記事を画面と同じ条件で引き直し、新しい順に200件までを既存のダイジェストのタスクに渡す。
- 結果は、きっかけを「一覧」とし、対象の説明とともにダイジェストの表に保存する。期間の列には、入力の記事の時刻の最古と最新を入れる。
- 一覧のダイジェストは、時刻のダイジェストと同じ1日の上限 `limits.digestsPerDay` で数える。
- 次の時刻のダイジェストの期間の始めは、一覧のダイジェストを除いて決める。
- アプリは、一覧のダイジェストでは通知を出さない。
- ダイジェストのタスクの入力に、任意の `scope`（対象の説明）を足す。
- Webとアプリのダイジェストの画面は、一覧のダイジェストに「一覧」のラベルと、期間の代わりに対象の説明を出す。

## Capabilities

### New Capabilities

なし。

### Modified Capabilities

- `digests`: 一覧のダイジェストの作り方、上限の共有、期間の計算から外すこと、通知しないこと、タスクの入力 `scope` を足す。仕様 `digests` はまだ `openspec/specs` に無いので、ADDEDの要件として書く

## Impact

- `packages/core`: 移行 `040_list_digests.sql` で `digests` を作り直し、`trigger` に `list` を、列 `target` を足す。
- `packages/core`: APIの型、`digestPeriodStart`、`listDigests`、`saveDigest` を変え、対象の記事を集める `listDigestArticles` を足す。ダイジェストのタスクの入力、`makeDigest` を変え、`DigestWorker` に `buildFromList` を足す。
- `apps/server`: `POST /digests` の本文の `target` と、`GET /digests` の絞り込み `kind=period` を受ける。
- `packages/client`: APIの呼び出しの型を合わせる。
- `apps/web`: 3つの一覧の操作と、ダイジェストの画面のラベルと対象の説明を足す。
- `apps/mobile`: 通知の確認を絞り込みつきにし、ダイジェストの画面にラベルと対象の説明を出す。
- LLMの呼び出しは、操作1回につき既存のダイジェストのタスク1回である。
