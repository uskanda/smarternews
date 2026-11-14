# Design

## Context

2つの画面が、同じ手順を別々に持っている。Blob URLを作り、`<a download>`をクリックし、その直後に`URL.revokeObjectURL`を呼ぶ。ダウンロードの開始は非同期で、Safariでは開始の前にURLが無効になる場合がある。理由はproposal.mdの「Why」を参照。

## Goals / Non-Goals

**Goals:**

- ダウンロードが始まるまで、Blob URLを有効なまま保つ
- 保存の手順を1か所にまとめる

**Non-Goals:**

- 書き出しのAPIやファイルの中身を変えること
- エラーの表示を変えること

## Decisions

### 共通関数にまとめる

`apps/web/src/lib/download.ts`に`saveBlob(blob, filename)`を置く。2つの画面は、Blobとファイル名を渡すだけにする。各画面で`setTimeout`を使う案もある。しかしそれでは直す場所が2つになり、片方だけを直すおそれが残る。

### 解放は遅らせるだけでなくさない

解放しないと、Blobはページを閉じるまで残る。遅らせれば、Blobを持つ時間が延びるだけで済む。

### 待ち時間は40秒

定数`REVOKE_DELAY_MS`にする。FileSaver.jsが同じ理由で使う値である。0msでは、遅いSafariで足りない場合がある。

## Risks / Trade-offs

- 40秒のあいだにダウンロードの始まらない場合がある。まれで、そのときは書き出しを選び直せば済む。
- 書き出しを繰り返すと、一時的に複数のBlobを持つ。どれも40秒で解放し、ファイルも小さい。
