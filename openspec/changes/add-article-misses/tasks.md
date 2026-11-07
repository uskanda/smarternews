# Tasks

## 1. 用語と記録

- [x] 1.1 `openspec/glossary.yml` に「外れ」と「外れの記録」を足す。用語の検査で確かめる
- [x] 1.2 移行の023で、`misses` と `miss_topics` の表と、トピックの表の `interpreted_at` の列を足す。記事、トピック、カテゴリを消したときの扱いを `packages/core/src/db/misses.test.ts` で確かめる
- [x] 1.3 `packages/core/src/db/misses.ts` に印の付け外しと、解釈に渡す外れ（90日、20件）の選び方を書く。`misses.test.ts` で、2回目の印、配信記事の拒否、180日の削除のあとの残留、選び方を確かめる

## 2. APIと記事のフラグ

- [x] 2.1 `articleUpdateSchema` に `missed` を足し、`setArticleFlags` で記録と既読を変える。`isRead` の優先と配信記事の拒否を `misses.test.ts` と `apps/server/src/articles.test.ts` で確かめる
- [x] 2.2 記事の詳細に `missed`、トピックに `missesSinceInterpretation` を足し、`applyInterpretation` で解釈の時刻を記録する。件数を `misses.test.ts` とサーバーのテストで確かめる
- [x] 2.3 `docs/api.md` に `missed`、外れの節、`missesSinceInterpretation` を書く

## 3. 解釈への反映

- [x] 3.1 解釈のタスクの入力に `misses` を足し、`<material>` で包んで除くものを書かせる。外れがあるとき、ないとき、区画を閉じようとする見出しを `packages/core/src/llm/tasks.test.ts` で確かめる
- [x] 3.2 実行前の解釈で直近の外れを渡し、解釈の時刻を記録する。再解釈で見出しが渡ることと、解釈済みのトピックが外れで解釈し直されないことを `packages/core/src/pipeline/collect.test.ts` で確かめる

## 4. Webの画面

- [x] 4.1 本文のペインに外れのボタンを置き、知らせからの取り消しと2回目の押下を実装する。配信記事では出さない。`apps/web/src/reader/reader.test.tsx` で確かめる
- [x] 4.2 `x` のキーとキー操作の一覧を足す。`reader.test.tsx` と `apps/web/src/shell/shell.test.tsx` で確かめる
- [x] 4.3 カテゴリの編集の画面に外れの件数と「解釈し直す」を出す。`packages/client` に `interpretTopic` を足す。`apps/web/src/settings/settings.test.tsx` で確かめる

## 5. 全体の確認

- [ ] 5.1 `make verify` を通す
- [x] 5.2 `openspec validate add-article-misses --strict` を通す
