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

/**
 * Turns the authenticated {@link Session} into the exact headers the API's
 * permission gate reads (`headerAuthContextResolver` in
 * packages/api/src/permission-gate.ts): the user id, the effective permission
 * codes, and the two scope dimensions. Every authenticated API call sends
 * these; without a session, no headers (the gate then sees an anonymous,
 * permission-less context and denies).
 *
 * `x-role-code` is separate from `x-permissions`: the workflow gate's steps
 * assign an approver ROLE (see `/workflow` routes' `actorRoles`), not a
 * permission code, so it isn't folded into the resolved permission set.
 */
export function authHeaders(session: Session | null): Record<string, string> {
  if (!session) return {};
  const scope = (s: SessionDTO["branchScope"]): string => (s === "*" ? "*" : s.join(","));
  return {
    "x-user-id": session.userId,
    "x-permissions": session.permissions.join(","),
    "x-role-code": session.roleCode ?? "",
    "x-branch-scope": scope(session.branchScope),
    "x-warehouse-scope": scope(session.warehouseScope),
  };
}
