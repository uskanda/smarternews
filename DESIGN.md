---
# DESIGN.md - Google DESIGN.md format (https://github.com/google-labs-code/design.md, version alpha).
# Tokens here are the normative values; the prose below says why and how to apply them.
# Check after every edit: designmd lint DESIGN.md   (0 errors; read the warnings)
version: alpha
name: smarternews
description: 記事の一覧は密度の高い道具として、本文は落ち着いて読む紙面として見せる。目立つ色は重要度の印だけにする。
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
  warning: "#8A5200"
  error: "#A1260D"
  on-error: "#FFFFFF"
  primary-dark: "#9CB6FF"
  on-primary-dark: "#10151B"
  background-dark: "#10151B"
  surface-dark: "#171D25"
  on-surface-dark: "#E7EBF0"
  on-surface-muted-dark: "#9DA9B7"
  outline-dark: "#2B3440"
  outline-strong-dark: "#66727F"
  selected-dark: "#212B3A"
  mark-dark: "#E9C13A"
  mark-fill-dark: "#5C4B12"
  warning-dark: "#F0B45C"
  error-dark: "#FFA08F"
  on-error-dark: "#10151B"
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
  list: 380px
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
それ以外は、青みのある灰色の濃淡と、操作を示す藍色だけで組み立てる。

## Colors

明るい配色と暗い配色の2組を持つ。暗い配色の値は、名前の末尾に `-dark` を付けて定義する。
画面のCSSが端末の設定を見て入れ替えるので、部品は末尾のない名前だけを使う。

- `background`（`#F3F5F8`）は、項目の一覧と画面の地に使う。青みのある薄い灰色で、白い紙面との差で区画を分ける。
- `surface`（`#FFFFFF`）は、記事の一覧と本文の紙面に使う。
- `on-surface`（`#17202B`）は、未読の見出しと本文の文字に使う。真っ黒にせず、青みを入れて地の色とそろえる。
- `on-surface-muted`（`#586473`）は、既読の見出し、要約、時刻などの補足に使う。白の上で4.5対1以上を保つ。
- `outline`（`#D8DEE6`）は、行と区画を分ける罫線に使う。
- `outline-strong`（`#7A8594`）は、ボタンと入力欄の枠に使う。部品の境目なので、地との差を3対1以上にする。
- `primary`（`#24418F`）は、リンク、押せる部品の文字と枠、フォーカスの枠に使う。主となるボタンは地をこの色にする。
- `selected`（`#E8EDF7`）は、選択中の行と項目の地に使う。
- `mark`（`#FFD84A`）と `mark-fill`（`#FFE98A`）は、重要度の印だけに使う。`mark` は見出しの左の線と、読み手への影響の左の線。`mark-fill` は見出しの文字の下半分に重ねる。文字の色には使わない。
- `warning`（`#8A5200`）は、未確認の印と、一部失敗の状態に使う。
- `error`（`#A1260D`）は、失敗の表示と、削除を確定するボタンに使う。

暗い配色では、`mark` を地の塗りに使うと文字が読めなくなる。`mark-fill-dark`（`#5C4B12`）を重ね、文字は `on-surface-dark` のままにする。

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
- 設定と実行履歴の画面の入力欄と説明は、`measure`（36em）までにする。
- 幅720pxから1099pxは、記事の一覧と本文の2ペイン。項目の一覧はボタンで開く。
- 幅719px以下は1ペイン。左右の余白は16pxを下回らない。
- 指で操作する端末では、ボタン、入力欄、単独のリンクの高さを `touch`（44px）以上にする。
- Androidアプリでは、押せる部品の高さと幅を `touch-android`（48dp）以上にする。Androidの目安に合わせた値である。
- Androidアプリは1ペインだけで、縦向きに固定する。項目の一覧は、左から出る引き出しに置く。左右の余白は `lg`（16dp）とする。
- 間隔は `spacing` の `xs` から `2xl` までの6段だけを使う。行の中は `xs` と `sm`、行の上下は `md`、区画の間は `xl`、本文のまわりは `2xl`。
- 一覧の行は、見出し、要約1行、補足1行の3段にそろえる。補足は左から、カテゴリ、時刻、出典の件数、印の順に並べる。

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
- `nav` は項目の一覧。選択中の項目は地を `selected` にし、太さを600にする。未読数は右端に置く。
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
