import Constants from "expo-constants";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { AppState } from "react-native";
import { loginResponseSchema, type SessionDTO } from "@mezan/contracts";
import { ApiError, ApiFailure } from "@/api/errors";
import { forgetCachedReads } from "@/api/query-cache";
import { HttpMethod, apiRequest, ScopeAll, type ApiCredentials, type RequestOptions } from "@/api/client";
import { confirmDeviceOwner, deviceCanConfirmOwner } from "./device-lock";
import { clearSession, loadConnection, loadSession, saveConnection, saveSession, type Connection } from "./storage";

const DEFAULT_BASE_URL =
  (Constants.expoConfig?.extra as { apiBaseUrl?: string } | undefined)?.apiBaseUrl ?? "https://demo.mezan.app";

export interface SignInInput {
  readonly baseUrl: string;
  readonly tenantCode: string | null;
  readonly email: string;
  readonly pin: string;
}

export interface SessionState {
  readonly ready: boolean;
  readonly session: SessionDTO | null;
  /** A stored session is present but the device owner has not confirmed it yet — the screens stay covered. */
  readonly locked: boolean;
  readonly unlock: (promptMessage: string, cancelLabel: string) => Promise<boolean>;
  readonly connection: Connection;
  readonly signIn: (input: SignInInput) => Promise<void>;
  readonly signOut: () => Promise<void>;
  readonly request: <T>(path: string, options?: RequestOptions<T>) => Promise<T>;
  readonly can: (permission: string) => boolean;
}

const SessionContext = createContext<SessionState | null>(null);

function scopeHeader(scope: SessionDTO["branchScope"]): string {
  return scope === ScopeAll.Every ? ScopeAll.Every : scope.join(",");
}

export function SessionProvider({ children }: { children: ReactNode }): ReactNode {
  const [ready, setReady] = useState(false);
  const [session, setSession] = useState<SessionDTO | null>(null);
  const [locked, setLocked] = useState(false);
  const sessionRef = useRef<SessionDTO | null>(null);
  sessionRef.current = session;
  const [connection, setConnection] = useState<Connection>({
    baseUrl: DEFAULT_BASE_URL,
    tenantCode: null,
    email: null,
  });

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const [stored, storedConnection] = await Promise.all([loadSession(), loadConnection()]);
      if (cancelled) return;
      const gate = stored !== null && (await deviceCanConfirmOwner());
      if (cancelled) return;
      if (storedConnection) setConnection(storedConnection);
      setSession(stored);
      setLocked(gate);
      setReady(true);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let wasInBackground = false;
    const subscription = AppState.addEventListener("change", (state) => {
      // Only "background" counts: the Face ID sheet and the permission alerts
      // themselves take the app to "inactive", and locking on those would loop.
      if (state === "background") {
        wasInBackground = true;
        return;
      }
      if (state !== "active" || !wasInBackground) return;
      wasInBackground = false;
      if (sessionRef.current === null) return;
      void deviceCanConfirmOwner().then((gate) => {
        if (gate && sessionRef.current !== null) setLocked(true);
      });
    });
    return () => subscription.remove();
  }, []);

  const unlock = useCallback(async (promptMessage: string, cancelLabel: string) => {
    const confirmed = await confirmDeviceOwner(promptMessage, cancelLabel);
    if (confirmed) setLocked(false);
    return confirmed;
  }, []);

  const credentials: ApiCredentials = useMemo(
    () => ({
      baseUrl: connection.baseUrl,
      tenantCode: connection.tenantCode,
      token: session?.token ?? null,
      branchScope: session ? scopeHeader(session.branchScope) : ScopeAll.Every,
      warehouseScope: session ? scopeHeader(session.warehouseScope) : ScopeAll.Every,
    }),
    [connection, session],
  );

  const signOut = useCallback(async () => {
    setSession(null);
    setLocked(false);
    await clearSession();
    await forgetCachedReads();
  }, []);

  const request = useCallback(
    async <T,>(path: string, options?: RequestOptions<T>): Promise<T> => {
      try {
        return await apiRequest<T>(credentials, path, options);
      } catch (error) {
        // A dead token must end the session here, or every screen renders its own sign-in prompt.
        if (error instanceof ApiError && error.failure === ApiFailure.Unauthorized && session) await signOut();
        throw error;
      }
    },
    [credentials, session, signOut],
  );

  const signIn = useCallback(async (input: SignInInput) => {
    const next: Connection = { baseUrl: input.baseUrl, tenantCode: input.tenantCode, email: input.email };
    // Whoever signs in next must never be served the last session's figures.
    await forgetCachedReads();
    const signedIn = await apiRequest(
      {
        baseUrl: next.baseUrl,
        tenantCode: next.tenantCode,
        token: null,
        branchScope: ScopeAll.Every,
        warehouseScope: ScopeAll.Every,
      },
      "/auth/login",
      { method: HttpMethod.Post, body: { username: input.email, pin: input.pin }, schema: loginResponseSchema },
    );
    await saveConnection(next);
    await saveSession(signedIn);
    setConnection(next);
    setSession(signedIn);
    setLocked(false);
  }, []);

  const can = useCallback(
    (permission: string) => {
      if (!session) return false;
      return session.permissions.includes(ScopeAll.Every) || session.permissions.includes(permission);
    },
    [session],
  );

  const value = useMemo<SessionState>(
    () => ({ ready, session, locked, unlock, connection, signIn, signOut, request, can }),
    [ready, session, locked, unlock, connection, signIn, signOut, request, can],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionState {
  const value = useContext(SessionContext);
  if (!value) throw new Error("useSession was called outside <SessionProvider>.");
  return value;
}
