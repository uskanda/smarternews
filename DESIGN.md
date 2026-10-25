---
# DESIGN.md - Google DESIGN.md format (https://github.com/google-labs-code/design.md, version alpha).
# Tokens here are the normative values; the prose below says why and how to apply them.
# Check after every edit: designmd lint DESIGN.md   (0 errors; read the warnings)
version: alpha
name: smarternews
description: 記事の一覧は密度の高い道具として、本文は落ち着いて読む紙面として見せる。目立つ色は重要度の印と、利用者が選んだ語の色付けだけにする。
colors:
  primary: "#24418F"
  on-primary: "#FFFFFF"
  background: "#F3F5F8"
  surface: "#FFFFFF"
  on-surface: "#17202B"
  on-surface-muted: "#586473"
  outline: "#D8DEE6"
  outline-strong: "#7A8594"
  selected: "#E8EDF7"
  mark: "#FFD84A"
  mark-fill: "#FFE98A"
  search-match: "#CBEEDD"
  search-match-line: "#1D6B4C"
  term-green: "#3D7A16"
  term-green-fill: "#DCEFC4"
  term-purple: "#6E44A8"
  term-purple-fill: "#E8DAF8"
  term-pink: "#A8346C"
  term-pink-fill: "#FADCE9"
  term-orange: "#A4520E"
  term-orange-fill: "#FFE2CC"
  warning: "#8A5200"
  error: "#A1260D"
  on-error: "#FFFFFF"
  primary-darkblue: "#9CB6FF"
  on-primary-darkblue: "#10151B"
  background-darkblue: "#10151B"
  surface-darkblue: "#171D25"
  on-surface-darkblue: "#E7EBF0"
  on-surface-muted-darkblue: "#9DA9B7"
  outline-darkblue: "#2B3440"
  outline-strong-darkblue: "#66727F"
  selected-darkblue: "#212B3A"
  mark-darkblue: "#E9C13A"
  mark-fill-darkblue: "#5C4B12"
  search-match-darkblue: "#1E4A3B"
  search-match-line-darkblue: "#7FD8AE"
  term-green-darkblue: "#9CD46C"
  term-green-fill-darkblue: "#253E19"
  term-purple-darkblue: "#C4A8F0"
  term-purple-fill-darkblue: "#3E2F5E"
  term-pink-darkblue: "#F09EC4"
  term-pink-fill-darkblue: "#58283F"
  term-orange-darkblue: "#F2AE76"
  term-orange-fill-darkblue: "#502F16"
  warning-darkblue: "#F0B45C"
  error-darkblue: "#FFA08F"
  on-error-darkblue: "#10151B"
  primary-dark: "#A9BEFF"
  on-primary-dark: "#121212"
  background-dark: "#121212"
  surface-dark: "#1B1B1B"
  on-surface-dark: "#E8E8E8"
  on-surface-muted-dark: "#A6A6A6"
  outline-dark: "#303030"
  outline-strong-dark: "#757575"
  selected-dark: "#2A2A2A"
  on-error-dark: "#121212"
typography:
  headline-lg:
    fontFamily: "'Shippori Mincho', 'Hiragino Mincho ProN', 'Yu Mincho', 'Noto Serif JP', serif"
    fontSize: 25px
    fontWeight: 700
    lineHeight: 1.5
  headline-md:
    fontFamily: "'IBM Plex Sans JP', 'Hiragino Sans', 'Yu Gothic UI', 'Noto Sans JP', sans-serif"
    fontSize: 15px
    fontWeight: 600
    lineHeight: 1.5
  body-lg:
    fontFamily: "'Shippori Mincho', 'Hiragino Mincho ProN', 'Yu Mincho', 'Noto Serif JP', serif"
    fontSize: 17px
    fontWeight: 500
    lineHeight: 1.95
  body-md:
    fontFamily: "'IBM Plex Sans JP', 'Hiragino Sans', 'Yu Gothic UI', 'Noto Sans JP', sans-serif"
    fontSize: 14px
    fontWeight: 400
    lineHeight: 1.6
  label-md:
    fontFamily: "'IBM Plex Sans JP', 'Hiragino Sans', 'Yu Gothic UI', 'Noto Sans JP', sans-serif"
    fontSize: 14px
    fontWeight: 600
    lineHeight: 1.45
  label-sm:
    fontFamily: "'IBM Plex Sans JP', 'Hiragino Sans', 'Yu Gothic UI', 'Noto Sans JP', sans-serif"
    fontSize: 12px
    fontWeight: 400
    lineHeight: 1.5
spacing:
  xs: 4px
  sm: 8px
  md: 12px
  lg: 16px
  xl: 24px
  2xl: 32px
  nav: 200px
  nav-min: 160px
  nav-max: 400px
  nav-indent: 16px
  list: 380px
  list-min: 280px
  list-max: 640px
  article-min: 360px
  measure: 36em
  measure-article: 52em
  touch: 44px
  touch-android: 48px
rounded:
  sm: 3px
  md: 4px
  lg: 6px
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.on-primary}"
    typography: "{typography.body-md}"
    rounded: "{rounded.md}"
    padding: "{spacing.sm}"
  button-secondary:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.on-surface}"
    typography: "{typography.body-md}"
    rounded: "{rounded.md}"
    padding: "{spacing.sm}"
  list-row:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.on-surface}"
    typography: "{typography.label-md}"
    padding: "{spacing.md}"
  list-row-selected:
    backgroundColor: "{colors.selected}"
    textColor: "{colors.on-surface}"
    typography: "{typography.label-md}"
    padding: "{spacing.md}"
  list-row-read:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.on-surface-muted}"
    typography: "{typography.body-md}"
    padding: "{spacing.md}"
  article-body:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.on-surface}"
    typography: "{typography.body-lg}"
    padding: "{spacing.2xl}"
  nav:
    backgroundColor: "{colors.background}"
    textColor: "{colors.on-surface}"
    typography: "{typography.body-md}"
    padding: "{spacing.sm}"
  headline-mark:
    backgroundColor: "{colors.mark-fill}"
    textColor: "{colors.on-surface}"
    typography: "{typography.label-md}"
  search-match:
    backgroundColor: "{colors.search-match}"
    textColor: "{colors.on-surface}"
  term-match-green:
    backgroundColor: "{colors.term-green-fill}"
    textColor: "{colors.on-surface}"
  term-match-purple:
    backgroundColor: "{colors.term-purple-fill}"
    textColor: "{colors.on-surface}"
  term-match-pink:
    backgroundColor: "{colors.term-pink-fill}"
    textColor: "{colors.on-surface}"
  term-match-orange:
    backgroundColor: "{colors.term-orange-fill}"
    textColor: "{colors.on-surface}"
  term-badge:
    backgroundColor: "{colors.term-green-fill}"
    textColor: "{colors.on-surface}"
    typography: "{typography.label-sm}"
    rounded: "{rounded.sm}"
  badge-warning:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.warning}"
    typography: "{typography.label-sm}"
    rounded: "{rounded.sm}"
  banner-error:
    backgroundColor: "{colors.error}"
    textColor: "{colors.on-error}"
    typography: "{typography.body-md}"
    rounded: "{rounded.md}"
    padding: "{spacing.sm}"
---

# smarternews design system

## Overview

1人の利用者が毎日開く、記事を読むための画面である。
記事の一覧は道具として作り、1画面に多くの行を並べる。本文は紙面として作り、読みやすい幅と行間を取る。
この2つの役割の違いを、書体の違いで示す。一覧と操作はゴシック、本文と記事の見出しは明朝にする。

画面の中で目立つ色は、重要度を示す黄色の印だけにする。蛍光ペンで見出しに線を引く見立てで、重要な記事だけが一覧の中で目に入る。
例外は、利用者が登録した語の色付けである。利用者が自分で選んだ語と色なので、気になる語を見つける手がかりとして、薄い地の色と下線を許す。
それ以外は、青みのある灰色の濃淡と、操作を示す藍色だけで組み立てる。

## Colors

「ライト」「ダーク」「ダークブルー」の3組の配色を持つ。末尾のない名前が「ライト」の値である。「ダーク」の値は名前の末尾に `-dark` を、「ダークブルー」の値は `-darkblue` を付けて定義する。

- 「ライト」は、青みのある薄い灰色の地に、白い紙面を置く。
- 「ダークブルー」は、青みのある暗い灰色の濃淡で組む。「ライト」と同じ色相なので、端末が暗い配色を指定しているときの既定にする。
- 「ダーク」は、色相を持たない黒と灰で組む。暗い画面で青みを避けたい利用者が選ぶ。

利用者は、設定の画面で「端末に従う」とこの3つから選ぶ。「端末に従う」は、端末が明るい配色のとき「ライト」、暗い配色のとき「ダークブルー」で表示する。
画面が利用者の選択と端末の設定を見て値を入れ替えるので、部品は末尾のない名前だけを使う。

- `background`（`#F3F5F8`）は、項目の一覧と画面の地に使う。青みのある薄い灰色で、白い紙面との差で区画を分ける。
- `surface`（`#FFFFFF`）は、記事の一覧と本文の紙面に使う。
- `on-surface`（`#17202B`）は、未読の見出しと本文の文字に使う。真っ黒にせず、青みを入れて地の色とそろえる。
- `on-surface-muted`（`#586473`）は、既読の見出し、要約、時刻などの補足に使う。白の上で4.5対1以上を保つ。
- `outline`（`#D8DEE6`）は、行と区画を分ける罫線に使う。
- `outline-strong`（`#7A8594`）は、ボタンと入力欄の枠に使う。部品の境目なので、地との差を3対1以上にする。
- `primary`（`#24418F`）は、リンク、押せる部品の文字と枠、フォーカスの枠に使う。主となるボタンは地をこの色にする。
- `selected`（`#E8EDF7`）は、選択中の行と項目の地に使う。
- `mark`（`#FFD84A`）と `mark-fill`（`#FFE98A`）は、重要度の印だけに使う。`mark` は見出しの左の線と、読み手への影響の左の線。`mark-fill` は見出しの文字の下半分に重ねる。文字の色には使わない。
- `search-match`（`#CBEEDD`）と `search-match-line`（`#1D6B4C`）は、検索で一致した語の強調だけに使う。`search-match` を語の地に塗り、`search-match-line` で語の下に線を引く。`mark` を使わないのは、`mark` が重要度の印だからである。緑みの色にしたのは、重要度の黄色とも、選択中の行の青みの灰色とも色相を離すためである。語の色付け（#54）の色とも分ける。
- `term-<色>-fill` と `term-<色>` は、語の色付けだけに使う。色は `green`、`purple`、`pink`、`orange` の4つで、利用者が語のまとまりごとに選ぶ。`term-<色>-fill` を一致した箇所と一覧の行の印の地に塗り、`term-<色>` で下線と印の左の線を引く。文字は `on-surface` のままにする。地は、`on-surface` と `on-surface-muted` の文字に対して、3つの配色のそれぞれで4.5対1以上を保つ。線は `surface` に対して3対1以上を保つ。黄色と青は使わない。黄色は重要度の印と、青はリンクの藍色と見分けられなくなるからである。緑は、検索の `search-match` の青みのある緑から色相を黄の側へ離す。
- `warning`（`#8A5200`）は、未確認の印と、一部失敗の状態に使う。
- `error`（`#A1260D`）は、失敗の表示と、削除を確定するボタンに使う。

暗い配色では、`mark` を地の塗りに使うと文字が読めなくなる。`mark-fill-darkblue`（`#5C4B12`）を重ね、文字は `on-surface` の暗い配色の値のままにする。
印の色は、「ダーク」の値を定義しない。`mark`、`mark-fill`、`search-match`、`search-match-line`、`term-<色>`、`term-<色>-fill`、`warning`、`error` である。「ダーク」でも「ダークブルー」の値を使う。意味を持つ色なので、暗い配色の間では変えない。

## Typography

- `IBM Plex Sans JP` は、一覧、操作、設定の画面に使う。字面がそろい、小さい大きさでも数字と仮名が読みやすい。
- `Shippori Mincho` は、記事の見出し（`headline-lg`）と本文（`body-lg`）に使う。長い文章を落ち着いて読める。
- どちらもアプリに同梱する。読み込めない場合は、端末の書体へ代わる。
- Androidアプリには、役割で使う太さの書体のファイルだけを埋め込む。書体の並びは使えないので、役割ごとに1つのファイルを指定する。行間は、大きさに倍率を掛けた値で指定する。
- 記事の本文の1行は52字までにし、行間は1.95にする。明朝は線が細いので、太さは500にする。1行が50字を大きく超えると、次の行の頭を見失いやすい。
- 一覧の見出し（`label-md`）は、未読を太さ600、既読を太さ400（`body-md`）にして見分ける。
- 件数や時刻のように桁をそろえる数字は、等幅の数字にする。
- 記事の言語は設定で変わる。日本語以外の本文でも、同じ大きさと行間で崩れないようにする。

## Layout

- 幅1100px以上は3ペイン。項目の一覧は `nav`（200px）、記事の一覧は `list`（380px）まで、残りが本文。記事は、本文の文字で数えて `measure-article`（52em）までの幅の1列に組む。ペインがそれより広いときは、列をペインの中央に置く。余白が右だけに偏らないようにする。
- 項目の一覧と記事の一覧の幅は、利用者が境目をドラッグして変えられる。`nav` と `list` は既定の幅である。範囲は、項目の一覧が `nav-min`（160px）から `nav-max`（400px）、記事の一覧が `list-min`（280px）から `list-max`（640px）。
- 本文のペインは `article-min`（360px）を下回らせない。それより狭いと、本文の1行が20字を切って読みにくくなる。画面が狭くて収まらないときは、記事の一覧、項目の一覧の順に、表示の幅だけを縮める。
- 設定と実行履歴の画面の入力欄と説明は、`measure`（36em）までにする。
- 幅720pxから1099pxは、記事の一覧と本文の2ペイン。項目の一覧はボタンで開く。
- 幅719px以下は1ペイン。左右の余白は16pxを下回らない。
- 指で操作する端末では、ボタン、入力欄、単独のリンクの高さを `touch`（44px）以上にする。
- Androidアプリでは、押せる部品の高さと幅を `touch-android`（48dp）以上にする。Androidの目安に合わせた値である。
- Androidアプリは1ペインだけで、縦向きに固定する。項目の一覧は、左から出る引き出しに置く。左右の余白は `lg`（16dp）とする。
- 間隔は `spacing` の `xs` から `2xl` までの6段だけを使う。行の中は `xs` と `sm`、行の上下は `md`、区画の間は `xl`、本文のまわりは `2xl`。
- 一覧の行は、見出し、要約1行、補足1行の3段にそろえる。補足は左から、カテゴリ、時刻、出典の件数、印の順に並べ、語のまとまりの印を最後に置く。
- 配信記事の行も同じ3段にする。補足は、購読フィードの名前、時刻の順に並べる。重要度の印と出典の件数は持たないので出さない。
- 項目の一覧は2段までの木にする。カテゴリの下に「AI生成」と購読フィードを置き、`nav-indent`（16px）だけ字下げする。3段目は作らない。
- 項目の名前が幅に収まらないときは、末尾を省略して1行に収める。未読数は省略せず、右端に残す。

## Elevation & Depth

影は使わない。重なりは、地（`background`）と紙面（`surface`）の色の差と、罫線で示す。
ダイアログだけは、背後を暗くして前に出す。Androidアプリの引き出しも同じ扱いにする。

## Shapes

角の丸みは小さくそろえる。印は `sm`、ボタンと入力欄は `md`、ダイアログは `lg`。
一覧の行と本文は角を持たない。記事ごとの枠で囲まず、罫線で区切る。

## Components

- `button-primary` は、画面ごとに1つまで置く。保存や追加のように、その画面の主な操作に使う。
- `button-secondary` は、枠（`outline-strong`）つきの白いボタン。それ以外の操作に使う。押されている状態は、地を `selected`、枠を `primary` にする。
- `list-row` は記事の一覧の1行。選択中は `list-row-selected`、既読は `list-row-read` にする。重要度4は行の左に `mark` の短い線、5は見出しに `headline-mark` を重ねる。
- `article-body` は本文。読み手への影響は、左に `mark` の線を引いた区画として本文の前に置く。
- 配信記事の要約は、元のページを開く操作と内容の間に、左に `outline-strong` の線を引いた区画として置く。見出しは「AIによる要約」で、`label-sm` の大きさと `on-surface-muted` の色にする。要約の文は `body-md` にする。配信元が書いた内容とLLMが書いた文は、見た目で見分けられなければならないからである。線に `mark` を使わないのは、`mark` が重要度の印だからである。枠で囲まないのは、本文が角と枠を持たないからである。
- 要約が配信された内容だけをもとにしているときは、そのことを区画の最後に `label-sm` の大きさと `on-surface-muted` の色で書く。要約を作っている途中は、同じ位置に同じ大きさと色の1行だけを出す。
- 訳のある配信記事の本文は、まとまりごとに、訳を先に、原文をそのすぐ下に置く。訳は本文と同じ `body-lg` と `on-surface` にする。原文は `body-md` の大きさと `on-surface-muted` の色にする。読むのは訳で、原文は確かめるときに見るものだからである。訳と原文の間隔は `xs`、まとまりどうしの間隔は本文の段落と同じにする。対であることを、間隔の差だけで示す。線と枠は足さない。
- 訳のないまとまり（コード、画像、翻訳していない残り）と、訳が原文と同じ文字列のまとまりは、本文の大きさと色で1度だけ出す。翻訳していない残りの前には、そのことを `label-sm` の大きさと `on-surface-muted` の色の1行で書く。
- 訳のある配信記事の見出しは訳したタイトルにし、そのすぐ下（間隔 `xs`）に原文のタイトルを `body-md` の大きさと `on-surface-muted` の色で置く。原文のタイトルを見出しと同じ太さにしないのは、見出しが2つあるように見えるからである。原文のタイトルと原文のまとまりには、原文の言語を属性として付ける。見出しの原文は、見出しにせず太字の1行にする。読み上げで見出しをたどるときに、同じ見出しが2度出ないようにするためである。
- 翻訳している途中は、内容の前に `label-sm` の大きさと `on-surface-muted` の色の1行を出す。翻訳できなかったときは、同じ位置に `body-md` の1行と、やり直すボタンを出す。どちらのときも、内容は原文のまま表示する。
- 本文の中の画像は、配信記事にだけ出す。幅は本文の列までとし、縦横の比を保つ。角は `md`、上下の間隔は `lg` にする。枠と影は付けない。
- 読み込めない画像の位置には、説明の文を `label-sm` の大きさと `on-surface-muted` の色で出す。説明の文がなければ何も出さない。
- 配信記事の本文では、元のページを開く操作を見出しのすぐ下に置く。内容が抜粋だけの配信元が多く、続きは元のページで読むからである。
- `nav` は項目の一覧。選択中の項目は地を `selected` にし、太さを600にする。未読数は右端に置く。カテゴリの行の左には、下の項目を折りたたむ印を置く。
- ペインの境目は、罫線の上に重ねた幅 `sm` の見えない帯で、ドラッグと矢印キーを受ける。マウスを載せたときとフォーカスのあるときだけ、`primary` の2pxの線を出す。普段は罫線だけが見える。矢印キーの1回の刻みは `lg`（16px）。
- 項目の一覧のカテゴリと購読フィードは、ドラッグで並べ替えられる。離したときに入る位置は、`primary` の2pxの横線で示す。ペインの境目と同じ線である。動かしている行は、文字を `on-surface-muted` にする。
- ドラッグ中は、動かしている項目の名前を、`primary` の2pxの枠で囲んだ `surface` の四角にして、ポインターのそばに出す。何かを掴んでいることが、動かし始めてすぐ分かるようにするためである。
- ドラッグ中の購読フィードが上にあるカテゴリは、配下の項目ごと3pxの枠で囲む。フォーカスの枠（2px）より太くして、置く先の候補であることを示す。
- 枠の色は、まだ置けない間は `outline-strong` とし、置けるようになったら `primary` へ変える。別のカテゴリが置けるようになった瞬間は、枠を2回点滅させる。動きを減らす設定の端末では点滅させず、色の変化だけで示す。
- 項目のメニューは、`surface` の地に `outline-strong` の枠で、角は `md` にする。影は付けない。選んでいる行は地を `selected` にし、選べない行は文字を `on-surface-muted` にする。購読フィードの「登録を解除」は、罫線で区切って最後に置く。
- `search-match` は、検索の結果の一覧の見出しと抜粋、結果から開いた記事の見出しと本文で、一致した語に重ねる。地の色に加えて、`search-match-line` の2pxの下線を引く。重要度5の見出しの `headline-mark` と重なっても、色を見分けられない利用者にも線の形で分かるようにするためである。角は付けず、文字の太さと大きさは周りのまま変えない。
- `term-match-<色>` は、語の色付けで一致した箇所に重ねる。一覧の行の見出しと抜粋、本文の見出しと本文、訳と原文、要約の区画が対象である。地を `term-<色>-fill` で塗り、`term-<色>` の2pxの下線を、文字から0.3emほど離して引く。リンクの下線より太く、遠くに引いて、リンクの文字と重なっても見分けられるようにする。色を見分けられない利用者にも、線の形で一致した箇所が分かる。角は付けず、文字の太さと大きさは周りのまま変えない。検索で一致した語と重なったところは、`search-match` を内側に重ねる。
- `term-badge` は、一覧の行の補足の最後に並べる、一致した語のまとまりの印である。まとまりの名前を `label-sm` の文字で書き、地を `term-<色>-fill`、左に `term-<色>` の2pxの線を引き、角は `sm` にする。図の `term-badge` は `green` の例である。名前は文字として読み上げる。幅が足りないときは、名前の末尾を省略する。
- 検索の結果の1行は、要約1行の代わりに、一致した箇所の抜粋を2行まで出す。抜粋は一致した語の前に40字ほどを含むので、1行では語が幅から外れることがあるからである。抜粋がないときは、いつもの要約を1行で出す。
- `badge-warning` は「未確認」の印。「更新」の印は同じ形で、文字を `on-surface-muted` にする。
- `banner-error` は失敗の表示。何ができなかったかと、次にできる操作を1つ並べる。
- フォーカスのある部品は、`primary` の2pxの枠を2px外側に出す。
- 接続用のQRコードは、どの配色でも白地に黒で描く。端末のカメラで読むためである。色の値を直接書く、唯一の例外とする。

## Do's and Don'ts

- `mark` を重要度以外に使わない。目立つ色が増えると、重要な記事が見分けられなくなる。
- 重要度、未確認、状態を色だけで伝えない。言葉か形を必ず併せる。
- 一覧の行を枠や影で囲まない。
- 本文に明朝以外を混ぜない。本文の中の強調は太さで示す。
- 操作の名前は、押したあとに出る表示と同じ言葉にする。「保存する」のあとは「保存しました」。
- 色や大きさの値を画面のコードに直接書かない。必要な値は、先にこのファイルへ足す。
