import { updateSettings } from "@smarternews/core";
import { API_TOKEN, testServer } from "@smarternews/server/testing";
import { render } from "@testing-library/react";
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
}

/** A server with the settings every test assumes: UTC, so that expected times can be read off the fixtures. */
export function makeServer(start?: string, options: { webSearch?: boolean } = {}): TestServer {
  const server = testServer(start, options);
  updateSettings(server.db, { timeZone: "UTC", outputLanguage: "ja" });
  return server;
}

/** Renders the whole app against a real API with an in-memory database. */
export function renderApp(options: RenderOptions = {}) {
  const server = options.server ?? makeServer();
  if (options.token !== null) window.localStorage.setItem("smarternews.token", options.token ?? API_TOKEN);
  if (options.width !== undefined) setViewport(options.width);
  const requests: string[] = [];
  let path = options.route ?? "/";
  const view = render(
    <App
      fetchImpl={(input, init) => {
        requests.push(`${init?.method ?? "GET"} ${input}`);
        if (options.offline?.()) return Promise.reject(new TypeError("fetch failed"));
        return server.app.request(input, init);
      }}
      initialEntries={[path]}
      now={() => server.clock()}
      onLocation={(next) => {
        path = next;
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
  };
}
