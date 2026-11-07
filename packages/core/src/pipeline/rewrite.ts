// A proposal of a new wording for a topic, asked of the model only when a reader asks for one. It reads the saved
// text and relevance test of the topic and what the reader did with its articles; it stores nothing but the
// record of the model call. The reader puts a proposal into the editor and saves it, which interprets it again.
import type { TopicRewriteResult } from "../api.ts";
import type { Clock } from "../clock.ts";
import { getCategory } from "../db/categories.ts";
import type { Database } from "../db/database.ts";
import { rewriteInputs } from "../db/rewrite-inputs.ts";
import { getSettings } from "../db/settings.ts";
import { getTopic } from "../db/topics.ts";
import { DomainError } from "../errors.ts";
import { LlmLimitError, TaskFailedError, type TaskRunner } from "../llm/runner.ts";

export interface TopicRewriteDeps {
  db: Database;
  clock: Clock;
  runner: TaskRunner;
}

/**
 * Proposals of a new wording for the topic, from one call of the task. Not asked of the model, and answered with
 * the reason, when the topic is not interpreted or an allowance is used up. A failed task is refused as
 * unavailable. The topic must exist.
 */
export async function proposeTopicRewrite(deps: TopicRewriteDeps, topicId: number): Promise<TopicRewriteResult> {
  const { db, clock, runner } = deps;
  const topic = getTopic(db, topicId);
  if (!topic.interpreted) return { status: "uninterpreted", proposals: [] };
  const blocked = runner.rewriteBlocked();
  if (blocked !== null) return { status: blocked, proposals: [] };

  const category = getCategory(db, topic.categoryId);
  const settings = getSettings(db);
  try {
    // A budget of its own: a proposal belongs to no run.
    const output = await runner.run(
      "proposeTopicRewrite",
      {
        topicText: topic.text,
        criteria: topic.criteria,
        kind: category.kind,
        outputLanguage: settings.outputLanguage,
        readerInfo: settings.readerInfo,
        ...rewriteInputs(db, topic.id, clock().toISOString()),
      },
      { runId: null, calls: 0 },
    );
    return { status: "proposed", proposals: output.proposals };
  } catch (error) {
    // Only a second attempt can run into an allowance here: the first was checked above.
    if (error instanceof LlmLimitError) return { status: error.scope === "budget" ? "budget" : (runner.rewriteBlocked() ?? "day"), proposals: [] };
    if (error instanceof TaskFailedError) throw new DomainError("unavailable", `no proposal could be had: ${error.message}`);
    throw error;
  }
}
