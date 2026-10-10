/** Parses a model's text answer as JSON, tolerating a Markdown code fence around it. */
export function parseJsonAnswer(text: string): unknown {
  const fenced = /^\s*```(?:json)?\s*\n([\s\S]*?)\n\s*```\s*$/.exec(text);
  try {
    return JSON.parse(fenced ? fenced[1]! : text);
  } catch {
    throw new Error("the answer is not JSON");
  }
}
