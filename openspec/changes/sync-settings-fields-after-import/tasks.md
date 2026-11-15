# Tasks

どの作業も、失敗するテストを先に書いてから実装する。テストは実際のLLMと外部サイトを呼ばない。

## 1. 設定の画面

- [x] 1.1 `settings.test.tsx` で、設定ファイルを読み込んだあとの読み手情報とタイムゾーンの入力欄が、読み込んだ値を表示することを確かめる。日数だけを変えた全体設定の保存で、読み込んだ値が戻らないことも確かめる
- [x] 1.2 `settings.test.tsx` で、全体設定に保存していない入力がある状態で読み込むと、入力が読み込んだ値に置き換わり、保存していない変更として残らないことを確かめる
- [x] 1.3 `settings.test.tsx` で、全体設定と読み手情報の保存のあとも、フォーカスが「保存する」に残ることを確かめる
- [x] 1.4 `SettingsPage.tsx` の `ReaderInfo` と `GlobalSettings` で、設定の値が変わったときに入力値を置き換える

## 2. 確認

- [x] 2.1 `make verify` を通し、`openspec validate sync-settings-fields-after-import --strict` を通す
