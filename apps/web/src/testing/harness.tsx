import { updateSettings } from "@smarternews/core";
import { API_TOKEN, testServer } from "@smarternews/server/testing";
import { act, render } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { App } from "../App.tsx";
import { setViewport } from "./setup.ts";

export type TestServer = ReturnType<typeof testServer>;

export interface RenderOptions {
  /** The path the browser is on. */
  route?: string;
  /** The token in the browser's storage. `null` means none is stored. */
  token?: string | null;
  /** Viewport width in pixels: 1280 shows three panes, 900 two, 390 one. */
  width?: number;
  server?: TestServer;
  /** Makes every request fail as if the server were down, while it returns true. */
  offline?: () => boolean;
  /**
   * Holds back the answers to the requests it returns true for, given as "POST /api/v1/...". The server
   * handles such a request at once; its answer reaches the app only when `release` lets it through.
   */
  holdAnswer?: (request: string) => boolean;
  /** Pass fake-timer advancing to user-event when a test freezes time. */
  advanceTimers?: (ms: number) => void | Promise<void>;
  /** Uses the browser's history, so that `back` goes through the entries the app pushed. */
  browserHistory?: boolean;
  /**
   * Holds back a request, given as "METHOD /api/v1/path?…", until the promise returned for it settles. The server
   * answers it then, as it stands at that moment; a rejected promise makes the request fail as if the server were
   * down. Returning undefined lets the request through at once.
   */
  hold?: (request: string) => Promise<void> | undefined;
}

/** A gate a test opens when it chooses: `wait` settles once `open` is called. */
export function gate(): { wait: Promise<void>; open: () => void } {
  let open: () => void = () => {};
  const wait = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { wait, open };
}

/**
 * A gate for the first request whose line contains `match`: pass `hold` to `renderApp`, and `open` it to let the
 * request reach the server. Later requests that match go through at once.
 */
export function gateFirst(match: string) {
  let release: () => void = () => {};
  const opened = new Promise<void>((resolve) => {
    release = resolve;
  });
  let held = false;
  return {
    hold: (request: string) => {
      if (held || !request.includes(match)) return undefined;
      held = true;
      return opened;
    },
    /** Whether the request has come and is waiting. */
    waiting: () => held,
    open: async () => {
      await act(async () => {
        release();
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
    },
  };
}

/** The browser's back. jsdom goes through its history after a task. */
export async function back(): Promise<void> {
  await act(async () => {
    window.history.back();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

/**
 * A server with the settings every test assumes: UTC, so that expected times can be read off the fixtures, and
 * a list that stays open after "mark all as read". The tests of moving on switch that on themselves.
 */
export function makeServer(start?: string, options: Parameters<typeof testServer>[1] = {}): TestServer {
  const server = testServer(start, options);
  updateSettings(server.db, { timeZone: "UTC", outputLanguage: "ja", advanceAfterMarkAll: false });
  return server;
}

/**
 * Makes the requests for the given paths below /api/v1, such as "categories", fail as if the server were down,
 * whatever their query. The returned set holds the paths that fail: delete one, or clear it, to let them through.
 */
export function failPaths(server: TestServer, paths: string[]): Set<string> {
  const failing = new Set(paths);
  const original = server.app.request.bind(server.app);
  server.app.request = ((input: string, init?: RequestInit) => {
    const path = String(input).split("?")[0]!;
    return [...failing].some((name) => path.endsWith(`/api/v1/${name}`)) ? Promise.reject(new TypeError("fetch failed")) : original(input, init);
  }) as typeof server.app.request;
  return failing;
}

/** Renders the whole app against a real API with an in-memory database. */
export function renderApp(options: RenderOptions = {}) {
  const server = options.server ?? makeServer();
  if (options.token !== null) window.localStorage.setItem("smarternews.token", options.token ?? API_TOKEN);
  if (options.width !== undefined) setViewport(options.width);
  const requests: string[] = [];
  const held: Array<{ request: string; answer: () => void; fail: () => void }> = [];
  const holds: Hold[] = [];
  let path = options.route ?? "/";
  let go: (delta: number) => void = () => {
    throw new Error("The app has not rendered its router yet.");
  };
  if (options.browserHistory) window.history.replaceState(null, "", path);
  const view = render(
    <App
      fetchImpl={(input, init) => {
        const request = `${init?.method ?? "GET"} ${input}`;
        requests.push(request);
        if (options.offline?.()) return Promise.reject(new TypeError("fetch failed"));
        const gated = options.hold?.(request);
        if (gated) {
          return gated.then(
            () => server.app.request(input, init),
            () => Promise.reject(new TypeError("fetch failed")),
          );
        }
        const response = Promise.resolve(server.app.request(input, init));
        if (options.holdAnswer?.(request)) {
          return new Promise<Response>((resolve, reject) => {
            held.push({ request, answer: () => resolve(response), fail: () => reject(new TypeError("fetch failed")) });
          });
        }
        const hold = holds.find((entry) => entry.match(request));
        if (!hold) return response;
        hold.held += 1;
        return hold.gate.then(() => response);
      }}
      initialEntries={options.browserHistory ? undefined : [path]}
      now={() => server.clock()}
      onLocation={(next) => {
        path = next;
      }}
      onHistory={(next) => {
        go = next;
      }}
    />,
  );
  return {
    ...view,
    server,
    requests,
    user: userEvent.setup(options.advanceTimers ? { advanceTimers: options.advanceTimers } : {}),
    /** The requests whose answers are held back, oldest first. */
    held: () => held.map((entry) => entry.request),
    /**
     * Lets the answer to the held request at `index` through, or with `fail` breaks the connection instead,
     * and waits for the app to take it.
     */
    release: async (index = 0, how: "answer" | "fail" = "answer") => {
      const [entry] = held.splice(index, 1);
      if (!entry) throw new Error(`No answer is held at ${index}.`);
      await act(async () => {
        if (how === "answer") entry.answer();
        else entry.fail();
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
    },
    /** The path and query the app is on now. */
    path: () => path,
    /** Goes back one entry in the history, as the browser's back button does. */
    back: async () => {
      await act(async () => go(-1));
    },
    /**
     * Holds back the responses of the requests that `match`, sent from now until `release`. The server answers
     * each request when it is sent; the app gets the answer only once released, as from a slow connection.
     * A string matches the whole "METHOD path" (such as "DELETE /api/v1/topics/3"), a pattern any part of it.
     */
    hold: (match: string | RegExp | ((request: string) => boolean)) => {
      let open: () => void = () => {};
      const matches =
        typeof match === "function"
          ? match
          : typeof match === "string"
            ? (request: string) => request === match
            : (request: string) => match.test(request);
      const hold: Hold = { match: matches, held: 0, gate: new Promise<void>((resolve) => (open = resolve)) };
      holds.push(hold);
      return {
        /** How many responses are held back. */
        held: () => hold.held,
        /** Passes the held responses on, and the later ones at once. */
        release: async () => {
          holds.splice(holds.indexOf(hold), 1);
          await act(async () => {
            open();
            await new Promise((resolve) => setTimeout(resolve, 0));
          });
        },
      };
    },
  };
}

interface Hold {
  match: (request: string) => boolean;
  held: number;
  gate: Promise<void>;
}
