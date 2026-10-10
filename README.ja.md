# smarternews

[English](README.md)

smarternewsは、1人の読み手のためのセルフホスト型ニュース収集サーバーである。
追いたい話題をキーワードか文章で登録すると、サーバーがスケジュールに従って関連するページを集める。
同じ話題のページは1つの記事にまとめ、出典へのリンクを付ける。記事はHTTPのAPIとRSSで読める。

判定と文章の生成はLLMが受け持ち、それ以外はプログラムが受け持つ。
取得、重複の排除、スケジュール、RSSの生成はLLMを呼ばない。
LLMを呼ぶのは、トピックの解釈、Webの検索、候補の判定、話題ごとの集約、記事の執筆の5つのタスクだけである。
どのタスクも入力の形と出力のJSON Schemaが決まっているので、プロバイダーを差し替えられる。

## 状態

このリポジトリにあるのはサーバー（クローラー、API、RSS）である。
APIを使うWebアプリとAndroidアプリは計画中で、まだ含まれていない。それまではRSSを読める任意のアプリで購読できる。

## 必要なもの

- LinuxまたはmacOS、Node.js 24以降、pnpm。
- LLMのプロバイダー。既定は [Claude Code](https://claude.com/claude-code) の `claude` コマンドで、サーバーを動かすユーザーで導入とログインを済ませておく。OllamaやLM StudioのようなOpenAI互換のサーバーも使える。設定は [docs/providers.md](docs/providers.md) にある。

サーバーはNodeでTypeScriptを直接実行するので、ビルドの手順はない。

## 使い始める

```bash
git clone https://github.com/uskanda/smarternews.git
cd smarternews
pnpm install

# 例のカテゴリを読み込む。あとで自分の内容に置き換える。
node apps/server/src/main.ts import examples/settings.example.yaml

# カテゴリを1つ、いますぐ実行する。LLMを数回呼び、結果を1行で表示する。
node apps/server/src/main.ts run developer-tools

# API、RSS、スケジュールを起動する。
node apps/server/src/main.ts serve
```

`run` コマンドはサーバーなしで動く。サーバーの起動後は、APIの `POST /api/v1/categories/:id/runs` で実行を始める。こうすると実行はサーバーの待ち行列に入り、1つずつ進む。

サーバーの既定の待ち受けは `127.0.0.1:8787` である。別の端末から次のように確かめる。

```bash
API=http://127.0.0.1:8787
TOKEN=$(node apps/server/src/main.ts token api)
FEED_TOKEN=$(node apps/server/src/main.ts token feed)

curl -s "$API/api/v1/health"
curl -s -H "Authorization: Bearer $TOKEN" "$API/api/v1/articles?unread=true"
curl -s "$API/rss/all.xml?token=$FEED_TOKEN"
```

## 設定するもの

設定は2つのファイルにあり、どちらもリポジトリの外に置く。

設定ファイルには読みたい内容を書く。カテゴリ、トピック、読み手情報、出力言語、タイムゾーンである。
書式は [examples/settings.example.yaml](examples/settings.example.yaml) を見る。
`import` で読み込み、`export` で現在の設定を書き出せるので、設定の控えとしても使える。同じ内容をAPIからも変更できる。

`~/.config/smarternews/config.yaml` にはサーバーの動かし方を書く。待ち受けの宛先、プロバイダー、各種の上限である。
すべての項目は省略できる。項目と既定値は [examples/config.example.yaml](examples/config.example.yaml) にある。

### カテゴリとトピック

カテゴリはトピックをまとめる単位で、スケジュールとRSSをカテゴリごとに持つ。種別は次の2つである。

- `news` は、直近の `windowHours`（既定は24）時間に公開されたページを集める。
- `event` は、今後 `windowDays`（既定は7）日以内に開催されるイベントを集め、日時、会場、料金、申込の要否を保存する。

トピックはキーワードか文章で書く。トピックを登録したときと文章を変えたときに、LLMが検索語と判定基準を1度だけ作る。
取得元はトピックごとに選ぶ。

| 取得元 | 内容 |
|---|---|
| `feeds` | 登録したRSSまたはAtomのフィードを読む |
| `newsSearch` | トピックの検索語でニュース検索を引く |
| `llmSearch` | LLMにWebを検索させる。地域のイベントのように、フィードとニュース検索で見つからない話題に使う |

関連する話題のうちどこまでを記事にするかは、`minImportance`（1から5）と `maxArticlesPerRun` で決まる。
記事にしなかった候補は理由とともに30日間残り、`GET /api/v1/runs/:id/candidates` で一覧できる。

### 読み手情報

`readerInfo` は、記事を読む人について自由に書く文章である。LLMはこれを関連と重要度の判定に使い、読み手への影響を1文で記事に付ける。
空にすると、記事にその1文は付かない。

## RSSとAPI

| URL | 内容 |
|---|---|
| `/rss/all.xml?token=<RSS用のトークン>` | 有効なカテゴリすべての、最終更新の新しい50件 |
| `/rss/<カテゴリの識別名>.xml?token=<RSS用のトークン>` | 1つのカテゴリの、最終更新の新しい50件 |
| `/api/v1/...` | そのほかの操作。[docs/api.md](docs/api.md) を見る |

RSS用のトークンでできるのはRSSの取得だけである。APIのトークンはすべての読み書きができるので、URLには書かない。

72時間以内に続報が出ると、サーバーは記事を書き直して未読に戻す。
RSSでは、新しい `guid` と、タイトルの先頭の印を付けて配信し直す。一度表示した項目の変更を無視するアプリが多いためである。

## 常駐させる

[examples/smarternews.service](examples/smarternews.service) はsystemdのユーザー単位のサービスの雛形である。導入のコマンドは先頭のコメントにある。

他の端末から読むには、`config.yaml` の `listen` を、その端末から届く宛先に変える。たとえばそのマシンのTailscaleの宛先である。
サーバーはTLSを持たず、認証は固定のトークン1つなので、閉じたネットワークの中で使う。外部のネットワークへは公開しない。

## 他のサイトへの配慮

- すべての要求に、製品名、版、このリポジトリのURLを含む `User-Agent` を付ける。`config.yaml` で変更できる。
- 記事のページを取得する前に `robots.txt` を確かめ、禁じられたページは取得しない。`robots.txt` を読めなかったサイトは、取得を禁じているものとして扱う。
- 同じホストへの要求は1秒以上空ける。1回の実行で取得する記事のページは20までとする。どちらも設定で変えられる。
- ページを取得するのは、記事にすると決めた話題だけである。関連なしと判定した候補のページは取得しない。`llmSearch` では、LLMが挙げたページの実在を確かめるために1度取得する。
- 記事に載せるのは、LLMが書いた要約と出典へのリンクである。読んだページの本文は転載せず、手元の写しは30日で消す。

ニュース検索は、既定でGoogle NewsのRSS出力を使う。Bing NewsのRSS出力へ切り替えることもできる。
どちらも、個人がRSSを読むアプリで使う非商用の利用だけを認めている。ほかの用途で使う前に、各社の利用条件を確かめること。

## LLMの呼び出しの上限

1回の実行は、呼び出しが `llmCallsPerRun`（既定は40）回に達すると止まる。
その日の呼び出しが `llmCallsPerDay`（既定は300）回に達したあとは、どの実行もLLMを呼ばない。
止まる前に完成した記事は残り、次の実行が残りを続ける。当日の呼び出し回数は `GET /api/v1/providers` で分かる。

## 開発

```bash
make verify    # lint、型検査、テスト、個人情報の検査
```

要件と設計は [openspec/](openspec/) に日本語で書いてある。テストは実際のLLMと外部のサイトを呼ばず、偽のプロバイダーと記録済みの応答で動く。

## ライセンス

[MIT](LICENSE)
