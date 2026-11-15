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
  // The requests whose answers wait until the test lets them through: matched against "METHOD path".
  const holds: { match: (request: string) => boolean; gate: Promise<void> }[] = [];
  let path = options.route ?? "/";
  let go: (delta: number) => void = () => {
    throw new Error("The app has not rendered its router yet.");
  };
  if (options.browserHistory) window.history.replaceState(null, "", path);
  const view = render(
    <App
      fetchImpl={async (input, init) => {
        const request = `${init?.method ?? "GET"} ${input}`;
        requests.push(request);
        if (options.offline?.()) throw new TypeError("fetch failed");
        for (const hold of holds.filter((entry) => entry.match(request))) await hold.gate;
        return server.app.request(input, init);
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
    /** The path and query the app is on now. */
    path: () => path,
    /** Goes back one entry in the history, as the browser's back button does. */
    back: async () => {
      await act(async () => go(-1));
    },
    /**
     * Keeps the answers to the matching requests ("METHOD path", such as "DELETE /api/v1/topics/3") waiting, as a
     * slow server would, until `release` lets them through. The requests are counted in `requests` when sent.
     */
    hold: (match: string | RegExp) => {
      let open!: () => void;
      const gate = new Promise<void>((resolve) => {
        open = resolve;
      });
      const entry = { match: (request: string) => (typeof match === "string" ? request === match : match.test(request)), gate };
      holds.push(entry);
      return {
        release: async () => {
          holds.splice(holds.indexOf(entry), 1);
          await act(async () => {
            open();
            await new Promise((resolve) => setTimeout(resolve, 0));
          });
        },
      };
    },
  };
}
