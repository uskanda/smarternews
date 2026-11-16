# Design

## Context

- サーバーの`TranslationService`の`translateArticle`は、進行中の翻訳を記事ごとに`#underWay`で共有する。2つ目の依頼は1つ目のPromiseを受け取る。
- `#translateArticle`は、保存のトランザクションの中で題と元の文を読み直し、翻訳を始めたときと違えば`unavailable`で失敗する。元の文は、全文が`fetched`なら全文、それ以外は配信された内容である。
- 画面の`useArticleTranslation`の問い合わせのキーには全文の`fetchedAt`が入る。全文が届くとキーが変わり、2つ目の翻訳が送られる。
- 記事を開いた直後は、子の`ArticleView`のeffectが、全文の取得を始める親の`ReaderPage`のeffectより先に走る。このため、`fullContent.fetching`だけを見ると、取得中の印が立つ前に翻訳が始まる。

## Goals / Non-Goals

**Goals:**

- 全文を待つ記事を開いたとき、`w`を押したとき、サーバーで全文を取得したときのどれでも、失敗の表示を出さずに訳を出す。
- 全文を待つ間に抜粋を翻訳する費用を、Webの画面では出さない。

**Non-Goals:**

- Androidアプリの画面を変えること。
- 翻訳し直しを何度も繰り返すこと。

## Decisions

### サーバー：保存の前の確認を、一度だけのやり直しにする

`#translateArticle(id, again)`の形にする。保存のトランザクションで元の文の違いを見つけたら、`again`が偽のときだけ、`null`を返してトランザクションを抜け、`#translateArticle(id, true)`を呼ぶ。トランザクションの中では非同期の翻訳を待てないので、例外ではなく戻り値でやり直しを伝える。
やり直しは`#underWay`に置いたPromiseの中で起きるので、待っている2つ目の依頼も新しい訳を受け取る。
読み直しの最初で本文の訳と題の訳がそろっていれば、今のコードと同じく、その訳を返す。

別案として、2つ目の依頼が元の文の違いを見て新しい翻訳を始める案（Q1のB）があった。1つ目を待つ依頼が失敗を受け取ることがあり、サーバーで全文を取得した場合も防げないため、選ばなかった。

### 画面：`useArticleTranslation`に待つ引数を足す

`useArticleTranslation(article, { wait })`とし、`wait`が真の間は`enabled`を偽にする。`ArticleView`は次の式で`wait`を決める。

```ts
const wait = fullContent.fetching || (article?.fullContentStatus === "waiting" && !fullContent.requestFailed);
```

`fullContentStatus === "waiting"`を入れるのは、開いた直後のeffectの順序のためである。取得が失敗すると状態は`failed`になり、応答がなければ`requestFailed`が真になるので、どちらでも待つのをやめる。
`enabled`が偽の間は`isFetching`も偽なので、翻訳の途中の表示は出ない。全文の取得の途中の表示は、今までどおり`FullContentBar`が出す。

## Risks / Trade-offs

- `w`を押す前に翻訳が始まっていた場合、抜粋の翻訳の費用は捨てられる。→ サーバーのやり直しで表示は直る。費用は、押す前に始まった分だけに限られる。
- 全文の取得が長くかかる間、題の訳も出ない。→ 一覧の題の訳はフィードを取得したときに翻訳APIが付けるので、ほとんどの記事では題の訳がすでにある。
- やり直しで翻訳の費用が2回かかる。→ やり直しは元の文が変わったときだけで、1回までに限る。
