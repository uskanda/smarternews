import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createClaudeCliAdapter } from "./claude-cli.ts";

// A stand-in for the claude command: it records how it was started and prints a canned answer.
const FAKE = `#!/usr/bin/env node
const fs = require("node:fs");
let stdin = "";
process.stdin.on("data", (chunk) => (stdin += chunk));
process.stdin.on("end", () => {
  fs.writeFileSync(process.env.FAKE_LOG, JSON.stringify({
    argv: process.argv.slice(2), stdin, cwd: process.cwd(), cwdEntries: fs.readdirSync(process.cwd()),
  }));
  if (process.env.FAKE_HANG) return setTimeout(() => {}, 60000);
  process.stderr.write(process.env.FAKE_STDERR ?? "");
  process.stdout.write(process.env.FAKE_OUTPUT ?? "");
  process.exit(Number(process.env.FAKE_EXIT ?? 0));
});
`;

function fake(env: Record<string, string>) {
  const dir = mkdtempSync(join(tmpdir(), "sn-fake-claude-"));
  const command = join(dir, "claude");
  writeFileSync(command, FAKE);
  chmodSync(command, 0o755);
  const log = join(dir, "log.json");
  const adapter = createClaudeCliAdapter({
    command,
    model: "haiku",
    extraArgs: [],
    env: { ...process.env, FAKE_LOG: log, ...env },
  });
  return { adapter, readLog: () => JSON.parse(readFileSync(log, "utf8")) as { argv: string[]; stdin: string; cwd: string; cwdEntries: string[] } };
}

const schema = { type: "object", properties: { ok: { type: "boolean" } }, required: ["ok"] };
const request = (overrides: Partial<{ webSearch: boolean; signal: AbortSignal }> = {}) => ({
  system: "SYSTEM TEXT",
  prompt: "PROMPT TEXT",
  outputSchema: schema,
  webSearch: false,
  timeoutMs: 5000,
  signal: new AbortController().signal,
  ...overrides,
});

/** The values that follow a flag, up to the next flag. */
function valuesOf(argv: string[], flag: string): string[] {
  const start = argv.indexOf(flag);
  if (start < 0) return [];
  const rest = argv.slice(start + 1);
  const end = rest.findIndex((arg) => arg.startsWith("--"));
  return end < 0 ? rest : rest.slice(0, end);
}

const success = (structured: unknown) =>
  JSON.stringify({ type: "result", subtype: "success", is_error: false, result: JSON.stringify(structured), structured_output: structured });

describe("the claude command adapter", () => {
  it("returns the structured output of the command", async () => {
    const { adapter } = fake({ FAKE_OUTPUT: success({ ok: true }) });
    await expect(adapter.complete(request())).resolves.toEqual({ ok: true });
  });

  it("sends the prompt on standard input and the schema, system prompt and model as arguments", async () => {
    const { adapter, readLog } = fake({ FAKE_OUTPUT: success({ ok: true }) });
    await adapter.complete(request());
    const { argv, stdin } = readLog();
    expect(stdin).toBe("PROMPT TEXT");
    expect(valuesOf(argv, "--system-prompt")).toEqual(["SYSTEM TEXT"]);
    expect(valuesOf(argv, "--model")).toEqual(["haiku"]);
    expect(JSON.parse(valuesOf(argv, "--json-schema")[0]!)).toEqual(schema);
    expect(valuesOf(argv, "--output-format")).toEqual(["json"]);
  });

  it("starts the model without any tool for a task that is not the search task", async () => {
    const { adapter, readLog } = fake({ FAKE_OUTPUT: success({ ok: true }) });
    await adapter.complete(request());
    const { argv } = readLog();
    expect(valuesOf(argv, "--tools")).toEqual([""]);
    expect(argv).not.toContain("--allowedTools");
  });

  it("allows only web search and page fetching for the search task", async () => {
    const { adapter, readLog } = fake({ FAKE_OUTPUT: success({ ok: true }) });
    await adapter.complete(request({ webSearch: true }));
    const { argv } = readLog();
    expect(valuesOf(argv, "--tools")).toEqual(["WebSearch", "WebFetch"]);
    expect(valuesOf(argv, "--allowedTools")).toEqual(["WebSearch", "WebFetch"]);
  });

  it("keeps the user's settings, instruction files, hooks and saved sessions out of the call", async () => {
    const { adapter, readLog } = fake({ FAKE_OUTPUT: success({ ok: true }) });
    await adapter.complete(request());
    const { argv, cwd, cwdEntries } = readLog();
    expect(valuesOf(argv, "--setting-sources")).toEqual([""]);
    expect(argv).toContain("--strict-mcp-config");
    expect(argv).toContain("--no-session-persistence");
    expect(cwd).not.toBe(process.cwd());
    expect(cwdEntries).toEqual([]);
  });

  it("parses the result text when the command gives no structured output", async () => {
    const output = JSON.stringify({ type: "result", subtype: "success", is_error: false, result: '```json\n{"ok": false}\n```' });
    const { adapter } = fake({ FAKE_OUTPUT: output });
    await expect(adapter.complete(request())).resolves.toEqual({ ok: false });
  });

  it("fails with the command's error text when it exits with an error", async () => {
    const { adapter } = fake({ FAKE_EXIT: "3", FAKE_STDERR: "not logged in" });
    await expect(adapter.complete(request())).rejects.toThrow(/exit code 3.*not logged in/s);
  });

  it("fails when the command reports an error result", async () => {
    const output = JSON.stringify({ type: "result", subtype: "error_during_execution", is_error: true, result: "rate limited" });
    const { adapter } = fake({ FAKE_OUTPUT: output });
    await expect(adapter.complete(request())).rejects.toThrow(/rate limited/);
  });

  it("stops the command when the call is aborted", async () => {
    const { adapter } = fake({ FAKE_HANG: "1" });
    const controller = new AbortController();
    const pending = adapter.complete(request({ signal: controller.signal }));
    setTimeout(() => controller.abort(), 150);
    await expect(pending).rejects.toThrow(/aborted/);
  });

  it("says that it can search", () => {
    expect(fake({}).adapter.capabilities.webSearch).toBe(true);
  });
});
