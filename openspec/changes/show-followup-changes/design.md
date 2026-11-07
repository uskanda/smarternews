# Design

## Context

動機はproposal.mdのWhyを参照する。

- 続報の書き直しは`reviseArticle`（`packages/core/src/db/articles.ts`）が行い、`is_read = 0, read_at = NULL`にする。記事を開くと`read_at`はその時刻で上書きされる。
- 出典（`article_refs`）には加わった時刻がない。同じURLは`INSERT OR IGNORE`で入らない。
- 本文の生成のタスク（`write`）が既存の記事を受け取るのは、mode "update"のときだけである。イベントでは、生成のあとに`findEventByKey`で同じイベントが見つかると、mode "update"に切り替わる（`run.ts`の`sameEvent`）。このとき既存の記事は入力に渡していない。
- 抜き出した名前（`mentions`）は、どんな形でも受けて、検証に通らなければnullにする形を取っている。

## Goals / Non-Goals

**Goals:**

- 呼び出しの回数を増やさずに、書き直しの1回分の「今回加わったこと」を保存して表示する。
- 記事を開いたあとも「新しい出典」の印が残る。

**Non-Goals:**

- AndroidアプリとRSSの出力の表示（grilling.mdの後回しにしたもの）。
- この記事を参照するその後の記事の表示。

## Decisions

### 列の追加

`027_update_notes.sql`で列を足す。`articles`には`update_note TEXT`と`read_before_update_at TEXT`、`article_refs`には`added_at TEXT`である。今ある行は空のままにする。今ある出典は加わった時刻がないので新しくない。

### 前回読んだ時刻

書き直すときは`read_before_update_at = coalesce(read_at, read_before_update_at)`にしてから`read_at`を空にする。未読のまま2回目の書き直しが来ると`read_at`が空なので、前の値が残る。前回読んでから加わった2回分の出典に印が付く。`read_at`そのものを基準にしないのは、開いたとたんに上書きされて印が消えるからである。

一度も読まれていない記事では基準がないので、印を付けない。読み手にとっては全部の出典が初めて見るものだからである。

### updateNoteの出力

`write`の出力に`updateNote`を、`mentions`と同じく、どんな形でも受けるスキーマで足す。文字列で、前後の空白を除いて1〜300文字ならその文字列、そうでなければnullにする。こうすると、その項目だけが不正でも問い直しも保存の失敗も起きない。`wire`には`string | null`として載せ、モデルには形を見せる。

プロンプトには、`existingArticle`があるときだけ、既存の記事になく新しい出典で加わったことを出力言語で1〜2文、なければnullと書く。ないときは`updateNote: null`と書く。

### クローラー

`reviseArticle`は`updateNote`を受け、nullでも`update_note`を書き換える。前の回の文を残すと、別の回の説明が「今回の更新」として出るからである。`run.ts`は、既存の記事を入力に渡したかどうかを生成の前に覚え、渡していなければ（`sameEvent`で切り替わった場合を含む）nullを渡す。`insertArticle`は`update_note`を空にする。`addRefs`は`added_at`に`now`を入れる。

### API

- `articleSummarySchema`に`updateNote: string | null`を足す。一覧と検索の結果で使う。
- `articleRefSchema`に`isNew: boolean`を足す。`added_at > read_before_update_at`のとき真にし、どちらかが空、または配信記事では偽にする。クローラーの入力の型（`NewRef`）からは外す。
- `articleSchema`に`previousArticles: Array<{ id, title, firstPublishedAt }>`を足す。`previous_article_id`をアプリ側で1件ずつたどり、見た識別子の集合で輪を止める。20件で止める。削除された記事は`ON DELETE SET NULL`で参照が切れるので、そこまでを返す。`previousArticleId`はAndroidアプリが使っているので残す。

### Webの画面

- `ArticleView.tsx`：「今回の更新で加わったこと」の区画を、影響の区画と同じ形（左の線と`type-label-sm`の見出し）で、未確認の表示のあと、影響の前に置く。線の色は`border-outline-strong`にして、影響の`border-mark`と見分ける。出典の`isNew`には`<Badge>新しい出典</Badge>`を付ける。「この話題の前の記事」は`useArticle(previousArticleId)`の1件をやめ、`previousArticles`の一覧にする。余分な要求が1つ減る。
- `ArticleRow.tsx`：抜粋のない行で`updateNote`を持つ記事は、要約の1行の代わりに「更新：」とその文を`line-clamp-1`で出す。語の強調と語のまとまりの判定は表示する文に対して行う。

## Risks / Trade-offs

- ［モデルが既存の記事の事実を「加わったこと」として書く］→ 既存の記事になかったことだけを書くよう、プロンプトで指示する。誤っても本文は正しく、害は小さい。
- ［連なりを1件ずつたどる問い合わせ］→ 主キーでの読み取りが最大20回で、記事の詳細を開くときだけ行うので軽い。
- ［今ある出典に時刻がない］→ 新しくないものとして扱う。次の書き直しから印が付く。

## Migration Plan

列を足すだけである。前の版に戻しても、足した列は古いコードから読まれない。
