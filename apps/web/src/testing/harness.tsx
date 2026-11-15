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
  hold?: (request: string) => boolean;
  /** Pass fake-timer advancing to user-event when a test freezes time. */
  advanceTimers?: (ms: number) => void | Promise<void>;
  /** Uses the browser's history, so that `back` goes through the entries the app pushed. */
  browserHistory?: boolean;
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
        const response = Promise.resolve(server.app.request(input, init));
        if (options.hold?.(request)) {
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
     */
    hold: (match: (request: string) => boolean) => {
      let open: () => void = () => {};
      const hold: Hold = { match, held: 0, gate: new Promise<void>((resolve) => (open = resolve)) };
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
