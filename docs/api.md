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
| 404 | `not_found` | The article, category, topic, run or path does not exist |
| 409 | `conflict` | A slug is taken, or the category already has a run waiting or in progress |

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

Settings fields: `readerInfo` (text), `outputLanguage` (a language tag such as `en` or `ja`), `timeZone` (an IANA name), `search` (`{"language":"en","region":"US"}`, the default market for news search).

Import matches categories by `slug` and topics by `text`. It updates what matches, creates the rest, and deletes nothing. An invalid file changes nothing. The response counts what was created and updated.

## Categories

| Operation | Purpose |
|---|---|
| `GET /api/v1/categories` | List categories |
| `POST /api/v1/categories` | Create one (status 201) |
| `GET /api/v1/categories/:id` | Read one |
| `PATCH /api/v1/categories/:id` | Change `name`, `schedule`, `minImportance`, `maxArticlesPerRun`, `windowHours`, `windowDays`, `enabled` |
| `DELETE /api/v1/categories/:id` | Delete it with its topics, articles, candidates and runs (status 204) |

```bash
curl -s -X POST -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"name":"Security","kind":"news","schedule":["06:00","18:00"]}' "$API/api/v1/categories"
```

`kind` is `news` or `event` and cannot change later. `slug` is derived from the name when omitted. `schedule` lists times of day in the configured time zone. Defaults: `schedule` `["05:00"]`, `minImportance` 3, `maxArticlesPerRun` 5, `windowHours` 24 for news, `windowDays` 7 for events.

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

Query parameters of the list:

| Parameter | Effect |
|---|---|
| `category` | Category id |
| `kind` | `news` or `event` |
| `unread` | `true` or `false` |
| `starred` | `true` or `false` |
| `includeEnded` | `true` to include events that have ended (only with `kind=event`) |
| `limit` | 1 to 200, default 50 |
| `cursor` | The `nextCursor` of the previous page |

Articles come ordered by last update, newest first. With `kind=event` the order is by start time, soonest first, and events that have ended are left out. Each response has two fields: `items`, the articles of this page, and `nextCursor`, which is `null` on the last page.

```bash
curl -s -H "Authorization: Bearer $TOKEN" "$API/api/v1/articles?unread=true&limit=20"
curl -s -H "Authorization: Bearer $TOKEN" "$API/api/v1/articles?kind=event"

curl -s -X PATCH -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"isRead":true,"starred":true}' "$API/api/v1/articles/1"

curl -s -X POST -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"categoryId":1,"before":"2026-03-01T12:00:00Z"}' "$API/api/v1/articles/mark-read"
```

`mark-read` marks the unread articles that were last updated before `before`. Pass the time at which you loaded the list, so that articles that arrived afterwards stay unread. Omit `categoryId` to cover every category.

Fields of an article in the list:

| Field | Content |
|---|---|
| `title`, `summary` | Headline and one or two sentences |
| `importance` | 1 to 5 |
| `impact` | One sentence for the reader, or `null` |
| `unconfirmed` | True when the sources are only rumours or unofficial |
| `firstPublishedAt`, `updatedAt` | When the article was first written and last rewritten |
| `revision` | How many times a follow-up rewrote it |
| `isRead`, `starred` | The reader's marks |
| `primaryUrl` | URL of the main source |
| `event` | For events: `startsAt`, `endsAt`, `venue`, `fee`, `registration` |

The detail adds these:

| Field | Content |
|---|---|
| `body`, `bodyHtml` | The article as Markdown and as HTML |
| `refs` | Every source: `url`, `siteName`, `title`, `publishedAt` |
| `topics` | The topics the story matched |
| `snippetOnly` | True when no source page could be read |
| `previousArticleId` | The earlier article of the same story, when the follow-up came more than 72 hours later |

Articles without a star are deleted 180 days after their last update. Starred articles are kept.

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

`GET /api/v1/runs/:id/candidates` accepts `status=rejected` (the default), `pending`, `accepted` or `all`. Each candidate has `title`, `url`, `siteName`, `publishedAt`, `sourceKind`, `topics`, `importance` and `reason`. Runs and candidates are deleted after 30 days.

## Providers

`GET /api/v1/providers` returns the configured providers (`name`, `adapter`, `model`, `webSearch`), the provider assigned to each task, the model calls made today and the two call limits. It returns no credentials. Providers are changed in `config.yaml`, not through the API.

## RSS

```bash
FEED_TOKEN=$(node apps/server/src/main.ts token feed)
curl -s "$API/rss/all.xml?token=$FEED_TOKEN"
curl -s "$API/rss/security.xml?token=$FEED_TOKEN"
```

`/rss/all.xml` covers every enabled category and `/rss/<slug>.xml` covers one. A feed holds the 50 most recently updated articles and leaves out events that have ended. Each item carries the summary as `description` and the full article as `content:encoded`. The full article holds, in this order, a notice when it is unconfirmed, the event details, the sentence for the reader, the body, and links to every source.
