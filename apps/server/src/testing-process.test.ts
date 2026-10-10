import { spawn, type ChildProcess } from "node:child_process";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

let child: ChildProcess;
let base: string;

beforeAll(async () => {
  child = spawn(process.execPath, [join(import.meta.dirname, "testing-process.ts")], { stdio: ["ignore", "pipe", "inherit"] });
  const port = await new Promise<string>((resolve, reject) => {
    child.stdout!.once("data", (chunk: Buffer) => resolve(/LISTENING (\d+)/.exec(chunk.toString())?.[1] ?? ""));
    child.once("exit", () => reject(new Error("the process ended before it listened")));
  });
  base = `http://127.0.0.1:${port}`;
});

afterAll(() => {
  child.kill();
});

async function control(command: Record<string, unknown>) {
  const response = await fetch(`${base}/__control`, { method: "POST", body: JSON.stringify(command) });
  const body = (await response.json()) as { result?: unknown; error?: string };
  if (!response.ok) throw new Error(body.error);
  return body.result;
}

describe("the test server process", () => {
  it("serves the API of a server it created, with the data put into it", async () => {
    const { id, url, apiToken } = (await control({ op: "create" })) as { id: string; url: string; apiToken: string };
    const category = (await control({ op: "category", id, args: ["Security", "news"] })) as { id: number };
    await control({ op: "article", id, args: [category.id, { title: "A story", importance: 5 }] });

    const response = await fetch(`${url}/api/v1/articles`, { headers: { authorization: `Bearer ${apiToken}` } });
    const list = (await response.json()) as { items: Array<{ title: string; importance: number }> };

    expect(list.items).toMatchObject([{ title: "A story", importance: 5 }]);
  });

  it("keeps the servers apart", async () => {
    const first = (await control({ op: "create" })) as { id: string; apiToken: string };
    const second = (await control({ op: "create" })) as { id: string; url: string };
    await control({ op: "category", id: first.id, args: ["Only here", "news"] });

    const response = await fetch(`${second.url}/api/v1/categories`, { headers: { authorization: `Bearer ${first.apiToken}` } });

    expect(await response.json()).toEqual([]);
  });

  it("refuses a request without the token, like the real server", async () => {
    const { url } = (await control({ op: "create" })) as { url: string };
    expect((await fetch(`${url}/api/v1/categories`)).status).toBe(401);
  });

  it("runs a function of the core package on the server's database", async () => {
    const { id, url, apiToken } = (await control({ op: "create" })) as { id: string; url: string; apiToken: string };
    const category = (await control({ op: "category", id, args: [] })) as { id: number };
    const article = await control({ op: "article", id, args: [category.id] });
    await control({ op: "core", id, name: "setArticleFlags", args: [article, { isRead: true }] });

    const response = await fetch(`${url}/api/v1/articles/${String(article)}`, { headers: { authorization: `Bearer ${apiToken}` } });

    expect(await response.json()).toMatchObject({ isRead: true });
  });

  it("moves the server's clock", async () => {
    const { id } = (await control({ op: "create", start: "2026-03-01T12:00:00.000Z" })) as { id: string };
    expect(await control({ op: "advance", id, args: [60_000] })).toBe("2026-03-01T12:01:00.000Z");
  });

  it("stops serving a server that was disposed of", async () => {
    const { id, url } = (await control({ op: "create" })) as { id: string; url: string };
    await control({ op: "dispose", id });
    await expect(fetch(`${url}/api/v1/health`)).rejects.toThrow();
    await expect(control({ op: "category", id, args: [] })).rejects.toThrow(/no test server/);
  });
});
