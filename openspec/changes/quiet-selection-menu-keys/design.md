# Design

## Context

動機はproposal.mdのWhyを参照する。
画面の1文字のキーは、キーの発生元が `data-hotkeys="off"` の印の中にあるとき止まる（`apps/web/src/lib/keys.ts` の `isInQuietDialog`）。
左のペインの項目のメニューとダイアログは、この印を持つ。選んだ文字列のメニューだけが持たない。

## Goals / Non-Goals

**Goals:**
- 選んだ文字列のメニューを開いている間、背後の記事と一覧を1文字のキーで操作できないようにする。

**Non-Goals:**
- 選んだ範囲の近くに出るボタンの列（`role="toolbar"`）は変えない。そこではフォーカスが記事に残り、`j` などは意図どおり働く。

## Decisions

- **メニューの `ContextMenu.Content` に印を足す。** メニューはPortalで描かれるが、キーの発生元の要素から印を探すので、そのまま止まる。キーの処理は変えない。
- **テストは左のペインのメニューのテストと同じ形にする。** フォーカスがメニューの中へ入るのを待ってから `j` と `s` を押し、記事、メニュー、スターを確かめる。

## Risks / Trade-offs

- ［あとから足すメニューが、また印を忘れる］→ いまの `ContextMenu.Content` と `Dialog.Content` はすべて調べ、印が無いのはこの1か所だけだった。
