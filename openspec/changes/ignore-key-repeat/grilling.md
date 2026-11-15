# grilling 記録: ignore-key-repeat

grillingの面談は省いた。決めることがQ1の1つだけで、issue #185の計画の質問で答えが出ていたためである（`/no-grilling` 相当）。
計画はissue #185で2026-11-15に承認を得た。

## 決定

| 決定 | 選択 | 出典 |
|---|---|---|
| `Shift+J` と `Shift+K` を押し続けたときに繰り返すか | 繰り返さない。押し続けて繰り返すのは `j`、`k`、Space、Shift+Space の4つだけにする | issue #185 の計画の質問 Q1（A） |
| 直す場所 | `apps/web/src/lib/keys.ts` の `onKeyDown` の1か所。`useHotkeys` を呼ぶ5か所は変えない | issue #185 の計画（承認済み） |
| 無視した繰り返しの入力と `g` の2打目の待ち | 無視した繰り返しの入力は、待ちを消費しない | issue #185 の計画（承認済み） |
| 仕様の変更をどこに記録するか | 新しい変更 `ignore-key-repeat` を作り、`web-shell` に要件を1つ足す | issue #185 の計画（承認済み） |

## 後回しにしたもの

- 一括の既読を短い間隔で2回押した場合の扱い
- 知らせが同時に1つしか出ないこと（`apps/web/src/shell/toast.tsx`）

## 状態

frontierは空。共有理解は2026-11-15に確認済み。
