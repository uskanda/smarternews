# Proposal

## Why

読み込んだ最後の記事で`j`か`Space`を押し、次のページの取得が失敗すると、読み込み済みの最後のページの先頭の記事が開く。原因は、`moveOn`がページの数の増減を確かめないことである。取得は失敗しても例外を投げず、前のままのページを返す。待つ間に別の一覧へ移った場合も、押した時点の一覧のパスで記事を開くので、元の一覧へ引き戻される（Issue #190、監査ID B-08）。

## What Changes

- 次のページの取得の前にページ数を覚え、増えたときだけ、増えた最初のページの先頭の記事を開く。
- 取得が失敗したら、開いている記事を残し、画面の下で`続きを読み込めませんでした。もう一度試してください。`と知らせる。
- 取得を待つ間に一覧か開いている記事が変わったら、記事を開かず、知らせも出さない。

## Capabilities

### New Capabilities

なし。

### Modified Capabilities

なし。不具合の修正で、要求は変わらないので、`.openspec.yaml`に`skip_specs: true`を置く。

## Impact

- `apps/web/src/reader/ReaderPage.tsx`の`moveOn`
- `apps/web/src/reader/reader.test.tsx`のテスト
- APIとサーバーは変わらない
