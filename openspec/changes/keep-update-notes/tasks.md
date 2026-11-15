# Tasks

## 1. 保存とmigration

- [x] 1.1 `database.test.ts`に033のmigrationのテストを足して失敗を確かめる。既存の`update_note`が`updated_at`の時刻で写り、文のない記事は写らず、記事を消すと行も消える
- [x] 1.2 `033_article_update_notes.sql`で表と索引を作り、既存の文を写して、1.1のテストが通ることを確かめる
- [x] 1.3 `articles.test.ts`と`followup.test.ts`に、書き直しごとの文が表に残るテストを足して失敗を確かめる。文のない回は行を残さない
- [x] 1.4 `reviseArticle`で文のある回を表に足し、説明のコメントを直して、1.3のテストが通ることを確かめる

## 2. API

- [x] 2.1 `articles.test.ts`に`updateNotes`のテストを足して失敗を確かめる。読んだあとの2回が古い順、最新の回が文なしでも前の文が残る、読んでいない記事は最新の1回分だけ（文なしなら空）、再び読んだあとはそれより前が出ない、一覧の`updateNote`は今のまま
- [x] 2.2 `articleSchema`に`updateNotes`を、`articles.ts`に`updateNotesOf`を足す。`Article`を組み立てるテストの値には`updateNotes: []`を足す。2.1のテストと型の検査が通ることを確かめる
- [x] 2.3 `docs/api.md`の記事の詳細の表に`updateNotes`を足す

## 3. Webの本文の画面

- [x] 3.1 `reader.test.tsx`に、1件で最新の回なら今の見出し、2件なら「前回読んでから加わったこと」で日時付きの順、1件でも最新の回でなければ並べる形、のテストを足して失敗を確かめる
- [x] 3.2 `ArticleView.tsx`を`updateNotes`で出すように直し、3.1のテストが通ることを確かめる

## 4. 確認

- [x] 4.1 `make verify`と`openspec validate keep-update-notes --strict`が通ることを確かめる
