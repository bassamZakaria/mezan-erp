import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { Context } from "hono";
import { ALL_SCOPE, createAuthContext, type AuthContext, type ScopeSelection } from "@mezan/domain";
import type { AuthContextResolver } from "./permission-gate.js";

/**
 * Server-held sessions, and the resolver that reads one off a request.
 *
 * WHY THIS EXISTS. Every route used to fall back to `headerAuthContextResolver`,
 * which reads the caller's permissions out of `x-permissions` — so the client
 * asserted its own authority and the answer was always yes. On the desktop
 * edition that is merely wrong; on the LAN mount, which binds 0.0.0.0 so tills
 * and tablets can reach it, any device on the shop wifi could send
 * `x-permissions: *` and act as a tenant admin against the real books, with no
 * credential. No other control in this codebase survives that, so nothing else
 * is worth hardening until this is closed.
 *
 * The token is opaque and high-entropy; only its SHA-256 is kept, so a dump of
 * process memory or of a future persisted table does not hand over live
 * sessions. SHA-256 (not scrypt) is deliberate: the token is 256 random bits,
 * not a human-chosen secret, so there is nothing to brute-force and this runs
 * on every request.
 */

/** How long a session stays valid without being used. A shop laptop is left logged in all day. */
const IDLE_TIMEOUT_MS = 12 * 60 * 60 * 1000;

export interface SessionGrant {
  readonly userId: string;
  /** Resolved at login from the user's role — never from anything the client sends. */
  readonly permissions: readonly string[];
  readonly roleCode: string | null;
  readonly branchScope: ScopeSelection;
  readonly warehouseScope: ScopeSelection;
}

interface StoredSession extends SessionGrant {
  lastSeenAt: number;
}

export interface SessionRegistry {
  /** Mints a token for a grant resolved server-side. The plaintext is returned once. */
  issue(grant: SessionGrant): string;
  find(token: string): SessionGrant | null;
  revoke(token: string): void;
  revokeUser(userId: string): void;
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function createSessionRegistry(now: () => number = Date.now): SessionRegistry {
  const byHash = new Map<string, StoredSession>();

  function sweep(at: number) {
    for (const [key, session] of byHash) {
      if (at - session.lastSeenAt > IDLE_TIMEOUT_MS) byHash.delete(key);
    }
  }

  return {
    issue(grant) {
      const at = now();
      sweep(at);
      const token = randomBytes(32).toString("base64url");
      byHash.set(hashToken(token), { ...grant, lastSeenAt: at });
      return token;
    },
    find(token) {
      const at = now();
      const session = byHash.get(hashToken(token));
      if (!session) return null;
      if (at - session.lastSeenAt > IDLE_TIMEOUT_MS) {
        byHash.delete(hashToken(token));
        return null;
      }
      session.lastSeenAt = at;
      return session;
    },
    revoke(token) {
      byHash.delete(hashToken(token));
    },
    revokeUser(userId) {
      for (const [key, session] of byHash) {
        if (session.userId === userId) byHash.delete(key);
      }
    },
  };
}

/** `Authorization: Bearer <token>`, or the header the desktop IPC bridge uses. */
export function readSessionToken(c: Context): string | null {
  const authorization = c.req.header("authorization");
  if (authorization) {
    const [scheme, value] = authorization.split(" ");
    if (scheme?.toLowerCase() === "bearer" && value) return value;
  }
  return c.req.header("x-session-token") ?? null;
}

/**
 * The scope the caller may act in.
 *
 * A client MAY narrow its own scope — that is the branch/warehouse switcher in
 * the shell, and the request carries it. It may never WIDEN it: the granted
 * scope comes from the session, and a requested id outside the grant is
 * dropped rather than honoured. This is the same rule the return-quantity
 * defect taught — a limit the caller supplies is not a limit.
 */
function narrowScope(granted: ScopeSelection, requested: string | undefined): ScopeSelection {
  if (!requested || requested === "*") return granted;
  const asked = requested
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);
  if (asked.length === 0) return granted;
  if (granted === ALL_SCOPE) return asked;
  const allowed = asked.filter((id) => granted.includes(id));
  return allowed.length > 0 ? allowed : granted;
}

const ANONYMOUS: AuthContext = createAuthContext({
  userId: "anonymous",
  permissions: [],
  branchScope: [],
  warehouseScope: [],
});

/**
 * Resolves the caller from the session registry. A request with no valid token
 * gets an AuthContext holding NO permissions, so every gated route answers 403
 * — never the permissive default the header resolver produced.
 */
export function createSessionAuthContextResolver(sessions: SessionRegistry): AuthContextResolver {
  return function resolveAuthContext(c: Context): AuthContext {
    const token = readSessionToken(c);
    if (!token) return ANONYMOUS;
    const grant = sessions.find(token);
    if (!grant) return ANONYMOUS;
    return createAuthContext({
      userId: grant.userId,
      permissions: [...grant.permissions],
      roleCodes: grant.roleCode ? [grant.roleCode] : [],
      branchScope: narrowScope(grant.branchScope, c.req.header("x-branch-scope")),
      warehouseScope: narrowScope(grant.warehouseScope, c.req.header("x-warehouse-scope")),
    });
  };
}

/** Constant-time compare for a caller-supplied token against a known one. */
export function tokensMatch(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}
