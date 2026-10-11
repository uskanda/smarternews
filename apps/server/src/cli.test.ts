import { mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parse } from "yaml";
import { describe, expect, it } from "vitest";
import { parseListen, runCli } from "./cli.ts";

function sandbox() {
  const root = mkdtempSync(join(tmpdir(), "sn-cli-"));
  const env = { SMARTERNEWS_CONFIG_DIR: join(root, "config"), SMARTERNEWS_DATA_DIR: join(root, "data") };
  const run = async (...argv: string[]) => {
    const out: string[] = [];
    const err: string[] = [];
    const code = await runCli(argv, { env, home: root, stdout: (text) => out.push(text), stderr: (text) => err.push(text) });
    return { code, out: out.join(""), err: err.join("") };
  };
  return { root, env, run };
}

const EXAMPLE = join(import.meta.dirname, "../../../examples/settings.example.yaml");

describe("smarternews token", () => {
  it("prints the API token, creating its file for the owner only", async () => {
    const { env, run } = sandbox();
    const first = await run("token", "api");
    const path = join(env.SMARTERNEWS_CONFIG_DIR, "api-token");
    expect(first.code).toBe(0);
    expect(first.out.trim()).toBe(readFileSync(path, "utf8").trim());
    expect(statSync(path).mode & 0o777).toBe(0o600);
    expect((await run("token", "api")).out).toBe(first.out);
  });

  it("keeps the feed token separate from the API token", async () => {
    const { run } = sandbox();
    expect((await run("token", "feed")).out).not.toBe((await run("token", "api")).out);
  });
});

describe("smarternews opml-import and opml-export", () => {
  const OPML = `<?xml version="1.0"?><opml version="2.0"><body>
    <outline text="Tools"><outline type="rss" text="A" xmlUrl="https://a.example.org/feed.xml"/></outline>
    <outline type="rss" text="B" xmlUrl="https://b.example.org/feed.xml"/>
  </body></opml>`;

  it("loads a document, then prints the subscribed feeds as OPML", async () => {
    const { run, root: dir } = sandbox();
    const file = join(dir, "feeds.opml");
    writeFileSync(file, OPML);

    const imported = await run("opml-import", file);
    expect(imported.code).toBe(0);
    expect(imported.out).toBe("2 feeds registered, 0 skipped; 1 categories created\n");

    const exported = await run("opml-export");
    expect(exported.code).toBe(0);
    expect(exported.out).toContain('<opml version="2.0">');
    expect(exported.out).toContain('xmlUrl="https://b.example.org/feed.xml"');
  });

  it("writes the document to a file when given a path", async () => {
    const { run, root: dir } = sandbox();
    const source = join(dir, "feeds.opml");
    writeFileSync(source, OPML);
    await run("opml-import", source);
    const target = join(dir, "out.opml");
    expect((await run("opml-export", target)).code).toBe(0);
    expect(readFileSync(target, "utf8")).toContain("a.example.org");
  });

  it("fails without changing anything when the file is not OPML", async () => {
    const { run, root: dir } = sandbox();
    const file = join(dir, "bad.opml");
    writeFileSync(file, "<html></html>");
    const result = await run("opml-import", file);
    expect(result.code).toBe(1);
    expect(result.err).toMatch(/not OPML/);
  });

  it("asks for the file name", async () => {
    const { run } = sandbox();
    expect((await run("opml-import")).code).toBe(2);
  });
});

describe("smarternews import and export", () => {
  it("loads a settings file and writes the same categories back", async () => {
    const { run } = sandbox();
    const imported = await run("import", EXAMPLE);
    expect(imported.code).toBe(0);
    expect(imported.out).toContain("3 categories created");

    const exported = await run("export");

    expect(exported.code).toBe(0);
    expect(parse(exported.out).categories.map((category: { slug: string }) => category.slug)).toEqual([
      "security",
      "developer-tools",
      "local-events",
    ]);
  });

  it("writes the export to a file when given a path", async () => {
    const { root, run } = sandbox();
    await run("import", EXAMPLE);
    const target = join(root, "out.yaml");
    expect((await run("export", target)).code).toBe(0);
    expect(parse(readFileSync(target, "utf8")).version).toBe(1);
  });

  it("fails and names the bad entry of an invalid settings file", async () => {
    const { root, run } = sandbox();
    const file = join(root, "bad.yaml");
    writeFileSync(file, "version: 1\ncategories:\n  - slug: a\n    name: A\n    kind: weather\n");
    const result = await run("import", file);
    expect(result.code).toBe(1);
    expect(result.err).toContain("categories.0.kind");
  });

  it("fails when the settings file does not exist", async () => {
    const { run } = sandbox();
    const result = await run("import", "/nonexistent/settings.yaml");
    expect(result.code).toBe(1);
    expect(result.err).toContain("settings.yaml");
  });
});

describe("smarternews start-up checks", () => {
  it("refuses to start with an assignment to an unknown provider, naming the task and the provider", async () => {
    const { env, run } = sandbox();
    await run("token", "api"); // creates the config directory
    writeFileSync(
      join(env.SMARTERNEWS_CONFIG_DIR, "config.yaml"),
      "providers:\n  a: { adapter: claude-cli, model: sonnet }\ntasks: { default: a, judge: missing }\n",
    );
    const result = await run("export");
    expect(result.code).toBe(1);
    expect(result.err).toMatch(/judge.*missing/);
  });

  it("explains the commands when called with an unknown one", async () => {
    const { run } = sandbox();
    const result = await run("frobnicate");
    expect(result.code).toBe(2);
    expect(result.err).toContain("serve");
  });

  it("fails when asked to run a category that does not exist", async () => {
    const { run } = sandbox();
    const result = await run("run", "nothing");
    expect(result.code).toBe(1);
    expect(result.err).toContain("nothing");
  });
});

describe("parseListen", () => {
  it("splits host and port", () => {
    expect(parseListen("127.0.0.1:8787")).toEqual({ hostname: "127.0.0.1", port: 8787 });
    expect(parseListen("0.0.0.0:9000")).toEqual({ hostname: "0.0.0.0", port: 9000 });
    expect(parseListen("[::1]:8787")).toEqual({ hostname: "::1", port: 8787 });
  });
});
