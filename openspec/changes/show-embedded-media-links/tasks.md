# Tasks

どの作業も、失敗するテストを先に書いてから実装する。

## 1. 変換

- [ ] 1.1 `content.test.ts` に、`iframe` と `video`（`src` あり）、`audio`（`source` の子だけ）、http(s)でない `src`、幅1の枠、`object` と `embed`、段落の途中の埋め込み、日本語と英語の文言、`text` に文言が入らないこと、オプションを省いたときに今までどおり捨てることのテストを書く
- [ ] 1.2 `convertContent` にオプション `embeds` を足し、`IFRAME`、`VIDEO`、`AUDIO` をリンクだけの段落にする。ファイルの先頭のコメントを直す

## 2. 呼び出し側

- [ ] 2.1 `ingest.ts`（配信の内容とMedia RSSの説明）と `full-content.ts` でオプションを有効にする。埋め込みのリンクが保存されることを `ingest.test.ts` と `full-content.test.ts` で確かめる
- [ ] 2.2 `google.ts` の既存のテスト「drops a tag the answer slipped in」が通ることを確かめる

## 3. 翻訳の区切り

- [ ] 3.1 `segments.ts` の `hasWords` で、埋め込みのリンクだけの段落を翻訳しない。`segments.test.ts` で確かめる

## 4. 説明

- [ ] 4.1 `README.ja.md` と `README.md` の内容の変換の説明を直す

## 5. 全体の確認

- [ ] 5.1 `make verify` を通し、`openspec validate show-embedded-media-links --strict` を通す
