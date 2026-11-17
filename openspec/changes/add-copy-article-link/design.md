# Design

## Context

本文の画面は `apps/web/src/reader/ArticleView.tsx` にある。配信記事には「元のページを開く」のリンクがあり、下端の操作の列にはスター、既読、外れの印のボタンが並ぶ。
キーの割り当ては、読む画面の `apps/web/src/reader/ReaderPage.tsx` の `useHotkeys` にある。`?` で開くキー操作の一覧は `apps/web/src/shell/Shell.tsx` の `KEYS` である。
主な出典のURL（`primaryUrl`）は、出典の並びの先頭のURLで、`o` のキーもこれを開く。
いまのコピーは、選んだ文字列のコピー（`apps/web/src/reader/Annotations.tsx` の `copy`）だけである。`navigator.clipboard` が無いときは `document.execCommand("copy")` を呼び、そのときの選択の範囲をコピーする。
`navigator.clipboard` は安全な文脈（HTTPSか、loopback）でしか使えない。自宅LANから素のHTTPで開くと無い。
結果を伝えるには、画面の下端に出す既存の知らせ（`apps/web/src/shell/toast.tsx`）がある。

## Goals / Non-Goals

**Goals:**

- 本文の画面から、記事の見出しとURLをMarkdownのリンクとして1回の操作でコピーできるようにする。
- 素のHTTPでも、選んでいない文字列をコピーできるようにする。

**Non-Goals:**

- 送り先の登録と、それを開く操作（grillingのQ1）。
- 出典の一覧の各行にコピーのボタンを置くこと（grillingのQ2）。

## Decisions

### コピーの部品を1つにする

`apps/web/src/lib/clipboard.ts` に `copyText(value): Promise<boolean>` を置く。
`navigator.clipboard` があれば `writeText` を使う。無いとき、または拒否されたときは、一時的な `textarea` を画面の外に作る。値を入れて選び、`document.execCommand("copy")` を呼ぶ。
呼んだあとは `textarea` を消し、元の選択の範囲とフォーカスを戻す。`execCommand` が `false` を返すか例外を投げたら、失敗として `false` を返す。
`Annotations.tsx` の `copy` もこの関数に置き換え、仕組みを1つにする。いまの代替は選択の範囲そのものをコピーするが、新しい代替はメニューに渡した文字列をコピーする。中身は同じ文字列で、利用者から見た振る舞いは変わらない。

### リンクの文字列を作る関数

`apps/web/src/lib/article-link.ts` に純粋な関数 `articleLink(article)` を置き、`[見出し](URL)` を返す。`primaryUrl` が無ければ `null` を返す。
見出しは `translatedTitle ?? title` で、本文の画面の見出しと同じ式にする（grillingのQ2、Q3）。
Markdownのリンクの形を保つため、見出しの `\` `[` `]` を `\` でエスケープする。URLの `(` `)` と空白は `%28` `%29` `%20` に置き換える。改行は空白にそろえる。

### 操作の置き場所と、キーとのつなぎ方

ボタンは下端の操作の列の最後に置き、`aria-keyshortcuts="c"` を付ける。`articleLink` が `null` の記事には出さない。
コピーと知らせは `ReaderPage.tsx` の `copyLink(article)` にまとめ、`ArticleView` へは `onCopyLink` として渡す。ボタンとキーが同じ関数を呼ぶので、結果の知らせも同じになる。
`c` は `x` と同じく、本文のペインに開いた記事（`opened`、`opened.id === articleId`）があり、リンクを作れる間だけ割り当てる。一覧で選んだだけの記事は対象にしない。ボタンが出ている間だけ働く、という決めごとにそろえるためである。
キー操作の一覧では、`o` の次に置く。

## Risks / Trade-offs

- ［`execCommand("copy")` は非推奨のAPIで、将来のブラウザーから外される可能性がある］→ 使うのは `navigator.clipboard` が無いか拒まれたときだけにする。失敗したら知らせで伝える。
- ［一時的な `textarea` を選ぶと、本文の選択が消える］→ 呼ぶ前の選択の範囲とフォーカスを保存し、呼んだあとに戻す。
- ［生成記事のリンクの文字は、出典のページのタイトルと一致しない］→ grillingのQ2で、読んだときに見ていたタイトルを残す方を選んだ。
