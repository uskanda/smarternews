# Tasks

## 1. 保存

- [ ] 1.1 マイグレーションで `feeds.topic_source`、`articles.summarized_in`、`candidates.feed_article_id` を足し、`candidates` の `source_kind` に `subscription` を加える。`database.test.ts` で、新しい列、CHECK制約、既存の候補が残ることを確かめる
- [ ] 1.2 `api.ts` に `topicSource`、`subscription`、`summarizedIn`、`feedArticles` を足し、`db/feeds.ts` で設定の保存と、カテゴリのない購読フィードでの有効化の拒否を行う。`feeds.test.ts` で確かめる
- [ ] 1.3 設定ファイルの書き出しと読み込みで `topicSource` を扱い、`examples/settings.example.yaml` を更新する。`settings-file.test.ts` で往復と、書かれていないときに値を保つことを確かめる

## 2. 実行

- [ ] 2.1 `config.ts` の `limits` に `subscriptionCandidatesPerRun`（既定60）を足し、`examples/config.example.yaml` を更新する。`config.test.ts` で既定値を確かめる
- [ ] 2.2 対象の配信記事を読み出す処理を足す。設定が無効のフィード、止めたフィード、ほかのカテゴリ、期間外、重複、フィルターで隠した記事、判定済みのURLを除くこと、上限と新しい順を `articles.test.ts` で確かめる
- [ ] 2.3 `run.ts` で配信記事を候補に加え、全トピックに結び付ける。採用したら `summarized_in` を記録し、ページを取れないときは配信された内容を書く処理に渡す。設定が無効ならいまと同じ動きになることも含めて `collect.test.ts` と `write.test.ts` で確かめる
- [ ] 2.4 `topicStats.ts` の取得元ごとの集計に `subscription` を加え、`topicStats.test.ts` で確かめる

## 3. API

- [ ] 3.1 記事の詳細で `summarizedIn` と `feedArticles` を返す。`articles.test.ts`（core）で確かめる
- [ ] 3.2 購読フィードのAPIで `topicSource` を受け付け、カテゴリのない購読フィードでは拒む。記事の詳細のAPIの項目とあわせて `feeds-api.test.ts` と `articles.test.ts`（server）で確かめ、`docs/api.md` を更新する

## 4. 画面

- [ ] 4.1 Webの購読フィードの設定に「トピックの取得元にする」の切り替えを足し、カテゴリのない購読フィードでは出さない。`feed-dialogs.test.tsx` で確かめる
- [ ] 4.2 Webの実行の詳細とトピックの集計で `subscription` を「購読フィード」と表示する。`runs.test.tsx` で確かめる
- [ ] 4.3 Webの本文の画面に「この記事をまとめた生成記事」と「まとめた配信記事」を出す。`reader.test.tsx` で確かめる
- [ ] 4.4 アプリの本文の画面に同じ2つのリンクを出す。`article.test.tsx` で確かめる

## 5. 仕上げ

- [ ] 5.1 `make verify` と `openspec validate use-subscriptions-as-topic-sources --strict` を通す
