import { randomUUID } from "node:crypto";
import {
  DomainError,
  LlmLimitError,
  notFound,
  planTopicTrial,
  type Clock,
  type Database,
  type TaskRunner,
  type TopicTrial,
  type TopicTrialRequest,
  type TopicTrialStart,
} from "@smarternews/core";

/** How long the result of a finished trial can be asked for. */
const KEEP_MS = 30 * 60_000;

export interface TopicTrialsDeps {
  db: Database;
  clock: Clock;
  runner: TaskRunner;
  /** Candidates per judge call, as in runs. */
  judgeBatchSize: number;
  log?: (...args: unknown[]) => void;
}

interface Entry {
  trial: TopicTrial;
  finishedAt: number | null;
}

/**
 * Topic trials, one at a time, kept in memory only: a trial stores nothing, and its result is gone after a while
 * or when the server restarts. The reader asks for the result until it is there.
 */
export class TopicTrials {
  readonly #deps: TopicTrialsDeps;
  readonly #entries = new Map<string, Entry>();
  #running: Promise<void> | null = null;

  constructor(deps: TopicTrialsDeps) {
    this.#deps = deps;
  }

  /** Starts a trial of `draft` on the topic, or says which allowance leaves too few calls for it. */
  start(topicId: number, draft: TopicTrialRequest): TopicTrialStart {
    if (this.#running) throw new DomainError("conflict", "a topic trial is running");
    this.#forgetOld();
    const plan = planTopicTrial(this.#deps, topicId, draft);
    if (plan.blocked !== null) return { status: plan.blocked, id: null };

    const id = randomUUID();
    const entry: Entry = {
      trial: { id, topicId, status: "running", stoppedBy: null, result: null, error: null },
      finishedAt: null,
    };
    this.#entries.set(id, entry);
    this.#running = plan
      .run()
      .then((result) => {
        entry.trial = { ...entry.trial, status: "succeeded", result };
      })
      .catch((error: unknown) => {
        if (error instanceof LlmLimitError) {
          entry.trial = { ...entry.trial, status: "stopped_by_limit", stoppedBy: error.scope };
        } else {
          (this.#deps.log ?? console.error)("topic trial:", error);
          entry.trial = { ...entry.trial, status: "failed", error: error instanceof Error ? error.message : String(error) };
        }
      })
      .finally(() => {
        entry.finishedAt = this.#deps.clock().getTime();
        this.#running = null;
      });
    return { status: "started", id };
  }

  get(id: string): TopicTrial {
    this.#forgetOld();
    const entry = this.#entries.get(id);
    if (!entry) throw notFound("topic trial", id);
    return entry.trial;
  }

  /** Resolves once no trial is running. For tests. */
  async idle(): Promise<void> {
    while (this.#running) await this.#running;
  }

  #forgetOld(): void {
    const now = this.#deps.clock().getTime();
    for (const [id, entry] of this.#entries) {
      if (entry.finishedAt !== null && now - entry.finishedAt > KEEP_MS) this.#entries.delete(id);
    }
  }
}
