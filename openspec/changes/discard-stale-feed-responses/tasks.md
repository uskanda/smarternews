# Tasks

## 1. フィードを探す要求

- [x] 1.1 `feeds-settings.test.tsx` に、探す間のURLの欄のテストと、探す間に変えたカテゴリと翻訳のテストを先に書き、失敗することを確かめる。URLの欄では、読み取り専用、フォーカス、応答のあとの編集を確かめる
- [x] 1.2 `controls.tsx` の入力欄に読み取り専用の見た目を足し、`DESIGN.md` の部品の説明に1行足す。`make verify-tokens verify-design` が通ることで確かめる
- [x] 1.3 `AddFeedForm.tsx` に、フィードを探す要求の連番、URLの欄の `readOnly`、最新のカテゴリと切り替えでの登録を足し、1.1のテストが通ることを確かめる
- [x] 1.4 `feed-dialogs.test.tsx` に、探す間にダイアログを閉じると購読されないテストを書き、失敗することと、1.3のあとに通ることを確かめる

## 2. 候補と見本の要求

- [x] 2.1 `feeds-settings.test.tsx` に、候補を待つ間にURLを直すテストと、見本を待つ間にセレクターを直すテストを先に書き、失敗することを確かめる
- [x] 2.2 `PageSelectors.tsx` の `useCandidates` と `SelectorEditor` に連番を足し、2.1のテストが通ることを確かめる。編集の画面の「候補を出し直す」の既存のテストも通ることを確かめる

## 3. 全体の確認

- [x] 3.1 `make verify` と `openspec validate discard-stale-feed-responses --strict` が通ることを確かめる
