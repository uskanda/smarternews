# smarternews

[日本語](README.ja.md)

smarternews is a self-hosted news crawler for one reader. You describe the topics you want to follow, in keywords or in sentences. The server collects pages about them on a schedule, groups pages about the same story, and writes one article per story with links to its sources. Read them through an HTTP API or as RSS feeds.

A language model does the judging and the writing, and ordinary code does the rest. Fetching, deduplication, scheduling and feed generation never call a model. The model is called for five tasks only: interpreting a topic, searching the web, judging candidates, grouping them into stories, and writing an article. Each task has a fixed input and a JSON Schema for its output, so the provider behind it can be replaced.

## Status

This repository contains the server (the crawler, the API and the RSS feeds) and a web app for reading and configuring. An Android app that uses the same API is planned and is not in the repository yet. Any RSS reader can also subscribe to the feeds.

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
- The settings pages edit categories, topics, the reader information and the global settings, and load or save the settings file.
- The run history shows what each run collected, what failed, and which candidates were rejected and why.

Keys: `j` and `k` move to the next and the previous article, `s` toggles the star, `m` toggles read, `o` opens the main source, and `?` lists the keys.

The interface is in Japanese. Articles are written in the output language you configure. Current Chrome is the tested browser; Firefox and Safari from 2024 or later should work as well.

The token is stored in the browser's local storage. "このブラウザーからトークンを消す" in the settings removes it. To work on the app itself, run `pnpm --filter @smarternews/web dev` next to a running server.

## What you configure

Two files hold your configuration, and both live outside the repository.

The settings file holds what you want to read: categories, topics, a description of the reader, the output language and the time zone. [examples/settings.example.yaml](examples/settings.example.yaml) shows the format. `import` loads a settings file and `export` writes the current settings back, so the file also serves as a backup. Everything in it can be changed through the API as well.

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

### Reader information

`readerInfo` is free text about who reads the articles. The model uses it to judge relevance and importance, and to add one sentence on what a story means for that reader. Leave it empty and articles carry no such sentence.

## Feeds and API

| URL | Content |
|---|---|
| `/rss/all.xml?token=<feed token>` | The 50 most recently updated articles of all enabled categories |
| `/rss/<category-slug>.xml?token=<feed token>` | The same for one category |
| `/api/v1/...` | Everything else; see [docs/api.md](docs/api.md) |

The feed token can only read feeds. Keep the API token out of URLs, because it can read and change everything.

When later pages add to a story within 72 hours, the server rewrites the article and marks it unread. The feed then delivers it again under a new `guid` with a marker in the title, because many readers ignore changes to an item they have already shown.

## Running as a service

[examples/smarternews.service](examples/smarternews.service) is a systemd user unit. The comments at its top give the install commands.

To read from other devices, set `listen` in `config.yaml` to an address those devices can reach, for example the Tailscale address of the machine. The server has no TLS and one fixed token, so it belongs on a private network. Do not expose the port to the internet.

## How it treats other sites

- Every request carries a `User-Agent` that names the product, its version and this repository. You can set your own in `config.yaml`.
- It obeys `robots.txt` before fetching an article page. A `robots.txt` that cannot be read counts as a refusal.
- It waits at least one second between two requests to the same host, and fetches at most 20 article pages per run. Both values are configurable.
- It fetches pages only for stories it is about to write, so pages of candidates judged irrelevant are never requested. With `llmSearch`, a page the model proposes is also fetched once, to confirm that it exists.
- Articles contain the model's own summary and links to the sources. The server does not republish the text of the pages it read, and deletes its copy of that text after 30 days.

News search uses the RSS output of Google News by default, and of Bing News as an alternative. Both publishers allow that output for personal, non-commercial use in a feed reader. Check their terms before using smarternews for anything else.

## Limits on model use

A run stops when it has made `llmCallsPerRun` model calls (40 by default). Once the day has reached `llmCallsPerDay` (300 by default), no run calls a model. Articles finished before a stop are kept, and the next run continues with the rest. `GET /api/v1/providers` shows the calls made today.

## Development

```bash
make verify    # lint, type check, tests, the web build, and a scan for personal data
```

Requirements and design live in [openspec/](openspec/) and are written in Japanese. [PRODUCT.md](PRODUCT.md) and [DESIGN.md](DESIGN.md) hold the product facts and the visual tokens of the web app. Tests never call a real model or a real site: they use a fake provider and recorded responses.

## License

[MIT](LICENSE)
