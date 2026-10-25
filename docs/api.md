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
{ "error": { "code": "invalid_input", "message": "the input is invalid", "fields": [{ "path": "minImportance", "message": "Too big: expected number to be <=5" }] } }
```

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

Import matches categories by `slug`, topics by `text`, subscribed feeds by `url`, filters by their action, scope and conditions, and term groups by `name`. A filter names a category by its `slug` and a feed by its `url`; a file written before filters may hold `stopWords`, which become hide filters over everything. What matches is updated, the rest is created, and nothing is deleted: a term group takes the colour of the file and only gains the terms it lacks. The groups of the file come first, in the file's order. Registered feeds are not fetched at once; each is fetched when its turn comes. An invalid file changes nothing. The response counts what was created and updated.

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
| `GET /api/v1/search` | Search the articles by words |
| `POST /api/v1/articles/:id/summary` | Ask for the summary of a feed article that is open. It then goes ahead of the others and keeps waiting after it is read. Returns `status`: `queued`, `limit` (the day has no summaries left) or `none` (this article gets no summary) |
| `POST /api/v1/articles/:id/translation` | The translation of a feed article's content, made and stored when there is none yet |
| `POST /api/v1/articles/:id/full-content` | Fetch the full content of a feed article from its page, and answer when that is done |
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
| `recentlyRead` | `true` for the articles read in the last seven days, last read first. Cannot be combined with `category`, `origin`, `feed`, `uncategorized`, `kind`, `unread`, `starred` or `minImportance` |
| `limit` | 1 to 200, default 50 |
| `cursor` | The `nextCursor` of the previous page |

Unless `origin` or `feed` narrows it, a list holds generated articles and feed articles together. Articles come ordered by last update, newest first. A feed article sorts by the time its item was published. When the item has no date, or one in the future, the time it was fetched is used. With `kind=event` the order is by start time, soonest first. Every list leaves out events that have ended unless `includeEnded=true` is given.

`recentlyRead=true` lists the articles whose `readAt` falls within the last seven days (168 hours, not calendar days), ordered by `readAt`, newest first. It includes events that have ended and ignores `includeEnded`. Articles read before the server started to record read times have no `readAt`, so they never appear here. Combined with any other narrowing, the request gets 400.

Each response has two fields: `items`, the articles of this page, and `nextCursor`, which is `null` on the last page.

```bash
curl -s -H "Authorization: Bearer $TOKEN" "$API/api/v1/articles?unread=true&limit=20"
curl -s -H "Authorization: Bearer $TOKEN" "$API/api/v1/articles?kind=event"

curl -s -X PATCH -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"isRead":true,"starred":true}' "$API/api/v1/articles/1"

curl -s -X POST -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"categoryId":1,"before":"2026-03-01T12:00:00Z"}' "$API/api/v1/articles/mark-read"
```

`mark-read` marks the unread articles that were last updated before `before`. Pass the time at which you loaded the list, so that articles that arrived afterwards stay unread. `categoryId`, `origin`, `feedId`, `uncategorized` (`true`) and `minImportance` narrow it; omit them all to cover everything. The response lists the articles it changed as `ids`, including the duplicates marked read with the articles kept for them, and `mark-unread` takes such a list to undo the change:

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
| `isRead`, `starred` | The reader's marks |
| `readAt` | When the article was last marked read, by the server's clock. Reading an article that is already read keeps the time, and putting it back to unread clears it. `null` for an unread article, and for one read before read times were recorded |
| `primaryUrl` | URL of the main source. For a feed article, the page of the item |
| `event` | For events: `startsAt`, `endsAt`, `venue`, `fee`, `registration` |

The detail adds these:

| Field | Content |
|---|---|
| `body`, `bodyHtml` | The article as Markdown and as HTML. For a feed article this is what the feed delivered, reduced to paragraphs, headings, lists, quotes, emphasis, code, links and images. The images of a feed article point to the server's relay (see [Images](#images)); only the HTML of a feed article contains images |
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
| `otherFeeds` | The other feeds that delivered a feed article: one entry per copy recorded as its duplicate, with `articleId` (the copy), `feedId` and `feedTitle`, in the order the copies were stored. Empty for an article without duplicates |
| `fullContent` | The full content of a feed article, taken from its page: `body` (Markdown), `bodyHtml` and `fetchedAt`. It comes apart from `body`, which stays what the feed delivered. `null` when there is none, and always for a generated article |
| `fullContentStatus` | `none`, `waiting` (its feed fetches full content and this article is next in line for it), `fetched` or `failed`. Always `none` for a generated article |
| `fullContentError` | Why the full content could not be had: `reason` and `detail`, as in the answer of `POST /api/v1/articles/:id/full-content`. `null` unless the status is `failed` |

### Search

`GET /api/v1/search` returns the articles that contain every word of `q`, generated and feed articles alike, newest first by last update. It matches the title, the translated title, the summary, the automatic summary, the body (for a feed article, its content without markup), the impact and the venue of an event. It does not match source URLs or the targets of links. Read articles and events that have ended are included; a feed article that a filter hides is not, unless it has a star. A hidden duplicate is left out unless `feed` names its feed. The search calls neither a model nor the translation API.

| Parameter | Effect |
|---|---|
| `q` | Required. Words separated by spaces, a full-width space included. At most 200 characters; empty or longer gets 400 |
| `category` | Category id: its generated articles and the articles of its feeds |
| `feed` | Feed id; only the articles of that subscribed feed |
| `unread` | `true` for unread articles only |
| `limit` | 1 to 200, default 50 |
| `cursor` | The `nextCursor` of the previous page |

Words are compared in the form the filters use: full-width and half-width alike, upper and lower case alike. Hiragana and katakana stay different. Every word is a part of the text to find, and signs and words such as `OR` or `NOT` are matched as they are; there is no phrase or exclusion syntax. A word of three or more characters uses the trigram index; a search with only one- and two-character words reads the articles one by one, newest first, and can be slow on a large database.

The response has `items`, `nextCursor` and `terms`. Each item has the fields of an article in the list and `excerpt`: about 120 characters around the first match in the summary, automatic summary, body, impact or venue, without Markdown, with `…` where it was cut. `excerpt` is `null` when only the title matches. `terms` are the words as they were matched, normalized and each once, for marking the matches.

```bash
curl -s -G -H "Authorization: Bearer $TOKEN" --data-urlencode "q=battery factory" "$API/api/v1/search"
```

The search index is kept by triggers that call a function the server registers when it opens the database. A connection without that function, such as the `sqlite3` command, can read the database but cannot insert, change or delete articles.

Generated articles without a star are deleted 180 days after their last update, feed articles without a star 90 days after the time they sort by. Starred articles are kept.

## Subscribed feeds

A subscribed feed is read as it is, like in any feed reader. Its items become feed articles, and no model is called for them. This is separate from the `feeds` of a topic, which are sources the model writes from.

| Operation | Purpose |
|---|---|
| `GET /api/v1/feeds` | List the subscribed feeds with their fetch state |
| `POST /api/v1/feeds` | Subscribe to a feed (status 201) |
| `POST /api/v1/feeds/discover` | Find the feeds a page points to, without subscribing |
| `GET /api/v1/feeds/:id` | Read one |
| `PATCH /api/v1/feeds/:id` | Change `title`, `categoryId`, `intervalMinutes`, `enabled`, `autoSummarize`, `translate`, `fetchFullContent` |
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

`categoryId` must name a category of the kind `news`, or be `null` for no category. `intervalMinutes` is 5 to 1440, or `null` to follow `feedIntervalMinutes` of the settings. `title` is taken from the feed unless you set it; once set, it stays. `autoSummarize`, `translate` and `fetchFullContent` are `false` unless you send `true`, at registration or in a change.

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
| `fetchFullContent` | True when the server fetches the page of every article this feed delivers and stores its text as the full content. Only articles stored after it was switched on are fetched |
| `lastFetchedAt`, `lastSucceededAt` | When it was last asked, and when that last worked |
| `lastError`, `failureCount` | Why the last fetch failed, or `null`; and how many failed in a row |
| `nextFetchAt` | When it is fetched next, or `null` while it is paused |
| `articleCount`, `starredCount` | How many articles it has, and how many of them are starred |

A fetch that fails is recorded on the feed and not in the run history. After each failure in a row the wait before the next try doubles, up to one day; a success brings it back to the interval. `fetch` answers with `status` (`updated`, `not_modified` or `failed`), `created` (the number of new articles), `error` when it failed, and `feed`.

An unchanged feed costs its site little: the server sends back the `ETag` and `Last-Modified` it was given, and a `304` answer counts as a success. Items are recognised by their `guid` or `id`, or by their link when they have neither. When a feed rewrites an item, the article is rewritten in place and keeps its place in the list and its read mark.

The OPML import subscribes to the feeds that are not subscribed yet and skips the others. A folder becomes the category of the same name; when there is none, a `news` category without topics is created. Nested folders count as the outermost one, and a feed outside every folder gets no category. Feeds in a folder named like an `event` category get no category either. Nothing is deleted, moved or fetched by the import, and it answers with `feedsCreated`, `feedsSkipped` and `categoriesCreated`. The export writes the subscribed feeds only, with the categories that hold some as folders.

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

Filters hide feed articles. A hide filter hides the articles that meet all its conditions. Keep filters hide the articles of their scope that meet none of them: two keep filters of one feed keep what either matches. When the keep filters of a category and of one of its feeds both apply, an article must pass both. An article that a hide filter matches is hidden even when a keep filter keeps it. Generated articles and starred articles are never hidden.

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
| `hiddenCount` | Articles without a star that the filter hides now. An article that several filters hide counts for each. 0 while the filter is off |

A condition has `fields` (one or more of `title`, `content`, `author` and `url`), `match` and `value` (up to 200 characters). An article meets the condition when any of the chosen fields matches. With `match` set to `contains`, the value is plain text found anywhere in the field; with `regex`, it is a JavaScript regular expression that may match anywhere in the field. Neither method tells upper case from lower case or full-width from half-width characters. `content` is the delivered content without markup and link targets, `url` is the address of the article's page, and an article without an author never meets an `author` condition. Translations are never matched.

New filters and changed ones apply to the articles already stored. The scope of a category follows the feeds that belong to it now: a feed moved to another category takes that category's filters. Deleting a category or a feed deletes the filters of that scope. Hidden articles are kept. They are in no list and no count, and a "mark all as read" passes over them. Removing the filter or switching it off brings them back, read or unread as they were. `DELETE` answers with `restored`, the number of articles that came back; `PATCH` answers with the filter and `restored`.

Status 400 answers a wrong regular expression, a keep filter over everything, and a scope that names a missing category or feed. Its `fields` name the problem, for example `conditions.1.value`. A filter with the same action, scope and conditions as a registered one gets status 409.

`POST /api/v1/filters/preview` takes the body of `POST /api/v1/filters` and answers with a count such as `{"hiddenCount":3}`. It counts like `hiddenCount`, as if the filter were saved and on. With `id` in the body, that registered filter is left out of the count, which shows what a change would do. Nothing is stored.

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
