# Proposal

## Why

項目は識別子（RSSのguid、Atomのid、JSON Feedのid）だけで見分けている。
配信元がCMSを替えたり、guidのURLをhttpからhttpsに変えたりすると識別子が一斉に変わり、そのフィードが載せている90日以内の項目が、最大200件、未読の新着として戻る。
自動の要約や翻訳を有効にした購読フィードでは、その分の上限と文字数も使う。

## What Changes

- 識別子が初めての項目でも、次の条件をすべて満たせば、新しい配信記事にせず、保存済みの配信記事の識別子を新しい識別子に付け替える。
  - 同じ購読フィードに、元のページのURLがhttpとhttpsの違いを除いて同じ配信記事が保存されている。
  - その配信記事の識別子が、取得した文書に載っていない。
  - タイトルが、大文字と小文字、全角と半角、空白、記号の違いを除いて同じ。
  - 候補が1対1に決まる。
- 付け替えた配信記事は、保存済みの項目として扱う。既読の状態は変えない。URLがhttpからhttpsに変わっていれば、参照のURLを新しいURLへ直す。
- 付け替えた項目は新しい項目と数えない。最後に新しい項目が現れた時刻を変えない。
- 識別子を持たないWebページの購読フィードの項目も、URLがhttpからhttpsに変わるだけなら同じ扱いになる。
- LLMは使わない。

## Capabilities

### New Capabilities

なし。

### Modified Capabilities

- `feed-subscriptions`：要件「項目の識別」に、識別子を付け替えた項目の扱いを足す。要件「新しい項目と数えない項目」に、付け替えた項目を既知の項目に含める。

## Impact

- `packages/core/src/feeds/ingest.ts` の `storeItems`
- `packages/core/src/fetch/url.ts`（タイトルをならす処理を、下限なしでも使えるようにする）
- `packages/core/src/feeds/ingest.test.ts`
- データベースの表、既存のデータ、API、画面は変えない
