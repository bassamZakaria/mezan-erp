import { sessionSchema, type SessionDTO } from "@mezan/contracts";

export type Session = SessionDTO;

const SESSION_STORAGE_KEY = "mezan.session";

function getSessionStorage(): Storage | null {
  try {
    return typeof window !== "undefined" ? window.localStorage : null;
  } catch {
    // Privacy mode / disabled storage can throw on access rather than just being absent.
    return null;
  }
}

/**
 * Restores the last persisted session on load, so a page refresh doesn't
 * force-log-out the user. Validated against {@link sessionSchema} — a
 * missing, corrupt, or stale-shaped stored value is treated as no session.
 */
export function loadPersistedSession(): Session | null {
  const storage = getSessionStorage();
  if (!storage) return null;
  const raw = storage.getItem(SESSION_STORAGE_KEY);
  if (!raw) return null;
  try {
    const parsed = sessionSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/** Persists the session (or, for `null` — e.g. on logout — clears it) so it survives a page refresh. */
export function persistSession(session: Session | null): void {
  const storage = getSessionStorage();
  if (!storage) return;
  if (session) storage.setItem(SESSION_STORAGE_KEY, JSON.stringify(session));
  else storage.removeItem(SESSION_STORAGE_KEY);
}

/** The topbar's working-branch / warehouse selector (data/hub-hooks.ts) — a further narrowing WITHIN the session's own scope, never wider than it. `null` means "no narrowing beyond the session scope". */
export interface ScopeSelection {
  readonly branchId: string | null;
  readonly warehouseId: string | null;
}

/**
 * Set when the server rejected a request because it no longer knows the
 * session, and read once by the login screen so the person is told WHY they
 * are being asked to sign in again.
 *
 * In sessionStorage rather than a module variable: the commonest way to meet a
 * dead token is to RELOAD a tab that was left open, and a module variable is
 * already gone by the time the login screen renders — the person would be
 * bounced to sign-in with no explanation, which is the exact case this exists
 * for. Per tab, and gone when the tab closes: the lifetime of the fact.
 */
const SESSION_EXPIRED_KEY = "mezan.sessionExpired";

function getTabStorage(): Storage | null {
  try {
    return typeof window !== "undefined" ? window.sessionStorage : null;
  } catch {
    return null;
  }
}

export function markSessionExpired(): void {
  getTabStorage()?.setItem(SESSION_EXPIRED_KEY, "1");
}

/**
 * Reading and clearing are SEPARATE on purpose.
 *
 * A single `consume()` in a `useState` initializer looks tidy and is wrong:
 * StrictMode invokes an initializer twice in development, so the first call
 * cleared the flag and the second returned false — and false is the value
 * React keeps. The notice never rendered. A pure read is safe to repeat; the
 * clear belongs in an effect, where running twice is also harmless.
 */
export function sessionExpiredPending(): boolean {
  return getTabStorage()?.getItem(SESSION_EXPIRED_KEY) === "1";
}

/** Clears the flag so the notice shows once, not on every later visit. */
export function clearSessionExpired(): void {
  getTabStorage()?.removeItem(SESSION_EXPIRED_KEY);
}

export const NO_SCOPE_SELECTION: ScopeSelection = { branchId: null, warehouseId: null };

const SCOPE_SELECTION_STORAGE_KEY = "mezan.scopeSelection";

/** Restores the last selected working branch/warehouse so a reload doesn't reset the topbar selector. */
export function loadPersistedScopeSelection(): ScopeSelection {
  const storage = getSessionStorage();
  if (!storage) return NO_SCOPE_SELECTION;
  const raw = storage.getItem(SCOPE_SELECTION_STORAGE_KEY);
  if (!raw) return NO_SCOPE_SELECTION;
  try {
    const parsed = JSON.parse(raw) as Partial<ScopeSelection>;
    return {
      branchId: typeof parsed.branchId === "string" ? parsed.branchId : null,
      warehouseId: typeof parsed.warehouseId === "string" ? parsed.warehouseId : null,
    };
  } catch {
    return NO_SCOPE_SELECTION;
  }
}

/** Persists the topbar's working-branch/warehouse selection so it survives a page refresh. */
export function persistScopeSelection(selection: ScopeSelection): void {
  const storage = getSessionStorage();
  if (!storage) return;
  storage.setItem(SCOPE_SELECTION_STORAGE_KEY, JSON.stringify(selection));
}

const TENANT_CODE_STORAGE_KEY = "mezan.tenantCode";

/** Persists the SaaS company code, lower-cased, so `authHeaders` can send it as `x-mezan-tenant`. */
export function persistTenantCode(code: string): void {
  const storage = getSessionStorage();
  if (!storage) return;
  storage.setItem(TENANT_CODE_STORAGE_KEY, code.trim().toLowerCase());
}

/** The last persisted company code, or `null` when none is stored (subdomain deployments never need one). */
export function loadTenantCode(): string | null {
  const storage = getSessionStorage();
  if (!storage) return null;
  return storage.getItem(TENANT_CODE_STORAGE_KEY);
}

/** Clears the stored company code — the «تغيير المنشأة» action. */
export function clearTenantCode(): void {
  const storage = getSessionStorage();
  if (!storage) return;
  storage.removeItem(TENANT_CODE_STORAGE_KEY);
}

/**
 * Turns the authenticated {@link Session} into the exact headers the API's
 * permission gate reads (`headerAuthContextResolver` in
 * packages/api/src/permission-gate.ts): the user id, the effective permission
 * codes, and the two scope dimensions. Every authenticated API call sends
 * these; without a session, no headers (the gate then sees an anonymous,
 * permission-less context and denies).
 *
 * `selection` (the topbar's working-branch/warehouse picker) narrows the
 * scope headers to the ONE chosen branch/warehouse instead of the session's
 * full granted set — it can only narrow, never widen: a selection outside the
 * session's own scope is ignored and the full session scope is sent instead.
 *
 * `x-role-code` is separate from `x-permissions`: the workflow gate's steps
 * assign an approver ROLE (see `/workflow` routes' `actorRoles`), not a
 * permission code, so it isn't folded into the resolved permission set.
 */
export function authHeaders(session: Session | null, selection?: ScopeSelection): Record<string, string> {
  const tenantCode = loadTenantCode();
  const tenantHeaders: Record<string, string> = tenantCode ? { "x-mezan-tenant": tenantCode } : {};
  if (!session) return tenantHeaders;
  const scope = (s: SessionDTO["branchScope"]): string => (s === "*" ? "*" : s.join(","));
  const inScope = (s: SessionDTO["branchScope"], id: string): boolean => s === "*" || s.includes(id);
  const branchScope =
    selection?.branchId && inScope(session.branchScope, selection.branchId) ? selection.branchId : scope(session.branchScope);
  const warehouseScope =
    selection?.warehouseId && inScope(session.warehouseScope, selection.warehouseId)
      ? selection.warehouseId
      : scope(session.warehouseScope);
  return {
    ...tenantHeaders,
    // The token IS the identity. `x-permissions`, `x-user-id` and `x-role-code`
    // used to travel here and the server believed them, so the client decided
    // what it was allowed to do — on the LAN mount, from any device on the shop
    // wifi. The scope headers stay because they are a NARROWING the user chose
    // in the topbar; the server clamps them to the session's own grant and can
    // never be widened by them.
    authorization: `Bearer ${session.token}`,
    "x-branch-scope": branchScope,
    "x-warehouse-scope": warehouseScope,
  };
}
