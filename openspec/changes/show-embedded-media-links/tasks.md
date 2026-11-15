# Tasks

どの作業も、失敗するテストを先に書いてから実装する。

## 1. 変換

- [x] 1.1 `content.test.ts` に、リンクにする要素のテストを書く。対象は `iframe` と `video`（`src` あり）と、`audio`（`source` の子だけ）である
- [x] 1.2 `content.test.ts` に、捨てる要素のテストを書く。対象は、http(s)でない `src`、幅1の枠、`object` と `embed` である
- [x] 1.3 `content.test.ts` に、段落の途中の埋め込み、日本語と英語の文言、`text` に文言が入らないことのテストを書く
- [x] 1.4 `content.test.ts` の既存のテストで、オプションを省いたときに今までどおり捨てることを確かめる
- [x] 1.5 `convertContent` にオプション `embeds` を足し、`IFRAME`、`VIDEO`、`AUDIO` をリンクだけの段落にする。ファイルの先頭のコメントを直す

## 2. 呼び出し側

- [x] 2.1 `ingest.ts`（配信の内容とMedia RSSの説明）と `full-content.ts` でオプションを有効にする。埋め込みのリンクが保存されることを `ingest.test.ts` と `full-content.test.ts` で確かめる
- [x] 2.2 `google.ts` の既存のテスト「drops a tag the answer slipped in」が通ることを確かめる

## 3. 翻訳の区切り

- [x] 3.1 `segments.ts` の `hasWords` で、埋め込みのリンクだけの段落を翻訳しない。`segments.test.ts` で確かめる

## 4. 説明

- [x] 4.1 `README.ja.md` と `README.md` の内容の変換の説明を直す

## 5. 全体の確認

- [x] 5.1 `make verify` を通し、`openspec validate show-embedded-media-links --strict` を通す
