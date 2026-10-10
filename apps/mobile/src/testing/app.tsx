// Renders the whole app, with its real routes, against a real API.
import type { Fetch } from "@smarternews/client";
import { render } from "@testing-library/react-native";
import { ExpoRoot } from "expo-router/build/ExpoRoot";
import { store } from "expo-router/build/global-state/router-store";
import { getMockContext } from "expo-router/testing-library";
import { saveConnection } from "../connection/store";
import { setEnvironment } from "../env";
import { nodeFetch } from "./fetch";
import { makeServer, type TestServer } from "./server";

export interface RenderOptions {
  server?: TestServer;
  /** False starts the app without a stored connection, as after installing. */
  connected?: boolean;
  /** The route to open, such as "/list/all". */
  url?: string;
  /** Makes every request fail as if the server could not be reached, while it returns true. */
  offline?: () => boolean;
}

/** Puts the device into the state the app starts from, without drawing anything: the periodic check needs no more. */
export async function prepareDevice(options: Omit<RenderOptions, "url"> = {}) {
  const server = options.server ?? (await makeServer());
  /** Every request the app made, with the server's own address cut off. A request elsewhere keeps its address. */
  const requests: string[] = [];
  const fetchImpl: Fetch = (input, init) => {
    requests.push(`${init?.method ?? "GET"} ${input.replace(server.url, "")}`);
    if (options.offline?.()) return Promise.reject(new TypeError("fetch failed"));
    return nodeFetch(input, init);
  };
  setEnvironment({ fetchImpl, now: server.now });
  if (options.connected !== false) await saveConnection({ url: server.url, token: server.token });
  return { server, requests };
}

export async function renderApp(options: RenderOptions = {}) {
  const { server, requests } = await prepareDevice(options);
  // What the router's own `renderRouter` does, without its switch to fake timers: the tests wait for a real
  // server over a real socket, and a wait on fake time never lets that socket be read.
  process.env.EXPO_ROUTER_IMPORT_MODE = "sync";
  const view = await render(<ExpoRoot context={getMockContext("app")} location={options.url ?? "/"} />);
  return { ...view, server, requests, pathname: () => store.getRouteInfo().pathnameWithParams };
}
