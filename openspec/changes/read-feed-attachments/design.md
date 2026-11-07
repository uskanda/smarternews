# Design

## Context

購読フィードのパーサー（`parseSubscription`）は、項目のタイトル、リンク、識別子、著者、内容だけを読む。enclosureとMedia RSSの要素は捨てている。
配信記事の内容は、保存の前にMarkdownへ変換し（`convertContent`）、画像はAPIの応答を作るときに中継のURLへ書き換える（`relayArticleImages`）。書き換えの検出は、タイトル、内容、著者を比べる。動機は `proposal.md` の「Why」を参照する。

## Goals / Non-Goals

**Goals:**

- 添付を本文とは別に保存し、APIで渡し、WebとAndroidアプリの本文の下に並べる。
- 内容のない項目（YouTubeのフィード）の本文を、説明から作る。
- ハイライト、翻訳、検索、フィルター、RSS、LLMには、添付を渡さない。

**Non-Goals:**

- 一覧のサムネイル（#49、`grilling.md` のQ6）。
- 再生と埋め込み。「埋め込みの枠は出さない」という決定を守る。
- 変更の前に保存し、配信元のフィードからもう消えた記事の読み直し。
- JSON Feedの `attachments` を読むこと。JSON Feedを足した変更（`add-json-feed`）が、読まないと決めている。JSON Feedの項目の添付は空のままにする。

## Decisions

### 添付は articles の attachments の列にJSONで置く

添付は、記事ごとの小さな並びで、ほかの表から引くことがない。表を分けず、`articles` に `attachments TEXT` を足す（`022_article_attachments.sql`）。中身は、`url`、`kind`、`mimeType`、`size`、`title`、`thumbnail` の並びのJSONで、添付がないときはNULLにする。
生成記事と、変更の前に保存した記事はNULLのままである。配信元のフィードがまだ項目を載せていれば、次の取得で入る。

### 読み取りはパーサーで済ませる

`parseSubscription` は、項目ごとに `attachments` と `description` を返す。URLを絶対にする基準は項目のページで、項目のページが相対のときは、取得したフィードのURL（`parseSubscription` の2つめの引数）で直す。基準がないときは、相対のURLを捨てる。
同じURLの重複、http(s)以外のURL、2000文字を超えるURLは、ここで捨てる。1つの項目の添付は20件まで（`MAX_ATTACHMENTS`）とする。際限なく並べるフィードへの備えで、設定ではない。
XMLのパーサーの `isArray` に `enclosure`、`media:content`、`media:thumbnail`、`media:group` を足し、要素が1つでも並びとして受け取る。
説明は、内容が空のときだけ返す。説明の検索用のパーサー（`parseFeed`、`collectFeed`）は変えない。

### 種類は medium、MIMEの型の順に決める

`medium` が `image`、`audio`、`video` ならそれに、ほかの値なら「その他」にする。`medium` がなければMIMEの型の頭で決める。`media:thumbnail` は画像で、`thumbnail` の印を付ける。サムネイルの印は、APIで記事のページへのリンク先（`thumbnailOf`）になる。

### 説明の変換は既存の変換を通す

プレーンテキストの説明は、`plainDescriptionHtml` でエスケープしたHTML（段落、`<br>`、http(s)だけの `<a>`）にしてから `convertContent` に渡す。エスケープ、長さの上限、Markdownの規則を、配信された内容と同じにするためである。URLの末尾の句読点と、対にならない閉じ括弧はURLに含めない。`type="html"` の説明は、そのまま `convertContent` に渡す。

### 添付だけの変化は書き換えに数えない

`storeItems` の書き換えの判定（タイトル、内容、著者）はそのまま使う。説明から作った本文は内容の差として現れ、今の規則で翻訳が消え、フィルターを判定し直す（Q5）。
添付の差は別の `UPDATE articles SET attachments = ?` で書く。フィルターと翻訳は添付を見ない。そのため、翻訳を消す理由と、判定し直す理由がない。

### 画像の読み込み先は中継の書き換えで埋める

`getArticle` は、添付の `imageUrl` を空のまま返す。`relayArticleImages` が、配信記事の画像の添付にだけ中継のURLを入れる。書き換えを通らない応答があっても、画面が元のURLを読み込むことはない。

### 描き方の判定は packages/client に置く

`attachmentDisplays` が、添付を「画像」と「リンク」の描き方に分け、種類の言葉（画像、音声、動画、ファイル）と大きさの表記（`formatFileSize`）を作る。WebとAndroidアプリで同じ判定と文言を使うためである。中継のパスで読み込めない画像は、読み込まずにリンクとして出す。
大きさは1024を単位とし、1 MB未満はKBの整数（切り上げ）、それ以上は小数1桁のMBかGBにする。リンクの名前は題、なければURLの最後のパス、それもなければホストにする。

### 画面の部品

Webは `Attachments.tsx`、アプリは `Attachments.tsx` を本文と抜き出した名前の間に置く。画像は本文の画像の部品（`ArticleImage`）を使い、読み込めないときの扱いと見た目を本文の画像とそろえる。
Webのリンクは `target="_blank" rel="noopener noreferrer"` にする。アプリは、元のページを開く操作と同じく、アプリ内のブラウザー（`openSource`）で開く。

## Risks / Trade-offs

- YouTubeの `media:content` は、古い埋め込みのURL（`application/x-shockwave-flash`）である。→「ファイル」のリンクとして出す。再生と埋め込みはしないので、害はない。
- 添付の画像がページのサムネイルと同じ画像のことがある。→ 一覧のサムネイルは#49で扱い、本文の画面では添付として1度だけ出す。
- 変更の前に保存し、もう配信されない記事は、本文が空のままである。→ issueで扱わないと決めた。
