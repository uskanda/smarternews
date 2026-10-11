import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { createBrowserRouter, createMemoryRouter, Navigate, RouterProvider, type RouteObject } from "react-router";
import { createApi, type Fetch } from "@smarternews/client";
import { AppContext, type AppServices } from "./app/context.ts";
import { readToken, writeToken } from "./lib/token-store.ts";
import { ReaderPage } from "./reader/ReaderPage.tsx";
import { RunPage } from "./runs/RunPage.tsx";
import { RunsPage } from "./runs/RunsPage.tsx";
import { CategoryPage } from "./settings/CategoryPage.tsx";
import { FeedsPage } from "./settings/FeedsPage.tsx";
import { SettingsPage } from "./settings/SettingsPage.tsx";
import { StopWordsPage } from "./settings/StopWordsPage.tsx";
import { NotFound, Shell } from "./shell/Shell.tsx";
import { ToastProvider } from "./shell/toast.tsx";
import { TokenScreen } from "./shell/TokenScreen.tsx";

export interface AppProps {
  /** Where API calls go. The browser's fetch unless a test passes its own. */
  fetchImpl?: Fetch;
  /** Starts the app on these paths with an in-memory history, for tests. */
  initialEntries?: string[];
  now?: () => Date;
  /** Told the path and query after every navigation, for tests. */
  onLocation?: (path: string) => void;
}

const routes: RouteObject[] = [
  {
    element: <Shell />,
    children: [
      { index: true, element: <Navigate to="/unread" replace /> },
      { path: "unread/:articleId?", element: <ReaderPage view="unread" /> },
      { path: "all/:articleId?", element: <ReaderPage view="all" /> },
      { path: "starred/:articleId?", element: <ReaderPage view="starred" /> },
      { path: "generated/:articleId?", element: <ReaderPage view="generated" /> },
      { path: "uncategorized/:articleId?", element: <ReaderPage view="uncategorized" /> },
      { path: "c/:slug/generated/:articleId?", element: <ReaderPage view="category-generated" /> },
      { path: "c/:slug/:articleId?", element: <ReaderPage view="category" /> },
      { path: "f/:feedId/:articleId?", element: <ReaderPage view="feed" /> },
      { path: "settings", element: <SettingsPage /> },
      { path: "settings/categories/:categoryId", element: <CategoryPage /> },
      { path: "settings/feeds", element: <FeedsPage /> },
      { path: "settings/stop-words", element: <StopWordsPage /> },
      { path: "runs", element: <RunsPage /> },
      { path: "runs/:runId", element: <RunPage /> },
      { path: "*", element: <NotFound /> },
    ],
  },
];

export function App({ fetchImpl, initialEntries, now, onLocation }: AppProps) {
  const [token, setTokenState] = useState<string | null>(readToken);
  const tokenRef = useRef(token);
  const queryClient = useMemo(
    () => new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 5000, refetchOnWindowFocus: false } } }),
    [],
  );

  const services = useMemo<AppServices & { setToken: (next: string | null) => void }>(() => {
    const setToken = (next: string | null) => {
      tokenRef.current = next;
      writeToken(next);
      if (next === null) queryClient.clear();
      setTokenState(next);
    };
    return {
      api: createApi({ fetchImpl, getToken: () => tokenRef.current, onUnauthorized: () => setToken(null) }),
      now: now ?? (() => new Date()),
      clearToken: () => setToken(null),
      setToken,
    };
  }, [fetchImpl, now, queryClient]);

  const router = useMemo(
    () => (initialEntries ? createMemoryRouter(routes, { initialEntries }) : createBrowserRouter(routes)),
    [initialEntries],
  );
  useEffect(() => {
    if (!onLocation) return;
    return router.subscribe((state) => onLocation(`${state.location.pathname}${state.location.search}`));
  }, [router, onLocation]);

  return (
    <AppContext value={services}>
      <QueryClientProvider client={queryClient}>
        <ToastProvider>
          {token === null ? <TokenScreen onToken={services.setToken} /> : <RouterProvider router={router} />}
        </ToastProvider>
      </QueryClientProvider>
    </AppContext>
  );
}
