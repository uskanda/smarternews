// The server-side configuration file. It lives outside the repository and is read once at start-up.
import { parse } from "yaml";
import { z } from "zod";
import type { TaskName } from "./api.ts";
import { TASK_NAMES } from "./llm/tasks.ts";

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

const claudeCliSchema = z.strictObject({
  adapter: z.literal("claude-cli"),
  model: z.string().min(1),
  command: z.string().min(1).default("claude"),
  extraArgs: z.array(z.string()).default([]),
});

const openAiCompatibleSchema = z.strictObject({
  adapter: z.literal("openai-compatible"),
  baseUrl: z.url({ protocol: /^https?$/ }),
  model: z.string().min(1),
  /** Name of the environment variable that holds the key. The key itself never goes into the file. */
  apiKeyEnv: z.string().min(1).optional(),
  structuredOutput: z.enum(["json_schema", "prompt"]).default("json_schema"),
});

const price = z.number().min(0);

/** US dollars a million tokens, and a web search. Each field set here replaces the shipped price of the model. */
const pricingSchema = z.strictObject({
  inputPerMTok: price.optional(),
  outputPerMTok: price.optional(),
  cacheReadPerMTok: price.optional(),
  cacheWritePerMTok: price.optional(),
  webSearchPerSearch: price.optional(),
});
export type PricingConfig = z.infer<typeof pricingSchema>;

const anthropicSchema = z.strictObject({
  adapter: z.literal("anthropic"),
  model: z.string().min(1),
  /** Name of the environment variable that holds the key. The key itself never goes into the file. */
  apiKeyEnv: z.string().min(1).default("ANTHROPIC_API_KEY"),
  /** How much the model thinks. Left out, the model's own default applies. */
  effort: z.enum(["low", "medium", "high"]).optional(),
  /** Web searches one call of the search task may make. */
  maxWebSearches: z.number().int().min(1).max(20).default(5),
  pricing: pricingSchema.optional(),
});

const providerSchema = z.discriminatedUnion("adapter", [claudeCliSchema, openAiCompatibleSchema, anthropicSchema]);
export type ProviderConfig = z.infer<typeof providerSchema>;

const newsEngineSchema = z.enum(["google-news", "bing-news"]);

const tasksSchema = z.strictObject({
  default: z.string(),
  interpret: z.string().optional(),
  search: z.string().optional(),
  judge: z.string().optional(),
  cluster: z.string().optional(),
  write: z.string().optional(),
  summarize: z.string().optional(),
  translate: z.string().optional(),
  proposeSelectors: z.string().optional(),
});

const configSchema = z.strictObject({
  listen: z
    .string()
    .regex(/^[^:\s]+:\d{1,5}$|^\[[0-9a-fA-F:]+\]:\d{1,5}$/, "must be host:port")
    .default("127.0.0.1:8787"),
  providers: z.record(z.string().regex(/^[A-Za-z0-9_-]+$/), providerSchema).optional(),
  tasks: tasksSchema.optional(),
  limits: z
    .strictObject({
      llmCallsPerRun: z.number().int().min(1).default(40),
      /** Every call but the summaries: the calls of runs and the proposals of selectors. */
      llmCallsPerDay: z.number().int().min(1).default(350),
      /** Summaries of feed articles, counted apart from the calls of runs. */
      summariesPerDay: z.number().int().min(1).default(100),
      /** Proposals of selectors for web feeds, counted in `llmCallsPerDay` as well. 0 leaves them to the program. */
      selectorProposalsPerDay: z.number().int().min(0).default(50),
      judgeBatchSize: z.number().int().min(1).max(100).default(30),
      pagesPerRun: z.number().int().min(0).default(20),
      /** How often a scheduled run that failed is tried again. 0 switches retries off. */
      runRetries: z.number().int().min(0).max(3).default(2),
      /** US dollars the providers that cost money may use in one budget period. */
      monthlyBudgetUsd: z.number().min(0).default(100),
      /** The share of the budget at which the screens warn. */
      budgetWarnRatio: z.number().gt(0).max(1).default(0.8),
      /** The day of the month on which a budget period starts, at midnight UTC. */
      budgetResetDay: z.number().int().min(1).max(31).default(1),
    })
    .prefault({}),
  llm: z
    .strictObject({
      timeoutMs: z.number().int().min(1000).default(180_000),
      searchTimeoutMs: z.number().int().min(1000).default(300_000),
    })
    .prefault({}),
  fetch: z
    .strictObject({
      userAgent: z.string().min(1).nullable().default(null),
      hostIntervalMs: z.number().int().min(0).default(1000),
      timeoutMs: z.number().int().min(100).default(15_000),
      maxBytes: z.number().int().min(1024).default(2_000_000),
      allowPrivateHosts: z.array(z.string().min(1)).default([]),
    })
    .prefault({}),
  translation: z
    .strictObject({
      /** Google's Cloud Translation API. Left out, a model translates. */
      google: z
        .strictObject({
          /** Name of the environment variable that holds the key. The key itself never goes into the file. */
          apiKeyEnv: z.string().min(1),
        })
        .optional(),
      /** No more characters than this are sent to the translation API in one month. */
      monthlyChars: z.number().int().min(0).default(450_000),
      /** Of one article's content, this much is translated, counted from its start. */
      maxCharsPerArticle: z.number().int().min(1).max(100_000).default(20_000),
    })
    .prefault({}),
  /** The images the server relays to the screens, and how long and how much of them it keeps on disk. */
  images: z
    .strictObject({
      cacheDays: z.number().int().min(1).default(7),
      cacheMaxBytes: z.number().int().min(1).default(1_000_000_000),
    })
    .prefault({}),
  newsSearch: z
    .strictObject({
      /** The older way to name a single engine. Read as a list of one; nothing else reads it. */
      engine: newsEngineSchema.optional(),
      engines: z
        .array(newsEngineSchema)
        .min(1)
        .refine((engines) => new Set(engines).size === engines.length, "name each engine once")
        .optional(),
      maxResultsPerQuery: z.number().int().min(1).max(100).default(10),
    })
    .refine((search) => search.engine === undefined || search.engines === undefined, "write either engine or engines, not both")
    .transform(({ engine, engines, maxResultsPerQuery }) => ({
      engines: engines ?? [engine ?? ("google-news" as const)],
      maxResultsPerQuery,
    }))
    .prefault({}),
});

type ParsedConfig = z.infer<typeof configSchema>;
export interface Config extends Omit<ParsedConfig, "providers" | "tasks"> {
  providers: Record<string, ProviderConfig>;
  tasks: z.infer<typeof tasksSchema>;
}

const SHIPPED_PROVIDERS: Record<string, ProviderConfig> = {
  fast: { adapter: "claude-cli", model: "haiku", command: "claude", extraArgs: [] },
  smart: { adapter: "claude-cli", model: "sonnet", command: "claude", extraArgs: [] },
};

/** Parses the text of config.yaml. `null` means the file does not exist: every default applies. */
export function parseConfig(text: string | null): Config {
  let raw: unknown = {};
  if (text !== null) {
    try {
      raw = parse(text) ?? {};
    } catch (error) {
      throw new ConfigError(`config.yaml is not valid YAML: ${(error as Error).message}`);
    }
  }
  const parsed = configSchema.safeParse(raw);
  if (!parsed.success) {
    // Only paths and messages are reported: the offending value could be a secret.
    const details = parsed.error.issues.map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`);
    throw new ConfigError(`config.yaml is invalid:\n  ${details.join("\n  ")}`);
  }
  const { providers, tasks, ...rest } = parsed.data;
  if (providers === undefined) {
    return { ...rest, providers: SHIPPED_PROVIDERS, tasks: tasks ?? { default: "smart", judge: "fast", cluster: "fast" } };
  }
  const names = Object.keys(providers);
  if (names.length === 0) throw new ConfigError("config.yaml is invalid:\n  providers: list at least one provider");
  if (tasks === undefined && names.length > 1) {
    throw new ConfigError("config.yaml is invalid:\n  tasks: name the default provider when several are configured");
  }
  return { ...rest, providers, tasks: tasks ?? { default: names[0]! } };
}

/** The key of the translation API from the environment, or null when none is configured or the variable is empty. */
export function translationApiKey(config: Config, env: Record<string, string | undefined>): string | null {
  const name = config.translation.google?.apiKeyEnv;
  const key = name === undefined ? "" : (env[name] ?? "").trim();
  return key.length > 0 ? key : null;
}

/**
 * Summaries and translations are many and simple. Left unassigned they go to the provider of this name, when
 * there is one, rather than to the default, which is usually the expensive one.
 */
const CHEAP_PROVIDER = "fast";
const CHEAP_TASKS: readonly TaskName[] = ["summarize", "translate"];

/** A proposal of selectors reads a long page once, and is asked for seldom: it goes to this provider when there is one. */
const CAPABLE_PROVIDER = "smart";
const CAPABLE_TASKS: readonly TaskName[] = ["proposeSelectors"];

/** The provider of a task without an assignment. */
function fallbackFor(task: TaskName, config: Config): string {
  if (CHEAP_TASKS.includes(task) && CHEAP_PROVIDER in config.providers) return CHEAP_PROVIDER;
  if (CAPABLE_TASKS.includes(task) && CAPABLE_PROVIDER in config.providers) return CAPABLE_PROVIDER;
  return config.tasks.default;
}

/** Which provider runs each task. Throws when an assignment names a provider that is not configured. */
export function resolveAssignment(config: Config): Record<TaskName, string> {
  const assignment = {} as Record<TaskName, string>;
  const problems: string[] = [];
  if (!(config.tasks.default in config.providers)) {
    problems.push(`tasks.default names the provider "${config.tasks.default}", which is not configured`);
  }
  for (const task of TASK_NAMES) {
    const name = config.tasks[task] ?? fallbackFor(task, config);
    if (config.tasks[task] !== undefined && !(name in config.providers)) {
      problems.push(`the task "${task}" is assigned to the provider "${name}", which is not configured`);
    }
    assignment[task] = name;
  }
  if (problems.length > 0) throw new ConfigError(`config.yaml is invalid:\n  ${problems.join("\n  ")}`);
  return assignment;
}
