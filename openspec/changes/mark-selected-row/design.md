# Design

## Context

一覧の行は、選択中を `bg-selected` の地だけで示している。DESIGN.mdの `selected` と `list-row` の定義もそのとおりなので、先にDESIGN.mdを変える。
行の左端は、重要度4の `mark` の短い線が使っている。フォーカスの枠は `primary` の2pxで、2px外側に出る。
`j` と `k` での移動は、記事とイベントの一覧が `ReaderPage.tsx` の `move`、注釈の一覧が `AnnotationList.tsx` の `move` を通る。どちらも、選択が変わったあとの `useLayoutEffect` で `followScroll` を使って一覧を送る。

## Goals / Non-Goals

**Goals:**

- 選択中の行を、地の色に加えて形でも示す。
- キーで移ったときに、一覧の中のフォーカスを選んだ行へ合わせる。
- 未読の行を読み上げでも伝える。

**Non-Goals:**

- navの項目の一覧の選択中の目印（太さ600と `aria-current` がある）
- Androidアプリの未読の読み上げ

## Decisions

- 線は、選択中の `li`（`relative`）の中に、`aria-hidden` の `span` を右端へ絶対配置で置いて描く。幅3pxと `primary` の地は、`app.css` の `.selected-mark` に書く。`border-r` で描くと行の内側の幅が変わる。すると、選んだときに見出しの折り返しまで変わることがある。3つの一覧で同じ部品 `SelectedMark` を使う。
- `primary` と `selected` の差は、ライトで約8.0対1、ダークブルーで約7.2対1、ダークで約7.9対1あり、どれも3対1以上である。
- フォーカスを移すかは、`move` の時点で決めて `useRef` に覚える。`document.activeElement` が一覧のスクロール領域（`[data-list-scroll]`）の中にあれば移す。選択が変わったあとの `useLayoutEffect` で、覚えていた場合だけ、選んだ行のリンクの `focus` を `preventScroll` 付きで呼ぶ。スクロールは `followScroll` に任せる。`Space` は本文の末尾で `move` を呼ぶので、同じ条件で動く。
- `未読。` は、見出しの `span` の先頭に `sr-only` の `span` で置く。重要度の `重要度N。` と同じ書き方にそろえる。見出しの文字は `[data-title]` の中に残るので、見出しを読むテストは影響を受けない。

## Risks / Trade-offs

- 右端の線は、一覧のペインの右の罫線のすぐ内側に出るので、罫線と近く、目立ちにくいことがある。→ 地の色と太さ3pxで見分けられるので、受け入れる。
- フォーカスを一覧の中にあるときだけ移すので、ページを開いた直後の `j` ではフォーカスは動かない。→ 承認された計画どおりで、本文を読む人の読み上げの位置を飛ばさないためである。
