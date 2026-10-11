# Tasks

## 1. 本文の幅

- [x] 1.1 `DESIGN.md` に、記事の本文の幅の上限（52em）を新しい値として足し、行の長さの説明を書き換える。`pnpm run tokens` で作り直し、`designmd lint DESIGN.md` がエラー0件であることを確かめる
- [x] 1.2 `apps/web` の本文の表示で、見出し、読み手への影響、本文、出典の幅の上限を新しい値に変え、ペインの中央に寄せる。上限と中央寄せを確かめるテストを先に書き、通す
- [x] 1.3 `apps/web` をビルドして実際のブラウザーで開き、幅1920pxと1280pxで本文の幅と余白を測る。幅390pxで横方向にはみ出さないことも確かめる
- [x] 1.4 `openspec validate widen-article-measure --strict` と `make verify` が成功することを確かめる
