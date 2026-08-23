import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import {
  authHeaders,
  loadPersistedScopeSelection,
  loadPersistedSession,
  NO_SCOPE_SELECTION,
  persistScopeSelection,
  persistSession,
  type ScopeSelection,
  type Session,
} from "./session";
import { resolveDefaultTransport, type Transport, type TransportResponse } from "./transport";

interface ApiContextValue {
  readonly session: Session | null;
  setSession(session: Session | null): void;
  /** The topbar's working-branch/warehouse selector (data/hub-hooks.ts `useScopeSelector`). */
  readonly scopeSelection: ScopeSelection;
  setScopeSelection(selection: ScopeSelection): void;
  /** Issues a request with the current session's auth headers (narrowed by `scopeSelection`) merged in. */
  request(path: string, init?: RequestInit): Promise<TransportResponse>;
}

const ApiContext = createContext<ApiContextValue | null>(null);

export interface ApiProviderProps {
  readonly children: ReactNode;
  /** Overridable for tests; defaults to the platform-resolved transport (HTTP or Electron IPC). */
  readonly transport?: Transport;
  /**
   * Seed an initial session (tests / restored sessions). Omit it to restore
   * the last persisted session (e.g. after a page reload); pass `null`
   * explicitly to start signed out regardless of what's persisted.
   */
  readonly initialSession?: Session | null;
}

export function ApiProvider({ children, transport, initialSession }: ApiProviderProps) {
  const [session, setSessionState] = useState<Session | null>(() =>
    initialSession !== undefined ? initialSession : loadPersistedSession(),
  );
  const [scopeSelection, setScopeSelectionState] = useState<ScopeSelection>(loadPersistedScopeSelection);
  const resolvedTransport = useMemo<Transport>(() => transport ?? resolveDefaultTransport(), [transport]);

  const setSession = useCallback((next: Session | null) => {
    setSessionState(next);
    persistSession(next);
    // A new session (login/logout/switch user) can carry a different branch/warehouse
    // scope, so a stale narrower selection from a previous session is dropped.
    setScopeSelectionState(NO_SCOPE_SELECTION);
    persistScopeSelection(NO_SCOPE_SELECTION);
  }, []);

  const setScopeSelection = useCallback((next: ScopeSelection) => {
    setScopeSelectionState(next);
    persistScopeSelection(next);
  }, []);

  const value = useMemo<ApiContextValue>(
    () => ({
      session,
      setSession,
      scopeSelection,
      setScopeSelection,
      request(path, init) {
        const headers = new Headers(init?.headers);
        for (const [k, v] of Object.entries(authHeaders(session, scopeSelection))) headers.set(k, v);
        if (init?.body && !headers.has("content-type")) headers.set("content-type", "application/json");
        return resolvedTransport(path, { ...init, headers });
      },
    }),
    [session, setSession, scopeSelection, setScopeSelection, resolvedTransport],
  );

  return <ApiContext.Provider value={value}>{children}</ApiContext.Provider>;
}

export function useApi(): ApiContextValue {
  const ctx = useContext(ApiContext);
  if (!ctx) throw new Error("useApi must be used within an <ApiProvider>.");
  return ctx;
}
