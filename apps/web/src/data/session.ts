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
 */
export function authHeaders(session: Session | null, selection?: ScopeSelection): Record<string, string> {
  if (!session) return {};
  const scope = (s: SessionDTO["branchScope"]): string => (s === "*" ? "*" : s.join(","));
  const inScope = (s: SessionDTO["branchScope"], id: string): boolean => s === "*" || s.includes(id);
  const branchScope =
    selection?.branchId && inScope(session.branchScope, selection.branchId) ? selection.branchId : scope(session.branchScope);
  const warehouseScope =
    selection?.warehouseId && inScope(session.warehouseScope, selection.warehouseId)
      ? selection.warehouseId
      : scope(session.warehouseScope);
  return {
    "x-user-id": session.userId,
    "x-permissions": session.permissions.join(","),
    "x-branch-scope": branchScope,
    "x-warehouse-scope": warehouseScope,
  };
}
