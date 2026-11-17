# Tasks

## 1. フィードを探す要求

- [ ] 1.1 `feeds-settings.test.tsx` に、探す間のURLの欄（読み取り専用、フォーカス、応答のあとの編集）と、探す間に変えたカテゴリと翻訳の反映のテストを先に書き、失敗することを確かめる
- [ ] 1.2 `controls.tsx` の入力欄に読み取り専用の見た目を足し、`DESIGN.md` の入力欄の説明に1行足す
- [ ] 1.3 `AddFeedForm.tsx` に、フィードを探す要求の連番、URLの欄の `readOnly`、最新のカテゴリと切り替えでの登録を足し、1.1のテストが通ることを確かめる
- [ ] 1.4 `feed-dialogs.test.tsx` に、探す間にダイアログを閉じると購読されないテストを書き、通ることを確かめる

## 2. 候補と見本の要求

- [ ] 2.1 `feeds-settings.test.tsx` に、候補を待つ間にURLを直すテストと、見本を待つ間にセレクターを直すテストを先に書き、失敗することを確かめる
- [ ] 2.2 `PageSelectors.tsx` の `useCandidates` と `SelectorEditor` に連番を足し、2.1のテストと、編集の画面の「候補を出し直す」の既存のテストが通ることを確かめる

## 3. 全体の確認

- [ ] 3.1 `make verify` と `openspec validate discard-stale-feed-responses --strict` が通ることを確かめる
