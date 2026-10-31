import { createContext, createElement, Fragment, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { CsrfCookie, DEVICE_BINDING_HEADER, DeviceBinding } from "@mezan/contracts";
import { QueryClientContext } from "@tanstack/react-query";
import { createHttpTransport, type Transport, type TransportResponse } from "../data/transport";
import type { AppTranslationKey } from "../i18n";
import { sessionCredential } from "../data/session";
import { serverMessage, type ServerErrorBody } from "../data/server-message";
import { StepUpDialog, type StepUpPrompt } from "../data/StepUpDialog";
import { loadPersistedPlatformSession, persistPlatformSession, type PlatformSession } from "./session";

const SIGN_IN_PATH = "/auth/login";
const SIGN_OUT_PATH = "/auth/logout";
const STEP_UP_PATH = "/auth/step-up";
const STEP_UP_STATUS = 403;
const STEP_UP_REQUIRED = "STEP_UP_REQUIRED";

function errorOf(text: string): ServerErrorBody | null {
  try {
    return JSON.parse(text) as ServerErrorBody;
  } catch {
    return null;
  }
}

// A 403 is read to learn whether it asks for a step-up; any other refusal is
// handed back whole — status, headers and body — as if it had not been read.
function replayable(response: TransportResponse, text: string): TransportResponse {
  return {
    ...response,
    json: async <T,>() => JSON.parse(text) as T,
    text: async () => text,
    blob: async () => new Blob([text], { type: response.header?.("content-type") ?? "" }),
  };
}

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
  const [stepUp, setStepUp] = useState<StepUpPrompt | null>(null);

  const credentialed = useCallback(
    (path: string, init?: RequestInit): RequestInit => {
      const headers = new Headers(init?.headers);
      if (session) for (const [name, value] of Object.entries(sessionCredential(session, CsrfCookie.Platform))) headers.set(name, value);
      if (init?.body && !headers.has("content-type")) headers.set("content-type", "application/json");
      if (path === SIGN_IN_PATH) headers.set(DEVICE_BINDING_HEADER, DeviceBinding.Cookie);
      return { ...init, headers };
    },
    [session],
  );

  const forget = useCallback(() => {
    queryClient?.clear();
    setSession(null);
  }, [queryClient, setSession]);

  const endSession = useCallback(() => {
    // The session lives in HttpOnly cookies the page cannot clear: only the
    // server can end it and expire them.
    void resolvedTransport(SIGN_OUT_PATH, credentialed(SIGN_OUT_PATH, { method: "POST" })).catch(() => undefined);
    forget();
  }, [resolvedTransport, credentialed, forget]);

  const afterStepUp = useCallback(
    async (refused: TransportResponse, resend: () => Promise<TransportResponse>): Promise<TransportResponse> => {
      const text = await refused.text();
      const replayed = replayable(refused, text);
      const body = errorOf(text);
      if (body?.error !== STEP_UP_REQUIRED) return replayed;
      const confirmed = await new Promise<boolean>((resolve) => {
        setStepUp({
          message: serverMessage(body) ?? "",
          cancel: () => resolve(false),
          confirm: async (password) => {
            const answer = await resolvedTransport(STEP_UP_PATH, credentialed(STEP_UP_PATH, { method: "POST", body: JSON.stringify({ password }) }));
            if (answer.ok) {
              resolve(true);
              return null;
            }
            const answerBody = errorOf(await answer.text());
            return (answerBody && serverMessage(answerBody)) ?? "";
          },
        });
      });
      setStepUp(null);
      return confirmed ? resend() : replayed;
    },
    [resolvedTransport, credentialed],
  );

  const value = useMemo<PlatformApiContextValue>(
    () => ({
      session,
      setSession,
      endSession,
      async request(path, init) {
        const send = () => resolvedTransport(path, credentialed(path, init));
        const first = await send();
        const response = first.status === STEP_UP_STATUS && session !== null ? await afterStepUp(first, send) : first;
        // A 401 means this session is no longer good — expired, revoked,
        // or the server restarted. The login POST is excluded: a wrong
        // password is a 401 the login screen reports itself, not a session
        // that went stale.
        if (response.status === 401 && session !== null && !path.startsWith(SIGN_IN_PATH)) {
          forget();
        }
        return response;
      },
    }),
    [session, setSession, endSession, resolvedTransport, credentialed, afterStepUp, forget],
  );

  return createElement(
    PlatformApiContext.Provider,
    { value },
    createElement(Fragment, null, children, stepUp ? createElement(StepUpDialog, { prompt: stepUp }) : null),
  );
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
  const body = (await res.json<ServerErrorBody>().catch(() => ({}))) as ServerErrorBody;
  const message = serverMessage(body);
  if (message) return { message, code: body.error };
  const key = body.error ? PLATFORM_ERROR_CODE_KEY[body.error] : undefined;
  return { message: t(key ?? fallbackKey), code: body.error };
}
