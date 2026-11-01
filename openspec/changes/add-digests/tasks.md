# Tasks

どの作業も、失敗するテストを先に書いてから実装する。テストは実際のLLMと外部サイトを呼ばない。アダプターを差し替え、記録済みの応答で動かす。

## 1. 保存と設定

- [ ] 1.1 `packages/core/src/db/migrations` に移行を足し、表 `digests` と全体設定の `digest_schedule` を作る。既存のデータベースを移して、時刻の一覧が7:00と19:00になることを `database.test.ts` で確かめる
- [ ] 1.2 `packages/core/src/api.ts` の全体設定に `digestSchedule` を足し、`db/settings.ts` で読み書きする。仕様 `settings` の「ダイジェストを作る時刻の保持」「ダイジェストを作る時刻の検証」の各場面をテストで確かめる
- [ ] 1.3 `settings-file.test.ts` で、仕様 `settings` の「設定ファイルでのダイジェストを作る時刻の扱い」の各場面を確かめる
- [ ] 1.4 `packages/core/src/db/digests.ts` に、保存、一覧、1件の取得、期間の始めの計算、入力の記事の集め方を書く。仕様 `digests` の「ダイジェストの期間」「ダイジェストの入力にする記事」の各場面をテストで確かめる。「入力の件数と選び方」「配信記事の入力の内容」の各場面も確かめる
- [ ] 1.5 `purgeExpired` で180日を過ぎたダイジェストを消す。仕様 `digests` の「ダイジェストの保存期間」の各場面を `retention.test.ts` で確かめる

## 2. タスクとランナー

- [ ] 2.1 `packages/core/src/llm/tasks.ts` に `digest` を足し、`taskNameSchema` と `TASK_NAMES` を9つにする。プロンプトに記事とカテゴリが入ること、`check` が入力にないカテゴリと重複した区画を拒むことを `tasks.test.ts` で確かめる
- [ ] 2.2 `config.ts` に `limits.digestsPerDay` と、`tasks` の `digest` を足し、割り当ての既定を `smart` にする。`config.test.ts` で確かめる
- [ ] 2.3 `TaskRunner` に `digestsToday` と `canDigest` を足し、`callsToday` から `digest` を除く。仕様 `llm-tasks` の「ダイジェストの1日の上限」「予算に達したときのダイジェスト」の各場面を `runner.test.ts` で確かめる

## 3. 作る処理

- [ ] 3.1 `packages/core/src/digests/worker.ts` に、1つのダイジェストを作る処理を書く。入力にない識別子を捨てること、区画をカテゴリの並び順にすること、記事が0件のときに呼ばないことを確かめる。仕様 `digests` の「根拠の記事の確かめ」「記事のない期間」「カテゴリの区画」の各場面が対象である
- [ ] 3.2 `DigestWorker` に、時刻での作成、起動のときの補完、今すぐ作る操作を書く。仕様 `digests` の「時刻でのダイジェストの作成」「停止中に過ぎた時刻の補完」「今すぐ作る」の各場面を、時計を動かすテストで確かめる。仕様 `llm-tasks` の「ダイジェストの呼び出しの回数」「ダイジェストの呼び出しの記録」も確かめる
- [ ] 3.3 `apps/server/src/runtime.ts` で `DigestWorker` を組み立て、起動と停止を結びつける。`runtime.test.ts` で確かめる

## 4. API

- [ ] 4.1 `apps/server/src/app.ts` にダイジェストの3つの操作を足す。仕様 `http-api` の「ダイジェストの一覧の操作」「ダイジェストの取得の操作」「今すぐ作る操作」の各場面を、サーバーを通したテストで確かめる
- [ ] 4.2 `GET /api/v1/providers` に `digestsToday` と `limits.digestsPerDay` を足す。仕様 `http-api` の「ダイジェストの呼び出し回数の提供」の場面を確かめる
- [ ] 4.3 `rss-route.test.ts` で、仕様 `digests` の「ダイジェストをRSSに出さないこと」の場面を確かめる
- [ ] 4.4 `packages/client/src/api.ts` にダイジェストの呼び出しを足し、応答のスキーマでの検証をテストで確かめる

## 5. Web

- [ ] 5.1 `apps/web/src/shell/Shell.tsx` の左のペインの「注釈」の下に、ダイジェストの項目を足す。仕様 `web-reader` と仕様 `web-shell` の、ダイジェストの項目の場面を確かめる
- [ ] 5.2 `apps/web/src/digests/DigestPage.tsx` を作り、`/digests/:digestId?` で開く。仕様 `web-reader` の「ダイジェストの画面」「根拠の記事へのリンク」の各場面を、実物のAPIに対するテストで確かめる。「画面からの今すぐ作る操作」「ダイジェストがないときの表示」と、仕様 `web-shell` の「ダイジェストの画面のURL」も確かめる
- [ ] 5.3 `apps/web/src/settings/SettingsPage.tsx` に、ダイジェストを作る時刻の欄を足す。仕様 `web-settings` の「ダイジェストを作る時刻の欄」の各場面を確かめる

## 6. アプリ

- [ ] 6.1 `apps/mobile/src/shell/DrawerContent.tsx` の「最近読んだ記事」の下に、ダイジェストの項目を足す。仕様 `mobile-shell` の場面を確かめる
- [ ] 6.2 `apps/mobile/app/(main)/digests.tsx` にダイジェストの画面を足す。仕様 `mobile-reader` の「アプリのダイジェストの画面」「アプリの根拠の記事へのリンク」「アプリのダイジェストがないときの表示」の各場面を確かめる
- [ ] 6.3 `packages/client/src/notify.ts` に `planDigestNotification` を書き、通知の確認に組み込む。仕様 `mobile-notifications` に足した5つの要件の各場面を確かめる

## 7. 文書と全体の確認

- [ ] 7.1 `docs/api.md` と `docs/providers.md` に、ダイジェストと新しい設定を書く。`examples/config.example.yaml`、`README.md`、`README.ja.md` にも書く
- [ ] 7.2 `apps/server` を作業用のディレクトリと空いているポートで起動する。プロバイダーは差し替えのものに向け、Webで今すぐ作るから表示までを確かめる。サーバーは起動のときに控えたPIDで止める
- [ ] 7.3 `make verify` を通し、`openspec validate add-digests --strict` が通ることを確かめる
