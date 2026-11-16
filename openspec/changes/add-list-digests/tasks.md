# Tasks

どの作業も、失敗するテストを先に書いてから実装する。テストは実際のLLMを呼ばない。

## 1. 保存とタスク

- [x] 1.1 `040_list_digests.sql` の移行で `digests` を作り直し、`trigger` に `list` を、列 `target` を足す。既存の行が残ることを `database.test.ts` で確かめる
- [x] 1.2 `api.ts` に `list` のきっかけ、`digestTargetSchema`、ダイジェストの `target`、`POST /digests` の本文、`GET /digests` の `kind` を足す
- [x] 1.3 `digestPeriodStart` が一覧のダイジェストを無視すること、`listDigests` の `kind=period` を `digests.test.ts` で確かめる
- [x] 1.4 `listDigestArticles` が3種類の対象で画面と同じ条件・新しい順・200件までを返すことを確かめる
- [x] 1.5 `tasks.ts` のダイジェストのタスクの入力に `scope` を足し、プロンプトの文が置き換わることを `tasks.test.ts` で確かめる

## 2. 作る処理とAPI

- [x] 2.1 `makeDigest` と、`DigestWorker` の `buildFromList` を書く。上限の共有、記事が0件、作っている最中の場面を確かめる
- [x] 2.2 `apps/server/src/app.ts` の `POST /digests` と `GET /digests` を変える。`list` の保存、409、絞り込みをサーバーを通したテストで確かめる
- [x] 2.3 `packages/client/src/api.ts` の呼び出しの型を合わせる

## 3. 画面

- [x] 3.1 Webの名前の一覧、検索の結果、スターの一覧に「この一覧をまとめる」を足し、正しい対象を送ることを確かめる
- [x] 3.2 Webのダイジェストの画面に、ラベル「一覧」と対象の説明を出す
- [x] 3.3 `check.ts` で、アプリの通知の確認を `kind=period` つきにし、一覧のダイジェストだけが新しいときに通知しないことを確かめる
- [x] 3.4 `DigestsScreen.tsx` で、アプリのダイジェストの画面にラベル「一覧」と対象の説明を出す

## 4. 仕上げ

- [x] 4.1 `make verify` を通し、`openspec validate add-list-digests --strict` を通す
