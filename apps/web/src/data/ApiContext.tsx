import { createContext, useContext, useMemo, useState, type ReactNode } from "react";
import { authHeaders, type Session } from "./session";
import { resolveDefaultTransport, type Transport, type TransportResponse } from "./transport";

interface ApiContextValue {
  readonly session: Session | null;
  setSession(session: Session | null): void;
  /** Issues a request with the current session's auth headers merged in. */
  request(path: string, init?: RequestInit): Promise<TransportResponse>;
}

const ApiContext = createContext<ApiContextValue | null>(null);

export interface ApiProviderProps {
  readonly children: ReactNode;
  /** Overridable for tests; defaults to the platform-resolved transport (HTTP or Electron IPC). */
  readonly transport?: Transport;
  /** Seed an initial session (tests / restored sessions). */
  readonly initialSession?: Session | null;
}

export function ApiProvider({ children, transport, initialSession = null }: ApiProviderProps) {
  const [session, setSession] = useState<Session | null>(initialSession);
  const resolvedTransport = useMemo<Transport>(() => transport ?? resolveDefaultTransport(), [transport]);

  const value = useMemo<ApiContextValue>(
    () => ({
      session,
      setSession,
      request(path, init) {
        const headers = new Headers(init?.headers);
        for (const [k, v] of Object.entries(authHeaders(session))) headers.set(k, v);
        if (init?.body && !headers.has("content-type")) headers.set("content-type", "application/json");
        return resolvedTransport(path, { ...init, headers });
      },
    }),
    [session, resolvedTransport],
  );

  return <ApiContext.Provider value={value}>{children}</ApiContext.Provider>;
}

export function useApi(): ApiContextValue {
  const ctx = useContext(ApiContext);
  if (!ctx) throw new Error("useApi must be used within an <ApiProvider>.");
  return ctx;
}
