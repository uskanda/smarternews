# Design

## Context

- 文字を選んだときのメニューは、`AnnotatedBody`（`apps/web/src/reader/Annotations.tsx`）が描くツールバーである。`.selection-menu` は `position: fixed` で、折り返さない。
- 位置は `selectionIn` が範囲の `getBoundingClientRect` から測る。測るのは `selectionchange` のときだけで、top は範囲の下6px、left は範囲の左端（最小8px）をそのまま使う。
- 本文のペインは、`ReaderPage.tsx` で `data-article-scroll` を持つ独立したスクロール領域である。その上には見出しなどの別の領域があり、メニュー（z-index 30）はそれらの上に重なる。
- 右クリックとキーボードで開くメニューは Radix の ContextMenu で、はみ出しはライブラリが避ける。キーボードで開くときは、範囲の左下の座標を渡す。

## Goals / Non-Goals

**Goals:**

- メニューが画面の右端と下端からはみ出さないこと。
- 本文をスクロールしても、メニューが範囲に付いていくこと。
- 範囲が本文のペインの外にある間は、メニューが別の領域に重ならないこと。

**Non-Goals:**

- 右クリックとキーボードで開くメニューの見た目と配置。
- メニューの中身（操作の種類と並び）。

## Decisions

- **位置の計算を純粋関数 `placeMenu` に分ける。** 範囲の矩形、メニューの幅と高さ、画面の幅と高さを受け取り、top と left を返す。単体テストで端の場合を確かめるためである。
  - 基本は今のとおり、範囲の下6px、左は範囲の左端。
  - 右端からはみ出すときは、メニューの右端が画面の右端から8pxになるまで左へずらす。left は8px以上にする。
  - 下端からはみ出すときは、範囲の上6pxに出す。上にも入らないときは、画面の中に収まるように top を詰める（8px以上、画面の下端から8px以内）。
- **`selectionIn` の `rect` に `right` を足す。** 範囲がペインと重なるかどうかを判定するためである。
- **矩形だけを測り直す。** `selectionchange` に加えて、`scroll`（capture で受けるので、本文のペインのスクロールも届く）と `resize` のときに、範囲の矩形を測り直す。`selectionIn` 全体を走らせるとアンカーの計算まで重くなるので、選択の範囲の矩形だけを `requestAnimationFrame` で1フレームに1回測る。
- **範囲がペインの外なら描かない。** ペインは `root.closest("[data-article-scroll]")` で探す。見つからないときは画面全体をペインとする。範囲の矩形がペインの矩形と少しも重ならないときは、ツールバーを描かない。選択そのものは残すので、`h` と右クリックは今のまま働く。
- **描く前に位置を当てる。** ツールバーに ref を付け、`useLayoutEffect` でメニューの大きさを測り、`placeMenu` の結果を style に当てる。はみ出した位置が一瞬だけ見えることがない。
- **CSS で折り返す。** `.selection-menu` に `flex-wrap: wrap` と `max-width: calc(100vw - 2 * 8px)` を足す。
- **キーボードで開くメニューは、測り直した矩形を使う。** `latest.current.rect` が測り直した値になるため、追加の処理はいらない。

## Risks / Trade-offs

- スクロールのたびに範囲の矩形を測る。測るのは1フレームあたり1回までなので、重さは小さい。
- jsdom はレイアウトを持たないので、結合テストでは Range とペインの `getBoundingClientRect` を差し替えて確かめる。実際の見た目は画面で確かめる。
