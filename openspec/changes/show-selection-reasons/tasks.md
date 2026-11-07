# Tasks

どの作業も、失敗するテストを先に書いてから実装する。

## 1. データベースとcore

- [x] 1.1 migration 023で`article_refs`に`reason`と`importance`を足し、採用済みの候補から既存の出典を埋める。候補のない出典と、却下された候補しかない出典がNULLのままであることをテストで確かめる
- [x] 1.2 `articleRefSchema`と`NewRef`に理由と重要度を足し、`addRefs`と`refsOf`で書き込みと読み出しをする。続報で同じURLを渡したとき、`reviseArticle`が最初の理由を残すことをテストで確かめる
- [x] 1.3 `listPending`が理由と判定の重要度を返し、`writeStories`がそれを出典へ渡す。実行のテストで、書いた記事の出典に理由と重要度が入ることを確かめる

## 2. API

- [x] 2.1 `GET /api/v1/articles/:id`の出典に`reason`と`importance`が含まれることを、サーバーのテストで確かめる

## 3. Webの本文の画面

- [x] 3.1 `ArticleView.tsx`で、出典の行の下に重要度と理由の行を出す。理由のない出典では出ないこと、HTMLのタグを含む理由が文字のまま出ることをテストで確かめる

## 4. 確認

- [x] 4.1 `make verify`を通す
