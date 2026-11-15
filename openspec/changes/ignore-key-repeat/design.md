# Design

## Context

キーの操作は、`apps/web/src/lib/keys.ts` の `useHotkeys` が登録した表を、1つの `keydown` の処理 `onKeyDown` が引いて動かす。
`useHotkeys` を呼ぶのは5か所（`ReaderPage.tsx`、`Shell.tsx`、`toast.tsx`、`Annotations.tsx`、`AnnotationList.tsx`）である。
`onKeyDown` は `event.repeat` を見ていない。動機は、proposal.mdの「Why」を参照。

## Goals / Non-Goals

**Goals:**

- 繰り返しの入力で、移動のキーだけが動くようにする。

**Non-Goals:**

- 一括の既読を短い間隔で2回押した場合の扱い。
- 知らせを複数並べること。

## Decisions

- **`onKeyDown` の1か所で判定する。** `keyName` で名前を決めた直後に、`event.repeat` が真で、名前が繰り返してよいキーの集合 `REPEATABLE_KEYS` になければ返す。集合は `j`、`k`、`Space`、`Shift+Space` である。呼ぶ側ごとに判定すると、5か所に同じ判定が散らばり、新しい呼ぶ側で漏れる。
- **無視した繰り返しの入力では何もしない。** `preventDefault` も呼ばず、`g` の2打目の待ち（`waitingUntil`）にも触れない。待ちを消すと、`g` を少し長く押しただけで、組み合わせの操作が動かなくなる。
- **繰り返してよいキーを許す集合で持つ。** 拒む集合にすると、あとから足したキーが既定で繰り返す。

## Risks / Trade-offs

- `Shift+J`・`Shift+K` を押し続けて項目をたどれなくなる。項目の数は記事より少なく、1回ずつ押せば足りる（issue #185 Q1）。
