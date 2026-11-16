# Tasks

## 1. 保存と理由の種類

- [x] 1.1 `reasons.ts` に、理由の種類 `missed-follow-up` と `stopped-follow-up` を足す。文は見出しを入れた日本語と英語にする。`reasons.test.ts` で確かめる
- [x] 1.2 `033_follow_up_marks.sql` の移行で、`articles` に `follow_ups_stopped` の列を足す。`candidates` を作り直し、CHECK制約に2つの値を足す。既存の候補の行とid、`reason_code`、`candidate_topics` が残ることを `database.test.ts` で確かめる。新しい値を保存できることも確かめる

## 2. 実行での除外

- [x] 2.1 `ArticleDigest` に `missed` と `followUpsStopped` を足し、`rejectCandidates` が見出しを受け取るようにする
- [x] 2.2 `writeStories` で、相手の記事に印のある話題を基準未満の判定より前に除外する。外れの印のある記事、止めた印のある記事、基準未満の続報、期間を過ぎた続報、印のない記事の書き直しを `followup.test.ts` で確かめる
- [x] 2.3 `findEventByKey` で生成のあとに見つけた同じイベントの記事に印があるとき、書き直さずに除外する。`events.test.ts` で確かめる

## 3. API

- [x] 3.1 `PATCH /api/v1/articles/:id` と記事の詳細に `followUpsStopped` を足す。切り替え、既読の不変、配信記事での400を `apps/server/src/articles.test.ts` で確かめる
- [x] 3.2 `rejectedByMark` をトピックの成績に足し、`topicRejected` に含める。`topicStats.test.ts` で確かめる
- [x] 3.3 `docs/api.md` に `followUpsStopped`、`PATCH` の説明、`rejectedByMark`、理由の種類を書き足す

## 4. Web

- [x] 4.1 `ArticleView.tsx` の本文のペインに続報の停止の切り替えのボタンを足し、記事の印の変更に `followUpsStopped` を通す。ボタンの切り替えと送る値、配信記事での非表示を `reader.test.tsx` で確かめる
- [x] 4.2 `TopicStats.tsx` のトピックの成績に「印のある記事の続報」の行を足し、`settings.test.tsx` で確かめる

## 5. 確認

- [ ] 5.1 `make verify` と `openspec validate skip-marked-follow-ups --strict` が通ることを確かめる
