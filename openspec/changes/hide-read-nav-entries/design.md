# Design

## Context

左のペインとAndroidアプリのドロワーは、`packages/client` の `buildNav` が作る1つの model を描いている。
Shift+JとShift+K（`stepTarget`）、ドラッグ（`dropAt`）、項目のメニューの「上へ」「下へ」（`stepMove`）も、同じ model を読む。
「この端末の設定」には、スクロールで既読にする設定がある。値は `localStorage` に置き、`lib/scroll-read.ts` が `useSyncExternalStore` で配っている。

## Goals / Non-Goals

**Goals:**

- 隠すかどうかの判定を `packages/client` の純粋な関数にし、Androidアプリからも同じ判定を使えるようにする。
- 描画とキー操作とドラッグとメニューが、同じ「隠したあとの model」を見るようにする。

**Non-Goals:**

- Androidアプリのドロワーと設定は変えない。
- サーバーとAPIは変えない。件数はいまの `counts` をそのまま使う。

## Decisions

### 隠す判定は、model から model を作る関数にする

`hideEmptyEntries(model, { current, counted })` は、`buildNav` の結果を受け取り、`groups` を絞った model を返す。`views` はそのまま返す。
子は、未読が1以上、`state` が `failed` か `stale`、開いている項目のどれかなら残す。グループは、自分の未読が1以上、残る子がある、自分が開いている項目のどれかなら残す。
`counted` が false のときは、model をそのまま返す。

`buildNav` に引数を足す案もあった。だが、隠す前の model も「開いている項目」を決めるために要る。別の関数にすれば、隠す前と後の2つを呼び出し側で持てる。

### グループの `childState` は、隠す前の子から計算した値のままにする

折りたたんだカテゴリの行の印は、下の購読フィードの中でいちばん強い状態を示す。隠した一時停止中の購読フィードのぶんも示すため、`childState` は残った子から計算し直さない。

### 開いている項目は、隠す前の model から決める

隠したあとの model から決めると、開いている項目が未読0のときに見つからず、隠されてしまう。Webでは `useNavModels` が、隠す前の model（`full`）と隠したあとの model（`shown`）と、開いている項目を返す。
`Nav` は `shown` を描き、ドラッグと項目のメニューにも `shown` を渡す。隠れた購読フィードを相手にメニューの「上へ」「下へ」が動くと、見た目が変わらないためである。
`Shell` の Shift+J と Shift+K は `shown` を、`g e` は `full` を使う。

### 保存のキーは共通のパッケージに置く

キーは `smarternews.nav.hideRead`、オンの値は `"on"` で、オフのときは値を保存しない。`scroll-read.ts` と同じ形にした。Androidでも同じキーを使えるように、`packages/client` の `nav.ts` に置く。
Webの `lib/hide-read.ts` は `lib/scroll-read.ts` と同じく、読めない保存先ではオフのままにする。

### すべて既読にしたあとの移り先は変えない

`nextTarget` は、もともと未読が0の項目を飛ばす。隠す設定に関わらず、移り先は同じになる。

## Risks / Trade-offs

- [開いている一覧をすべて既読にしたあと、別の一覧へ移るとその項目が消える] → 仕様どおりの振る舞いとする。開いている間は残るので、読んでいる最中に行が消えることはない。
- [カテゴリの未読が0でも、隠さない子が残ることがある（取得の失敗など）] → グループは残る子があれば残すので、木の形は崩れない。
- [件数の読み込み前は全部が0に見える] → `counted` が false の間は何も隠さないので、ペインが一瞬空になることはない。
