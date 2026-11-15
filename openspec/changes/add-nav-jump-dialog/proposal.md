# Proposal

## Why

項目を移るキーは、1つずつ進む `Shift+J` と `Shift+K`、固定の行き先へ移る `g` の組だけである。
購読フィードが数十件あると、目的の購読フィードまで何度もキーを押すか、マウスで左のペインをスクロールすることになる（Issue #221）。

## What Changes

- `g` に続けて `u` を押すと、入力欄と候補の一覧を持つ小さなダイアログ「項目へ移る」を開く。
- 名前の一部を打つと、カテゴリ（「未分類」を含む）と購読フィードが絞られ、Enterか候補のクリックでその一覧を開く。
- 候補には、折りたたんだカテゴリの下の購読フィードと、未読のない項目を隠す設定で隠している項目も入る。
- キー操作の一覧とREADMEに `g u` を足す。
- APIとAndroidアプリは変えない。LLMは呼ばない。

## Capabilities

### New Capabilities

なし。

### Modified Capabilities

- `web-shell`：要件「名前を打っての項目の移動」を足し、「gに続くキーでの項目の移動」と「gのあとの待ち時間」のキーの列挙に `u` を足す。

## Impact

- `packages/client/src/order.ts`：候補を作って絞る関数
- `apps/web/src/shell/JumpDialog.tsx`（新規）：ダイアログ
- `apps/web/src/shell/Shell.tsx`：キーの表、`g u` の登録、ダイアログの配置
- `README.md`、`README.ja.md`：キー操作の説明
- API、Androidアプリ：変えない
