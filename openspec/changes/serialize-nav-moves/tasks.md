# Tasks

## 1. 移動の列

- [ ] 1.1 `packages/client/src/order.test.ts` に、応答を手で解決できるPromiseを使うテストを書き、先に失敗させる。2回目の送信は1回目の完了まで呼ばれない。`onSettled` は最後の応答で1回だけ呼ばれる。1回目が失敗すると2回目は呼ばれず、`onFailed` が1回だけ呼ばれる
- [ ] 1.2 `packages/client/src/order.ts` に `createMoveQueue` を足し、1.1のテストが通ることを確かめる

## 2. Webのフック

- [ ] 2.1 `apps/web/src/testing/harness.tsx` に、指定した要求の応答を止めておき、あとで流すか失敗にする `hold` を足す
- [ ] 2.2 `apps/web/src/shell/order.test.tsx` にテストを書き、先に失敗させる。応答が逆の順に届いても2回の移動のあとの並びが残る。移動の前に始まった `/feeds` の再取得の応答で並びが戻らない。1回目が失敗したら、2回目は送られず、並びは保存済みのものになる
- [ ] 2.3 `apps/web/src/shell/order.tsx` の `useNavMoves` を列と取得の取り消しで直し、2.2のテストと既存のテストが通ることを確かめる

## 3. アプリのフック

- [ ] 3.1 `apps/mobile/src/shell/order.test.tsx` に、続けた移動の1回目が失敗したとき、2回目は送られず知らせが1つだけ出るテストを足し、先に失敗させる
- [ ] 3.2 `apps/mobile/src/shell/order.tsx` の `useNavMoves` をWebと同じ形に直し、3.1のテストと既存のテストが通ることを確かめる

## 4. 確認

- [ ] 4.1 `make verify` と `openspec validate serialize-nav-moves --strict` が通ることを確かめる
