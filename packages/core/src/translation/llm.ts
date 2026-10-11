// The model as a translator: the translate task, called with as many segments as fit one call.
import type { TaskRunner } from "../llm/runner.ts";
import { TRANSLATE_INPUT_CHARS } from "../llm/tasks.ts";
import type { TranslationItem, TranslationOutput, Translator } from "./adapter.ts";

/** The mark that makes a segment a heading or a list item. It is kept here and not given to the model. */
const MARK = /^(#{1,6} |- |\d+\. )/;

function batches(texts: string[]): string[][] {
  const result: string[][] = [];
  let current: string[] = [];
  let size = 0;
  for (const text of texts) {
    if (current.length > 0 && size + text.length > TRANSLATE_INPUT_CHARS) {
      result.push(current);
      current = [];
      size = 0;
    }
    current.push(text);
    size += text.length;
  }
  if (current.length > 0) result.push(current);
  return result;
}

export class LlmTranslator implements Translator {
  readonly #runner: TaskRunner;

  constructor(runner: TaskRunner) {
    this.#runner = runner;
  }

  async translate(items: TranslationItem[], target: string): Promise<TranslationOutput> {
    const marks = items.map((item) => (item.plain ? "" : (MARK.exec(item.text)?.[1] ?? "")));
    const bare = items.map((item, index) => item.text.slice(marks[index]!.length));
    // These calls belong to no run; the day's limit of calls applies to them as to any other.
    const budget = { runId: null, calls: 0 };
    const texts: string[] = [];
    for (const batch of batches(bare)) {
      const output = await this.#runner.run("translate", { outputLanguage: target, items: batch.map((text, index) => ({ n: index + 1, text })) }, budget);
      texts.push(...output.items.map((item) => item.text));
    }
    return { texts: texts.map((text, index) => `${marks[index]}${text}`), sourceLanguage: null };
  }
}
