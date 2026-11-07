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

A request without the right token gets status 401. Two operations need no token: `GET /api/v1/health`, which returns the status and the version of the server, and the image relay under `/api/v1/image-proxy/`, whose URLs carry a signature instead (see [Images](#images)).

RSS feeds use a separate, read-only token in the query string. The API rejects that token, and the feeds reject the API token.

## Errors

An error response has this shape:

```json
{ "error": { "code": "invalid_input", "message": "the input is invalid", "fields": [{ "path": "minImportance", "message": "Too big: expected number to be <=5", "code": "too_big", "maximum": 5, "unit": "number" }] } }
```

Each entry of `fields` has `path` and `message`. The message is English and meant for logs and the CLI; a client words the problem from these optional fields instead:

| Field | Meaning |
|---|---|
| `code` | The kind of problem, listed below. A client words an entry without a code, or with a code it does not know, as a value that cannot be saved |
| `minimum`, `maximum` | The bound that `too_small` or `too_big` broke |
| `unit` | What the bound counts: `chars` (characters of a text), `number` (the value itself) or `items` (entries of a list) |

| `code` | Meaning |
|---|---|
| `required` | The value is missing, or of another type |
| `too_small`, `too_big` | The value, its length or its number of entries is out of range |
| `format` | The value is not in the expected form: a time that is not `HH:MM`, a URL, a regular expression or CSS selector that cannot be read, a number that is not whole |
| `invalid_value` | The value is not one of the allowed values |
| `custom` | Another rule of the schema |
| `unknown_time_zone` | The time zone is not an IANA time zone name |
| `no_such_item` | The value names a category, feed or term group that does not exist |
| `not_allowed` | The value cannot be combined with the rest, such as a keep filter over everything or selectors for a feed |
| `unreachable` | The URL could not be fetched or read as what it should be |
| `no_items` | The selectors take no article out of the page |

The element of a list is named by its index, such as `schedule.1` for the second time.

| Status | `code` | Meaning |
|---|---|---|
| 400 | `invalid_input` | The input does not match the schema. `fields` names each problem |
| 401 | `unauthorized` | The token is missing or wrong |
| 404 | `not_found` | The article, category, topic, feed, filter, run or path does not exist |
| 409 | `conflict` | A slug is taken, a feed or a filter is already registered, or the category already has a run waiting or in progress |
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
| `advanceAfterMarkAll` | `true` makes the web app and the Android app open the next list with unread articles after "mark all as read". `true` by default |
| `removeDuplicates` | `true` hides a feed article that another feed delivered first from the lists over everything and over categories. `true` by default; see [Duplicates across feeds](#duplicates-across-feeds) |
| `digestSchedule` | The times of day, as `HH:MM` in `timeZone`, at which a [digest](#digests) is made. At most 24; stored once each and in the order of the day. `["07:00","19:00"]` by default; `[]` makes digests by hand only |
| `staleFeedDays` | After how many days without a new item an enabled subscribed feed counts as stale, a whole number from 1 to 365. `60` by default; see [Stale feeds and feed stats](#stale-feeds-and-feed-stats) |

Import matches categories by `slug`, topics by `text`, subscribed feeds by `url`, filters by their action, scope and conditions, and term groups by `name`. A filter names a category by its `slug` and a feed by its `url`, and so does an entry of `listViews`; a file written before filters may hold `stopWords`, which become hide filters over everything. What matches is updated, the rest is created, and nothing is deleted: a term group takes the colour of the file and only gains the terms it lacks. The groups of the file come first, in the file's order. Registered feeds are not fetched at once; each is fetched when its turn comes. A [web feed](#web-feeds) is written with its `selectors`, and a subscription with `selectors` is registered as one; a file that gives selectors to a feed the server has, or none to a web feed it has, is invalid. An invalid file changes nothing. The response counts what was created and updated.

`listViews` holds the [list views](#list-views) that differ from the defaults, one entry per item of the left pane: `list` is `unread`, `all`, `starred`, `generated` or `uncategorized`, `{"category": "tools"}`, `{"category": "tools", "generatedOnly": true}` or `{"feed": "https://example.com/feed.xml"}`, and `sort` is `newest` or `oldest`. Export leaves `listViews` out when no entry was changed. Import applies the entries after the categories and feeds of the file are stored, so an entry can name a feed that the same file subscribes to; entries the file does not name keep their views, and an entry without `sort` keeps its sort. An entry that names a category or feed found neither in the file nor on the server, an event category, or the same item twice makes the whole file invalid. `listViewsUpdated` in the response counts the entries applied.

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
| `GET /api/v1/categories/:id/topic-stats` | What each topic of a category brought in the last 30 days |
| `POST /api/v1/categories/:id/topics` | Add a topic (status 201) |
| `GET /api/v1/topics/:id` | Read one |
| `PATCH /api/v1/topics/:id` | Change `text`, `enabled`, `sources`, `search`, `queries` |
| `DELETE /api/v1/topics/:id` | Delete it (status 204) |
| `POST /api/v1/topics/:id/interpret` | Ask for a new interpretation before the next run |
| `POST /api/v1/topics/:id/trials` | Try a text on the topic without saving it (status 202) |
| `GET /api/v1/topic-trials/:id` | Read a trial: its status and, once it succeeded, its result |
| `POST /api/v1/topics/:id/rewrite-proposals` | Ask the model for new wordings of the topic, without saving anything |

```bash
curl -s -X POST -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"text":"Vulnerabilities exploited in the wild","sources":{"feeds":["https://www.bleepingcomputer.com/feed/"],"newsSearch":true}}' \
  "$API/api/v1/categories/1/topics"
```

A topic's response includes `interpreted`, the generated `queries` and `criteria`, and `sources` (`feeds`, `newsSearch`, `llmSearch`). Interpretation happens at the start of the next run of the category. When you create a topic without `sources`, the interpretation chooses `newsSearch` and `llmSearch` for you; once you set `sources` yourself, it leaves them alone. Changing `text` schedules a new interpretation. `search` overrides the language and region of news search for this topic; `null` removes the override. `missesSinceInterpretation` counts the [misses](#misses) of the topic's articles marked after its last interpretation; a topic interpreted before this count existed counts all of its misses.

### Topic trials

A trial shows what a new text would change before you save it. `POST /api/v1/topics/:id/trials` takes `{"text": ..., "search": ...}`, the text and the search locale being edited; `search` left out or `null` uses the settings'. The trial asks the `interpret` task once with them, then the `judge` task once per batch of `limits.judgeBatchSize` stored candidates of the topic. It takes up to that many of the newest candidates the judge accepted and as many it rejected, more of one side when the other has fewer. Candidates rejected for an unknown publication time are left out, and a candidate the program rejected after the judge accepted it (below the minimum importance, over the article limit, an event date outside the window or unconfirmed) counts as accepted. The other topics a candidate matched are judged with their saved text, and each batch is judged at the time its newest candidate was collected.

The answer comes at once: 202 with `{"status": "started", "id": ...}`. When a limit leaves too few calls for the trial, nothing starts and the answer is 200 with `id` `null` and a `status` that names the limit: `limit` for `limits.topicTrialsPerDay`, `day` for `limits.llmCallsPerDay`, `budget` for the monthly budget. While another trial runs, the answer is 409. Only one trial runs at a time.

`GET /api/v1/topic-trials/:id` answers `id`, `topicId`, `status` (`running`, `succeeded`, `failed` or `stopped_by_limit`), `stoppedBy` (`run`, `day` or `budget` for a trial stopped by a limit), `error` for a failed one, and `result` for a succeeded one. The result holds the new `queries` and `criteria`, the category's `minImportance`, the number of candidates `tried`, and `changes`: the candidates whose verdict turned between accepted and rejected, newest first. Each has `candidateId`, `title`, `url`, `siteName`, `publishedAt`, `before` (`verdict`, `reason`, and `byProgram` when the stored reason is the program's), `after` (`verdict`, `reason`, `importance`), and `belowMinimum`, true when the trial accepts it below the category's minimum importance.

A trial stores nothing: topics, candidates, seen URLs and articles stay as they were, and saving the text later interprets it again in the next run. Only its model calls are recorded, with the purpose `trial`. Results are kept in memory for 30 minutes and are gone after a restart; asking then answers 404.

### Proposals of topic rewrites

`POST /api/v1/topics/:id/rewrite-proposals` takes no body. It asks the `proposeTopicRewrite` task once with the saved text and `criteria` of the topic, the reader information, and the topic's articles opened and starred, its misses and the candidates the judge found not relevant (see [Model providers](providers.md#proposals-of-topic-rewrites) for how many of each). The answer waits for the model, up to `llm.timeoutMs`.

The answer is 200 with `status` and `proposals`. `status` is `proposed` with one or two `proposals`, each with `text`, the new wording, and `explanation`, in the output language, of what changed and how the relevance test is likely to change. Without a call of the model, `proposals` is empty and `status` says why: `limit` for `limits.topicRewritesPerDay`, `day` for `limits.llmCallsPerDay`, `budget` for the monthly budget, `uninterpreted` for a topic that waits for its interpretation. When the task fails or runs out of time, the answer is 503. A topic that does not exist answers 404.

Nothing is stored but the record of the call, which belongs to no run. To use a proposal, send its text with `PATCH /api/v1/topics/:id`; the topic is then interpreted again before the next run.

### Topic stats

`topic-stats` counts, for every topic of the category in the order of their ids, the candidates collected and the generated articles made in the last 30 days. No model is called. The answer has `since`, the start of the period, and `topics`, one entry per topic with these fields:

| Field | Meaning |
|---|---|
| `topicId`, `text` | The topic |
| `collected` | The candidates collected for it: `total`, and `bySource` with `feed`, `news-search` and `llm-search` |
| `rejectedByJudge` | Candidates the `judge` task rejected |
| `belowMinimum` | Candidates rejected because their story was below the category's `minImportance` |
| `overLimit` | Candidates rejected because the run had written `maxArticlesPerRun` articles |
| `rejectedByDate` | Candidates rejected for a date: news without a publication time, and events outside the window or without a date |
| `created` | Generated articles of the topic made in the period. Feed articles are never counted |
| `updated` | Generated articles of the topic rewritten by a follow-up, the last time in the period |
| `opened`, `starred` | Of the articles in `created`: the ones opened, and the ones with a star now |
| `missed` | Of the articles in `created`: the ones marked as a [miss](#misses) for this topic, whenever the mark was made |
| `topRejectedSites` | Up to three sites with the most rejected candidates, as `siteName` and `count`, most first; candidates without a site name are left out |

A candidate that matched two topics counts for both. A candidate keeps only its last reason, so one the judge accepted and the program then rejected counts under the program's reason. An unknown category answers 404.

```bash
curl -s -H "Authorization: Bearer $TOKEN" "$API/api/v1/categories/1/topic-stats"
```

## Articles

| Operation | Purpose |
|---|---|
| `GET /api/v1/articles` | List articles |
| `GET /api/v1/articles/:id` | Read one with body, references and topics |
| `PATCH /api/v1/articles/:id` | Set `isRead` or `starred`, or mark a generated article as a miss with `missed` (see [Misses](#misses)) |
| `POST /api/v1/articles/mark-read` | Mark many as read |
| `POST /api/v1/articles/mark-unread` | Put the named articles back to unread |
| `GET /api/v1/counts` | Unread and starred totals, and counts per category and per feed |
| `GET /api/v1/search` | Search the articles by words |
| `POST /api/v1/articles/:id/open` | Record that the article's body was shown to a reader. Returns `openedAt` |
| `POST /api/v1/articles/:id/summary` | Ask for the summary of a feed article that is open. It then goes ahead of the others and keeps waiting after it is read. Returns `status`: `queued`, `limit` (the day has no summaries left) or `none` (this article gets no summary) |
| `POST /api/v1/articles/:id/translation` | The translation of a feed article's content, made and stored when there is none yet |
| `POST /api/v1/articles/:id/full-content` | Fetch the full content of a feed article from its page, and answer when that is done |
| `GET /api/v1/translation` | How much the translation API was used this month |
| `GET /api/v1/annotations` | The reader's highlights and notes on every article, the last made first: see [Annotations](#annotations) |
| `GET /api/v1/mentions/articles` | The articles that mention a name, newest first: see [Mentions](#mentions) |

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
| `recentlyRead` | `true` for the articles read in the last seven days, last read first. Cannot be combined with `category`, `origin`, `feed`, `uncategorized`, `kind`, `unread`, `starred`, `minImportance` or `order` |
| `order` | `newest` (the default) or `oldest`, by the same time either way. Not allowed with `kind=event` or `recentlyRead=true`, whose order is fixed, not even as `newest` |
| `limit` | 1 to 200, default 50 |
| `cursor` | The `nextCursor` of the previous page |

Unless `origin` or `feed` narrows it, a list holds generated articles and feed articles together. Articles come ordered by last update, newest first, or oldest first with `order=oldest`. A feed article sorts by the time its item was published. When the item has no date, or one in the future, the time it was fetched is used. A generated article that a follow-up rewrites moves to the newest end, in either order. With `kind=event` the order is by start time, soonest first. Every list leaves out events that have ended unless `includeEnded=true` is given.

`recentlyRead=true` lists the articles whose `readAt` falls within the last seven days (168 hours, not calendar days), ordered by `readAt`, newest first. It includes events that have ended and ignores `includeEnded`. Articles read before the server started to record read times have no `readAt`, so they never appear here. Combined with any other narrowing, the request gets 400.

Each response has three fields: `items`, the articles of this page; `nextCursor`, which is `null` on the last page; and `asOf`, the time by the server's clock at which it read the list. A cursor belongs to the order it was issued for: the cursor of a list oldest first sent without `order=oldest`, or the other way round, gets 400.

```bash
curl -s -H "Authorization: Bearer $TOKEN" "$API/api/v1/articles?unread=true&limit=20"
curl -s -H "Authorization: Bearer $TOKEN" "$API/api/v1/articles?kind=event"

curl -s -X PATCH -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"isRead":true,"starred":true}' "$API/api/v1/articles/1"

curl -s -X POST -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"categoryId":1,"before":"2026-03-01T12:00:00.000Z"}' "$API/api/v1/articles/mark-read"
```

`mark-read` marks the unread articles that were last updated before `before`. Pass the `asOf` of the first page of the list: articles that arrived after the list was read stay unread, and the articles of pages not loaded yet are marked too, whatever the order of the list. `categoryId`, `origin`, `feedId`, `uncategorized` (`true`) and `minImportance` narrow it; omit them all to cover everything. The response lists the articles it changed as `ids`, including the duplicates marked read with the articles kept for them, and `mark-unread` takes such a list to undo the change:

```bash
curl -s -X POST -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"ids":[1,2]}' "$API/api/v1/articles/mark-unread"
```

`mark-read` also takes a list of the articles a screen showed instead of a range. Each entry names an article by `id` with the `updatedAt` it had in the list. The server marks an article only while it is unread and not updated after that time, so an article that a follow-up rewrote since then stays unread. An id that no longer exists is skipped. The list holds 1 to 500 articles; a longer one gets 400 and marks nothing, and so does a body that also has any field of the range. The response is the same `updated` and `ids`, duplicates included:

```bash
curl -s -X POST -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"articles":[{"id":1,"updatedAt":"2026-03-01T09:00:00.000Z"},{"id":2,"updatedAt":"2026-03-01T10:30:00.000Z"}]}' \
  "$API/api/v1/articles/mark-read"

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

A category's `unread` and `total` include the articles of its subscribed feeds. Unread counts leave out events that have ended. No count includes a feed article that a filter hides. A hidden duplicate counts for its own feed and among the starred only, so a category's `unread` can be smaller than the sum of its feeds' `unread`.

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
| `updateNote` | One or two sentences on what the last rewrite by a follow-up added, in the output language. `null` for an article never rewritten, when the model gave none, after a rewrite whose writer did not read the earlier article (the same event found under another headline), and for a feed article |
| `isRead`, `starred` | The reader's marks |
| `readAt` | When the article was last marked read, by the server's clock. Reading an article that is already read keeps the time, and putting it back to unread clears it. `null` for an unread article, and for one read before read times were recorded |
| `openedAt` | When the article was first opened, by the server's clock: see [Open times](#open-times). `null` for an article never opened, and for every article opened before open times were recorded |
| `primaryUrl` | URL of the main source. For a feed article, the page of the item |
| `event` | For events: `startsAt`, `endsAt`, `venue`, `fee`, `registration` |

The detail adds these:

| Field | Content |
|---|---|
| `body`, `bodyHtml` | The article as Markdown and as HTML. For a feed article this is what the feed delivered (or, for an item without content, its Media RSS description), reduced to paragraphs, headings, lists, quotes, emphasis, code, links and images. The images of a feed article point to the server's relay (see [Images](#images)); only the HTML of a feed article contains images |
| `refs` | Every source: `url`, `siteName`, `title`, `publishedAt`, `reason`, `importance` and `isNew`. `reason` and `importance` are what the judgement gave the source, `null` for a feed article and for older sources. `isNew` is true when a follow-up added the source after the reader last read the article before that follow-up; opening the article again keeps it. It is false in an article never read, for a source stored before the time sources were added was recorded, and in a feed article |
| `topics` | The topics the story matched |
| `snippetOnly` | True when no source page could be read |
| `autoSummary` | The summary a model wrote of a feed article: `text`, `source` and `createdAt`. `source` is `page` when it was written from the article's page, and `feed` when that page could not be read and only what the feed delivered was used. `null` when there is no summary, and always for a generated article |
| `autoSummaryPending` | True while a feed article waits for its summary. It stops waiting when it is read |
| `translatedTitle` | The title of a feed article in the output language, also in the list. `title` stays the original. `null` when there is no translation |
| `translatable` | True for an article of a subscribed feed that has `translate` switched on. Only such an article can be translated |
| `sourceLanguage` | The language of the original as the translation API found it, such as `en`. `null` when a model translated or nothing did |
| `translation` | The stored translation of the content, in the shape `POST /api/v1/articles/:id/translation` returns. `null` until the article is translated |
| `previousArticleId` | The earlier article of the same story, when the follow-up came more than 72 hours later |
| `previousArticles` | The chain of earlier articles of the same story, newest first, at most 20: the article of `previousArticleId`, the article that one follows up, and so on. Each has `id`, `title` and `firstPublishedAt`. The chain ends where an article was deleted or where it comes back on itself. Empty without `previousArticleId` |
| `otherFeeds` | The other feeds that delivered a feed article: one entry per copy recorded as its duplicate, with `articleId` (the copy), `feedId` and `feedTitle`, in the order the copies were stored. Empty for an article without duplicates |
| `fullContent` | The full content of a feed article, taken from its page: `body` (Markdown), `bodyHtml` and `fetchedAt`. It comes apart from `body`, which stays what the feed delivered. `null` when there is none, and always for a generated article |
| `fullContentStatus` | `none`, `waiting` (its feed fetches full content and this article is next in line for it), `fetched` or `failed`. Always `none` for a generated article |
| `fullContentError` | Why the full content could not be had: `reason` and `detail`, as in the answer of `POST /api/v1/articles/:id/full-content`. `null` unless the status is `failed` |
| `annotations` | The reader's annotations on the article: `note`, the note on the whole article or `null`, and `highlights`, the oldest first. See [Annotations](#annotations). The list does not have this field |
| `mentions` | The names of people, organizations, products and places found in the article, in the order they were stored: `name` and `kind` (`person`, `organization`, `product` or `place`). See [Mentions](#mentions). Empty for an article without them. The list does not have this field |
| `attachments` | The files the feed attached to a feed article (RSS enclosures, Media RSS contents and thumbnails), in the order the feed listed them: `url` (the original address), `kind` (`image`, `audio`, `video` or `other`), `mimeType`, `size` in bytes, `title`, `thumbnailOf` (for a thumbnail, the article's page; otherwise `null`) and `imageUrl` (for an image, its address on the image relay; otherwise `null`). They are not part of `body`. Empty for a generated article and for a feed article without attachments. The list does not have this field |
| `missed` | True when the reader marked the generated article as a [miss](#misses). Always `false` for a feed article. The list does not have this field |

### Misses

A miss is the reader's mark on a generated article that should not have been made for its topics. `PATCH /api/v1/articles/:id` with `{"missed":true}` marks it and marks it read; marking it again keeps the first mark. `{"missed":false}` takes the mark away and leaves the read mark as it is. When the same request gives `isRead`, that wins, so an undo can send `{"missed":false,"isRead":false}` to put back an article that was unread. A feed article gets 400, with `missed` as the field and `not_allowed` as the code.

```bash
curl -s -X PATCH -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"missed":true}' "$API/api/v1/articles/1"
```

The server keeps each miss with the article's title and topics as they were when it was marked. The record stays when the article is deleted, and a miss does not keep the article from being deleted. Deleting a topic takes it off the misses; deleting a category deletes its misses. When a topic is interpreted, at the start of a run after it was created, after its text changed, or after `POST /api/v1/topics/:id/interpret`, the interpret task also reads the titles of the topic's misses of the last 90 days, the newest 20 at most, and writes into the criteria what to leave out. A miss never makes a topic be interpreted again by itself.

### Open times

A screen that shows the body of an article calls `POST /api/v1/articles/:id/open`. The first call stores the server's time as `openedAt`; later calls keep it and answer it again, as `{"openedAt":"2026-03-01T10:00:00.000Z"}`. The call works for generated and feed articles, read or unread, and changes neither the read mark nor any count. An article that does not exist gets 404.

Nothing else sets `openedAt`: marking an article read, "mark all as read", marking what a screen showed and reading the duplicates of a kept article leave it as it is. Putting an article back to unread and a follow-up that rewrites it keep it too. The server started to record open times with this version; articles opened before have none, and are not given one from their read time.

```bash
curl -s -X POST -H "Authorization: Bearer $TOKEN" "$API/api/v1/articles/1/open"
```

### Search

`GET /api/v1/search` returns the articles that contain every word of `q`, generated and feed articles alike, newest first by last update. It matches the title, the translated title, the summary, the automatic summary, the body (for a feed article, its content without markup), the impact and the venue of an event, and the reader's annotations: highlighted texts, those no longer in the body included, and notes. The words may be spread over the fields and the annotations. It does not match source URLs, the targets of links or the names found in articles (see [Mentions](#mentions)). Read articles and events that have ended are included; a feed article that a filter hides is not, unless it has a star or an annotation. A hidden duplicate is left out unless `feed` names its feed. The search calls neither a model nor the translation API.

| Parameter | Effect |
|---|---|
| `q` | Required. Words separated by spaces, a full-width space included. At most 200 characters; empty or longer gets 400 |
| `category` | Category id: its generated articles and the articles of its feeds |
| `feed` | Feed id; only the articles of that subscribed feed |
| `unread` | `true` for unread articles only |
| `limit` | 1 to 200, default 50 |
| `cursor` | The `nextCursor` of the previous page |

Words are compared in the form the filters use: full-width and half-width alike, upper and lower case alike. Hiragana and katakana stay different. Every word is a part of the text to find, and signs and words such as `OR` or `NOT` are matched as they are; there is no phrase or exclusion syntax. A word of three or more characters uses the trigram index; a search with only one- and two-character words reads the articles one by one, newest first, and can be slow on a large database.

The response has `items`, `nextCursor`, `asOf` (as in the list) and `terms`. Each item has the fields of an article in the list and `excerpt`: about 120 characters around the first match in the summary, automatic summary, body, impact or venue, without Markdown, with `…` where it was cut. When none of these has a word and a note of the reader's has one, `excerpt` is taken from the first such note (the note on the whole article first, then the notes on highlights, oldest first), as it was written, and `excerptFromNote` is `true`; otherwise `excerptFromNote` is `false`. `excerpt` is `null` when only the title or a highlighted text matches. `terms` are the words as they were matched, normalized and each once, for marking the matches.

```bash
curl -s -G -H "Authorization: Bearer $TOKEN" --data-urlencode "q=battery factory" "$API/api/v1/search"
```

The search index is kept by triggers that call a function the server registers when it opens the database. A connection without that function, such as the `sqlite3` command, can read the database but cannot insert, change or delete articles.

Generated articles without a star or an annotation are deleted 180 days after their last update, feed articles without a star or an annotation 90 days after the time they sort by. Starred and annotated articles are kept. An article whose last annotation is removed is deleted at the next purge once its time has passed.

## Mentions

The names of people, organizations, products and places that an article mentions, at most ten an article. The model finds them in the call that writes a generated article, and in the call that summarises a feed article; no call is made only for names. So a feed article has names only when its feed has automatic summaries on and its summary has been written. A follow-up that rewrites a generated article replaces its names. A feed that rewrites its item, or stops summarising, leaves the names as they are. Articles stored before the server kept names have none. When the names of an answer are not valid, the article or summary is stored without them, and a rewritten article keeps its earlier names.

| Operation | Purpose |
|---|---|
| `GET /api/v1/mentions/articles` | The articles that have the name `name` among their names. `limit` (1 to 200, default 50) and `cursor`, as in the article list |

Names are compared in a normalized form: full-width and half-width alike, upper and lower case alike, without the spaces around them, and with a run of spaces taken as one. Nothing else is taken as the same name: an abbreviation, another spelling or a part of a name is another name. The kind does not count, so the organization `Apple` and the product `Apple` are one name.

The list holds generated and feed articles alike, read ones and events that have ended included, newest first by last update. A feed article that a filter hides is left out, unless it has a star or an annotation, and so is a hidden duplicate, as in a search. The response has the shape of the article list: `items`, `nextCursor` and `asOf`. A name no article has gets an empty list. A name that is empty or only spaces, or longer than 100 characters once normalized, gets 400 with the field `name`. The list calls neither a model nor the translation API.

```bash
curl -s -G -H "Authorization: Bearer $TOKEN" --data-urlencode "name=Bank of Japan" "$API/api/v1/mentions/articles?limit=20"
```

## Annotations

The reader's highlights on the body of an article, each with a note or none, and one note on the whole article. They are kept as they were written, whatever becomes of the body: a follow-up, a rewrite by the feed or the full content changes the body and leaves the annotations as they are. They go with their article when it is deleted. No operation calls a model or the translation API.

| Operation | Purpose |
|---|---|
| `GET /api/v1/annotations` | Every annotation of every article, the last made first. `limit` (1 to 200, default 50) and `cursor`, as in the article list. Answers `items` and `nextCursor` |
| `POST /api/v1/articles/:id/highlights` | Highlight a part of the body. Answers the highlight with status 201 |
| `PATCH /api/v1/highlights/:id` | Change the note of a highlight: `{"note":"..."}`, or `{"note":null}` to remove the note and keep the highlight |
| `DELETE /api/v1/highlights/:id` | Remove a highlight with its note. Answers 204 |
| `PUT /api/v1/articles/:id/note` | Write the note on the whole article, `{"text":"..."}`, or replace the one it has. Answers the note |
| `DELETE /api/v1/articles/:id/note` | Remove the note on the whole article. Answers 204, also when there was none |

```bash
curl -s -X POST -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"quote":"a new battery plant","prefix":"Thecompanywillbuild","suffix":"nearthecoast.","position":19,"note":"Check the size"}' \
  "$API/api/v1/articles/1/highlights"

curl -s -X PUT -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"text":"Compare with last year"}' "$API/api/v1/articles/1/note"

curl -s -H "Authorization: Bearer $TOKEN" "$API/api/v1/annotations?limit=20"
```

A highlight has these fields:

| Field | Content |
|---|---|
| `id`, `articleId` | The highlight and its article |
| `quote` | The highlighted text as the screen drew it. 1 to 5000 characters, not only spaces |
| `prefix`, `suffix` | Up to 32 characters right before and right after the quote, without spaces and line breaks |
| `position` | Where the quote starts, counted in characters of the drawn body without spaces and line breaks. 0 or more |
| `note` | The note, trimmed, up to 5000 characters. `null` when there is none: a note of spaces only is none |
| `createdAt`, `updatedAt` | When it was made, and when its note last changed. Changing the note keeps `createdAt` |

The note on the whole article has `id`, `articleId`, `text` (1 to 5000 characters, trimmed; spaces only get 400), `createdAt` and `updatedAt`. Replacing its text keeps `createdAt`.

The server does not look for the quote in the body: the text a screen draws differs a little from the text the server holds. A screen finds a highlight again in the body it draws, comparing without spaces and line breaks, and telling case and width apart. Where the quote occurs more than once, it takes the occurrence whose text around it matches `prefix` and `suffix` best, and of equals the one nearest `position`. A highlight whose quote is no longer in the body is shown apart from the body.

An item of `GET /api/v1/annotations` has `kind` (`highlight` or `note`), `id`, `articleId`, `origin`, `title` and `translatedTitle` of the article, `quote` (`null` for a note on the whole article), `note` and `createdAt`. The list holds the annotations of every article, a hidden duplicate's included: an annotated feed article is never hidden by filters.

Status 400 answers an empty quote, a quote or note over 5000 characters, `prefix` or `suffix` over 32 characters and a `position` below 0. Status 404 answers an article or a highlight that does not exist.

## Subscribed feeds

A subscribed feed is read as it is, like in any feed reader. Its items become feed articles, and no model is called for them. This is separate from the `feeds` of a topic, which are sources the model writes from.

| Operation | Purpose |
|---|---|
| `GET /api/v1/feeds` | List the subscribed feeds with their fetch state |
| `POST /api/v1/feeds` | Subscribe to a feed (status 201) |
| `POST /api/v1/feeds/discover` | Find the feeds a page points to, without subscribing |
| `POST /api/v1/feeds/page/candidates` | Propose selectors for a page without a feed, each with a preview. See [Web feeds](#web-feeds) |
| `POST /api/v1/feeds/page/preview` | Show what a set of selectors takes out of a page |
| `GET /api/v1/feeds/:id` | Read one |
| `PATCH /api/v1/feeds/:id` | Change `title`, `categoryId`, `intervalMinutes`, `enabled`, `autoSummarize`, `translate`, `fetchFullContent`, and `selectors` of a web feed |
| `POST /api/v1/feeds/:id/move` | Put it into a category, before another feed there or last. Returns all feeds in their new order |
| `DELETE /api/v1/feeds/:id` | Delete it with all of its articles, starred ones included (status 204) |
| `POST /api/v1/feeds/:id/fetch` | Fetch it now |
| `GET /api/v1/feeds/:id/stats` | What became of the articles it delivered in the last 30 days |
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

`categoryId` must name a category of the kind `news`, or be `null` for no category. `intervalMinutes` is 5 to 1440, or `null` to follow `feedIntervalMinutes` of the settings. `title` is taken from the feed unless you set it; once set, it stays. `autoSummarize`, `translate` and `fetchFullContent` are `false` unless you send `true`, at registration or in a change.

`move` takes `{"categoryId": 3, "before": 12}`: the category the feed goes into (`null` for none) and the feed it is placed before (`null` for last). Moving a category takes `{"before": 3}` in the same way. The lists of categories and feeds are returned in this order everywhere, and the settings file and OPML are written in it.

`discover` returns `feeds`, a list of `url` and `title`. When the URL is itself a feed, the list holds that one feed. For a page it holds the feeds the page names with `<link rel="alternate">`, and it is empty when there are none.

Fields of a feed:

| Field | Content |
|---|---|
| `url`, `title`, `siteUrl` | The feed, its name, and the page it belongs to |
| `format` | `feed` for RSS, Atom and RDF; `page` for a [web feed](#web-feeds). It never changes |
| `selectors` | The selectors of a web feed; `null` for a feed |
| `categoryId` | The category, or `null` |
| `intervalMinutes` | The feed's own interval, or `null` for the base interval |
| `enabled` | False while the feed is paused: it is not fetched, and its articles stay |
| `autoSummarize` | True when a model summarises the articles this feed delivers. Only articles stored after it was switched on are summarised |
| `translate` | True when the titles and contents of this feed's articles are translated into the output language. Switching it on translates nothing that is stored: an article the feed already has is translated when it is opened |
| `fetchFullContent` | True when the server fetches the page of every article this feed delivers and stores its text as the full content. Only articles stored after it was switched on are fetched |
| `lastFetchedAt`, `lastSucceededAt` | When it was last asked, and when that last worked |
| `lastError`, `failureCount` | Why the last fetch failed, or `null`; and how many failed in a row |
| `goneAt` | When the first of the 410 (Gone) answers in a row came, or `null`. Any other answer empties it. The feed stays enabled and goes on being fetched |
| `nextFetchAt` | When it is fetched next, or `null` while it is paused. After a 429 or 503 answer with a `Retry-After` header, no earlier than the time it gives, one day ahead at most |
| `articleCount`, `starredCount` | How many articles it has, and how many of them are starred |
| `annotatedCount` | How many of its articles have an annotation, each counted once. Deleting the feed deletes them with their annotations |
| `lastNewItemAt` | When a fetch last found an item the feed had never listed, or `null` when none was found yet |
| `stale` | True when the feed is enabled and no new item came for more than `staleFeedDays` of the settings |
| `recentArticleCount` | How many articles it delivered in the last 30 days: `received` of its stats |

A fetch that fails is recorded on the feed and not in the run history. After each failure in a row the wait before the next try doubles, up to one day; a success brings it back to the interval. A 429 or 503 answer with a `Retry-After` header, in seconds or as a date, also puts the next scheduled try no earlier than the time it gives, one day ahead at most; `fetch` itself does not wait for it. A 410 answer sets `goneAt`, and the feed goes on being fetched like after any failure. `fetch` answers with `status` (`updated`, `not_modified` or `failed`), `created` (the number of new articles), `error` when it failed, and `feed`.

An unchanged feed costs its site little: the server sends back the `ETag` and `Last-Modified` it was given, and a `304` answer counts as a success. Items are recognised by their `guid` or `id`, or by their link when they have neither. When a feed rewrites an item, the article is rewritten in place and keeps its place in the list and its read mark.

The OPML import subscribes to the feeds that are not subscribed yet and skips the others. A folder becomes the category of the same name; when there is none, a `news` category without topics is created. Nested folders count as the outermost one, and a feed outside every folder gets no category. Feeds in a folder named like an `event` category get no category either. Nothing is deleted, moved or fetched by the import, and it answers with `feedsCreated`, `feedsSkipped` and `categoriesCreated`. The export writes the subscribed feeds only, with the categories that hold some as folders. Web feeds are not in it: OPML has no way to hold their selectors. The settings file has them.

### Web feeds

A web feed reads a page that has no feed. The server fetches the page and takes its articles out with CSS selectors: `item` selects every element that holds one article, and the optional `title`, `link` and `date` select the parts of an article inside it. Without `title` the text of the link is the title; without `link` the item's first link is the link, or the item itself when it is a link. An item without a link or a title is left out. Links are made absolute against the page. `date` reads the `datetime` attribute, or else the text: ISO 8601, `2026-10-20`, `2026/10/20`, `2026.10.20` and `2026年10月20日`, each with a time after it or not. A time without an offset is read in `timeZone` of the settings, and an article without a date sorts by the fetch that found it. Each selector is at most 300 characters; one that is not a CSS selector is refused with status 400 and the name of the field, before any request.

A web feed's articles hold the title, the link and the date only. The text of the page is not stored; switch `fetchFullContent` on to have the server fetch each article's page, as for any feed. The page is fetched by the rules of full content: robots.txt is obeyed, and a page it forbids is not requested. No condition is sent, and no script of the page runs, so a page that draws its list with a script has no articles to take out. Fetching, taking out and storing call no model.

```bash
curl -s -X POST -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"url":"https://example.org/news"}' "$API/api/v1/feeds/page/candidates"
curl -s -X POST -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"url":"https://example.org/news","selectors":{"item":"ul.news > li","date":"time"}}' "$API/api/v1/feeds/page/preview"
curl -s -X POST -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"url":"https://example.org/news","format":"page","selectors":{"item":"ul.news > li","date":"time"},"fetchFullContent":true}' "$API/api/v1/feeds"
```

`candidates` takes `{"url": ...}` and answers `candidates`, `usedModel` and `fallback`. Each candidate has `selectors` and a `preview`, and takes at least one article out of the page. The model's `proposeSelectors` task is asked once, the only call of a model for web feeds; the answer waits for it, up to `llm.timeoutMs`. On a day that reached `selectorProposalsPerDay` or `llmCallsPerDay`, when the task fails or runs out of time, and when none of its candidates takes an article out, the server guesses candidates from the parts of the page with many links. `usedModel` is then `false`, and `fallback` says why: `limit`, `failed` or `empty`. The list may be empty. None of this is an error. A page that cannot be fetched (robots.txt, an HTTP failure) answers 400 with the reason. Nothing is stored.

`preview` takes `{"url": ..., "selectors": ...}` and answers `count`, the number of articles the selectors take out, and `items`, the first 10 with `title`, `url` and `publishedAt` (`null` without a date). It calls no model and stores nothing.

Subscribing with `"format": "page"` needs `selectors`, and refuses a page from which they take no article. A feed without `format` is subscribed as before, and `selectors` without `"format": "page"` is refused. `PATCH` takes new `selectors` for a web feed; they apply from the next fetch, and the articles stored before stay. A feed refuses `selectors` with 400. `format` cannot be changed.

A fetch whose page has no element for `item` fails with the reason `no element matches the item selector`. It stores nothing, keeps `lastSucceededAt` and `lastNewItemAt`, and doubles the wait before the next try like any failure; when this goes on past `staleFeedDays`, the feed is stale as well. The server never asks the model again by itself: ask for candidates once more and change the selectors.

### Stale feeds and feed stats

A fetch that finds an item the feed has never listed sets `lastNewItemAt` to the time of the fetch. That holds whether or not the item is stored: an item published more than 90 days ago, an item past the limit of one fetch and an item recorded as a duplicate count as new. A rewritten item, an item whose article was deleted after the retention period while the feed still lists it, and a `304` answer change nothing. The fetch at subscription sets it too, unless the feed delivers no item. A feed that existed before this version got the time its newest article was stored.

A feed is `stale` while it is enabled and more than `staleFeedDays` days have passed since `lastNewItemAt`, or since `createdAt` when no new item came yet. The server works this out on every request, so a change of `staleFeedDays` shows at once. A failing feed can be stale too, and a disabled one never is. Nothing is switched off: a stale feed is fetched as before.

`stats` counts the feed's articles stored in the last 30 days, by the time they were stored, and returns these fields:

| Field | Content |
|---|---|
| `since` | The start of the period |
| `received` | Every article stored, hidden ones included |
| `opened` | The ones with an `openedAt`. Open times are recorded from this version on, so the count is low for the first 30 days after the update |
| `starred` | The ones starred now |
| `hiddenByFilters` | The ones the enabled filters hide now, without the starred and annotated ones. It follows the filters as they are now: adding or deleting a filter changes the count for the whole period |
| `hiddenAsDuplicates` | The ones recorded as duplicates while `removeDuplicates` is on, and `0` while it is off. A duplicate that a filter also hides counts here and in `hiddenByFilters` |
| `lastNewItemAt` | As in the feed |

Nothing of this calls a model. A feed that does not exist gets 404.

```bash
curl -s -H "Authorization: Bearer $TOKEN" "$API/api/v1/feeds/1/stats"
```

### Duplicates across feeds

When a feed delivers a new item, the server compares it with the feed articles that other feeds delivered in the last 7 days. An item is a duplicate when it has the same page, with tracking parameters and the fragment removed, or the same title. Titles are compared without regard to full and half width, case, white space, punctuation and symbols; a title with fewer than 10 characters left is compared by its page only. The items of one feed are not compared with each other, generated articles take no part, and no model is called. The article stored first is kept, and the duplicate is recorded against it. Each item is judged once, when it is stored: a rewritten item is not judged again, and articles stored before this version are never compared.

While `removeDuplicates` is on, a duplicate is left out of the lists over everything, over a category and over no category, and out of their counts. It stays in the list of its own feed, with the starred articles, and in its feed's `unread`. Marking the kept article read, alone or with "mark all as read", marks its unread duplicates read too, except those a filter hides. Putting the kept article back to unread leaves them as they are. A duplicate waits for no summary and its title is not translated when it is fetched; both happen when it is opened and asked for. When the kept article is deleted, the duplicate stored first is kept instead.

Switched off, duplicates are listed and counted like any other article and nothing new is recorded. The records stay, so switching it back on hides the same duplicates again.

## Full content

The full content of a feed article is the text of its page, taken out of the page and reduced to Markdown by the same rules as the content a feed delivers. It is stored next to what the feed delivered, which stays as it was. Filters, the detection of rewritten items and the start of the content in lists use what the feed delivered only. Search does not match the full content. Full content is never in the RSS output, and no model is called to fetch it.

A feed with `fetchFullContent` switched on has the full content of its new articles fetched after they are stored, apart from the fetching of the feed, one page at a time and newest first. An article that is read before its turn comes, a duplicate that is hidden, and an article that a filter hides are skipped. There is no daily limit: the pages are fetched like any other, obeying `robots.txt` and the interval between requests to one host. A fetch that fails is recorded on the article with its reason and is not tried again by itself, not even for a reason that may pass, such as a timeout. When the feed rewrites an item, the full content stays as it was.

`POST /api/v1/articles/:id/full-content` takes no body and works for any feed article, whatever its feed's setting and whether it failed before. It goes ahead of the articles that wait, right after the page being fetched, and answers when its own fetch is over, which can take several seconds. An article that has full content is answered from it without a request. It answers 400 for a generated article and 404 for one that does not exist.

```json
{ "status": "fetched", "fullContent": { "body": "The vendor shipped a fix…", "bodyHtml": "<p>The vendor shipped a fix…</p>", "fetchedAt": "2026-03-01T12:00:00.000Z" } }
```

```json
{ "status": "failed", "error": { "reason": "http", "detail": "404" } }
```

| `reason` | When |
|---|---|
| `no-url` | The article has no page |
| `robots` | `robots.txt` forbids the page |
| `blocked` | The page is a destination the crawler does not fetch (see the README) |
| `http` | The site answered with a status other than 2xx; `detail` is the status |
| `not-html` | The answer is not HTML; `detail` is its media type |
| `timeout` | The site did not answer in time |
| `error` | The request failed otherwise; `detail` says how |
| `no-content` | No text could be taken out of the page |
| `shorter` | The text taken out of the page is shorter than what the feed delivered, as a notice to subscribe would be |

Storing the full content drops the translation of the article's content; the translated title stays. From then on, `POST /api/v1/articles/:id/translation` translates the full content in place of what the feed delivered, with the same limit of characters. When the feed also summarises, the summary is written from the full content, and the page is requested once for both. When the full content failed, the summary is written from what the feed delivered without another request.

## Images

The images in the content of a feed article are loaded from the server, never from the site that published them. In every answer that carries such content (`GET` and `PATCH /api/v1/articles/:id`, `POST /api/v1/articles/:id/translation` and `POST /api/v1/articles/:id/full-content`), the address of each image in `body`, in `fullContent` and in the segments of `translation` is a path of the relay:

```text
/api/v1/image-proxy/<signature>/<original URL in base64url>
```

The path has no origin. The web app loads it from its own origin; another client puts the URL of the server in front of it. The stored content keeps the original URLs, both `http` and `https`. The body of a generated article is never rewritten, and a screen loads no image from it.

The signature is an HMAC-SHA256 of the original URL, made with a key that the server creates at its first start and keeps in the data directory as `image-proxy.key`. The key appears in no answer, no log and no settings file. A signed path does not expire. Deleting the key file and restarting the server makes every earlier path invalid; the next answers carry new ones.

A request for a relay path needs no token, since an image element cannot send one. The server fetches the original with the same limits as a page: no request to a refused address, every redirect target checked, at most five redirects, the configured time limit and `User-Agent`. It sends nothing the device sent, such as cookies or the referrer, and it does not wait the interval per host or read `robots.txt`. It keeps at most four fetches open to one host; the others wait their turn. An image may be up to 10 MB, and its format is told from its bytes: JPEG, PNG, GIF, WebP and AVIF are served, anything else, SVG included, is refused.

| Status | Meaning |
|---|---|
| 200 | The image, with `Content-Type` set to its format, `X-Content-Type-Options: nosniff`, `Content-Security-Policy: default-src 'none'; sandbox` and `Cache-Control: private, max-age=<the period images are kept>` |
| 403 | The signature does not match or the path is malformed. Nothing is fetched |
| 502 | The image could not be had: a refused destination, a timeout, a status other than 2xx, more than 10 MB, or an answer that is not an image in one of the five formats |

An error answer is a short line of plain text. The server keeps the images it fetched on disk, in `image-cache` in the data directory, and answers a later request from there. `images` in `config.yaml` sets how long an image is kept and how much may be kept in all (see the README).

## Translation

Translation is for the articles of the subscribed feeds that have `translate` switched on, and for nothing else. The target is `outputLanguage` of the settings. The original title and content are kept; filters are matched against the original only.

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

## Filters

Filters hide feed articles. A hide filter hides the articles that meet all its conditions. Keep filters hide the articles of their scope that meet none of them: two keep filters of one feed keep what either matches. When the keep filters of a category and of one of its feeds both apply, an article must pass both. An article that a hide filter matches is hidden even when a keep filter keeps it. Generated articles, starred articles and articles with an annotation are never hidden; removing the star or the last annotation hides such an article again when a filter matches it.

| Operation | Purpose |
|---|---|
| `GET /api/v1/filters` | List the filters with the number of articles each hides |
| `POST /api/v1/filters` | Add one (status 201) |
| `PATCH /api/v1/filters/:id` | Change its action, scope or conditions, or switch it on or off |
| `DELETE /api/v1/filters/:id` | Remove it |
| `GET /api/v1/filters/:id/articles` | The articles it hides, newest first, in pages like `GET /api/v1/articles` (`limit`, `cursor`) |
| `POST /api/v1/filters/preview` | Count what a filter would hide, without saving it |

```bash
curl -s -X POST -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"action":"hide","scope":{"type":"all"},"conditions":[{"fields":["title","content"],"match":"contains","value":"sponsored"}]}' \
  "$API/api/v1/filters"

curl -s -X POST -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"action":"keep","scope":{"type":"feed","feedId":1},"conditions":[{"fields":["title"],"match":"regex","value":"release|announce"}]}' \
  "$API/api/v1/filters/preview"

curl -s -X PATCH -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"enabled":false}' "$API/api/v1/filters/1"

curl -s -X DELETE -H "Authorization: Bearer $TOKEN" "$API/api/v1/filters/1"
```

Filter fields:

| Field | Content |
|---|---|
| `action` | `hide` or `keep` |
| `scope` | `{"type":"all"}`, `{"type":"category","categoryId":1}` or `{"type":"feed","feedId":2}`. A keep filter cannot have `all` |
| `conditions` | 1 to 10 conditions; an article must meet all of them |
| `enabled` | `false` keeps the filter without applying it. `true` by default |
| `hiddenCount` | Articles without a star or an annotation that the filter hides now. An article that several filters hide counts for each. 0 while the filter is off |

A condition has `fields` (one or more of `title`, `content`, `author` and `url`), `match` and `value` (up to 200 characters). An article meets the condition when any of the chosen fields matches. With `match` set to `contains`, the value is plain text found anywhere in the field; with `regex`, it is a JavaScript regular expression that may match anywhere in the field. Neither method tells upper case from lower case or full-width from half-width characters. `content` is the delivered content without markup and link targets, `url` is the address of the article's page, and an article without an author never meets an `author` condition. Translations are never matched.

New filters and changed ones apply to the articles already stored. The scope of a category follows the feeds that belong to it now: a feed moved to another category takes that category's filters. Deleting a category or a feed deletes the filters of that scope. Hidden articles are kept. They are in no list and no count, and a "mark all as read" passes over them. Removing the filter or switching it off brings them back, read or unread as they were. `DELETE` answers with `restored`, the number of articles that came back; `PATCH` answers with the filter and `restored`.

Status 400 answers a wrong regular expression, a keep filter over everything, and a scope that names a missing category or feed. Its `fields` name the problem, for example `conditions.1.value`. A filter with the same action, scope and conditions as a registered one gets status 409.

`POST /api/v1/filters/preview` takes the body of `POST /api/v1/filters` and answers with a count such as `{"hiddenCount":3}`. It counts like `hiddenCount`, as if the filter were saved and on. With `id` in the body, that registered filter is left out of the count, which shows what a change would do. Nothing is stored.

## List views

Each entry of the left pane of the web app and the drawer of the Android app keeps how it lists its articles, so that both apps show it the same way. For now a list view holds one setting, `sort`: `newest` or `oldest`. An entry that was never changed is `newest`. The server stores the views and answers them; it does not apply them to `GET /api/v1/articles` by itself, so an app reads the view of the entry it opens and sends `order` with the list.

| Operation | Purpose |
|---|---|
| `GET /api/v1/list-views` | The entries whose view differs from the defaults, as `{"items":[{"key":"feed-12","sort":"oldest"}]}` |
| `PATCH /api/v1/list-views/:key` | Change the view of one entry, `{"sort":"oldest"}`. What the body leaves out stays as it is. Answers with the view of the entry, such as `{"key":"feed-12","sort":"oldest"}` |

```bash
curl -s -X PATCH -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"sort":"oldest"}' "$API/api/v1/list-views/feed-12"
```

A key names an entry: `unread`, `all`, `starred`, `generated`, `uncategorized`, `category-3` (a category), `category-3-generated` (the generated articles of a category) or `feed-12` (a subscribed feed). An entry set back to all its defaults is no longer listed. Deleting a category deletes the views of the category and of its generated articles; its feeds keep theirs when they move to no category. Deleting a feed deletes its view.

Status 404 answers a category or feed that does not exist. Status 400 answers an event category, whose list is ordered by start; `recently-read`, which is ordered by read time; a key it cannot read; and a `sort` other than the two.

## Term highlights

Term groups colour their terms in the lists and the texts of articles, generated and delivered alike. Nothing is hidden, and no article changes: the server only stores the groups and answers them, and the web app and the Android app match the terms against the text they show. A term matches as a filter's `contains` does: anywhere in the text, upper and lower case alike, full-width and half-width alike. Where terms of two groups match one place, the group that comes first colours it.

| Operation | Purpose |
|---|---|
| `GET /api/v1/term-groups` | List the groups in their order, each with its terms |
| `POST /api/v1/term-groups` | Add a group at the end (status 201) |
| `PATCH /api/v1/term-groups/:id` | Change its `name` or `color` |
| `DELETE /api/v1/term-groups/:id` | Remove it with its terms (status 204) |
| `POST /api/v1/term-groups/:id/move` | Put it before another group, `{"before":2}`, or last, `{"before":null}`. Answers with every group in the new order |
| `POST /api/v1/term-groups/:id/terms` | Add a term, `{"text":"tariff"}` (status 201). Answers with the group |
| `DELETE /api/v1/term-groups/:id/terms/:termId` | Remove one term (status 204) |

```bash
curl -s -X POST -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"name":"Trade","color":"orange"}' "$API/api/v1/term-groups"

curl -s -X POST -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"text":"tariff"}' "$API/api/v1/term-groups/1/terms"
```

Term group fields:

| Field | Content |
|---|---|
| `name` | 1 to 100 characters, one group per name |
| `color` | `green`, `purple`, `pink` or `orange`. `green` when left out. The apps take the values of the colour scheme in use |
| `terms` | `[{"id":1,"text":"tariff"}]`, in the order they were added. A term has 1 to 100 characters |

Status 400 answers an empty name or term, a colour outside the four, and a `before` that names no group; status 404 answers a group or term that does not exist. A name that another group has, and a term the group has already in another case or width, get status 409. Another group may have the same term.

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
| `stopped_by_limit` | A limit on model calls or the monthly budget was reached. Finished articles are kept and the next run continues |

A run with the status `stopped_by_limit` names the limit in `stoppedBy`. Every other run has `null` there, and so do runs that stopped before the server kept this field.

| `stoppedBy` | Meaning |
|---|---|
| `run` | The run made as many model calls as `limits.llmCallsPerRun` allows |
| `day` | The day reached `limits.llmCallsPerDay` |
| `budget` | The budget period spent `limits.monthlyBudgetUsd` on providers that cost money. Those providers are not called again until the next period starts |

Three fields say what the run's model calls used. Money is counted as the monthly budget counts it: the known costs of the calls to billable providers (see [Providers](#providers)).

| Field | Meaning |
|---|---|
| `costUsd` | US dollars the run spent on billable providers. `null` for a run that called no billable provider |
| `unknownCostCalls` | The run's calls to billable providers whose cost is unknown, such as a timeout. `costUsd` leaves them out |
| `callsByTask` | For each task the run called, `calls` (every call, those to providers that cost nothing included) and `costUsd` (`null` when none of the calls went to a billable provider). A task the run did not call is absent |

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

### Attention

The server points out what the runs went through that you should look at. It works the items out from the run history each time you ask, and calls no model.

| Operation | Purpose |
|---|---|
| `GET /api/v1/attention` | List the items you have not dismissed, as `{ items, count }` |
| `POST /api/v1/attention/dismissals` | Dismiss the item whose `key` the body gives (status 204) |

```bash
curl -s -H "Authorization: Bearer $TOKEN" "$API/api/v1/attention"
curl -s -X POST -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"key":"run:42"}' "$API/api/v1/attention/dismissals"
```

| `kind` | When |
|---|---|
| `run-failed` | The latest scheduled run of an enabled category, or its last retry, failed with no retry planned, or stopped at a limit, and no later run succeeded or partly failed |
| `uninterpreted` | An enabled topic is still uninterpreted, and the latest finished run of its category failed to interpret it |
| `empty-search` | A news search (one engine and one query of a topic) or a topic's web search by the model returned nothing in its last three attempts. Attempts that failed are left out |
| `no-adoption` | An enabled topic, made at least 14 days ago, has had no article written or updated in the last 14 days |
| `google-unresolved` | The last three runs that tried to resolve Google News redirect links resolved none |

An item has `kind`, `key`, and the fields that fit its kind: `categoryId`, `categoryName`, `topicId`, `topicText`, `runId`, `runStatus`, `source` (`news-search` or `llm-search`), `engine`, `query` and `since`, the time the state began. The other fields are `null`.

The `key` names the kind, the target and what set the item off: the failed run, or the first of the searches that found nothing, for example. A dismissed item stays hidden while that holds, and comes back when something new sets it off. Dismissing the same key again is not an error. Dismissals, and the record of each search behind `empty-search` and `google-unresolved`, are deleted after 30 days.

## Digests

| Operation | Purpose |
|---|---|
| `GET /api/v1/digests` | List the digests, the latest first |
| `GET /api/v1/digests/:id` | Read one digest |
| `POST /api/v1/digests` | Make a digest of the period that ends now |

```bash
curl -s -X POST -H "Authorization: Bearer $TOKEN" "$API/api/v1/digests"
curl -s -H "Authorization: Bearer $TOKEN" "$API/api/v1/digests?limit=1"
```

A digest sums up the generated and feed articles of a period in one call of the `digest` task. The server makes one at the times of `digestSchedule` in the settings, and makes up at start-up for a time missed in the last six hours. A period runs from the end of the last digest to the time the digest is started, at most 24 hours back.

The list answers `items` and `building`, `true` while a digest is being made. `limit` takes 1 to 200 and is 30 by default. Each item has `id`, `createdAt`, `periodStart`, `periodEnd`, `trigger` (`schedule`, `catch-up` or `manual`), `articleCount`, the number of articles the model read, and `executiveSummary`.

One digest adds `sections` and `articles`. A section has `categoryId`, `categoryName`, the name the category had when the digest was made, and `lines`, each with `text` and `articleIds`, the articles it is drawn from. Ids the model was not given are dropped before the digest is stored. `articles` gives `id`, `title` and `origin` of the source articles that are still stored; an id of a deleted article stays in its line and is missing from `articles`. Digests are deleted after 180 days.

`POST` answers at once. It answers 202 with `{"status":"queued"}` when a digest is started, and 409 while one is being made. It answers 200 with `limit` when the day has made `digestsPerDay` calls for digests, `budget` when the provider of the task costs money and the budget period is used up, and `empty` when the period holds no article; the model is not called then. Digests are never in the RSS output.

## Providers

```bash
curl -s -H "Authorization: Bearer $TOKEN" "$API/api/v1/providers"
```

`GET /api/v1/providers` returns the configured providers (`name`, `adapter`, `model`, `webSearch`, `billable`) and the provider assigned to each task. It also returns the model calls made today for runs and proposals of selectors (`llmCallsToday`), the summaries made today (`summariesToday`), the calls made today for digests (`digestsToday`) and the limits (`llmCallsPerRun`, `llmCallsPerDay`, `summariesPerDay`, `selectorProposalsPerDay`, `digestsPerDay`). It returns no credentials. Providers are changed in `config.yaml`, not through the API.

A provider is `billable` when calling it costs money: today that means the `anthropic` adapter. The server works out the cost of each call from the token counts the API reports and the unit prices of the model. `budget` gives what the current budget period has spent:

| Field | Meaning |
|---|---|
| `periodStart`, `periodEnd` | The first and the last day of the period, as `YYYY-MM-DD`. A period starts at midnight UTC on `limits.budgetResetDay` |
| `spentUsd` | US dollars spent in the period by billable providers |
| `monthlyBudgetUsd` | The budget of one period. Once `spentUsd` reaches it, billable providers are not called |
| `warnRatio` | The share of the budget at which the screens warn |
| `unknownCostCalls` | Calls to billable providers that ended without an answer, such as a timeout. Their cost is unknown and `spentUsd` leaves it out |
| `byTask`, `byProvider` | `spentUsd` split by task and by provider name. A task or provider without a cost in the period has 0 |

These amounts are the server's own estimate from published prices, not the amount Anthropic bills.

### Usage

```bash
curl -s -H "Authorization: Bearer $TOKEN" "$API/api/v1/usage"
```

`GET /api/v1/usage` splits the model calls of the current budget period, from its first day to now, several ways. Money is counted as `budget.spentUsd` counts it; `calls` counts every call, those to providers that cost nothing included. The model is not called to make it.

| Field | Meaning |
|---|---|
| `periodStart`, `periodEnd` | The first and the last day of the budget period, as `YYYY-MM-DD` |
| `elapsedRatio` | The share of the period that has passed, from 0 to 1 |
| `billable` | `false` when no provider costs money. Every amount is then 0, and `calls` tells the usage |
| `monthlyBudgetUsd`, `spentUsd`, `unknownCostCalls` | The same as in `budget` |
| `byCategory` | Every category, in the order of the list, with `calls`, `costUsd` and `unknownCostCalls` of its runs, `articlesCreated` (its generated articles made in the period), `articlesOpened` (those of them the reader opened) and `costPerOpenedUsd` (`costUsd` divided by `articlesOpened`, or `null` when none was opened) |
| `outsideRuns` | `calls`, `costUsd` and `unknownCostCalls` of the calls that belong to no run: summaries, translations, proposals of selectors and digests, and calls whose run was deleted |
| `byDay` | Every UTC day from `periodStart` to today, with `day`, `calls` and `costUsd`. Days without calls have 0. The amounts add up to `spentUsd` |
| `projection` | `projectedUsd`, the money at the end of the period if it goes on at its average pace so far (`spentUsd` divided by the time passed, times the length of the period), and `exceedsBudget`, `true` when that is more than `monthlyBudgetUsd` |

The records of model calls are kept for 30 days, or from the first day of the current budget period when that is earlier, so that the period counts every call. Runs are still deleted after 30 days; their calls then count outside runs.

## RSS

```bash
FEED_TOKEN=$(node apps/server/src/main.ts token feed)
curl -s "$API/rss/all.xml?token=$FEED_TOKEN"
curl -s "$API/rss/security.xml?token=$FEED_TOKEN"
```

`/rss/all.xml` covers every enabled category and `/rss/<slug>.xml` covers one. A feed holds the 50 most recently updated generated articles and leaves out events that have ended. Articles of subscribed feeds are never in it: the server does not pass on what other sites deliver. Each item carries the summary as `description` and the full article as `content:encoded`. The full article holds, in this order, a notice when it is unconfirmed, the event details, the sentence for the reader, the body, and links to every source.
