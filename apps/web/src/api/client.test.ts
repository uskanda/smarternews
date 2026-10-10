import { API_TOKEN, testServer } from "@smarternews/server/testing";
import { describe, expect, it, vi } from "vitest";
import { ApiError, createApi } from "./client.ts";

function setup(token: string | null = API_TOKEN) {
  const server = testServer();
  const onUnauthorized = vi.fn();
  const seen: Array<{ url: string; authorization: string | null }> = [];
  const api = createApi({
    fetchImpl: (input, init) => {
      seen.push({ url: String(input), authorization: new Headers(init?.headers).get("authorization") });
      return server.app.request(String(input), init);
    },
    getToken: () => token,
    onUnauthorized,
  });
  return { server, api, onUnauthorized, seen };
}

describe("the API client", () => {
  it("sends the stored token as a bearer token", async () => {
    const { api, seen } = setup();
    await api.categories();
    expect(seen[0]).toEqual({ url: "/api/v1/categories", authorization: `Bearer ${API_TOKEN}` });
  });

  it("returns what the server stored, in the shared shape", async () => {
    const { api, server } = setup();
    const created = await api.createCategory({ name: "Security", kind: "news" });
    server.article(created.id, { title: "A story", importance: 4 });

    const list = await api.articles({ category: created.id, unread: "true" });

    expect(created).toMatchObject({ slug: "security", minImportance: 3 });
    expect(list.items).toMatchObject([{ title: "A story", importance: 4, isRead: false }]);
    expect(list.nextCursor).toBeNull();
  });

  it("reports a refused value with the field and the reason", async () => {
    const { api, server } = setup();
    const category = server.category();
    const error = await api.updateCategory(category.id, { minImportance: 9 }).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ kind: "invalid", status: 400, fields: [{ path: "minImportance" }] });
  });

  it("tells a missing object from a conflict", async () => {
    const { api, server } = setup();
    server.category("Security");
    await expect(api.article(4242)).rejects.toMatchObject({ kind: "not_found" });
    await expect(api.createCategory({ name: "Other", slug: "security", kind: "news" })).rejects.toMatchObject({ kind: "conflict" });
  });

  it("reports an unreachable server as a network failure", async () => {
    const api = createApi({
      fetchImpl: () => Promise.reject(new TypeError("fetch failed")),
      getToken: () => API_TOKEN,
      onUnauthorized: () => {},
    });
    await expect(api.categories()).rejects.toMatchObject({ kind: "network", status: null });
  });

  it("announces a rejected token so that the app can ask for a new one", async () => {
    const { api, onUnauthorized } = setup("wrong-token");
    await expect(api.categories()).rejects.toMatchObject({ kind: "unauthorized" });
    expect(onUnauthorized).toHaveBeenCalledTimes(1);
  });

  it("checks a candidate token without touching the stored one", async () => {
    const { api, onUnauthorized } = setup(null);
    await expect(api.verifyToken(API_TOKEN)).resolves.toBe(true);
    await expect(api.verifyToken("wrong")).resolves.toBe(false);
    expect(onUnauthorized).not.toHaveBeenCalled();
  });

  it("passes list filters as query parameters and leaves out the unset ones", async () => {
    const { api, seen } = setup();
    await api.articles({ unread: "true", minImportance: 4, limit: 50 });
    const url = new URL(seen[0]!.url, "http://x");
    expect(Object.fromEntries(url.searchParams)).toEqual({ unread: "true", minImportance: "4", limit: "50" });
  });

  it("downloads the settings file as text and uploads it back", async () => {
    const { api, server } = setup();
    server.category("Security");
    const text = await api.exportSettings();
    expect(text).toContain("slug: security");
    await expect(api.importSettings(text)).resolves.toEqual({ categoriesCreated: 0, categoriesUpdated: 1, topicsCreated: 0, topicsUpdated: 0 });
  });
});
