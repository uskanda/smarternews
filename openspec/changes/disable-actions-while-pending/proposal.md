# Proposal

## Why

Webの画面には、要求の応答を待つ間も押せるボタンがあり、続けて押すと同じ操作を二重に送る。
削除の2回目は404になり、成功の知らせを「削除できませんでした」に置き換える。
トピックの追加は、同じトピックを2件作り、LLMの解釈も2回走らせる。
2026-11-06のWeb UIの監査（B-10）が見つけた。欠陥は1つの作り方から出ているので、Webの全体で同じ形に直す（grilling.md）。

## What Changes

- サーバーのデータを変える要求を送るボタンは、応答を待つ間は無効で、応答が届けば成否によらず戻る。
- 要求の間は、同じ操作のキーを捨てる。対象は「すべて既読にする」のShift+Aと、ハイライトのHである。
- 要求の間は、右クリックのメニューの「ハイライト」を無効にする。
- 1つのダイアログに要求を送るボタンが2つあるときは、どちらの要求の間も両方を無効にする。カテゴリの削除の「削除する」と「無効にする」がこれに当たる。
- 対象は、削除の確認、追加のフォーム、「すべて既読にする」、ハイライトの作成である。
- 設定の「保存する」と、OPMLと設定ファイルの読み込みも対象にする。
- フィルターの切り替えと、トピックの版に戻す操作も対象にする。
- ボタンの名前は要求の間も変えない。「やめる」は押せるままにする。
- 楽観的に更新する操作（スター、既読の印、左のペインの並べ替え、語のまとまりの並べ替え）は変えない。語のまとまりの並べ替えは、mainで押した直後に画面を変え、要求を順に送る作りになったので、ここに入れる。
- 読むだけの操作（書き出し）、Androidアプリ、サーバーとAPIも変えない。

## Capabilities

### New Capabilities

なし。

### Modified Capabilities

- `web-shell`：要求「要求の間の操作の無効化」を足す

## Impact

- `apps/web/src/lib/pending.ts`：フック `usePending` を足す。要求の間を表す状態と、二重の呼び出しを捨てる入口を返す
- `apps/web/src/settings/` の設定の画面：`CategoryPage.tsx`、`SettingsPage.tsx`、`FeedsPage.tsx`
- `apps/web/src/settings/` のほかの画面：`FiltersPage.tsx`、`TermHighlightsPage.tsx`、`TopicHistory.tsx`
- `apps/web/src/reader/`：`ReaderPage.tsx`（すべて既読にする）、`Annotations.tsx`（ハイライトの作成）
- `apps/web/src/testing/harness.tsx`：`hold` を足す。選んだ要求の応答を止めておき、あとで流す
