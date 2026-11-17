# Tasks

## 1. テストを先に書く

- [x] 1.1 `shell.test.tsx`に、左のペインの項目の名前が「名前、未読N件」、スターの項目が「スター、スターN件」になるテストを足し、失敗することを確かめる
- [x] 1.2 `controls.test.tsx`と`settings.test.tsx`にテストを足し、失敗することを確かめる。読み込み中の部品と設定ファイルの結果が`role="status"`の中にあることを確かめる
- [x] 1.3 `topic-trial.test.tsx`と`topic-rewrite.test.tsx`にテストを足し、失敗することを確かめる。枠の文が待ちの文から終わりの1文に入れ替わり、一覧が枠の外にあることを確かめるテストである

## 2. 実装する

- [x] 2.1 `Shell.tsx`の`ListItem`に`countKind`を足し、数を「、未読N件」「、スターN件」で読ませる。`NavItem`の`count`を消す
- [x] 2.2 `controls.tsx`の`Loading`と、`SettingsPage.tsx`の設定ファイルの結果に`role="status"`を付ける
- [x] 2.3 `TopicTrial.tsx`と`TopicRewrite.tsx`に`role="status"`の枠を置き、待ちと終わりの文を入れる
- [x] 2.4 `order.test.tsx`など5つのテストで、項目の名前と数を前提にした箇所を直す

## 3. 文書

- [x] 3.1 `DESIGN.md`に数の読み方と、待ちと終わりの知らせを足す
- [x] 3.2 `openspec validate announce-counts-and-waits --strict`を通す

## 4. 確かめる

- [ ] 4.1 `make verify`を通す
