# Tasks

## 1. 版の表と記録

- [ ] 1.1 移行の030で `topic_versions` と `category_versions` を作り、既存のトピックとカテゴリに最初の版を入れる。`packages/core/src/db/database.test.ts` で確かめる
- [ ] 1.2 `api.ts` に版のスキーマを足し、`db/versions.ts` に版の記録と一覧を書く。作成、編集、解釈で版が1つでき、同じ値の保存、有効と無効の切り替え、「解釈し直す」では版ができないことを `packages/core/src/db/versions.test.ts` で確かめる
- [ ] 1.3 カテゴリの作成と更新で、最低重要度か件数上限が変わったときだけ版を作る。`versions.test.ts` で確かめる
- [ ] 1.4 設定ファイルの読み込みで、既存のトピックとカテゴリにつき版を1つにまとめる。`packages/core/src/settings-file.test.ts` で確かめる
- [ ] 1.5 実行の解釈で契機「解釈」の版ができることを `packages/core/src/pipeline/run.test.ts` で確かめる
- [ ] 1.6 `restoreTopicVersion` を書く。解釈済みの版と未解釈の版、解釈の時刻、取得元の印、新しい版と古い版、別のトピックの版を `versions.test.ts` で確かめる

## 2. 成績の切れ目

- [ ] 2.1 `topicStats` を期間で数える形にし、切れ目と前と後の成績を足す。前と後の分かれ方、切れ目がない場合、全体の数が変わらないことを `packages/core/src/db/topicStats.test.ts` で確かめる

## 3. API

- [ ] 3.1 3つの経路を足す。応答、404、LLMを呼ばないことを `apps/server/src/topic-versions-api.test.ts` で確かめる
- [ ] 3.2 `packages/client` に3つの呼び出しを足し、`packages/client/src/api.test.ts` で確かめる
- [ ] 3.3 `docs/api.md` に表の行と版の節を足す

## 4. Webの画面

- [ ] 4.1 トピックの編集に履歴の区画と「この版に戻す」を置く。履歴の表示、ダイアログを経て戻ること、保存していない変更があると押せないことを `apps/web/src/settings/topic-history.test.tsx` で確かめる
- [ ] 4.2 成績の行に変更前と変更後の2列を置く。`topic-history.test.tsx` で確かめる
- [ ] 4.3 カテゴリの画面に最低重要度と件数上限の履歴を置く。`topic-history.test.tsx` で確かめる

## 5. 全体の確認

- [ ] 5.1 `make verify` を通す
