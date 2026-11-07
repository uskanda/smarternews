// A topic trial: the interpret and judge tasks of a run, asked with a text that is not saved, over candidates that
// are already stored. Nothing is written but the record of the model calls, so the trial can be repeated at will.
import type { TopicTrialChange, TopicTrialRequest, TopicTrialResult } from "../api.ts";
import { listTrialCandidates, type TrialCandidate } from "../db/candidates.ts";
import { getCategory } from "../db/categories.ts";
import type { Database } from "../db/database.ts";
import { getSettings } from "../db/settings.ts";
import { getTopic, listTopics } from "../db/topics.ts";
import type { CallBudget, TaskRunner } from "../llm/runner.ts";

export interface TopicTrialDeps {
  db: Database;
  runner: TaskRunner;
  /** Candidates per judge call, as in runs. A trial judges at most two batches. */
  judgeBatchSize: number;
}

export interface TopicTrialPlan {
  /** The model calls the trial makes when every answer is valid the first time. */
  calls: number;
  /** Why the trial cannot start now; null when it can. */
  blocked: ReturnType<TaskRunner["trialBlocked"]>;
  /** Makes the calls. Throws `LlmLimitError` when an allowance runs out on the way, `TaskFailedError` when a task fails. */
  run(): Promise<TopicTrialResult>;
}

/** Reads what a trial of `draft` on the topic would judge. The topic must exist. */
export function planTopicTrial(deps: TopicTrialDeps, topicId: number, draft: TopicTrialRequest): TopicTrialPlan {
  const { db, runner, judgeBatchSize } = deps;
  const topic = getTopic(db, topicId);
  const candidates = listTrialCandidates(db, topic.id, judgeBatchSize);
  const batches: TrialCandidate[][] = [];
  const ordered = [...candidates].sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id - b.id);
  for (let offset = 0; offset < ordered.length; offset += judgeBatchSize) batches.push(ordered.slice(offset, offset + judgeBatchSize));
  const calls = 1 + batches.length;

  return {
    calls,
    blocked: runner.trialBlocked(calls),
    async run() {
      const category = getCategory(db, topic.categoryId);
      const settings = getSettings(db);
      const budget: CallBudget = { runId: null, calls: 0, purpose: "trial" };
      const interpretation = await runner.run(
        "interpret",
        { topicText: draft.text, kind: category.kind, search: draft.search ?? settings.search },
        budget,
      );

      // The other topics a candidate matched are judged as they are saved, so that the verdict is the one a run
      // would reach with the draft; only the tried topic has its text and test replaced.
      const topics = new Map(listTopics(db, category.id).map((entry) => [entry.id, { id: entry.id, text: entry.text, criteria: entry.criteria }]));
      topics.set(topic.id, { id: topic.id, text: draft.text, criteria: interpretation.criteria });

      const changes: Array<TopicTrialChange & { createdAt: string }> = [];
      for (const batch of batches) {
        const topicIds = new Set(batch.flatMap((candidate) => candidate.topicIds));
        // The time of the run that made the candidates, not of the trial: an old candidate is not judged stale for
        // a reason the text has nothing to do with.
        const now = batch.reduce((latest, candidate) => (candidate.createdAt > latest ? candidate.createdAt : latest), batch[0]!.createdAt);
        const output = await runner.run(
          "judge",
          {
            kind: category.kind,
            outputLanguage: settings.outputLanguage,
            readerInfo: settings.readerInfo,
            now,
            timeZone: settings.timeZone,
            topics: [...topics.values()].filter((entry) => topicIds.has(entry.id)),
            candidates: batch.map((candidate, index) => ({
              id: index + 1,
              title: candidate.title,
              snippet: candidate.snippet,
              siteName: candidate.siteName,
              publishedAt: candidate.publishedAt,
              topicIds: candidate.topicIds,
            })),
          },
          budget,
        );
        for (const judgment of output.judgments) {
          const candidate = batch[judgment.id - 1]!;
          const verdict = judgment.relevant ? "accepted" : "rejected";
          if (verdict === candidate.verdict) continue;
          changes.push({
            candidateId: candidate.id,
            title: candidate.title,
            url: candidate.url,
            siteName: candidate.siteName,
            publishedAt: candidate.publishedAt,
            before: { verdict: candidate.verdict, reason: candidate.reason, byProgram: candidate.programReason !== null },
            after: { verdict, reason: judgment.reason, importance: judgment.importance },
            belowMinimum: verdict === "accepted" && judgment.importance < category.minImportance,
            createdAt: candidate.createdAt,
          });
        }
      }

      changes.sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.candidateId - a.candidateId);
      return {
        queries: interpretation.queries,
        criteria: interpretation.criteria,
        minImportance: category.minImportance,
        tried: candidates.length,
        changes: changes.map(({ createdAt: _createdAt, ...change }) => change),
      };
    },
  };
}
