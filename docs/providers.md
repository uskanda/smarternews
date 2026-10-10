# Model providers

smarternews calls a language model for five tasks. A provider is a model you configured under a name, and each task runs on the provider you assign to it.

| Task | What the model does | When it runs |
|---|---|---|
| `interpret` | Turns a topic into search queries and a relevance test | Once per new or edited topic |
| `search` | Searches the web for a topic and lists pages | Once per run for each topic with `llmSearch` |
| `judge` | Decides which candidates are relevant, and how important | Once per 30 new candidates |
| `cluster` | Groups candidates that report the same story | Once per run that has relevant candidates |
| `write` | Writes the article for one story | Once per story |

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

This adapter cannot run the `search` task. A topic with `llmSearch` is then skipped for that source, and the run history says why. Assign `search` to a `claude-cli` provider to keep web search while other tasks run locally:

```yaml
tasks:
  default: local
  search: smart
```

## Mixing providers

Assignments are per task, so a cheap model can do the high-volume work. `judge` reads up to 30 short candidates per call and `cluster` reads headlines, while `write` produces the text you read. The default configuration therefore runs `judge` and `cluster` on `haiku` and the other tasks on `sonnet`.

## Output validation and limits

The server validates every answer against the task's schema. An answer that does not match is requested once more with the same input. A second mismatch fails the task: nothing is stored, and the run history records the failure.

A call that exceeds `llm.timeoutMs` (`llm.searchTimeoutMs` for `search`) is stopped and counts as a failure. `limits.llmCallsPerRun` and `limits.llmCallsPerDay` bound the number of calls; see the README.

## Text from the web is data

Candidate titles, snippets and page text reach the model inside `<material>` blocks, and the system prompt says that such text is data and never an instruction. Three measures limit what a hostile page can do. Tasks other than `search` have no tools. Every answer must match a schema. Article bodies are rendered with raw HTML escaped and with only web and mail links kept.
