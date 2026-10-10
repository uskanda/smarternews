import { createApi, type Api } from "@smarternews/client";
import { focusManager, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createContext, useContext, useEffect, useMemo, type ReactNode } from "react";
import { AppState } from "react-native";
import { useConnection } from "../connection/ConnectionProvider";
import { environment } from "../env";

interface AppContextValue {
  api: Api;
  now: () => Date;
  serverUrl: string;
}

const AppContext = createContext<AppContextValue | null>(null);

export function useApp(): AppContextValue {
  const value = useContext(AppContext);
  if (!value) throw new Error("useApp needs an AppProvider above it, and a connection");
  return value;
}

/** The API client for the connected server, and a query cache that lives as long as the connection. */
export function AppProvider({ children }: { children: ReactNode }) {
  const { connection, invalidate } = useConnection();
  // A new cache per connection: nothing read from one server is shown for another.
  const key = connection ? `${connection.url}\n${connection.token}` : "";
  // eslint-disable-next-line react-hooks/exhaustive-deps -- the key stands for the connection
  const client = useMemo(() => new QueryClient({ defaultOptions: { queries: { retry: false } } }), [key]);

  // A cache that is no longer shown holds no timers and no data of the server it came from.
  useEffect(() => () => client.clear(), [client]);

  // Coming back to the foreground counts as focus: lists and counts are fetched again.
  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) => focusManager.setFocused(state === "active"));
    return () => subscription.remove();
  }, []);

  const value = useMemo<AppContextValue | null>(() => {
    if (!connection) return null;
    const api = createApi({
      baseUrl: connection.url,
      fetchImpl: environment().fetchImpl,
      getToken: () => connection.token,
      onUnauthorized: invalidate,
    });
    return { api, now: () => environment().now(), serverUrl: connection.url };
  }, [connection, invalidate]);

  return (
    <QueryClientProvider client={client}>
      <AppContext.Provider value={value}>{children}</AppContext.Provider>
    </QueryClientProvider>
  );
}
