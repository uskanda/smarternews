# Proposal

## Why

内容の変換は、`iframe`、`video`、`audio`、`object`、`embed` の要素を中身ごと捨てる。
動画や音声を埋め込んだ記事では、その場所に何も出ず、読み手は動画があったことに気付けない（issueの213番、Web UIの監査のR-03）。

## What Changes

- 配信の内容と全文の変換で、`src` がhttp(s)の `iframe`、`video`、`audio` を、元のアドレスへのリンクだけの段落に変える。`src` がない `video` と `audio` は、http(s)の最初の `source` の子の `src` を使う。
- リンクの文字は出力言語に従う。日本語は「埋め込み（ホスト名）」、英語は「Embedded content (host)」にする。
- 幅か高さが0か1の要素、リンク先のない要素、`object` と `embed` は、今までどおり捨てる。
- リンクの文字は、照合用の文章（ストップワードと全文の長さの比較）に入れない。
- 埋め込みのリンクだけの段落は、本文の翻訳に送らない。
- 枠は表示しない。画面は変えない。
- 変換の結果が変わるため、保存済みの記事は次の取得で書き換えとして扱われる。LLMは使わない。

## Capabilities

### New Capabilities

なし。

### Modified Capabilities

- `feed-subscriptions`: 「内容の変換」で、埋め込みを元のアドレスへのリンクとして残す規則を足す

## Impact

- `packages/core`: 変換（`feeds/content.ts`）にオプションを足し、配信の内容（`feeds/ingest.ts`）と全文の取得（`feeds/full-content.ts`）で有効にする。
- `packages/core`: 翻訳の区切り（`translation/segments.ts`）で、埋め込みのリンクだけの段落を翻訳しない。
- 翻訳の答えの読み取り（`translation/google.ts`）は変えない。紛れ込んだタグは今までどおり捨てる。
- `README.ja.md`、`README.md`: 内容の変換の説明を直す。
- 表の変換は別のissueで扱う。
