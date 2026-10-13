import { useQueryClient } from "@tanstack/react-query";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  authHeaders,
  loadPersistedScopeSelection,
  loadPersistedSession,
  markSignInNotice,
  NO_SCOPE_SELECTION,
  persistScopeSelection,
  persistSession,
  SignInNotice,
  type ScopeSelection,
  type Session,
} from "./session";
import { resolveDefaultTransport, SessionEndedReason, type Transport, type TransportResponse } from "./transport";
import { publishLoaderApi } from "./api-bridge";
import { DEVICE_BINDING_HEADER } from "@mezan/contracts";
import { StepUpDialog, type StepUpPrompt } from "./StepUpDialog";

const SIGN_IN_PATH = "/auth/login";
const STEP_UP_PATH = "/auth/step-up";
const STEP_UP_STATUS = 403;
const STEP_UP_REQUIRED = "STEP_UP_REQUIRED";
const COOKIE_KEPT_DEVICE_SECRET = "cookie";

function parsed(text: string): { error?: string; message?: string } | null {
  try {
    return JSON.parse(text) as { error?: string; message?: string };
  } catch {
    return null;
  }
}

function replayable(response: TransportResponse, text: string): TransportResponse {
  return { status: response.status, ok: response.ok, json: async <T,>() => JSON.parse(text) as T, text: async () => text };
}

import { branchRefusalBefore, isBranchRestricted } from "../branch-restriction";

const BRANCH_REFUSAL_STATUS = 403;

function locallyRefused(body: unknown): TransportResponse {
  return {
    status: BRANCH_REFUSAL_STATUS,
    ok: false,
    json: <T,>() => Promise.resolve(body as T),
    text: () => Promise.resolve(JSON.stringify(body)),
  };
}

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

  const [stepUp, setStepUp] = useState<StepUpPrompt | null>(null);

  const afterStepUp = useCallback(
    async (refused: TransportResponse, resend: () => Promise<TransportResponse>, headers: Headers): Promise<TransportResponse> => {
      const text = await refused.text();
      const replayed = replayable(refused, text);
      const body = parsed(text);
      if (body?.error !== STEP_UP_REQUIRED) return replayed;
      const confirmed = await new Promise<boolean>((resolve) => {
        setStepUp({
          message: body.message ?? "",
          cancel: () => resolve(false),
          confirm: async (pin) => {
            const answer = await resolvedTransport(STEP_UP_PATH, { method: "POST", headers, body: JSON.stringify({ pin }) });
            if (answer.ok) {
              resolve(true);
              return null;
            }
            return parsed(await answer.text())?.message ?? "";
          },
        });
      });
      setStepUp(null);
      return confirmed ? resend() : replayed;
    },
    [resolvedTransport],
  );

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
        if (path === SIGN_IN_PATH) headers.set(DEVICE_BINDING_HEADER, COOKIE_KEPT_DEVICE_SECRET);
        const refusedByBranchPolicy = isBranchRestricted(session) ? branchRefusalBefore(path, method) : null;
        if (refusedByBranchPolicy) return locallyRefused(refusedByBranchPolicy);
        const send = (): Promise<TransportResponse> => resolvedTransport(path, { ...init, headers });
        const first = await send();
        const response = first.status === STEP_UP_STATUS && session !== null ? await afterStepUp(first, send, headers) : first;

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
          markSignInNotice(response.sessionEnded === SessionEndedReason.Displaced ? SignInNotice.SignedInElsewhere : SignInNotice.SessionExpired);
          setSession(null);
          // Every cached answer was read as someone who is no longer signed in.
          queryClient.clear();
        }
        return response;
      },
    }),
    [session, setSession, scopeSelection, setScopeSelection, resolvedTransport, queryClient, afterStepUp],
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

  return (
    <ApiContext.Provider value={value}>
      {children}
      {stepUp ? <StepUpDialog prompt={stepUp} /> : null}
    </ApiContext.Provider>
  );
}

export function useApi(): ApiContextValue {
  const ctx = useContext(ApiContext);
  if (!ctx) throw new Error("useApi must be used within an <ApiProvider>.");
  return ctx;
}
