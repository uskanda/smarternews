# Design

## Context

show-followup-changes（まだarchiveしていない）で、3つの列を足した。`articles.update_note`は最新の書き直しの文である。`articles.read_before_update_at`は書き直す前に読んだ時刻である。`article_refs`の`added_at`は出典に加わった時刻である。`reviseArticle`は、文がnullでも`update_note`を書き換える。`read_before_update_at`は、未読のまま2回書き直されても1回目の前の値を残す。「新しい出典」は`added_at > read_before_update_at`で決まる。

文がnullになるのは、モデルが「加わったことはない」と答えたとき、値が不正だったとき、`sameEvent`で書き直しに切り替わり前の記事を入力に渡していないときである。続報の書き直しは最初の公開から72時間以内に起きるので、同じ日に2回あることがある。

## Goals / Non-Goals

**Goals:**

- 前回読んでからの書き直しの文を、「新しい出典」と同じ基準ですべて出す。
- 一覧の行、APIの一覧の項目、Androidアプリ、RSSは変えない。

**Non-Goals:**

- 本文の生成のタスクに書かせる範囲とプロンプト（show-followup-changesのQ2）は変えない。
- Androidアプリの本文の画面には表示を足さない。

## Decisions

### 表`article_update_notes`

033のmigrationで、`id`、`article_id`、`note`、`created_at`の表を作る。`article_id`は`articles(id)`を指し、`ON DELETE CASCADE`を付ける。索引は`(article_id, created_at)`に作る。記事を消すと行も消えるので、180日の削除や配信記事の削除に手を入れずに済む。

同じmigrationで、`update_note`が空でない記事の文を、`updated_at`を`created_at`にして写す。`update_note`は最新の書き直しの文なので、その時刻は`updated_at`と一致する。写しておくと、移行の直後に読んで次の書き直しが来ても、移行前の文が消えない。

`articles.update_note`は残す（Q3）。消すと一覧の問い合わせに副問い合わせが要り、列を消すために表を作り直すことにもなる。

### 保存

`reviseArticle`は今と同じく`update_note`を書き換える。文があるときだけ、`article_update_notes`に`(id, note, now)`を足す（Q1：文のない回は行を残さない）。呼び出し側（`run.ts`）は書き直しと受け入れを1つのトランザクションで行っているので、行の追加もその中に入る。

### 取り出し

`getArticle`の中で`updateNotesOf`が`updateNotes`を決める（Q4：判定はサーバー）。

- 生成でない記事、または`revision = 0`の記事は空。
- `read_before_update_at`があれば、`created_at > read_before_update_at`の行をすべて古い順に返す。最新の回に文がなくても前の回の文が返る（Q1）。`refsOf`の`isNew`と同じ基準である。
- なければ、`created_at = updated_at`の行、つまり最新の書き直しの文だけを返す（Q2）。最新の回に文がなければ空になる。

並びは`created_at, id`の順にする。時刻はISO 8601の文字列で、文字列の比較が時刻の比較になる。

### APIの形

`articleSchema`に`updateNotes: { note: string; createdAt: string }[]`を足す。`articleSummarySchema`には足さない。一覧の行は今のまま`updateNote`（最新の1文）を使う。

すべての回を返して画面で選ぶ案（Q4のB）は採らない。`isNew`もサーバーで決めており、Androidアプリがあとで同じ項目を使うとき判定を書き直さずに済む。

### Webの本文の画面

`ArticleView`は`article.updateNotes`を見る。

- 1件で、`createdAt`が`updatedAt`に一致するとき：今と同じ「今回の更新で加わったこと」の区画で1文を出す。
- 2件以上のとき、または1件でも最新の回のものでないとき：「前回読んでから加わったこと」の見出しの下の`<ol>`で、古い順に並べる。各文の上には、`formatFull`で整えた日時を`<time dateTime>`で出す。日付だけでは同じ日の2回を見分けられない。
- 罫線の色と位置（影響の欄の前）、検索語の強調（`Highlighted`）は今のまま。

## Risks / Trade-offs

- ［`update_note`と表の最新の行が二重に持つ］→書き込みは`reviseArticle`の1か所だけにし、同じトランザクションの中で両方を書く。
- ［移行前に文のなかった書き直しや、上書きされた文は戻らない］→戻せる情報がない。移行後の書き直しから記録が揃う。
- ［`created_at = updated_at`の比較が時刻の文字列の一致に頼る］→どちらも`reviseArticle`の同じ`now`から書くので一致する。移行で写す行も`updated_at`をそのまま使う。

## Migration Plan

033のmigrationはサーバーの起動時に当たる。表を作って写すだけで、既存の列は変えない。戻すときは、前の版のサーバーが`article_update_notes`を読まないだけで動く。
