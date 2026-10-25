import { chmodSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { articlePage, rssDocument } from "@smarternews/core/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runCli, startServer } from "./cli.ts";
import { createRuntime } from "./runtime.ts";

// A stand-in for the claude command. It answers each task from the prompt it is given, the way the
// pipeline tests' fake model does: "[skip]" in a headline means not relevant.
const FAKE_CLAUDE = `#!/usr/bin/env node
let stdin = "";
process.stdin.on("data", (chunk) => (stdin += chunk));
process.stdin.on("end", () => {
  const lines = (block) => {
    const blocks = [...stdin.matchAll(/<material>\\n([\\s\\S]*?)\\n<\\/material>/g)].map((match) => match[1]);
    return (blocks[block] ?? "").split("\\n").filter(Boolean).map((line) => JSON.parse(line));
  };
  let output;
  if (stdin.startsWith("Task: turn a topic")) {
    output = { queries: ["widgets"], criteria: "anything about widgets", suggestedSources: { newsSearch: false, llmSearch: false } };
  } else if (stdin.startsWith("Task: decide")) {
    output = { judgments: lines(0).map((c) => ({ id: c.id, relevant: !c.title.includes("[skip]"), reason: "decided by the fake", importance: 4 })) };
  } else if (stdin.startsWith("Task: group")) {
    output = { groups: lines(0).map((c) => ({ candidateIds: [c.id], existingArticleId: null })) };
  } else {
    output = {
      title: "Widget maker confirms outage",
      summary: "The outage lasted four hours.",
      body: stdin.includes("lasted four hours") ? "Written from the **page**." : "Written from the snippet.",
      unconfirmed: false, impact: "Check your widgets.", event: null,
    };
  }
  process.stdout.write(JSON.stringify({ type: "result", subtype: "success", is_error: false, structured_output: output }));
});
`;

// A stand-in for the claude command that only proposes selectors, and writes a line to calls.log next to
// itself for every call.
const FAKE_PROPOSER = `#!/usr/bin/env node
const { appendFileSync } = require("node:fs");
const { join } = require("node:path");
let stdin = "";
process.stdin.on("data", (chunk) => (stdin += chunk));
process.stdin.on("end", () => {
  appendFileSync(join(__dirname, "calls.log"), stdin.split("\\n")[0] + "\\n");
  const output = { candidates: [{ item: "ul.town > li", title: null, link: null, date: "time" }] };
  process.stdout.write(JSON.stringify({ type: "result", subtype: "success", is_error: false, structured_output: output }));
});
`;

/** The stories the page of the town lists, newest first. */
let townStories = ["harbor", "library"];

let site: ReturnType<typeof createServer>;
let siteUrl = "";
const requests: Array<{ path: string; userAgent: string }> = [];

beforeAll(async () => {
  site = createServer((req, res) => {
    requests.push({ path: req.url ?? "", userAgent: req.headers["user-agent"] ?? "" });
    if (req.url === "/feed.xml") {
      res.writeHead(200, { "content-type": "application/rss+xml" });
      res.end(
        rssDocument(
          "Widget News",
          [
            { title: "Widget maker confirms outage", link: `${siteUrl}/story?utm_source=rss`, description: "An outage happened." },
            { title: "Buy widgets today [skip]", link: `${siteUrl}/ad` },
          ],
          new Date(Date.now() - 3_600_000).toISOString(),
        ),
      );
    } else if (req.url === "/town") {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(
        `<html><head><title>Town Notices</title></head><body><nav><a href="/">Home</a></nav><ul class="town">${townStories
          .map((story) => `<li><a href="/town/${story}">The notice about the ${story}</a><time datetime="${new Date(Date.now() - 3_600_000).toISOString()}">an hour ago</time></li>`)
          .join("")}</ul></body></html>`,
      );
    } else if (req.url === "/story") {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(articlePage("The widget maker confirmed that the outage lasted four hours."));
    } else {
      res.writeHead(404).end("not found");
    }
  });
  await new Promise<void>((resolve) => site.listen(0, "127.0.0.1", resolve));
  siteUrl = `http://127.0.0.1:${(site.address() as AddressInfo).port}`;
});

afterAll(() => new Promise<void>((resolve) => site.close(() => resolve())));

describe("from a settings file to the API and the feed", () => {
  it("imports settings, runs a category with the fake model, and serves the article over the API and RSS", async () => {
    const root = mkdtempSync(join(tmpdir(), "sn-e2e-"));
    const env = { SMARTERNEWS_CONFIG_DIR: join(root, "config"), SMARTERNEWS_DATA_DIR: join(root, "data") };
    mkdirSync(env.SMARTERNEWS_CONFIG_DIR, { recursive: true });
    const claude = join(root, "claude");
    writeFileSync(claude, FAKE_CLAUDE);
    chmodSync(claude, 0o755);
    writeFileSync(
      join(env.SMARTERNEWS_CONFIG_DIR, "config.yaml"),
      `providers:\n  fake: { adapter: claude-cli, model: test, command: ${JSON.stringify(claude)} }\nfetch: { hostIntervalMs: 0, allowPrivateHosts: ["127.0.0.1"] }\n`,
    );
    const settings = join(root, "settings.yaml");
    writeFileSync(
      settings,
      `version: 1
settings: { outputLanguage: en, timeZone: UTC, readerInfo: "Runs widgets in production." }
categories:
  - slug: widgets
    name: Widgets
    kind: news
    topics:
      - text: News about widgets
        sources: { feeds: ["${siteUrl}/feed.xml"] }
`,
    );
    const out: string[] = [];
    const io = { env, home: root, stdout: (text: string) => out.push(text), stderr: (text: string) => out.push(text) };

    expect(await runCli(["import", settings], io)).toBe(0);
    expect(await runCli(["run", "widgets"], io), out.join("")).toBe(0);
    expect(out.join("")).toMatch(/succeeded.*1 article\(s\) created/s);

    const runtime = createRuntime({ env, home: root });
    const server = await startServer(runtime, { hostname: "127.0.0.1", port: 0 });
    try {
      const base = `http://127.0.0.1:${server.port}`;
      const apiToken = readFileSync(join(env.SMARTERNEWS_CONFIG_DIR, "api-token"), "utf8").trim();
      const feedToken = readFileSync(join(env.SMARTERNEWS_CONFIG_DIR, "feed-token"), "utf8").trim();
      const authorized = { headers: { authorization: `Bearer ${apiToken}` } };

      expect((await fetch(`${base}/api/v1/articles`)).status).toBe(401);
      const list = (await (await fetch(`${base}/api/v1/articles`, authorized)).json()) as { items: Array<{ id: number; title: string }> };
      expect(list.items.map((item) => item.title)).toEqual(["Widget maker confirms outage"]);

      const article = (await (await fetch(`${base}/api/v1/articles/${list.items[0]!.id}`, authorized)).json()) as Record<string, unknown>;
      expect(article).toMatchObject({
        summary: "The outage lasted four hours.",
        bodyHtml: "<p>Written from the <strong>page</strong>.</p>",
        impact: "Check your widgets.",
        importance: 4,
        snippetOnly: false,
        refs: [{ url: `${siteUrl}/story`, siteName: "Widget News" }],
        topics: [{ text: "News about widgets" }],
      });

      const runs = (await (await fetch(`${base}/api/v1/runs`, authorized)).json()) as Array<{ id: number; status: string; llmCalls: number }>;
      expect(runs).toMatchObject([{ status: "succeeded", collected: 2, rejected: 1, articlesCreated: 1 }]);
      const rejected = (await (await fetch(`${base}/api/v1/runs/${runs[0]!.id}/candidates`, authorized)).json()) as Array<{ title: string; reason: string }>;
      expect(rejected).toMatchObject([{ title: "Buy widgets today [skip]", reason: "decided by the fake" }]);

      const rss = await fetch(`${base}/rss/widgets.xml?token=${feedToken}`);
      expect(rss.status).toBe(200);
      const xml = await rss.text();
      expect(xml).toContain("<title>Widget maker confirms outage</title>");
      expect(xml).toContain(`<link>${siteUrl}/story</link>`);
      expect((await fetch(`${base}/rss/widgets.xml`)).status).toBe(401);
    } finally {
      await server.close();
      runtime.close();
    }

    // The crawler named itself to the site, and did not fetch the page of the rejected candidate.
    expect(requests.every((request) => request.userAgent.startsWith("smarternews/"))).toBe(true);
    expect(requests.map((request) => request.path)).not.toContain("/ad");
  });
});

describe("a web feed from its candidates to its articles", () => {
  it("proposes selectors with the model once, subscribes, and takes the next article out of the page, in the settings file but not in OPML", async () => {
    const root = mkdtempSync(join(tmpdir(), "sn-e2e-page-"));
    const env = { SMARTERNEWS_CONFIG_DIR: join(root, "config"), SMARTERNEWS_DATA_DIR: join(root, "data") };
    mkdirSync(env.SMARTERNEWS_CONFIG_DIR, { recursive: true });
    const claude = join(root, "claude");
    writeFileSync(claude, FAKE_PROPOSER);
    chmodSync(claude, 0o755);
    writeFileSync(
      join(env.SMARTERNEWS_CONFIG_DIR, "config.yaml"),
      `providers:\n  fake: { adapter: claude-cli, model: test, command: ${JSON.stringify(claude)} }\nfetch: { hostIntervalMs: 0, allowPrivateHosts: ["127.0.0.1"] }\n`,
    );
    const calls = () => {
      try {
        return readFileSync(join(root, "calls.log"), "utf8").split("\n").filter(Boolean);
      } catch {
        return [];
      }
    };

    const runtime = createRuntime({ env, home: root });
    const server = await startServer(runtime, { hostname: "127.0.0.1", port: 0 });
    try {
      const base = `http://127.0.0.1:${server.port}`;
      const apiToken = readFileSync(join(env.SMARTERNEWS_CONFIG_DIR, "api-token"), "utf8").trim();
      const call = async (method: string, path: string, body?: unknown) => {
        const response = await fetch(`${base}${path}`, {
          method,
          headers: { authorization: `Bearer ${apiToken}`, ...(body === undefined ? {} : { "content-type": "application/json" }) },
          body: body === undefined ? undefined : JSON.stringify(body),
        });
        return { status: response.status, text: await response.text() };
      };
      const page = `${siteUrl}/town`;

      const candidates = JSON.parse((await call("POST", "/api/v1/feeds/page/candidates", { url: page })).text);
      expect(candidates).toMatchObject({ usedModel: true, fallback: null, candidates: [{ selectors: { item: "ul.town > li", date: "time" }, preview: { count: 2 } }] });
      expect(calls()).toEqual([expect.stringMatching(/^Task: a web page lists articles/)]);

      const created = await call("POST", "/api/v1/feeds", { url: page, format: "page", selectors: candidates.candidates[0].selectors });
      expect(created.status).toBe(201);
      const feed = JSON.parse(created.text);
      expect(feed).toMatchObject({ title: "Town Notices", format: "page", articleCount: 2 });

      townStories = ["market", "harbor", "library"];
      const fetched = JSON.parse((await call("POST", `/api/v1/feeds/${feed.id}/fetch`)).text);
      expect(fetched).toMatchObject({ status: "updated", created: 1 });
      const articles = JSON.parse((await call("GET", `/api/v1/articles?feed=${feed.id}`)).text) as { items: Array<{ title: string }> };
      expect(articles.items.map((item) => item.title)).toEqual(["The notice about the market", "The notice about the harbor", "The notice about the library"]);

      expect((await call("GET", "/api/v1/feeds/opml")).text).not.toContain("/town");
      const settings = (await call("GET", "/api/v1/settings/export")).text;
      expect(settings).toContain(`url: ${page}`);
      expect(settings).toMatch(/selectors:\s+item: ul.town > li\s+date: time/);

      // Only the request for candidates called the model.
      expect(calls()).toHaveLength(1);
    } finally {
      await server.close();
      runtime.close();
    }
  });
});
