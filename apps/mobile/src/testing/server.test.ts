import { createApi } from "@smarternews/client";
import { nodeFetch } from "./fetch";
import { makeServer } from "./server";

it("reaches a real API from inside a test", async () => {
  const server = await makeServer();
  await server.category("Security");
  const api = createApi({ baseUrl: server.url, fetchImpl: nodeFetch, getToken: () => server.token, onUnauthorized: () => {} });

  const categories = await api.categories();

  expect(categories.map((category) => category.name)).toEqual(["Security"]);
});

it("gives every test a server of its own", async () => {
  const first = await makeServer();
  const second = await makeServer();
  await first.category("Only in the first");
  const api = createApi({ baseUrl: second.url, fetchImpl: nodeFetch, getToken: () => second.token, onUnauthorized: () => {} });

  expect(await api.categories()).toEqual([]);
});
