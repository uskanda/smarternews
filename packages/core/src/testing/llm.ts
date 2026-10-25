import type { TaskName } from "../api.ts";
import type { Clock } from "../clock.ts";
import type { Database } from "../db/database.ts";
import type { LlmRequest } from "../llm/adapter.ts";
import { TaskRunner, type Provider } from "../llm/runner.ts";
import { TASK_NAMES } from "../llm/tasks.ts";

export type FakeHandler = (request: LlmRequest) => unknown | Promise<unknown>;

/**
 * A TaskRunner whose tasks are answered by test functions. Each task gets its own provider, named after
 * the task, so a test can see which task was called and with what prompt.
 */
export function fakeLlm(
  db: Database,
  clock: Clock,
  handlers: Partial<Record<TaskName, FakeHandler>>,
  options: { webSearch?: boolean; limits?: { llmCallsPerRun: number; llmCallsPerDay: number; summariesPerDay?: number; selectorProposalsPerDay?: number }; timeZone?: string; timeoutMs?: number } = {},
) {
  const requests = Object.fromEntries(TASK_NAMES.map((task) => [task, [] as LlmRequest[]])) as Record<TaskName, LlmRequest[]>;
  const providers = new Map<string, Provider>(
    TASK_NAMES.map((task) => [
      task,
      {
        name: task,
        adapterKind: "fake",
        model: "fake",
        adapter: {
          capabilities: { webSearch: options.webSearch ?? true },
          async complete(request: LlmRequest) {
            requests[task].push(request);
            const handler = handlers[task];
            if (!handler) throw new Error(`the test did not expect a ${task} call`);
            return handler(request);
          },
        },
      },
    ]),
  );
  const runner = new TaskRunner({
    db,
    clock,
    providers,
    assignment: Object.fromEntries(TASK_NAMES.map((task) => [task, task])) as Record<TaskName, string>,
    limits: options.limits ?? { llmCallsPerRun: 40, llmCallsPerDay: 300 },
    timeouts: { defaultMs: options.timeoutMs ?? 2000, searchMs: options.timeoutMs ?? 2000 },
    timeZone: () => options.timeZone ?? "UTC",
  });
  return { runner, requests };
}

/** The JSON objects, one per line, of the n-th material block of a prompt. */
export function materialLines<T = Record<string, unknown>>(prompt: string, block = 0): T[] {
  const blocks = [...prompt.matchAll(/<material>\n([\s\S]*?)\n<\/material>/g)].map((match) => match[1]!);
  return (blocks[block] ?? "")
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as T);
}
