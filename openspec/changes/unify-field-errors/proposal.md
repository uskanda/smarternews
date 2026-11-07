# Proposal

## Why

設定の画面の入力の誤りは、サーバーが返す英語の理由をそのまま包んで表示する。カテゴリの欄はブラウザー既定の吹き出しを出し、件数の上限50も画面に示していない。全体設定と購読フィードの欄だけが、日本語の自前の検査で理由を欄の近くに出す。
PRODUCT.mdは「画面の言葉は日本語だけにする」と定めている。2026-11-06のWeb UIの監査（U-09、GitHubのissueの116番）が、この食い違いを見つけた。

## What Changes

- APIの400の誤りの各欄に、機械が読む誤りの種類 `code` を足す。範囲の誤りには、境界の `minimum` と `maximum`、境界が数えるものの `unit`（文字数、数、要素の数）も足す。どれも省略できる項目で、今までのアプリはそのまま動く。
- 英語の `message` は、CLIとログのために残す。
- スキーマの範囲の値を、`packages/core` から名前付きの定数で出す。スキーマと画面の両方がその定数を使う。
- `packages/client` に、欄の名前と誤りの種類から日本語の文を作る関数と、送る前に値を確かめる関数を足す。Androidアプリも同じ関数を使える。
- 設定の画面のすべてのフォームと、購読フィードのオプションのダイアログを、`noValidate` と自前の検査にそろえる。理由は日本語で欄の近くに出し、誤りがあれば送らない。
- カテゴリの編集で、件数上限と対象期間の範囲を説明文に出す。
- 設定ファイルの読み込みの誤り一覧は、理由を日本語にし、場所はファイルのキーの並びのまま出す。

## Capabilities

### New Capabilities

なし。

### Modified Capabilities

- `http-api`: 入力の検証の誤りに、誤りの種類と範囲の境界を含める
- `web-settings`: 入力の誤りを日本語で欄の近くに出し、送る前に自前で確かめる。カテゴリの編集で範囲を示す。設定ファイルの誤り一覧の理由を日本語にする

## Impact

- `packages/core`：`errors.ts` の `FieldError` を変える。`api.ts` の `apiErrorSchema` と範囲の定数、`settings-file.ts` の `zodFieldErrors` も変える
- `packages/core` の誤りを返す各所：`db/`、`feeds/`、`filters/`、`search/` の各ファイル
- `packages/client`：`api.ts` の `ApiError` と、`messages.ts`
- `apps/web`：設定の画面の各フォームと、`reader/FeedOptionsDialog.tsx`
- `docs/api.md`：誤りの形の説明
- APIの互換：足すのは省略できる項目だけで、既存の項目は変えない
