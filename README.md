# smarternews

[日本語](README.ja.md)

smarternews is a self-hosted news crawler for one reader. You describe the topics you want to follow, in keywords or in sentences. The server collects pages about them on a schedule, groups pages about the same story, and writes one article per story with links to its sources. Read them through an HTTP API or as RSS feeds.

It is also a feed reader. Subscribe to RSS and Atom feeds, and their articles appear beside the written ones, as the feeds deliver them.

A language model does the judging and the writing, and ordinary code does the rest. Fetching, deduplication, scheduling, feed generation and everything about subscribed feeds never call a model. The model is called for five tasks only: interpreting a topic, searching the web, judging candidates, grouping them into stories, and writing an article. Each task has a fixed input and a JSON Schema for its output, so the provider behind it can be replaced.

## Status

This repository contains the server (the crawler, the API and the RSS feeds), a web app for reading and configuring, and an Android app for reading. All three use the same API. Any RSS reader can also subscribe to the feeds.

## Requirements

- Linux or macOS with Node.js 24 or later and pnpm.
- A model provider. The default is the [Claude Code](https://claude.com/claude-code) command `claude`, installed and logged in for the user that runs the server. An OpenAI-compatible server such as Ollama or LM Studio also works; see [docs/providers.md](docs/providers.md).

The server runs TypeScript directly with Node and needs no build. Only the web app is built, with one command.

## Quick start

```bash
git clone https://github.com/uskanda/smarternews.git
cd smarternews
pnpm install
pnpm build    # builds the web app; skip it to use the API and the feeds only

# Load the sample categories, then replace them with your own later.
node apps/server/src/main.ts import examples/settings.example.yaml

# Run one category now. This calls the model a few times and prints a summary.
node apps/server/src/main.ts run developer-tools

# Start the API, the feeds and the scheduler.
node apps/server/src/main.ts serve
```

The `run` command works without the server. Once the server is running, start runs through the API instead (`POST /api/v1/categories/:id/runs`), so that they wait their turn in the server's queue.

The server listens on `127.0.0.1:8787` by default. Open `http://127.0.0.1:8787/` in a browser and paste the API token, or use the API from another terminal:

```bash
API=http://127.0.0.1:8787
TOKEN=$(node apps/server/src/main.ts token api)
FEED_TOKEN=$(node apps/server/src/main.ts token feed)

curl -s "$API/api/v1/health"
curl -s -H "Authorization: Bearer $TOKEN" "$API/api/v1/articles?unread=true"
curl -s "$API/rss/all.xml?token=$FEED_TOKEN"
```

## Web app

The web app is a three-pane reader: views and categories on the left, the list of articles in the middle, the article on the right. On a narrow screen it shows one pane at a time. It follows the light or dark setting of the device.

- Opening an article marks it as read. "すべて既読にする" marks everything in the list, and can be undone for ten seconds.
- Importance 4 and 5 are marked in the list, and a switch narrows the list to them.
- An event category is shown as a list of upcoming events grouped by day.
- A category with subscribed feeds lists them below its name, after an entry "AI生成" for the articles the model wrote. "AI生成" at the top shows the written articles of every category. Feeds without a category are under "未分類".
- The settings pages edit categories, topics, subscribed feeds, stop words, the reader information and the global settings, and load or save the settings file and OPML.
- The run history shows what each run collected, what failed, and which candidates were rejected and why.

Keys: `j` and `k` move to the next and the previous article, `s` toggles the star, `m` toggles read, `o` opens the main source, and `?` lists the keys.

The interface is in Japanese. Articles are written in the output language you configure. Current Chrome is the tested browser; Firefox and Safari from 2024 or later should work as well.

The token is stored in the browser's local storage. "このブラウザーからトークンを消す" in the settings removes it. To work on the app itself, run `pnpm --filter @smarternews/web dev` next to a running server.

## Android app

The Android app is a reader for the phone. It shows the same lists and articles as the web app, marks an article as read when you open it, and tells you about new articles with notifications. Download the APK from the [releases page](https://github.com/uskanda/smarternews/releases) and install it; Android asks once whether to allow installing from that source. The APK holds no server address and no token.

To connect, open the web app's settings on a computer, press "アプリ接続用のQRコードを表示する", and scan the code from the app's first screen. You can also type the server's URL and the token. The device keeps the token in its encrypted storage. Your phone must be able to reach the server, for example over Tailscale.

- Swipe an article left or right to move to the next or the previous one. In the list, a swipe to the left marks a row as read without opening it, and a long press offers the star and the source.
- The drawer on the left lists the same views, categories and subscribed feeds as the web app, with unread counts.
- The settings screen edits the reader information, starts a run of a category, and shows what the latest run of each category did. Categories, topics, subscribed feeds and stop words are edited in the web app, which the settings screen opens in the browser.
- The interface is in Japanese, and the screen stays in portrait.

Notifications are made on the device. While the app is closed, Android lets it ask your server for new articles from time to time, no more often than every 15 minutes and at moments Android chooses. So a notification can arrive well after the article, and battery saving can delay it further; opening the app always shows the current state. Nothing is sent to a notification service. The default notifies articles of importance 5 only; the settings screen offers every new written article, or none. Articles of subscribed feeds are never notified.

Your server is the only thing the app talks to, with one exception: the images in an article of a subscribed feed are loaded from the site that publishes them. Its QR scanner is Google's ML Kit, which would upload usage statistics of the scanner; the build removes the part that does the uploading. Sources open in the browser, which then talks to the site you open.

To build the APK yourself you need a JDK 17 and the Android SDK:

```bash
cd apps/mobile
pnpm exec expo prebuild --platform android --clean
cd android && ./gradlew assembleRelease
```

Without a signing key the build is signed with the debug key, which is enough to try it. The release workflow in [.github/workflows/android.yml](.github/workflows/android.yml) signs with a key from repository secrets and attaches the APK to each release. Its first lines say how to store the key. Keep a copy of that key somewhere safe. Android only installs an update that is signed with the same key as the app it replaces. If the key is lost, the app has to be uninstalled before a new build can be installed.

## What you configure

Two files hold your configuration, and both live outside the repository.

The settings file holds what you want to read: categories, topics, subscribed feeds, stop words, a description of the reader, the output language and the time zone. [examples/settings.example.yaml](examples/settings.example.yaml) shows the format. `import` loads a settings file and `export` writes the current settings back, so the file also serves as a backup. Everything in it can be changed through the API as well.

`~/.config/smarternews/config.yaml` holds how the server runs: the listen address, the model providers, and the limits. Every key is optional. [examples/config.example.yaml](examples/config.example.yaml) lists the keys with their defaults.

### Categories and topics

A category groups topics and has its own schedule and its own RSS feed. Each category is one of two kinds:

- `news` collects pages published within the last `windowHours` (24 by default).
- `event` collects events that take place within the next `windowDays` (7 by default), and stores their date, venue, fee and whether registration is required.

A topic is a keyword or a sentence. The model turns it into search queries and a relevance test once, when the topic is new or its text changes. Each topic chooses its sources:

| Source | What it does |
|---|---|
| `feeds` | Reads the RSS or Atom feeds you list |
| `newsSearch` | Queries a news search engine with the topic's queries |
| `llmSearch` | Lets the model search the web. Use it for topics that feeds and news search miss, such as local events |

`minImportance` (1 to 5) and `maxArticlesPerRun` decide how much of what is relevant becomes an article. Candidates that are left out are stored with the reason for 30 days, and `GET /api/v1/runs/:id/candidates` lists them.

### Subscribed feeds

A subscribed feed is read as it is. The server fetches it on an interval and stores each item as an article with the feed's own title and content. No model is involved, so subscribing costs no model calls. This is separate from the `feeds` of a topic, which are material the model writes from.

Add a feed in the web app under "設定" and "購読フィードを設定する". Enter the address of the feed, or of a site: the server then looks for the feeds that the page announces. A feed belongs to one `news` category or to none.

- The base interval is 30 minutes and can be set from 5 minutes to one day. A feed can have an interval of its own, and can be paused.
- A fetch that fails is shown on the feed, with the reason, and not in the run history. After each failure in a row the wait doubles, up to one day.
- Every item a feed delivers when you subscribe becomes an unread article. Items older than 90 days are left out.
- Articles of feeds can be starred and marked read like any other. Without a star they are deleted after 90 days.
- The content is reduced to paragraphs, headings, lists, quotes, emphasis, code, links and images. Scripts and embedded frames are removed.
- Deleting a category keeps its feeds. They move to "未分類" with their articles.

Images in the content are loaded by your browser or phone from the site that publishes them, over HTTPS only and without a referrer. That site learns the address of your device and when you read. For articles the model wrote, no image is ever loaded.

To move subscriptions between readers, use OPML: the web app loads and saves it, and so do two commands.

```bash
node apps/server/src/main.ts opml-import feeds.opml
node apps/server/src/main.ts opml-export > feeds.opml
```

A folder becomes the category of the same name. If that category does not exist yet, it is created without topics, and such a category starts no scheduled run. Loading a file skips the feeds you already have and deletes nothing.

### Stop words

A stop word hides the articles of subscribed feeds whose title contains it. Each word can also cover the content. Matching ignores case and the difference between full-width and half-width characters. A hidden article is kept and comes back when you remove the word. Starred articles and articles the model wrote are never hidden.

### Reader information

`readerInfo` is free text about who reads the articles. The model uses it to judge relevance and importance, and to add one sentence on what a story means for that reader. Leave it empty and articles carry no such sentence.

## Feeds and API

| URL | Content |
|---|---|
| `/rss/all.xml?token=<feed token>` | The 50 most recently updated written articles of all enabled categories |
| `/rss/<category-slug>.xml?token=<feed token>` | The same for one category |
| `/api/v1/...` | Everything else; see [docs/api.md](docs/api.md) |

The feed token can only read feeds. Keep the API token out of URLs, because it can read and change everything.

These feeds carry the articles the model wrote. Articles of subscribed feeds are not in them: the server does not pass on what other sites publish.

When later pages add to a story within 72 hours, the server rewrites the article and marks it unread. The feed then delivers it again under a new `guid` with a marker in the title, because many readers ignore changes to an item they have already shown.

## Running as a service

[examples/smarternews.service](examples/smarternews.service) is a systemd user unit. The comments at its top give the install commands.

After an upgrade that changes the database, the server copies the database file before it starts, next to the original, as `db.sqlite.before-<number>`. Delete the copy once the new version works for you.

To read from other devices, set `listen` in `config.yaml` to an address those devices can reach, for example the Tailscale address of the machine. The server has no TLS and one fixed token, so it belongs on a private network. Do not expose the port to the internet.

## How it treats other sites

- Every request carries a `User-Agent` that names the product, its version and this repository. You can set your own in `config.yaml`.
- It obeys `robots.txt` before fetching an article page. A `robots.txt` that cannot be read counts as a refusal.
- It waits at least one second between two requests to the same host, and fetches at most 20 article pages per run. Both values are configurable.
- It fetches pages only for stories it is about to write, so pages of candidates judged irrelevant are never requested. With `llmSearch`, a page the model proposes is also fetched once, to confirm that it exists.
- Articles contain the model's own summary and links to the sources. The server does not republish the text of the pages it read, and deletes its copy of that text after 30 days.
- Subscribed feeds are fetched no more often than every five minutes, and every 30 minutes by default. The request carries the `ETag` and `Last-Modified` of the last answer, so an unchanged feed is answered without a body. What a feed delivers is shown to you only, and never served on.

News search uses the RSS output of Google News by default, and of Bing News as an alternative. Both publishers allow that output for personal, non-commercial use in a feed reader. Check their terms before using smarternews for anything else.

## Where it does not go

URLs reach the crawler from feeds, search results and model output, so one of them may point at your router or at another service on the same machine. The crawler therefore fetches only `http` and `https` URLs, and sends no request to a loopback, private, link-local or shared-space (`100.64.0.0/10`) address. A host name is checked against the address it resolves to at the moment of connecting. Every redirect target is checked the same way, and a fetch gives up after five redirects.

To read a feed that you host on your own network, list its host in `config.yaml`:

```yaml
fetch:
  allowPrivateHosts: [feeds.home.example]
```

A refused fetch is recorded like any other failed fetch, so the run history shows the URL and the reason. Calls to model providers are not restricted, because you choose those addresses yourself.

## Limits on model use

A run stops when it has made `llmCallsPerRun` model calls (40 by default). Once the day has reached `llmCallsPerDay` (300 by default), no run calls a model. Articles finished before a stop are kept, and the next run continues with the rest. `GET /api/v1/providers` shows the calls made today.

## Development

```bash
make verify    # lint, type check, tests, the web build, and a scan for personal data
```

Requirements and design live in [openspec/](openspec/) and are written in Japanese. [PRODUCT.md](PRODUCT.md) and [DESIGN.md](DESIGN.md) hold the product facts and the visual tokens of both apps. Tests never call a real model or a real site: they use a fake provider and recorded responses. The tests of the Android app run in Jest against a real API that a test process serves on the loopback address; `make verify` does not build the APK.

## License

[MIT](LICENSE)
