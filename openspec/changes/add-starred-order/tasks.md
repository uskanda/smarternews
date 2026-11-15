# Tasks

## 1. サーバーの保存と一覧

- [x] 1.1 `database.test.ts` に移行のテストを書き、失敗を確かめてから移行の033を足して通す。既存のスターに `updated_at` が入ることと、`list_views` が `starred` を「スター」の項目にだけ受けることを確かめる
- [x] 1.2 `articles.test.ts` にスターの時刻のテストを書き、失敗を確かめてから `setArticleFlags` と `starredAt` を直して通す。付ける、付け直す、外す、の3つを確かめる
- [x] 1.3 `articles.test.ts` にスターを付けた順の一覧のテストを書き、失敗を確かめてから `listArticles` と続きの値を直して通す。並び、続きの値、ほかの並び順の続きの値の拒否、`starred` のない一覧での拒否を確かめる
- [x] 1.4 `search.test.ts` に「スターだけ」のテストを書き、失敗を確かめてから `searchArticles` と検索の条件を直して通す。隠した重複が出ることも確かめる

## 2. 表示の設定と設定ファイル

- [x] 2.1 `list-views.test.ts` などに表示の設定のテストを書き、失敗を確かめてから `list-views.ts` を直して通す。「スター」にだけ `starred` を保存できることと、設定ファイルの往復と拒否を確かめる
- [x] 2.2 `docs/api.md` に、並び順 `starred`、`starredAt`、検索の `starred` の説明を足す

## 3. 共有のモデル

- [x] 3.1 `nav.test.ts` と `merge.test.ts` にテストを書き、失敗を確かめてから `nav.ts` と `merge.ts` を直して通す。`targetFilter`、`listSortOf`、`sortOptionsOf`、`sortKeyFor` を確かめる

## 4. Web

- [x] 4.1 `SortMenu.tsx` と `ReaderPage.tsx` に、並び順のメニューと検索の結果の「スターだけ」を足す。先にテストを書いて失敗を確かめ、実装のあとに通す

## 5. アプリ

- [x] 5.1 `ListScreen.tsx` と `useReaderList.ts` に、並び順の選択肢と検索の結果の「スターだけ」を足す。先にテストを書いて失敗を確かめ、実装のあとに通す

## 6. 全体の確認

- [ ] 6.1 `openspec validate add-starred-order --strict` と `make verify` が通ることを確かめる

6.1は、実装した環境では終えていない。
`openspec validate`、lint、型の検査、テスト、ビルド、トークンとDESIGN.mdの検査は通った。
textlintと用語の検査は、mainにある `add-feed-articles-list` の文書で失敗し、この変更の文書には指摘がない。
`check:private` は、実行の環境が作業ディレクトリに置く読めない空のファイルを開こうとして失敗した。
