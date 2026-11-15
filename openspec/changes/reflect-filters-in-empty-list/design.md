# Design

## Context

`ReaderPage.tsx` の `EmptyList` は、記事がないときの文を `view` と `hasSources` だけで決めている。
一覧の2つの切り替え（`includeRead` と `importantOnly`）は同じファイルの `ReaderPage` が持ち、URLの `read` と `min` で表す。
検索結果が空のときの `SearchEmpty` は、すでに「絞り込みを外す」のボタンを持つ。

## Goals / Non-Goals

**Goals:**

- 重要度で絞って0件のとき、そのことと、絞り込みを外す操作を出す。
- 「既読も表示」が入っているとき、既読も表示するよう勧めない。

**Non-Goals:**

- Androidアプリの空の一覧の文（別のissueにする）

## Decisions

- `EmptyList` に `includeRead`、`importantOnly`、`onWiden` を足す。判定の順序は次のとおり。
  1. カテゴリと購読フィードが1つもないときは、今の文のままにする。
  2. 重要度で絞っているときは、重要度4以上の記事がないことを伝える文を出す。`SearchEmpty` と同じ `Button` で「絞り込みを外す」を出す。
  3. それ以外は今の項目ごとの文を出す。汎用の文は、「既読も表示」が入っているとき、既読も表示するよう勧める部分を除く。
- 両方の切り替えが入っているときは、0件の原因になりうる重要度の文を優先する。
- 呼び出しからは、`includeRead` を `readToggle && includeRead` として渡す。既読の切り替えを出さない項目では、URLに `read=1` が残っていても偽になる。`importantOnly` は、重要度の切り替えを出す項目でだけ真になる今の値をそのまま渡す。
- `onWiden` は `toggleParam("min", "4", false)` で、URLの `min` を消す。チェックの表示もURLから決まるので、一緒に外れる。

## Risks / Trade-offs

- 「未読」で絞って0件のときも、「すべての記事を見る」のリンクの代わりに絞り込みの文が出る。→ 0件の原因が絞り込みでありうる場面では、項目によらず同じ案内が正確である（Q2のA）。
