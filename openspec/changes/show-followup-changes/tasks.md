# Tasks

## 1. 本文の生成のタスク

- [x] 1.1 `tasks.test.ts`に、既存の記事があるときだけプロンプトにupdateNoteの指示が入ること、updateNoteが数値・空・301文字ならnullでほかの項目は通ることのテストを足し、失敗を確かめる
- [x] 1.2 `tasks.ts`の`write`に`updateNote`の出力とプロンプトを足し、1.1のテストが通ることを確かめる

## 2. データベースとパイプライン

- [x] 2.1 マイグレーション`022_update_notes.sql`で列を足し、`database.test.ts`が通ることを確かめる
- [x] 2.2 `followup.test.ts`に、書き直しでupdateNoteが保存されること、次の書き直しでnullなら空に戻ること、mode "follow"では保存されないこと、updateNoteだけが不正でも記事が保存されることのテストを足し、失敗を確かめる
- [x] 2.3 `articles.ts`の`reviseArticle`、`insertArticle`、`addRefs`と`run.ts`を変え、2.2のテストが通ることを確かめる

## 3. API

- [x] 3.1 `articles.test.ts`に、`isNew`（読む→書き直す→開く、未読のまま2回、一度も読まれていない）と`previousArticles`（新しい順、20件まで、輪）のテストを足し、失敗を確かめる
- [x] 3.2 `api.ts`の型と`articles.ts`の読み出しを変え、3.1のテストが通ることを確かめる
- [x] 3.3 `docs/api.md`に足した3つの項目を書く

## 4. Webの画面

- [ ] 4.1 `reader.test.tsx`に、「今回の更新で加わったこと」の区画、「新しい出典」の印、前の記事の一覧、一覧の行の「更新：…」（既読でも同じ、検索の結果では抜粋）のテストを足し、失敗を確かめる
- [ ] 4.2 `ArticleView.tsx`と`ArticleRow.tsx`を変え、4.1のテストが通ることを確かめる

## 5. 全体の確認

- [ ] 5.1 `make verify`と`openspec validate show-followup-changes --strict`が通ることを確かめる
