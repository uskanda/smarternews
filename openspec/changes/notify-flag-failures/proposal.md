# Proposal

## Why

Webの画面では、スター、既読、一括の既読の取り消しが失敗しても、利用者に知らせない。未読の一覧に残した行は印も戻らないので、保存されたように見える。web-shellの「失敗の表示」の要求を満たしていない。この要求は、APIの呼び出しが失敗したら知らせることを求めている。

## What Changes

- スターの付け外しと、既読・未読の切り替えが失敗したら、画面の下で知らせ、「もう一度試す」を置く。記事を開いたときの自動の既読も同じように知らせる。
- 失敗したときは、すべての一覧と記事の印を元に戻す。開いた記事のキャッシュがない行も戻す。未読の一覧や直近に読んだ一覧で残した行も戻す。
- 一括の既読の「取り消す」が失敗したら、画面の下で知らせ、「もう一度試す」を置く。
- アプリ（`apps/mobile`）は変えない。

## Capabilities

### New Capabilities

なし。

### Modified Capabilities

なし。web-shellの「失敗の表示」の要求に、実装を合わせる変更である。要求は変わらないので、`.openspec.yaml`に`skip_specs: true`を置く。

## Impact

- `apps/web/src/api/queries.ts`の`useArticleFlags`
- `apps/web/src/reader/ReaderPage.tsx`のスター、既読、一括の既読の取り消し
- `apps/web/src/reader/reader.test.tsx`のテスト
- APIとサーバーは変わらない
