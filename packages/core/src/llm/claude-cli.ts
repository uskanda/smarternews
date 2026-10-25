import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { LlmAdapter, LlmRequest } from "./adapter.ts";
import { parseJsonAnswer } from "./json.ts";

export interface ClaudeCliOptions {
  command: string;
  model: string;
  extraArgs: string[];
  env?: NodeJS.ProcessEnv;
}

/** The arguments of one headless call. The prompt goes to standard input, so nothing follows the flags. */
export function claudeArgs(options: Pick<ClaudeCliOptions, "model" | "extraArgs">, request: LlmRequest): string[] {
  return [
    "--print",
    ...options.extraArgs,
    "--output-format",
    "json",
    "--model",
    options.model,
    "--system-prompt",
    request.system,
    "--json-schema",
    JSON.stringify(request.outputSchema),
    // Keep the caller's own Claude Code setup out of the call: no user, project or local settings (and so
    // no hooks or instruction files from them), no MCP servers, no saved session.
    "--setting-sources",
    "",
    "--strict-mcp-config",
    "--no-session-persistence",
    // Tools: web search and page fetching for the search task, none otherwise.
    ...(request.webSearch
      ? ["--tools", "WebSearch", "WebFetch", "--allowedTools", "WebSearch", "WebFetch"]
      : ["--tools", ""]),
  ];
}

interface ClaudeResult {
  is_error?: boolean;
  subtype?: string;
  result?: string;
  structured_output?: unknown;
}

function readResult(stdout: string): unknown {
  let result: ClaudeResult;
  try {
    result = JSON.parse(stdout) as ClaudeResult;
  } catch {
    throw new Error(`the command did not print JSON: ${stdout.slice(0, 200)}`);
  }
  if (result.is_error === true || (result.subtype !== undefined && result.subtype !== "success")) {
    throw new Error(`the command reported an error: ${String(result.result ?? result.subtype).slice(0, 500)}`);
  }
  if (result.structured_output !== undefined && result.structured_output !== null) return result.structured_output;
  return parseJsonAnswer(result.result ?? "");
}

/** Runs the `claude` command (or a compatible one) once per call, in an empty directory. */
export function createClaudeCliAdapter(options: ClaudeCliOptions): LlmAdapter {
  return {
    capabilities: { webSearch: true },
    async complete(request) {
      const cwd = await mkdtemp(join(tmpdir(), "smarternews-llm-"));
      try {
        const answer = await new Promise<unknown>((resolve, reject) => {
          const child = spawn(options.command, claudeArgs(options, request), {
            cwd,
            env: options.env ?? process.env,
            stdio: ["pipe", "pipe", "pipe"],
          });
          let stdout = "";
          let stderr = "";
          const onAbort = () => {
            child.kill("SIGTERM");
            reject(new Error("the call was aborted"));
          };
          if (request.signal.aborted) onAbort();
          request.signal.addEventListener("abort", onAbort, { once: true });
          child.stdout.on("data", (chunk: Buffer) => (stdout += chunk.toString("utf8")));
          child.stderr.on("data", (chunk: Buffer) => (stderr += chunk.toString("utf8")));
          child.on("error", (error) => reject(new Error(`could not start "${options.command}": ${error.message}`)));
          child.on("close", (code) => {
            request.signal.removeEventListener("abort", onAbort);
            if (code !== 0) {
              reject(new Error(`"${options.command}" ended with exit code ${code}: ${(stderr || stdout).trim().slice(0, 500)}`));
              return;
            }
            try {
              resolve(readResult(stdout));
            } catch (error) {
              reject(error as Error);
            }
          });
          child.stdin.on("error", () => {});
          child.stdin.end(request.prompt);
        });
        // The command runs on the subscription: what it reports spending is not money the server spends.
        return { answer, usage: null };
      } finally {
        await rm(cwd, { recursive: true, force: true });
      }
    },
  };
}
