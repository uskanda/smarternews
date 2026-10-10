import { mkdtempSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { API_TOKEN, FEED_TOKEN, testServer } from "./testing.ts";
import { ensureToken } from "./tokens.ts";

describe("authentication", () => {
  it("answers 401 and returns no articles without a token", async () => {
    const s = testServer();
    s.article(s.category().id);
    const response = await s.get("/api/v1/articles", null);
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: { code: "unauthorized", message: expect.any(String) } });
  });

  it("answers 401 for a wrong token", async () => {
    const s = testServer();
    expect((await s.get("/api/v1/articles", "wrong-token")).status).toBe(401);
  });

  it("returns the articles with the right token", async () => {
    const s = testServer();
    s.article(s.category().id);
    const response = await s.get("/api/v1/articles");
    expect(response.status).toBe(200);
    expect((await response.json()).items).toHaveLength(1);
  });

  it("refuses the feed token on the API, so it cannot change settings", async () => {
    const s = testServer();
    const category = s.category();
    const response = await s.patch(`/api/v1/categories/${category.id}`, { name: "Changed" }, FEED_TOKEN);
    expect(response.status).toBe(401);
    expect((await (await s.get(`/api/v1/categories/${category.id}`)).json()).name).toBe("Security");
  });

  it("does not accept the API token in the query string", async () => {
    const s = testServer();
    expect((await s.get(`/api/v1/articles?token=${API_TOKEN}`, null)).status).toBe(401);
  });
});

describe("health check", () => {
  it("answers without a token with the version and nothing about the content", async () => {
    const s = testServer();
    s.article(s.category().id);
    const response = await s.get("/api/v1/health", null);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "ok", version: "9.9.9" });
  });
});

describe("versioned paths", () => {
  it("serves the API under /api/v1 only", async () => {
    const s = testServer();
    expect((await s.get("/api/v1/articles")).status).toBe(200);
    expect((await s.get("/api/articles")).status).toBe(404);
  });
});

describe("ensureToken", () => {
  it("creates a token file that only its owner can read, and reports that it is new", () => {
    const path = join(mkdtempSync(join(tmpdir(), "sn-token-")), "nested", "api-token");
    const { token, created } = ensureToken(path);
    expect(created).toBe(true);
    expect(token.length).toBeGreaterThanOrEqual(40);
    expect(readFileSync(path, "utf8").trim()).toBe(token);
    expect(statSync(path).mode & 0o777).toBe(0o600);
  });

  it("returns the stored token on later calls", () => {
    const path = join(mkdtempSync(join(tmpdir(), "sn-token-")), "api-token");
    const first = ensureToken(path);
    const second = ensureToken(path);
    expect(second).toEqual({ token: first.token, created: false });
  });

  it("generates a different token each time", () => {
    const dir = mkdtempSync(join(tmpdir(), "sn-token-"));
    expect(ensureToken(join(dir, "a")).token).not.toBe(ensureToken(join(dir, "b")).token);
  });
});
