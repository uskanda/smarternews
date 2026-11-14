# Tasks

## 1. 古い確認の応答を捨てる

- [x] 1.1 `filters.test.tsx` の「adding a filter」に、確認の応答を止めて待つ間に条件を変えるテストを先に書き、失敗することを確かめる。対象は、件数の欄が出ないこと、もう一度の確認で新しい条件の件数が出ること、誤りの応答で古い条件の誤りを出さないことである
- [x] 1.2 `FilterForm.tsx` に下書きの版を足し、`check` で版が変わった応答を捨てる。1.1のテストと既存の設定のテストが通ることを確かめる

## 2. 全体の確認

- [x] 2.1 `make verify` と `openspec validate discard-stale-filter-preview --strict` が通ることを確かめる。`make verify` のうち、この変更の外にある失敗（ほかの変更の文書のtextlintと用語、サンドボックスが置く読めないファイルでの `check:private`）は、この変更の対象にしない
