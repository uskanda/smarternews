# Design

## Context

知らせは `apps/web/src/shell/toast.tsx` の `ToastProvider` が、画面の下の中央に1つずつ出す。地は `bg-surface`、枠は `border-outline` の1px、角は `rounded-md` である。
DESIGN.mdには知らせの部品の定義がない。項目のメニュー（Componentsの項目のメニューの行）と文字を選んだときのメニューは、同じ白い地に `outline-strong` の枠である。

## Goals / Non-Goals

**Goals:**

- 知らせの境目を、白い一覧と本文の上で見分けられるようにする。
- DESIGN.mdに知らせの部品を定義する。

**Non-Goals:**

- 影や背後の暗転を足すこと
- 枠の太さや知らせの位置、表示時間を変えること
- Androidアプリの知らせ

## Decisions

- 枠の指定を `border-outline` から `border-outline-strong` に変える。色はトークンから決まるので、3つの配色を個別に書く必要はない。
- `outline-strong` と `surface` の差は、ライトで約3.7対1、ダークブルーで約3.5対1、ダークで約3.7対1あり、どれも3対1以上である。`outline` と白の差は約1.35対1だった。
- 新しいトークンは作らない。項目のメニューと同じ見た目にそろえる。
- DESIGN.mdのYAMLの `toast` は、今の見た目に合わせて、地 `surface`、文字 `on-surface`、書体 `body-md`、角 `md`、余白 `sm` にする。枠の色はYAMLの部品の項目にないので、Componentsの文で書く。
- テストは、知らせ（`role="status"`）に `border-outline-strong` の指定が付くことを確かめる。

## Risks / Trade-offs

- ダークブルーの差は約3.5対1で、3対1に近い。→ ボタンと入力欄の枠と同じ色で、ほかの部品と同じ基準を満たすので受け入れる。
- 見え方は画面で確かめていない。→ 計画で、見え方の確認は任意とした。
