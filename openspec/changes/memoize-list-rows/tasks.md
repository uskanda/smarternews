# Tasks

## 1. 語の色付けの判定を覚える

- [ ] 1.1 `highlight.test.ts`に、同じ文字列で`groupsIn`を2回呼ぶと2回目は正規化をやり直さないことと、覚えた結果でもグループの順序、重複のなさ、`null`の読み飛ばしが同じことのテストを足し、失敗を見る
- [ ] 1.2 `highlight.ts`の`groupsIn`に、文字列ごとのキャッシュを足す。1.1のテストで確かめる

## 2. 行をメモ化する

- [ ] 2.1 `reader.test.tsx`に、数十行の一覧で`j`を押したとき`formatToParts`の呼び出しが行数に比例して増えないことと、移動のあとも選択の印と既読の表示が正しい行に付くことのテストを足し、失敗を見る
- [ ] 2.2 `ArticleRow.tsx`を`memo`で包み、`now`をミリ秒の数値で受け取る
- [ ] 2.3 `ReaderPage.tsx`で、分に丸めた現在時刻を一覧で1回だけ求めて行に渡す。2.1のテストで確かめる

## 3. 確かめる

- [ ] 3.1 `openspec validate memoize-list-rows --strict`を通す
- [ ] 3.2 `make verify`を通す
