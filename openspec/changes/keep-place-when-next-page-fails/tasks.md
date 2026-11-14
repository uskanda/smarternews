# Tasks

## 1. 失敗を確かめるテスト

- [ ] 1.1 `reader.test.tsx`の「moving past the last article loaded」に、次のページの取得が失敗するテストを足す。`j`と`Space`で50件目に留まって知らせが出ること、2ページを読み込んだ100件目で51件目へ移らないこと、待つ間に別の一覧へ移ると引き戻されないことを確かめる

## 2. ページが増えたときだけ移る

- [ ] 2.1 `ReaderPage.tsx`の`moveOn`で、取得の前のページ数を覚え、増えたときだけ増えた最初のページの先頭を開く。失敗したら知らせを出す。1.1のテストと既存のテストで確かめる
- [ ] 2.2 押した時点の`listKey`と`articleId`を覚え、取得のあとにrefの最新の値と比べる。変わっていれば何もしない。1.1のテストで確かめる

## 3. 確かめる

- [ ] 3.1 `openspec validate keep-place-when-next-page-fails --strict`を通す
- [ ] 3.2 `make verify`を通す
