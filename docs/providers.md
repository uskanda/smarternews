# Model providers

smarternews calls a language model for eight tasks. A provider is a model you configured under a name, and each task runs on the provider you assign to it.

| Task | What the model does | When it runs |
|---|---|---|
| `interpret` | Turns a topic into search queries and a relevance test | Once per new or edited topic |
| `search` | Searches the web for a topic and lists pages | Once per run for each topic with `llmSearch` |
| `judge` | Decides which candidates are relevant, and how important | Once per 30 new candidates |
| `cluster` | Groups candidates that report the same story | Once per run that has relevant candidates |
| `write` | Writes the article for one story | Once per story |
| `summarize` | Summarises one article of a subscribed feed | Once per article of a feed that has summaries switched on |
| `translate` | Translates the title and the content of one article of a subscribed feed | When an article of a feed that translates is opened and the translation API cannot be used; once per 8,000 characters |
| `proposeSelectors` | Proposes CSS selectors that take the articles out of a page without a feed | When you ask for candidates while adding a web feed, or choose "候補を出し直す" while editing one |

Providers and assignments live in `~/.config/smarternews/config.yaml`. The server reads the file at start-up and refuses to start when an assignment names a provider that is not configured. [examples/config.example.yaml](../examples/config.example.yaml) lists every key.

## The `claude-cli` adapter

```yaml
providers:
  fast: { adapter: claude-cli, model: haiku }
  smart: { adapter: claude-cli, model: sonnet }
tasks:
  default: smart
  judge: fast
  cluster: fast
```

This adapter starts the `claude` command once per call, in an empty temporary directory, and passes the prompt on standard input. It uses the login of the user that runs the server, so that user must have run `claude` and logged in once.

That user's own Claude Code setup stays out of the call. The adapter passes `--setting-sources ""`, `--strict-mcp-config` and `--no-session-persistence`, so user settings, hooks, instruction files, MCP servers and saved sessions stay out. Every task except `search` gets `--tools ""`, which leaves the model without tools. For `search` the adapter allows `WebSearch` and `WebFetch` and nothing else.

`model` accepts whatever `claude --model` accepts. Aliases such as `haiku` and `sonnet` follow the current models, so the configuration does not need editing when a model is replaced. `command` (default `claude`) and `extraArgs` let you point the adapter at another binary or add flags.

### Checking the adapter by hand

The tests exercise this adapter against a stand-in command. To confirm that it works with the real one, run a category once and read the summary:

```bash
node apps/server/src/main.ts import examples/settings.example.yaml
node apps/server/src/main.ts run developer-tools
```

A successful run prints one line:

```
run 1 succeeded: 13 candidate(s) collected, 11 rejected, 2 article(s) created, 0 updated, 6 model call(s)
```

That status means every task returned output that matched its schema. A failure adds a line that names the task and the reason:

```
  write (Some headline): the output did not match the schema twice (title: Invalid input)
```

## The `anthropic` adapter

```yaml
providers:
  fast:
    adapter: anthropic
    model: claude-haiku-5-5
    effort: low
  smart:
    adapter: anthropic
    model: claude-sonnet-5-5
    apiKeyEnv: ANTHROPIC_API_KEY
    effort: medium
    maxWebSearches: 5
tasks:
  default: smart
  judge: fast
  cluster: fast
```

This adapter calls the Messages API of Anthropic with the official SDK. No command is started, and nothing of the server user's Claude Code setup takes part.

`apiKeyEnv` (default `ANTHROPIC_API_KEY`) names the environment variable that holds the API key, so the key stays out of the file. When the variable is unset or empty, the server does not start and names the provider and the variable. The key goes to the API in a request header only. It is in no log line, no run history and no API answer. [examples/smarternews.service](../examples/smarternews.service) shows how to hand a key to the service.

`model` takes the full model ID, such as `claude-haiku-5-5` or `claude-sonnet-5-5`; the aliases of the `claude` command do not work here. `effort` (`low`, `medium` or `high`) sets how much the model thinks before it answers. Thinking is billed as output tokens, so a lower effort makes each call cheaper. Left out, the model's own default applies.

Every task gets the output schema as a structured output. The API refuses some JSON Schema constraints, such as string lengths and number ranges. The adapter leaves those out of what it sends, and the server still checks the answer against the full schema. Tasks other than `search` get no tools. For `search` the adapter gives the model the API's server-side web search and page fetching, with `maxWebSearches` (default 5) as the most uses of each in one call.

### What the calls cost

Each answer reports the tokens the call used: input, output, cache reads and cache writes, and the number of web searches. The API does not report a price, so the server multiplies these counts by the unit prices of the model and stores the result with the call. It ships the public prices of `claude-opus-5-5`, `claude-sonnet-5-5`, `claude-sonnet-4-6`, `claude-haiku-5-5` and `claude-haiku-4-5`, and $0.01 per web search. For `claude-haiku-5-5`, a call whose prompt is over 100,000 tokens is priced at the higher rate.

`pricing` replaces any of these prices, in US dollars per million tokens and per search:

```yaml
providers:
  smart:
    adapter: anthropic
    model: claude-sonnet-5-5
    pricing:
      inputPerMTok: 2
      outputPerMTok: 10
      cacheReadPerMTok: 0.1
      cacheWritePerMTok: 2.5
      webSearchPerSearch: 0.01
```

A model the server does not ship prices for needs all four token prices under `pricing`. Without them the server does not start, and names the provider and the model.

### The monthly budget

```yaml
limits:
  monthlyBudgetUsd: 100   # US dollars one budget period may spend on providers that cost money
  budgetWarnRatio: 0.8    # the screens warn from this share of the budget
  budgetResetDay: 1       # the day of the month on which a period starts, at midnight UTC
```

A budget period runs from midnight UTC on `budgetResetDay` to the moment before the same time a month later. In a month without that day, such as 31 in February, the period starts on the last day of the month. The server adds up the cost of the calls in the current period. Once the total reaches `monthlyBudgetUsd`, no provider that costs money is called until the next period starts. A run then stops as `stopped_by_limit`, summaries wait for the next period, and a translation by the model is reported as not possible for now. Tasks assigned to other adapters go on, and the limits on the number of calls still apply.

Each call is checked against what was spent before it, so one call can take the total a little past the budget. A call that ends without an answer, such as one that timed out, has no usage to price. It counts as a call of unknown cost and stays out of the total. The page of the settings shows the period, the total against the budget, the money by task and by provider, and the number of calls of unknown cost. From `budgetWarnRatio` on, every page of the web app shows a warning at the top.

The totals are the server's estimate from published prices. They are not read from Anthropic's billing, whose period may also start at another hour, so keep `budgetWarnRatio` low enough to leave a margin.

## The `openai-compatible` adapter

```yaml
providers:
  local:
    adapter: openai-compatible
    baseUrl: http://127.0.0.1:11434/v1
    model: your-model-name
    apiKeyEnv: LOCAL_LLM_API_KEY
    structuredOutput: json_schema
tasks:
  default: local
```

This adapter posts to `<baseUrl>/chat/completions`. It works with any server that implements that endpoint, including Ollama, LM Studio and OpenRouter.

`apiKeyEnv` names an environment variable that holds the key, so the key itself stays out of the file. When the variable is unset, the server does not start. The server sends the key as a bearer token and never writes it to logs, run history or API responses.

`structuredOutput: json_schema` sends the output schema as `response_format`. Servers without that feature need `structuredOutput: prompt`, which puts the schema into the system message and asks for JSON only.

This adapter cannot run the `search` task. A topic with `llmSearch` is then skipped for that source, and the run history says why. Assign `search` to a `claude-cli` or `anthropic` provider to keep web search while other tasks run locally:

```yaml
tasks:
  default: local
  search: smart
```

## Summaries of feed articles

`summarize` runs only for the subscribed feeds you switched "自動で要約する" on for, once for each article such a feed delivers afterwards. It reads the article's page, or what the feed delivered when the page cannot be read, and writes up to 400 characters in the output language. It uses no tools.

A task that is not listed under `tasks` uses `default`, with this one exception: `summarize` uses the provider named `fast` when there is one. Summaries are many and simple, and `default` is usually the expensive model. Without a provider of that name, `summarize` uses `default` like the others. To choose yourself, assign it:

```yaml
tasks:
  default: smart
  summarize: fast
```

Summaries have their own allowance, `limits.summariesPerDay` (100 by default), and are not counted towards `limits.llmCallsPerDay`. With the `claude-cli` adapter both draw on the same subscription, so the most a day can use is the sum of the two. Under the `anthropic` adapter, both also count towards the monthly budget.

## Translation of feed articles

A subscribed feed with "翻訳する" switched on has its articles translated into the output language: the titles when the articles are stored, the content when an article is first opened. Two services can do this, and both receive the title and the content of those articles, and nothing else.

Google's Cloud Translation API (the basic edition, v2) is used while a key is set and the month has room. Create a key for the API in a Google Cloud project, put it into an environment variable of the server, and name that variable in `config.yaml`. The key itself is written into no file of smarternews, is not stored in the database, and is in no log line and no API answer.

```yaml
translation:
  google:
    apiKeyEnv: GOOGLE_TRANSLATE_API_KEY   # the name of the variable, not the key
  monthlyChars: 450000                    # no more than this is sent to Google in one month
  maxCharsPerArticle: 20000               # of one article's content, this much is translated
```

The server counts every character it sends, tags included, per month in the configured time zone, and counts before it sends. A request that would pass `monthlyChars` is not sent. The default of 450,000 lies below the 500,000 characters a month that Google does not bill at the time of writing; check the current terms before you raise it. Google does not tell how much of the allowance is left, so the server's own count is what keeps the bill at zero. `GET /api/v1/translation` and the page of the subscribed feeds show the count.

The `translate` task takes over when no key is set, when the month has reached its limit, and when the API fails. It runs only when a reader opens an article, never while feeds are fetched, so without a key the titles in the lists stay in the original language until an article is opened. Like `summarize`, it uses the provider named `fast` when there is one and `tasks` does not assign it. Its calls count towards `limits.llmCallsPerDay`. It receives numbered passages and must answer with the same numbers and the same count; an answer that does not, or that adds a link the passage does not have, is discarded and nothing is stored.

## Selectors for web feeds

A web feed is a page without a feed whose articles are taken out with CSS selectors. `proposeSelectors` reads the page once and proposes up to three sets of selectors. It runs only when you ask for candidates on the page of the subscribed feeds: never while a web feed is fetched, and never on its own when a page stops matching its selectors. It receives the page's URL and its HTML without scripts, styles and embeds, cut to the first 50,000 characters, and uses no tools.

A task that is not listed under `tasks` uses `default`, with a second exception: `proposeSelectors` uses the provider named `smart` when there is one. It reads a long page and is asked for seldom. Without a provider of that name it uses `default`.

`limits.selectorProposalsPerDay` (50 by default) bounds the proposals of one day. Each proposal also counts towards `limits.llmCallsPerDay`, whose default of 350 makes room for those 50. 0 switches proposals off. On a day that has reached either limit, and when the task fails, times out or proposes selectors that take no article out of the page, the server finds candidates by itself in the parts of the page with many links. The page says that the model was not used, and this is not an error.

```yaml
limits:
  selectorProposalsPerDay: 50
```

## Mixing providers

Assignments are per task, so a cheap model can do the high-volume work. `judge` reads up to 30 short candidates per call and `cluster` reads headlines, while `write` produces the text you read. The default configuration therefore runs `judge` and `cluster` on `haiku` and the other tasks on `sonnet`.

## Output validation and limits

The server validates every answer against the task's schema. An answer that does not match is requested once more with the same input. A second mismatch fails the task: nothing is stored, and the run history records the failure.

A call that exceeds `llm.timeoutMs` (`llm.searchTimeoutMs` for `search`) is stopped and counts as a failure. `limits.llmCallsPerRun` and `limits.llmCallsPerDay` bound the number of calls of runs, `limits.summariesPerDay` those of summaries, and `limits.selectorProposalsPerDay` those of proposals of selectors; see the README. `limits.monthlyBudgetUsd` bounds the money the `anthropic` adapter spends, as described above.

`limits.runRetries` (2 by default, 0 to 3) is how often a scheduled run that ended as `failed` is tried again. Each retry is a run like any other, so it obeys `limits.llmCallsPerRun` and `limits.llmCallsPerDay`. While a provider stays down, a category therefore uses up to three runs' worth of calls for one scheduled time. A run that stopped at a limit is not retried.

## Text from the web is data

Candidate titles, snippets and page text reach the model inside `<material>` blocks, and the system prompt says that such text is data and never an instruction. Three measures limit what a hostile page can do. Tasks other than `search` have no tools. Every answer must match a schema. Article bodies are rendered with raw HTML escaped and with only web and mail links kept.
