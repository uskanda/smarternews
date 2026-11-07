# Tasks

どの作業も、失敗するテストを先に書いてから実装する。

## 1. サーバーの誤りの種類

- [x] 1.1 `packages/core/src/errors.ts` の `FieldError` に、`code`、`minimum`、`maximum`、`unit` を足す。種類の一覧 `FIELD_ERROR_CODES` も置く。`apiErrorSchema` の `fields` にも同じ項目を省略できる形で足す。型の検査（`pnpm run typecheck`）で確かめる
- [x] 1.2 `zodFieldErrors` で、`zod` の誤りを種類と境界に写す。`settings-file.test.ts` で、名前の長さ、件数上限、実行時刻の形、欠けた名前の誤りを確かめる
- [x] 1.3 `DomainError` の欄と `refine` に種類を付ける。`db/settings.test.ts` で、時刻帯の誤りが `unknown_time_zone` を持つことを確かめる。ほかの種類は、既存のサーバーと `packages/core` のテストで確かめる
- [x] 1.4 `api.ts` から範囲の値を名前付きの定数で出し、スキーマがそれを使う。`settings-api.test.ts` で、件数上限に51を送ると `too_big` と境界の50が返ることを確かめる。仕様 `http-api` の「誤りの種類の表示」「範囲の境界の表示」の場面にあたる
- [x] 1.5 `docs/api.md` の誤りの説明に、`code`、`minimum`、`maximum`、`unit` と種類の一覧を書き足す

## 2. 日本語の文への変換

- [x] 2.1 `packages/client/src/messages.ts` に、文を作る関数と送る前の検査の関数を足す。`messages.test.ts` で、種類ごとの文、境界の数、配列の要素の誤り、知らない種類の文、送る前の検査の文を確かめる
- [x] 2.2 `ApiError` の `fields` の型を、種類と境界を持つ `FieldProblem` にする。型の検査で確かめる

## 3. Webの画面

- [x] 3.1 `SettingsPage.tsx` の全体設定、読み手情報、カテゴリの追加を、`noValidate` と自前の検査にする。サーバーの誤りは `fieldMessage` で出す。`settings.test.tsx` で、存在しないタイムゾーンの理由が日本語で出て、英語が出ないことを確かめる。範囲の外の日数の文も確かめる。仕様 `web-settings` の「入力の誤りの日本語の表示」「更新が止まったとみなす日数の編集」の場面にあたる
- [x] 3.2 `CategoryPage.tsx` のカテゴリの編集、トピックの編集と追加を同じ形にし、件数上限と対象期間の説明に範囲を出す。`settings.test.tsx` で、件数上限に51を入れると送らずに範囲の文が欄の近くに出ることを確かめる。説明の「1から50まで」と、実行時刻の2つ目の誤りの文も確かめる。仕様 `web-settings` の「送る前の自前の検査」「カテゴリの範囲の表示」の場面にあたる
- [x] 3.3 `noValidate` をほかのフォームにも付け、英語の理由を出す経路をなくす。対象は、語の色付けの3つのフォーム、購読フィードの追加と編集、OPMLの読み込み、フィルター、購読フィードのオプションのダイアログである。既存の `feeds-settings.test.tsx`、`filters.test.tsx`、`term-highlights.test.tsx` で確かめる
- [x] 3.4 `SettingsPage.tsx` の設定ファイルの誤り一覧を、キーの並びと日本語の理由で出す。`settings.test.tsx` で、不正な種別のファイルに、キーの並びと選べる値から選ぶことが出ることを確かめる。仕様 `web-settings` の「設定ファイルの読み込み」の場面にあたる

## 4. 全体の確認

- [ ] 4.1 `make verify` を通す。lint、型、テスト、ビルド、`textlint`、用語の検査を含む
- [ ] 4.2 `apps/server` の使い捨てのサーバーで、カテゴリの編集、全体設定、設定ファイルの読み込みを手で試す。誤りがすべて日本語で欄の近くに出ることと、ブラウザー既定の吹き出しが出ないことを確かめる。サーバーの `providers` は `/bin/false` に向け、自分で付けたプロセスの番号で止める
