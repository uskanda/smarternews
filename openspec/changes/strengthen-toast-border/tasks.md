# Tasks

## 1. DESIGN.md

- [x] 1.1 YAMLの `components:` に `toast` を足す
- [x] 1.2 `## Components` の項目のメニューの行の後に、知らせの行を足す。枠を `outline-strong` にする理由と、影と背後の暗転を付けないことを書く

## 2. 知らせの枠

- [x] 2.1 `toast.test.tsx` に、知らせに `border-outline-strong` の指定が付くことのテストを書き、先に失敗させる
- [x] 2.2 `toast.tsx` の枠を `border-outline-strong` に変え、2.1のテストが通ることを確かめる

## 3. 確認

- [x] 3.1 `make verify` と `openspec validate strengthen-toast-border --strict` が通ることを確かめる
