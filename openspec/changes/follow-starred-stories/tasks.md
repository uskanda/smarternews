# Tasks

## 1. 集約の入力

- [x] 1.1 `038_previous_article_index.sql`で`articles (previous_article_id)`に索引を足し、データベースのテストが通ることを確かめる
- [x] 1.2 `db/articles.test.ts`に`starredStoryTips`のテストを先に書き、失敗することを確かめる。対象は、90日の境界、20件の上限、後の記事への置き換え、枝分かれと輪の扱いである。ほかのカテゴリ、イベント、スターのない記事を除くことも確かめる
- [x] 1.3 `starredStoryTips`を実装し、1.2のテストが通ることを確かめる
- [x] 1.4 `followup.test.ts`に実行の処理のテストを先に書き、失敗することを確かめる。30日前に更新したスター付きの記事が集約の`existingArticles`に入り、続く候補は前の記事を指す新しい記事になる。スターのない30日前の記事は入らない。偽のTaskRunnerで確かめる
- [x] 1.5 `groupStories`に`STARRED_LOOKBACK_MS`と`STARRED_STORIES_LIMIT`を足し、1.4のテストが通ることを確かめる

## 2. API

- [x] 2.1 `db/articles.test.ts`にテストを先に書き、失敗することを確かめる。対象は、`laterArticles`、`followsStarred`、`unreadFollowUps`、絞り込み`starredStory`である。既読にすると`unreadFollowUps`が0になることも含める
- [x] 2.2 `api.ts`の型と`db/articles.ts`の問い合わせを足し、2.1のテストが通ることを確かめる
- [x] 2.3 `docs/api.md`に新しい項目と絞り込みを書き、型と食い違わないことを読み合わせて確かめる

## 3. Web

- [x] 3.1 `reader.test.tsx`にテストを先に書き、失敗することを確かめる。対象は、その後の記事の節と、一覧の「続報あり」の印の表示と非表示である
- [x] 3.2 `ArticleView.tsx`と`ArticleRow.tsx`を変え、3.1のテストが通ることを確かめる

## 4. 通知

- [x] 4.1 `notify.test.ts`にテストを先に書き、失敗することを確かめる。「重要度5だけ」では重要度3の続報と書き直されたスター付きの記事を通知し、「出さない」では何も通知しない
- [x] 4.2 `planNotifications`を変え、4.1のテストが通ることを確かめる
- [x] 4.3 `check.ts`で「重要度5だけ」のときに`starredStory=true`でも問い合わせて結果をまとめ、アプリのテストと型の検査が通ることを確かめる

## 5. 全体の確認

- [x] 5.1 `make verify`と`openspec validate follow-starred-stories --strict`が通ることを確かめる
