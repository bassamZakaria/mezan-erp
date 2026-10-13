import { createContext, createElement, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { QueryClientContext } from "@tanstack/react-query";
import { createHttpTransport, type Transport, type TransportResponse } from "../data/transport";
import type { AppTranslationKey } from "../i18n";
import { loadPersistedPlatformSession, persistPlatformSession, type PlatformSession } from "./session";

/**
 * The platform console's own door onto the shared Hono app: every path here
 * is relative to `/api/platform`, distinct from the tenant `/api` the rest of
 * `apps/web` talks to. A separate provider rather than a mode on
 * `ApiContext` — the two sessions (tenant operator vs. platform operator) are
 * never the same person signed in twice, and mixing them into one context
 * would let a stray tenant request carry a platform bearer token or vice versa.
 */
export class PlatformApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly code?: string,
  ) {
    super(message);
    this.name = "PlatformApiError";
  }
}

interface PlatformApiContextValue {
  readonly session: PlatformSession | null;
  setSession(session: PlatformSession | null): void;
  endSession(): void;
  request(path: string, init?: RequestInit): Promise<TransportResponse>;
}

const PlatformApiContext = createContext<PlatformApiContextValue | null>(null);

export interface PlatformApiProviderProps {
  readonly children: ReactNode;
  /** Overridable for tests; defaults to HTTP against `/api/platform`. */
  readonly transport?: Transport;
  /** Seed an initial session for tests; omit to restore the last persisted one. */
  readonly initialSession?: PlatformSession | null;
}

export function PlatformApiProvider({ children, transport, initialSession }: PlatformApiProviderProps) {
  const [session, setSessionState] = useState<PlatformSession | null>(() =>
    initialSession !== undefined ? initialSession : loadPersistedPlatformSession(),
  );
  const resolvedTransport = useMemo<Transport>(() => transport ?? createHttpTransport("/api/platform"), [transport]);

  const setSession = useCallback((next: PlatformSession | null) => {
    setSessionState(next);
    persistPlatformSession(next);
  }, []);
  const queryClient = useContext(QueryClientContext);
  const endSession = useCallback(() => {
    queryClient?.clear();
    setSession(null);
  }, [queryClient, setSession]);

  const value = useMemo<PlatformApiContextValue>(
    () => ({
      session,
      setSession,
      endSession,
      async request(path, init) {
        const headers = new Headers(init?.headers);
        if (session) headers.set("authorization", `Bearer ${session.token}`);
        if (init?.body && !headers.has("content-type")) headers.set("content-type", "application/json");
        const response = await resolvedTransport(path, { ...init, headers });
        // A 401 means this bearer token is no longer good — expired, revoked,
        // or the server restarted. The login POST is excluded: a wrong
        // password is a 401 the login screen reports itself, not a session
        // that went stale.
        if (response.status === 401 && session !== null && !path.startsWith("/auth/login")) {
          endSession();
        }
        return response;
      },
    }),
    [session, setSession, endSession, resolvedTransport],
  );

  return createElement(PlatformApiContext.Provider, { value }, children);
}

export function usePlatformApi(): PlatformApiContextValue {
  const ctx = useContext(PlatformApiContext);
  if (!ctx) throw new Error("usePlatformApi must be used within a <PlatformApiProvider>.");
  return ctx;
}

/** Server error codes with no `message` of their own (`VALIDATION_ERROR`'s body only carries `details`) mapped to a catalog string. */
const PLATFORM_ERROR_CODE_KEY: Readonly<Record<string, AppTranslationKey>> = {
  VALIDATION_ERROR: "platform.error.validation",
};

/**
 * Reads a failed response's `{ error, message?, details? }` body into a
 * string that is always a catalog translation, never the bare `error` code —
 * a domain refusal carries its own Arabic `message`; a route-level
 * `VALIDATION_ERROR` (zod) carries only `error` + `details`, so it is looked
 * up by code; anything unrecognised falls back to the caller's own key.
 */
export async function readPlatformErrorMessage(
  res: Pick<TransportResponse, "json">,
  t: (key: AppTranslationKey) => string,
  fallbackKey: AppTranslationKey,
): Promise<string> {
  return (await readPlatformError(res, t, fallbackKey)).message;
}

export async function readPlatformError(
  res: Pick<TransportResponse, "json">,
  t: (key: AppTranslationKey) => string,
  fallbackKey: AppTranslationKey,
): Promise<{ readonly message: string; readonly code: string | undefined }> {
  const body = (await res.json<{ error?: string; message?: string }>().catch(() => ({}))) as {
    error?: string;
    message?: string;
  };
  if (body.message) return { message: body.message, code: body.error };
  const key = body.error ? PLATFORM_ERROR_CODE_KEY[body.error] : undefined;
  return { message: t(key ?? fallbackKey), code: body.error };
}
