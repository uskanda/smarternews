# grilling 記録: unify-field-errors

GitHubのissueの116番のコメントで、1ラウンドの質問（Q1〜Q3）に答えた記録である。
issueは、入力の誤りの理由に英語が混ざり、出し方も画面ごとに違うという、2026-11-06のWeb UIの監査の項目（U-09）である。
PRODUCT.mdは「画面の言葉は日本語だけにする」と定めている。

## 決定

| 決定 | 選択 | 出典 |
|---|---|---|
| サーバーの誤りの種類をどこから得るか | APIの誤りの各欄に、機械が読む `code` を足す。範囲の誤りには `minimum` と `maximum` も足す。日本語の文への変換は `packages/client` に置き、Androidアプリと共有する。`message` はCLIとログのため英語のまま残す（A） | 第1ラウンドQ1 |
| 自前の検査にそろえるフォームの範囲 | 設定画面のすべてのフォームと、購読フィードのオプションのダイアログ。どれも `noValidate` にし、欄の近くに日本語の理由を出す。検索欄とトークンの画面は対象外（A） | 第1ラウンドQ2 |
| 設定ファイルの読み込みの誤り一覧 | 理由は日本語にし、場所は `categories.0.kind` のようなキーの並びのまま出す（A） | 第1ラウンドQ3 |

## 計画で決めたこと

承認を求めた計画（issueのコメント）で、次を決めた。利用者は変更なしで承認した。

| 決定 | 選択 |
|---|---|
| `code` の種類 | `zod` から写す `required`、`too_small`、`too_big`、`format`、`invalid_value`、`custom` と、サーバーが自分で付ける `unknown_time_zone`、`no_such_item`、`not_allowed`、`unreachable`、`no_items`。どれにも当たらないものには `code` を付けない |
| 文字数と数の区別 | `zod` の `origin` を `unit`（`chars`、`number`、`items`）として写す |
| 範囲の値 | `packages/core/src/api.ts` から名前付きの定数で出し、スキーマと画面の両方が使う |
| 変換の関数 | `packages/client/src/messages.ts` の `fieldMessage`。配列の要素の誤りは親の欄の誤りとして扱い、何番目かを文に入れる。知らない種類の誤りには、その欄の値は保存できないと表示する |
| 画面での検査 | `checkWholeNumber` と `checkRequired` などを `packages/client` に置き、画面での検査とサーバーの誤りの変換が同じ文を出す |
| カテゴリの説明文 | 件数上限と対象期間の範囲を説明文に出す（「1から50まで」など） |
| 既存の日本語の文 | `AddFeedForm` と `PageSelectors` にある、欄ごとの日本語の文は残す。誤りの種類で文を選べるものだけ、`fieldMessage` の文に替える |

## 後回しにしたもの

- Androidアプリの入力フォームでの利用。今のアプリには接続画面のほかに入力フォームがない。変換の関数を `packages/client` に置くところまでにする

## 状態

frontierは空。共有理解に到達した。利用者はQ1〜Q3に答え、続く計画を2026-11-06に承認した。
