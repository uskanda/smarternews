import { createContext, useContext } from "react";
import type { Api } from "@smarternews/client";

export interface AppServices {
  api: Api;
  /** The current time. Injected so that tests can move it. */
  now: () => Date;
  /** The token the app is using, the one its API calls send. Kept for this page even where storage is blocked. */
  getToken: () => string | null;
  /** Forgets the stored token and returns to the token screen. */
  clearToken: () => void;
}

export const AppContext = createContext<AppServices | null>(null);

export function useApp(): AppServices {
  const services = useContext(AppContext);
  if (!services) throw new Error("useApp must be used inside the App");
  return services;
}
