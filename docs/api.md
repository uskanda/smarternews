# HTTP API

Every operation is under `/api/v1`. Requests and responses are JSON unless a section says otherwise. The request and response shapes are defined once, as zod schemas, in [packages/core/src/api.ts](../packages/core/src/api.ts). Clients written in TypeScript can import them from `@smarternews/core/api`.

The examples assume these variables:

```bash
API=http://127.0.0.1:8787
TOKEN=$(node apps/server/src/main.ts token api)
```

## Authentication

Send the API token as a bearer token:

```bash
curl -s -H "Authorization: Bearer $TOKEN" "$API/api/v1/settings"
```

A request without the right token gets status 401. `GET /api/v1/health` is the one operation that needs no token. It returns the status and the version of the server.

RSS feeds use a separate, read-only token in the query string. The API rejects that token, and the feeds reject the API token.

## Errors

An error response has this shape:

```json
{ "error": { "code": "invalid_input", "message": "the input is invalid", "fields": [{ "path": "minImportance", "message": "Too big: expected number to be <=5" }] } }
```

| Status | `code` | Meaning |
|---|---|---|
| 400 | `invalid_input` | The input does not match the schema. `fields` names each problem |
| 401 | `unauthorized` | The token is missing or wrong |
| 404 | `not_found` | The article, category, topic, feed, stop word, run or path does not exist |
| 409 | `conflict` | A slug is taken, a feed or a stop word is already registered, or the category already has a run waiting or in progress |
| 503 | `unavailable` | The article cannot be translated now: the translation API cannot be used and the day has no model call left, or the model failed. Nothing was stored; the same request can be sent again later |

## Settings

| Operation | Purpose |
|---|---|
| `GET /api/v1/settings` | Read the reader information and the global settings |
| `PATCH /api/v1/settings` | Change any of them |
| `GET /api/v1/settings/export` | Download the settings file (YAML) |
| `POST /api/v1/settings/import` | Apply a settings file sent as the request body (YAML) |

```bash
curl -s -X PATCH -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"readerInfo":"Maintains web services written in Rust.","outputLanguage":"en","timeZone":"Europe/Berlin"}' \
  "$API/api/v1/settings"

curl -s -H "Authorization: Bearer $TOKEN" "$API/api/v1/settings/export" > settings.yaml
curl -s -X POST -H "Authorization: Bearer $TOKEN" --data-binary @settings.yaml "$API/api/v1/settings/import"
```

Settings fields:

| Field | Content |
|---|---|
| `readerInfo` | Text about who reads the articles |
| `outputLanguage` | A language tag such as `en` or `ja` |
| `timeZone` | An IANA name |
| `search` | `{"language":"en","region":"US"}`, the default market for news search |
| `feedIntervalMinutes` | How often subscribed feeds are fetched, 5 to 1440 minutes, 30 by default |
| `advanceAfterMarkAll` | `true` makes the web app and the Android app open the next list with unread articles after "mark all as read". `false` by default |

Import matches categories by `slug`, topics by `text`, subscribed feeds by `url` and stop words by their text. What matches is updated, the rest is created, and nothing is deleted. Registered feeds are not fetched at once; each is fetched when its turn comes. An invalid file changes nothing. The response counts what was created and updated.

## Categories

| Operation | Purpose |
|---|---|
| `GET /api/v1/categories` | List categories |
| `POST /api/v1/categories` | Create one (status 201) |
| `GET /api/v1/categories/:id` | Read one |
| `PATCH /api/v1/categories/:id` | Change `name`, `schedule`, `minImportance`, `maxArticlesPerRun`, `windowHours`, `windowDays`, `enabled` |
| `POST /api/v1/categories/:id/move` | Put it before another category, or last. Returns all categories in their new order |
| `DELETE /api/v1/categories/:id` | Delete it with its topics, generated articles, candidates and runs (status 204). Its subscribed feeds stay, without a category |

```bash
curl -s -X POST -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"name":"Security","kind":"news","schedule":["06:00","18:00"]}' "$API/api/v1/categories"
```

`kind` is `news` or `event` and cannot change later. A category may have no topics and only hold subscribed feeds; its schedule then starts no run. `slug` is derived from the name when omitted. `schedule` lists times of day in the configured time zone. Defaults: `schedule` `["05:00"]`, `minImportance` 3, `maxArticlesPerRun` 5, `windowHours` 24 for news, `windowDays` 7 for events.

## Topics

| Operation | Purpose |
|---|---|
| `GET /api/v1/categories/:id/topics` | List the topics of a category |
| `POST /api/v1/categories/:id/topics` | Add a topic (status 201) |
| `GET /api/v1/topics/:id` | Read one |
| `PATCH /api/v1/topics/:id` | Change `text`, `enabled`, `sources`, `search`, `queries` |
| `DELETE /api/v1/topics/:id` | Delete it (status 204) |
| `POST /api/v1/topics/:id/interpret` | Ask for a new interpretation before the next run |

```bash
curl -s -X POST -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"text":"Vulnerabilities exploited in the wild","sources":{"feeds":["https://www.bleepingcomputer.com/feed/"],"newsSearch":true}}' \
  "$API/api/v1/categories/1/topics"
```

A topic's response includes `interpreted`, the generated `queries` and `criteria`, and `sources` (`feeds`, `newsSearch`, `llmSearch`). Interpretation happens at the start of the next run of the category. When you create a topic without `sources`, the interpretation chooses `newsSearch` and `llmSearch` for you; once you set `sources` yourself, it leaves them alone. Changing `text` schedules a new interpretation. `search` overrides the language and region of news search for this topic; `null` removes the override.

## Articles

| Operation | Purpose |
|---|---|
| `GET /api/v1/articles` | List articles |
| `GET /api/v1/articles/:id` | Read one with body, references and topics |
| `PATCH /api/v1/articles/:id` | Set `isRead` or `starred` |
| `POST /api/v1/articles/mark-read` | Mark many as read |
| `POST /api/v1/articles/mark-unread` | Put the named articles back to unread |
| `GET /api/v1/counts` | Unread and starred totals, and counts per category and per feed |
| `POST /api/v1/articles/:id/translation` | The translation of a feed article's content, made and stored when there is none yet |
| `GET /api/v1/translation` | How much the translation API was used this month |

Query parameters of the list:

| Parameter | Effect |
|---|---|
| `category` | Category id |
| `origin` | `generated` for articles the model wrote, `feed` for articles of subscribed feeds |
| `feed` | Feed id; only the articles of that subscribed feed |
| `uncategorized` | `true` for the articles of feeds that belong to no category |
| `kind` | `news` or `event` |
| `unread` | `true` or `false` |
| `starred` | `true` or `false` |
| `minImportance` | 1 to 5; only articles at or above this importance. Feed articles have no importance, so this leaves them out |
| `includeEnded` | `true` to include events that have ended |
| `limit` | 1 to 200, default 50 |
| `cursor` | The `nextCursor` of the previous page |

Unless `origin` or `feed` narrows it, a list holds generated articles and feed articles together. Articles come ordered by last update, newest first. A feed article sorts by the time its item was published. When the item has no date, or one in the future, the time it was fetched is used. With `kind=event` the order is by start time, soonest first. Every list leaves out events that have ended unless `includeEnded=true` is given. Each response has two fields: `items`, the articles of this page, and `nextCursor`, which is `null` on the last page.

```bash
curl -s -H "Authorization: Bearer $TOKEN" "$API/api/v1/articles?unread=true&limit=20"
curl -s -H "Authorization: Bearer $TOKEN" "$API/api/v1/articles?kind=event"

curl -s -X PATCH -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"isRead":true,"starred":true}' "$API/api/v1/articles/1"

curl -s -X POST -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"categoryId":1,"before":"2026-03-01T12:00:00Z"}' "$API/api/v1/articles/mark-read"
```

`mark-read` marks the unread articles that were last updated before `before`. Pass the time at which you loaded the list, so that articles that arrived afterwards stay unread. `categoryId`, `origin`, `feedId`, `uncategorized` (`true`) and `minImportance` narrow it; omit them all to cover everything. The response lists the articles it changed as `ids`, and `mark-unread` takes such a list to undo the change:

```bash
curl -s -X POST -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"ids":[1,2]}' "$API/api/v1/articles/mark-unread"

curl -s -H "Authorization: Bearer $TOKEN" "$API/api/v1/counts"
```

`counts` returns these:

| Field | Content |
|---|---|
| `unread`, `starred` | Totals over everything |
| `generatedUnread` | Unread generated articles |
| `uncategorizedUnread` | Unread articles of feeds without a category |
| `categories` | Per category: `categoryId`, `unread`, `total`, `generatedUnread`, and `generatedTotal` (its generated articles, read or not) |
| `feeds` | Per subscribed feed: `feedId` and `unread` |

A category's `unread` and `total` include the articles of its subscribed feeds. Unread counts leave out events that have ended. No count includes a feed article that a stop word hides.

Fields of an article in the list:

| Field | Content |
|---|---|
| `origin` | `generated` or `feed` |
| `categoryId` | The category, or `null` for an article of a feed without one |
| `feedId`, `author` | For feed articles: the subscribed feed, and the author the feed names. Otherwise `null` |
| `title`, `summary` | Headline and one or two sentences. For a feed article the summary is the start of its content |
| `importance` | 1 to 5, or `null` for a feed article |
| `impact` | One sentence for the reader, or `null` |
| `unconfirmed` | True when the sources are only rumours or unofficial |
| `firstPublishedAt`, `updatedAt` | When the article was first written and last rewritten |
| `revision` | How many times a follow-up rewrote it |
| `isRead`, `starred` | The reader's marks |
| `primaryUrl` | URL of the main source. For a feed article, the page of the item |
| `event` | For events: `startsAt`, `endsAt`, `venue`, `fee`, `registration` |

The detail adds these:

| Field | Content |
|---|---|
| `body`, `bodyHtml` | The article as Markdown and as HTML. For a feed article this is what the feed delivered, reduced to paragraphs, headings, lists, quotes, emphasis, code, links and HTTPS images. Only the HTML of a feed article contains images |
| `refs` | Every source: `url`, `siteName`, `title`, `publishedAt` |
| `topics` | The topics the story matched |
| `snippetOnly` | True when no source page could be read |
| `autoSummary` | The summary a model wrote of a feed article: `text`, `source` and `createdAt`. `source` is `page` when it was written from the article's page, and `feed` when that page could not be read and only what the feed delivered was used. `null` when there is no summary, and always for a generated article |
| `autoSummaryPending` | True while a feed article waits for its summary. It stops waiting when it is read |
| `translatedTitle` | The title of a feed article in the output language, also in the list. `title` stays the original. `null` when there is no translation |
| `translatable` | True for an article of a subscribed feed that has `translate` switched on. Only such an article can be translated |
| `sourceLanguage` | The language of the original as the translation API found it, such as `en`. `null` when a model translated or nothing did |
| `translation` | The stored translation of the content, in the shape `POST /api/v1/articles/:id/translation` returns. `null` until the article is translated |
| `previousArticleId` | The earlier article of the same story, when the follow-up came more than 72 hours later |

Generated articles without a star are deleted 180 days after their last update, feed articles without a star 90 days after the time they sort by. Starred articles are kept.

## Subscribed feeds

A subscribed feed is read as it is, like in any feed reader. Its items become feed articles, and no model is called for them. This is separate from the `feeds` of a topic, which are sources the model writes from.

| Operation | Purpose |
|---|---|
| `GET /api/v1/feeds` | List the subscribed feeds with their fetch state |
| `POST /api/v1/feeds` | Subscribe to a feed (status 201) |
| `POST /api/v1/feeds/discover` | Find the feeds a page points to, without subscribing |
| `GET /api/v1/feeds/:id` | Read one |
| `PATCH /api/v1/feeds/:id` | Change `title`, `categoryId`, `intervalMinutes`, `enabled`, `autoSummarize`, `translate` |
| `POST /api/v1/feeds/:id/move` | Put it into a category, before another feed there or last. Returns all feeds in their new order |
| `DELETE /api/v1/feeds/:id` | Delete it with all of its articles, starred ones included (status 204) |
| `POST /api/v1/feeds/:id/fetch` | Fetch it now |
| `GET /api/v1/feeds/opml` | Download every subscribed feed as OPML |
| `POST /api/v1/feeds/opml` | Subscribe to the feeds of an OPML document sent as the request body |

```bash
curl -s -X POST -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"url":"https://example.org/"}' "$API/api/v1/feeds/discover"

curl -s -X POST -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"url":"https://example.org/feed.xml","categoryId":1,"intervalMinutes":120}' "$API/api/v1/feeds"

curl -s -X PATCH -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"intervalMinutes":null,"enabled":false}' "$API/api/v1/feeds/1"

curl -s -X POST -H "Authorization: Bearer $TOKEN" "$API/api/v1/feeds/1/fetch"

curl -s -H "Authorization: Bearer $TOKEN" "$API/api/v1/feeds/opml" > feeds.opml
curl -s -X POST -H "Authorization: Bearer $TOKEN" --data-binary @feeds.opml "$API/api/v1/feeds/opml"
```

Subscribing fetches the URL once and answers when that is done. Status 400 means that the URL does not return RSS or Atom, or that it is a destination the crawler does not fetch (see the README). A 409 answer says that the URL is already subscribed; URLs that differ only in tracking parameters count as the same. Every item the feed delivers at that moment becomes an unread article, except items published more than 90 days ago.

`categoryId` must name a category of the kind `news`, or be `null` for no category. `intervalMinutes` is 5 to 1440, or `null` to follow `feedIntervalMinutes` of the settings. `title` is taken from the feed unless you set it; once set, it stays. `autoSummarize` and `translate` are `false` unless you send `true`, at registration or in a change.

`move` takes `{"categoryId": 3, "before": 12}`: the category the feed goes into (`null` for none) and the feed it is placed before (`null` for last). Moving a category takes `{"before": 3}` in the same way. The lists of categories and feeds are returned in this order everywhere, and the settings file and OPML are written in it.

`discover` returns `feeds`, a list of `url` and `title`. When the URL is itself a feed, the list holds that one feed. For a page it holds the feeds the page names with `<link rel="alternate">`, and it is empty when there are none.

Fields of a feed:

| Field | Content |
|---|---|
| `url`, `title`, `siteUrl` | The feed, its name, and the page it belongs to |
| `categoryId` | The category, or `null` |
| `intervalMinutes` | The feed's own interval, or `null` for the base interval |
| `enabled` | False while the feed is paused: it is not fetched, and its articles stay |
| `autoSummarize` | True when a model summarises the articles this feed delivers. Only articles stored after it was switched on are summarised |
| `translate` | True when the titles and contents of this feed's articles are translated into the output language. Switching it on translates nothing that is stored: an article the feed already has is translated when it is opened |
| `lastFetchedAt`, `lastSucceededAt` | When it was last asked, and when that last worked |
| `lastError`, `failureCount` | Why the last fetch failed, or `null`; and how many failed in a row |
| `nextFetchAt` | When it is fetched next, or `null` while it is paused |
| `articleCount`, `starredCount` | How many articles it has, and how many of them are starred |

A fetch that fails is recorded on the feed and not in the run history. After each failure in a row the wait before the next try doubles, up to one day; a success brings it back to the interval. `fetch` answers with `status` (`updated`, `not_modified` or `failed`), `created` (the number of new articles), `error` when it failed, and `feed`.

An unchanged feed costs its site little: the server sends back the `ETag` and `Last-Modified` it was given, and a `304` answer counts as a success. Items are recognised by their `guid` or `id`, or by their link when they have neither. When a feed rewrites an item, the article is rewritten in place and keeps its place in the list and its read mark.

The OPML import subscribes to the feeds that are not subscribed yet and skips the others. A folder becomes the category of the same name; when there is none, a `news` category without topics is created. Nested folders count as the outermost one, and a feed outside every folder gets no category. Feeds in a folder named like an `event` category get no category either. Nothing is deleted, moved or fetched by the import, and it answers with `feedsCreated`, `feedsSkipped` and `categoriesCreated`. The export writes the subscribed feeds only, with the categories that hold some as folders.

## Translation

Translation is for the articles of the subscribed feeds that have `translate` switched on, and for nothing else. The target is `outputLanguage` of the settings. The original title and content are kept; stop words are matched against the original only.

The title of a new article is translated while the feed is fetched, by the translation API alone. Without a key, in a month that reached its limit, or when the API fails, the article is stored without a translated title, and the fetch still counts as a success.

`POST /api/v1/articles/:id/translation` takes no body. It returns the stored translation when there is one. Otherwise it translates the content, and the title when that has no translation yet, stores both and returns them, so the first call for an article takes as long as translating does. Requests for the same article that overlap share one translation. It answers 400 for an article that is not `translatable`, and 503 with the code `unavailable` when nothing can translate now.

```json
{
  "translatedTitle": "ベンダーが修正を公開",
  "sourceLanguage": "en",
  "segments": [
    { "original": "The vendor shipped a fix.", "translated": "ベンダーが修正を公開しました。", "originalHtml": "<p>The vendor shipped a fix.</p>", "translatedHtml": "<p>ベンダーが修正を公開しました。</p>" },
    { "original": "```\nnpm update\n```", "translated": null, "originalHtml": "<pre><code>npm update\n</code></pre>", "translatedHtml": null }
  ],
  "method": "google",
  "truncated": false,
  "createdAt": "2026-03-01T12:00:00.000Z"
}
```

| Field | Meaning |
|---|---|
| `segments` | The content in order: every heading, paragraph, list item and quote is one segment. `original` and `translated` are Markdown; the two `Html` fields are the same text rendered, with raw HTML shown as text. A client draws the list from top to bottom and matches nothing up itself |
| `translated` | `null` for a segment that is shown as it is: code, images, and what lies past the translated length |
| `method` | `google` when the translation API translated, `llm` when the model did |
| `truncated` | True when the end of the content was left untranslated. Of one article, the first 20,000 characters are translated (`translation.maxCharsPerArticle`) |

When the feed rewrites an item, the translation of what changed is dropped. The title is translated again with the fetch, the content the next time the article is opened.

`GET /api/v1/translation` returns `month` (the current month in the configured time zone, as `YYYY-MM`), `chars` (characters sent to the translation API in that month), `monthlyChars` (the limit) and `apiKeyConfigured`. It never returns the key.

## Stop words

A stop word hides the feed articles whose title contains it. With the scope `title_and_content` the content counts too. Matching ignores case and the difference between full-width and half-width characters, and treats the word as plain text. Generated articles and starred articles are never hidden.

| Operation | Purpose |
|---|---|
| `GET /api/v1/stop-words` | List the stop words with the number of articles each hides |
| `POST /api/v1/stop-words` | Add one (status 201) |
| `PATCH /api/v1/stop-words/:id` | Change its `scope` |
| `DELETE /api/v1/stop-words/:id` | Remove it |

```bash
curl -s -X POST -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"text":"sponsored","scope":"title_and_content"}' "$API/api/v1/stop-words"

curl -s -X DELETE -H "Authorization: Bearer $TOKEN" "$API/api/v1/stop-words/1"
```

`scope` is `title` (the default) or `title_and_content`. A new word applies to the articles already stored. Hidden articles are kept: they are in no list and no count, and they come back, read or unread as they were, when the word is removed. `DELETE` answers with `restored`, the number of articles that came back. `hiddenCount` counts an article that several words match for the oldest of them.

## Runs

| Operation | Purpose |
|---|---|
| `POST /api/v1/categories/:id/runs` | Run a category now (status 202) |
| `GET /api/v1/runs` | List runs, newest first. `category` and `limit` narrow the list |
| `GET /api/v1/runs/:id` | Read one |
| `GET /api/v1/runs/:id/candidates` | List the candidates the run rejected, with reasons |

```bash
curl -s -X POST -H "Authorization: Bearer $TOKEN" "$API/api/v1/categories/1/runs"
curl -s -H "Authorization: Bearer $TOKEN" "$API/api/v1/runs?category=1&limit=5"
curl -s -H "Authorization: Bearer $TOKEN" "$API/api/v1/runs/1/candidates"
```

Runs execute one at a time. A manual run of a category that already has a run waiting or in progress gets status 409.

A run has `trigger` (`schedule` or `manual`), `status`, `queuedAt`, `startedAt`, `finishedAt`, the counts `collected`, `rejected`, `articlesCreated`, `articlesUpdated`, `llmCalls`, and `failures` (each with `stage`, `target`, `message`).

| `status` | Meaning |
|---|---|
| `queued`, `running` | Waiting or in progress |
| `succeeded` | Finished without a failure |
| `partial` | Finished, and some step failed: a feed, a topic's interpretation, one article |
| `failed` | Every source failed, the run crashed, or the server stopped during it |
| `stopped_by_limit` | A limit on model calls was reached. Finished articles are kept and the next run continues |

A scheduled run that ends as `failed` is retried, as the README describes. Four more fields of a run say where it stands:

| Field | Meaning |
|---|---|
| `attempt` | Which retry the run is: 1 for the first retry. 0 for a run that is not a retry |
| `retryOf` | The id of the scheduled run this run retries, however many retries came between. `null` for a run that is not a retry |
| `retryAt` | When the retry of this failed run is due. `null` when none is planned, and once the retry has been queued |
| `retrySkipped` | Why this failed run is not retried, or `null` |

A retry has the `trigger` `schedule`. `retrySkipped` is one of four values:

| `retrySkipped` | Meaning |
|---|---|
| `limit` | The retries allowed by `limits.runRetries` are used up |
| `superseded` | The next scheduled run of the category was queued first |
| `disabled` | The category is disabled or has no enabled topic |
| `manual` | The run was started by hand, and manual runs are not retried |

A failed run can have neither `retryAt` nor `retrySkipped`. Its retry has been queued, or it failed before retries existed, or the server closed it at start-up because it had waited for more than six hours.

`GET /api/v1/runs/:id/candidates` accepts `status=rejected` (the default), `pending`, `accepted` or `all`. Each candidate has `title`, `url`, `siteName`, `publishedAt`, `sourceKind`, `topics`, `importance` and `reason`. Runs and candidates are deleted after 30 days.

## Providers

`GET /api/v1/providers` returns the configured providers (`name`, `adapter`, `model`, `webSearch`), the provider assigned to each task, the model calls made today for runs (`llmCallsToday`), the summaries made today (`summariesToday`) and the three limits (`llmCallsPerRun`, `llmCallsPerDay`, `summariesPerDay`). It returns no credentials. Providers are changed in `config.yaml`, not through the API.

## RSS

```bash
FEED_TOKEN=$(node apps/server/src/main.ts token feed)
curl -s "$API/rss/all.xml?token=$FEED_TOKEN"
curl -s "$API/rss/security.xml?token=$FEED_TOKEN"
```

`/rss/all.xml` covers every enabled category and `/rss/<slug>.xml` covers one. A feed holds the 50 most recently updated generated articles and leaves out events that have ended. Articles of subscribed feeds are never in it: the server does not pass on what other sites deliver. Each item carries the summary as `description` and the full article as `content:encoded`. The full article holds, in this order, a notice when it is unconfirmed, the event details, the sentence for the reader, the body, and links to every source.
