// A fetch for tests, on Node's own HTTP client. Inside Jest the global fetch is Expo's, which needs the native
// side of a real device; the tests have to reach the test server over the real network stack instead.
import { Agent, request } from "node:http";
import type { Fetch } from "@smarternews/client";

// No connection is kept open between requests, so nothing holds the test run after its last test.
const agent = new Agent({ keepAlive: false });

export const nodeFetch: Fetch = (input, init) =>
  new Promise<Response>((resolve, reject) => {
    const headers = Object.fromEntries(new Headers(init?.headers as Record<string, string> | undefined).entries());
    const call = request(input, { method: init?.method ?? "GET", headers, agent }, (answer) => {
      const chunks: Buffer[] = [];
      answer.on("data", (chunk: Buffer) => chunks.push(chunk));
      answer.on("end", () => {
        const text = Buffer.concat(chunks).toString("utf8");
        const status = answer.statusCode ?? 0;
        resolve({
          ok: status >= 200 && status < 300,
          status,
          headers: new Headers(answer.headers as Record<string, string>),
          text: async () => text,
          json: async () => JSON.parse(text) as unknown,
        } as unknown as Response);
      });
    });
    call.on("error", () => reject(new TypeError("fetch failed")));
    if (typeof init?.body === "string") call.write(init.body);
    call.end();
  });
