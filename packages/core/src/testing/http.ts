import type { Clock } from "../clock.ts";

export interface RecordedRequest {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: string | null;
  at: number;
}

type Route = (request: RecordedRequest) => Response | Promise<Response> | "hang";

/**
 * A stand-in for the global fetch. Routes are matched by exact URL first, then by URL prefix; anything else
 * answers 404. Every request is recorded with the time the clock showed.
 */
export function fakeFetch(routes: Record<string, Route | string>, clock: Clock = () => new Date(0)) {
  const requests: RecordedRequest[] = [];
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    const request: RecordedRequest = {
      url,
      method: init?.method ?? "GET",
      headers: Object.fromEntries(new Headers(init?.headers).entries()),
      body: typeof init?.body === "string" ? init.body : null,
      at: clock().getTime(),
    };
    requests.push(request);
    const key = Object.keys(routes).find((candidate) => candidate === url) ?? Object.keys(routes).find((candidate) => url.startsWith(candidate));
    const route = key === undefined ? undefined : routes[key];
    if (route === undefined) return new Response("not found", { status: 404 });
    if (typeof route === "string") return new Response(route, { status: 200, headers: { "content-type": "text/html; charset=utf-8" } });
    const answer = route(request);
    if (answer === "hang") {
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
      });
    }
    return answer;
  }) as typeof fetch;
  return { fetchImpl, requests, urls: () => requests.map((request) => request.url) };
}

export function xml(body: string): Response {
  return new Response(body, { status: 200, headers: { "content-type": "application/xml; charset=utf-8" } });
}

export function html(body: string): Response {
  return new Response(body, { status: 200, headers: { "content-type": "text/html; charset=utf-8" } });
}
