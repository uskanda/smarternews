# Tasks

## 1. 保存と理由の種類

- [x] 1.1 理由の種類 `missed-follow-up` と `stopped-follow-up` を、見出しを入れた日本語と英語の文とともに足し、`reasons.test.ts` が通ることを確かめる
- [x] 1.2 移行 `032_follow_up_marks.sql` で `articles.follow_ups_stopped` を足し、`candidates` を作り直してCHECK制約に2つの値を足す。既存の候補の行、id、`reason_code`、`candidate_topics` が残り、新しい値を保存できることを `database.test.ts` で確かめる

## 2. 実行での除外

- [x] 2.1 `ArticleDigest` に `missed` と `followUpsStopped` を足し、`rejectCandidates` が見出しを受け取るようにする
- [x] 2.2 `writeStories` で、相手の記事に印のある話題を基準未満の判定より前に除外する。外れの印のある記事、止めた印のある記事、基準未満の続報、期間を過ぎた続報、印のない記事の書き直しを `followup.test.ts` で確かめる
- [x] 2.3 生成のあとで同じイベントの記事に印があると分かった場合に、書き直さずに除外する。`events.test.ts` で確かめる

## 3. API

- [x] 3.1 記事の詳細と `PATCH /api/v1/articles/:id` に `followUpsStopped` を足す。切り替え、既読の不変、配信記事での400を `apps/server/src/articles.test.ts` で確かめる
- [x] 3.2 トピックの成績に `rejectedByMark` を足し、`topicRejected` に含める。`topicStats.test.ts` で確かめる
- [x] 3.3 `docs/api.md` に `followUpsStopped`、`PATCH` の説明、`rejectedByMark`、理由の種類を書き足す

## 4. Web

- [ ] 4.1 本文のペインに続報の停止の切り替えのボタンを足し、記事の印の変更に `followUpsStopped` を通す。ボタンの切り替えと送る値、配信記事での非表示を `reader.test.tsx` で確かめる
- [ ] 4.2 トピックの成績に「印のある記事の続報」の行を足し、`settings.test.tsx` で確かめる

## 5. 確認

- [ ] 5.1 `make verify` と `openspec validate skip-marked-follow-ups --strict` が通ることを確かめる
