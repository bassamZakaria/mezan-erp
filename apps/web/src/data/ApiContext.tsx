import { useQueryClient } from "@tanstack/react-query";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  authHeaders,
  loadPersistedScopeSelection,
  loadPersistedSession,
  markSessionExpired,
  NO_SCOPE_SELECTION,
  persistScopeSelection,
  persistSession,
  type ScopeSelection,
  type Session,
} from "./session";
import { resolveDefaultTransport, type Transport, type TransportResponse } from "./transport";
import { publishLoaderApi } from "./api-bridge";

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

  const queryClient = useQueryClient();

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

  /**
   * The scope rides in the request HEADERS, not in any query key, so nothing
   * cached notices it changed: picking a warehouse relabelled the selector and
   * left every list showing the previous scope's rows until a page reload.
   * Dropping the cache is the honest fix — every cached answer was computed
   * under a scope that no longer applies.
   *
   * In an EFFECT rather than inside the setter: invalidating in the same tick
   * refetches before React has re-rendered, so `request` still closes over the
   * previous selection and the new rows arrive under the OLD scope. Waiting
   * until after the commit is what makes the refetch carry the new headers.
   */
  const firstScopeRender = useRef(true);
  useEffect(() => {
    if (firstScopeRender.current) {
      firstScopeRender.current = false;
      return;
    }
    void queryClient.invalidateQueries();
  }, [scopeSelection, queryClient]);

  const value = useMemo<ApiContextValue>(
    () => ({
      session,
      setSession,
      scopeSelection,
      setScopeSelection,
      async request(path, init) {
        const headers = new Headers(init?.headers);
        // The topbar picker is a VIEW narrowing, not a grant, so it rides on
        // reads only. Write routes enforce warehouse scope as authority (D103),
        // and a transfer names two warehouses — sending the one the reader
        // happened to be looking at would refuse a move the user is entitled
        // to make. The server clamps the header to the session's own grant
        // either way, so omitting it can never widen anything.
        const method = (init?.method ?? "GET").toUpperCase();
        const narrowing = method === "GET" || method === "HEAD" ? scopeSelection : undefined;
        for (const [k, v] of Object.entries(authHeaders(session, narrowing))) headers.set(k, v);
        if (init?.body && !headers.has("content-type")) headers.set("content-type", "application/json");
        const response = await resolvedTransport(path, { ...init, headers });

        /*
         * 401 means the server does not know this session any more — it
         * restarted, the token idled out, or someone signed out elsewhere.
         *
         * Handled HERE because `request` is the one door every call goes
         * through: without it each screen decided for itself, and a list whose
         * query is simply disabled without a session rendered «0 rows» — a
         * number, indistinguishable from a tenant that genuinely has none.
         *
         * 403 is deliberately NOT treated this way: that is a signed-in person
         * meeting a permission they do not hold, and signing them out would be
         * a worse answer than the refusal they should see.
         *
         * The login POST is excluded — a wrong PIN is a 401 the login screen
         * reports itself, not a session that expired.
         */
        if (response.status === 401 && session !== null && !path.startsWith("/auth/login")) {
          markSessionExpired();
          setSession(null);
          // Every cached answer was read as someone who is no longer signed in.
          queryClient.clear();
        }
        return response;
      },
    }),
    [session, setSession, scopeSelection, setScopeSelection, resolvedTransport, queryClient],
  );

  /*
   * Route loaders run outside React and cannot call `useApi`, so the live
   * value is published where they can read it (data/api-bridge.ts).
   *
   * During RENDER, not in an effect: the router may run a loader for the next
   * match before this commit's effects have flushed, and a loader that found
   * no API would either throw on a legitimate navigation or fetch without the
   * session headers. The assignment is idempotent.
   */
  publishLoaderApi({ request: value.request, queryClient, isAuthenticated: session !== null });

  return <ApiContext.Provider value={value}>{children}</ApiContext.Provider>;
}

export function useApi(): ApiContextValue {
  const ctx = useContext(ApiContext);
  if (!ctx) throw new Error("useApi must be used within an <ApiProvider>.");
  return ctx;
}
