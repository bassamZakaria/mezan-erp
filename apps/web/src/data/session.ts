import type { SessionDTO } from "@mezan/contracts";

export type Session = SessionDTO;

/**
 * Turns the authenticated {@link Session} into the exact headers the API's
 * permission gate reads (`headerAuthContextResolver` in
 * packages/api/src/permission-gate.ts): the user id, the effective permission
 * codes, and the two scope dimensions. Every authenticated API call sends
 * these; without a session, no headers (the gate then sees an anonymous,
 * permission-less context and denies).
 */
export function authHeaders(session: Session | null): Record<string, string> {
  if (!session) return {};
  const scope = (s: SessionDTO["branchScope"]): string => (s === "*" ? "*" : s.join(","));
  return {
    "x-user-id": session.userId,
    "x-permissions": session.permissions.join(","),
    "x-branch-scope": scope(session.branchScope),
    "x-warehouse-scope": scope(session.warehouseScope),
  };
}
