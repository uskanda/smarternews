# Tasks

## 1. 本文の生成のタスク

- [x] 1.1 `tasks.test.ts`にupdateNoteのテストを足し、失敗を確かめる。プロンプトの指示は既存の記事があるときだけ入る。数値・空・301文字のupdateNoteはnullになり、ほかの項目は通る
- [x] 1.2 `tasks.ts`の`write`に`updateNote`の出力とプロンプトを足し、1.1のテストが通ることを確かめる

## 2. データベースとクローラー

- [x] 2.1 `027_update_notes.sql`で列を足し、`database.test.ts`が通ることを確かめる
- [x] 2.2 `followup.test.ts`にupdateNoteの保存のテストを足し、失敗を確かめる。書き直しで保存し、次の書き直しでnullなら空に戻す。新しい記事を作る続報では保存しない。updateNoteだけが不正でも記事は保存する
- [x] 2.3 `articles.ts`の`reviseArticle`、`insertArticle`、`addRefs`と`run.ts`を変え、2.2のテストが通ることを確かめる

## 3. API

- [x] 3.1 `articles.test.ts`に`isNew`のテストを足し、失敗を確かめる。読む→書き直す→開く、未読のまま2回、一度も読まれていない、の3つの場合を確かめる
- [x] 3.2 `articles.test.ts`に`previousArticles`のテストを足し、失敗を確かめる。新しい順で20件までになり、輪になっていても止まる
- [x] 3.3 `api.ts`の型と`articles.ts`の読み出しを変え、3.1と3.2のテストが通ることを確かめる
- [x] 3.4 `docs/api.md`に足した3つの項目を書く

## 4. Webの画面

- [x] 4.1 `reader.test.tsx`に本文の画面のテストを足し、失敗を確かめる。「今回の更新で加わったこと」の区画、「新しい出典」の印、前の記事の一覧を確かめる
- [x] 4.2 `reader.test.tsx`に一覧の行の「更新：」で始まる1行のテストを足す。既読でも同じで、検索の結果では抜粋が優先される
- [x] 4.3 `@smarternews/client`に年つきの日付の`formatDate`を足し、`time.test.ts`が通ることを確かめる
- [x] 4.4 `ArticleView.tsx`と`ArticleRow.tsx`を変え、4.1と4.2のテストが通ることを確かめる

## 5. 全体の確認

- [x] 5.1 `make verify`の各項目を走らせ、この変更の分に失敗がないことを確かめる
- [x] 5.2 `openspec validate show-followup-changes --strict`が通ることを確かめる
