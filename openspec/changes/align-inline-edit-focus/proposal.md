# Proposal

## Why

設定画面のその場で開く編集の欄で、フォーカスの扱いが画面ごとに違う。トピックでは「編集」を押すとフォーカスが失われ、フィルターと語のまとまりでは開いても欄へ移らず、閉じたときも「編集」へ戻らない。キーボードで操作する人が、開くたびと閉じるたびに位置を探し直すことになる。

## What Changes

- 購読フィードの編集の形に、トピック・フィルター・語のまとまりをそろえる。
- 編集の欄を開いたら、欄の中で操作できる最初の入力欄へフォーカスを移す。ラジオボタンのまとまりでは、選ばれているものへ移す。
- 編集の欄を閉じたら（保存・やめる・閉じる）、欄を開いた「編集」のボタンへフォーカスを戻す。
- 4画面の処理を、共通の1つの仕組みに置き換える。
- 削除したあとのフォーカスは扱わない。

## Capabilities

### New Capabilities

なし。

### Modified Capabilities

- `web-settings`：その場で開く編集の欄のフォーカスの要件を足す。

## Impact

- `apps/web/src/settings/` の `CategoryPage.tsx`、`FiltersPage.tsx`、`TermHighlightsPage.tsx`、`FeedsPage.tsx`。
- 共通の処理を置く新しいファイル `apps/web/src/settings/inline-edit-focus.ts`。
- API、データ、Androidアプリには影響しない。
