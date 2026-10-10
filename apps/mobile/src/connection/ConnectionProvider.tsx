import { ApiError, createApi, type Connection } from "@smarternews/client";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { environment } from "../env";
import { clearConnection, forgetToken, loadConnection, saveConnection } from "./store";

export type ConnectFailure = "token" | "unreachable";

interface ConnectionState {
  /** "loading" until the stored connection has been read. */
  status: "loading" | "none" | "connected";
  connection: Connection | null;
  /** True after the server refused the stored token. */
  invalidated: boolean;
  /** Checks the URL and token against the server, and stores them only when the server accepts them. */
  connect(candidate: Connection): Promise<ConnectFailure | null>;
  /** Called when the server refuses the stored token. */
  invalidate(): void;
  disconnect(): Promise<void>;
}

const ConnectionContext = createContext<ConnectionState | null>(null);

export function useConnection(): ConnectionState {
  const value = useContext(ConnectionContext);
  if (!value) throw new Error("useConnection needs a ConnectionProvider above it");
  return value;
}

export function ConnectionProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<ConnectionState["status"]>("loading");
  const [connection, setConnection] = useState<Connection | null>(null);
  const [invalidated, setInvalidated] = useState(false);

  useEffect(() => {
    let alive = true;
    void loadConnection().then((stored) => {
      if (!alive) return;
      setConnection(stored);
      setStatus(stored ? "connected" : "none");
    });
    return () => {
      alive = false;
    };
  }, []);

  const connect = useCallback(async (candidate: Connection): Promise<ConnectFailure | null> => {
    const api = createApi({ baseUrl: candidate.url, fetchImpl: environment().fetchImpl, getToken: () => candidate.token, onUnauthorized: () => {} });
    try {
      if (!(await api.verifyToken(candidate.token))) return "token";
    } catch (error) {
      if (error instanceof ApiError && error.kind === "unauthorized") return "token";
      return "unreachable";
    }
    await saveConnection(candidate);
    setConnection(candidate);
    setInvalidated(false);
    setStatus("connected");
    return null;
  }, []);

  const invalidate = useCallback(() => {
    void forgetToken();
    setConnection(null);
    setInvalidated(true);
    setStatus("none");
  }, []);

  const disconnect = useCallback(async () => {
    await clearConnection();
    setConnection(null);
    setInvalidated(false);
    setStatus("none");
  }, []);

  const value = useMemo(
    () => ({ status, connection, invalidated, connect, invalidate, disconnect }),
    [status, connection, invalidated, connect, invalidate, disconnect],
  );
  return <ConnectionContext.Provider value={value}>{children}</ConnectionContext.Provider>;
}
