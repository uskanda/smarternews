# Design

## Context

今は画面ごとに書き方が違う（proposal.mdのWhyを参照）。

- 購読フィード：`EditFeed`が開いたときに`querySelector("input")`で最初のinputを探す。`FeedRow`が前の`editing`をrefに覚え、effectで「編集」へ戻す。
- フィルターと語のまとまり：onDoneの中で`setEditing(false)`のすぐあとに、「編集」ボタンの`focus()`を呼ぶ。このときボタンはまだ描かれていないため、フォーカスは戻らない。
- トピック：フォーカスを扱う処理がない。

`FilterForm`は、フィルターの追加の欄でも使う。

## Goals / Non-Goals

**Goals:**
- 4画面の処理を1つのフックにまとめ、開くときと閉じるときの動きをそろえる。

**Non-Goals:**
- 削除したあとのフォーカス（grilling.mdのQ3）。
- `FilterForm`など、欄そのものの部品を変えること。

## Decisions

### 共通のフック`useInlineEditFocus(editing)`

`apps/web/src/settings/inline-edit-focus.ts`に置き、`{ region, opener }`の2つのrefを返す。`region`は欄を包む要素に、`opener`は「編集」ボタンに付ける。前の`editing`をrefに覚え、`useEffect`で変わり目だけを扱う。開いた変わり目では`region`の中の最初の入力欄へ、閉じた変わり目では`opener`へ移す。effectの中で移すので、ボタンが描かれたあとになる。

欄を包む要素で探すため、`FilterForm`を変えずに済み、追加の欄ではフォーカスが動かない。

代わりの案：購読フィードの書き方を3画面へ写す。同じ処理が4か所に散り、またずれていくため採らない。

### 最初の入力欄を探す`firstField(root)`

無効でない`input`（hiddenを除く）・`select`・`textarea`を文書の順に見る。ラジオボタンは、選ばれているものだけを数える。同じnameのまとまりに選ばれているものがなければ、そのまとまりの先頭を数える。Tabで入るときのブラウザーの動きに合わせた。

代わりの案：文字を書く欄だけを対象にする。issueの「最初の入力欄」から外れ、フィルターで種類と範囲を飛ばしてしまうため採らない。

## Risks / Trade-offs

- 欄を開いたあとで、非同期に入力欄の増える画面がありうる。→ effectは開いた直後に1度だけ探す。購読フィードの統計は入力欄を持たないため、今の4画面では先頭は変わらない。
- 削除などで、「編集」のボタンを描かないまま欄の消える場合がある。→ refは空なので何もしない。Non-Goalsのとおり。
