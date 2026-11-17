# Tasks

どの作業も、失敗するテストを先に書いてから実装する。テストは実際のLLMと外部サイトを呼ばない。

## 1. 共通の仕組み

- [x] 1.1 `lib/pending.test.ts` にフックのテストを書き、`lib/pending.ts` に `usePending` を足して通す。要求の間の2回目の呼び出しが捨てられることと、失敗のあとも `pending` が戻ることを確かめる
- [x] 1.2 `testing/harness.tsx` の `renderApp` に `hold` を足す。一致した要求の応答を `release` まで止められることを、2章以降のテストで確かめる

## 2. issueが挙げた操作

- [x] 2.1 `settings.test.tsx` に、トピックの削除の「削除する」と、トピックの追加を2回押すテストを足す。`CategoryPage.tsx` を直し、要求が1回で、ボタンが無効で、成功の知らせが出ることを確かめる
- [x] 2.2 `settings.test.tsx` に、カテゴリの削除の確認のテストを足し、`DeleteCategory` を直して通す。「無効にする」の要求の間は「削除する」も無効になることを確かめる
- [x] 2.3 `settings.test.tsx` に、カテゴリの追加を2回押すテストを足し、`SettingsPage.tsx` の `Categories` を直して通す
- [x] 2.4 `term-highlights.test.tsx` に、まとまりの削除と語の削除を2回押すテストを足し、`TermHighlightsPage.tsx` の `GroupRow` を直して通す
- [x] 2.5 `reader.test.tsx` に、一括の既読のテストを足し、`ReaderPage.tsx` を直して通す。ボタンを2回押し、Shift+Aも押しても、要求が1回で、知らせに件数と「取り消す」が残ることを確かめる
- [x] 2.6 `annotations.test.tsx` に、ハイライトの作成のテストを足し、`AnnotatedBody` を直して通す。選んだ文字列の下のボタン、H、右クリックのメニューを使っても、ハイライトが1件で、メニューの項目が無効であることを確かめる

## 3. ほかの、データを変える操作

- [x] 3.1 `term-highlights.test.tsx` に、追加と編集の保存のテストを足し、`TermHighlightsPage.tsx` を直して通す。並べ替えは、mainで楽観的な更新になったので対象から外す
- [x] 3.2 `filters.test.tsx` に、フィルターの削除と切り替えを2回押すテストを足し、`FiltersPage.tsx` を直して通す。削除のあと「削除できませんでした」が出ないことを確かめる
- [x] 3.3 `settings.test.tsx` に、設定の保存と設定ファイルの読み込みのテストを足し、`SettingsPage.tsx` と `CategoryPage.tsx` を直して通す
- [x] 3.4 `feeds-settings.test.tsx` に、購読フィードの編集、基本の取得周期の保存、OPMLの読み込みのテストを足し、`FeedsPage.tsx` を直して通す
- [x] 3.5 `topic-history.test.tsx` に、版に戻す要求の間のテストを足し、`TopicHistory.tsx` を直して通す。すべての「この版に戻す」が無効になることを確かめる

## 4. 確認

- [x] 4.1 `openspec validate disable-actions-while-pending --strict` と、lint、型の確認、テスト、ビルドを通す
- [ ] 4.2 `make verify` の全体を通す
- [ ] 4.3 `providers` を `/bin/false` に向けた使い捨てのサーバーをブラウザーで開く。削除と一括の既読を続けて押しても、要求が1回だけであることを確かめる
