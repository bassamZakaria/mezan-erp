import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { isIP } from "node:net";
import type { Context, MiddlewareHandler } from "hono";
import {
  ALL_SCOPE,
  createAuthContext,
  recordSecurityEventOrFallback,
  type AuditSink,
  type AuthContext,
  type ScopeSelection,
} from "@mezan/domain";
import { DEVICE_BINDING_HEADER, DEVICE_SECRET_HEADER } from "@mezan/contracts";
import type { AuthContextResolver } from "./permission-gate.js";
import { requestOrigin } from "./request-origin.js";
import { markSessionDisplaced } from "./session-ended.js";

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

/**
 * How long a session may live AT ALL, however busy it is.
 *
 * `lastSeenAt` is refreshed on every `find()`, so before this constant existed
 * a token that was used was immortal: the twelve-hour idle timeout only ever
 * fired on a session nobody was using, which is precisely the session nobody
 * needs bounded. A token lifted from a till and then polled once an hour never
 * expired at any point in its life.
 *
 * Sixteen hours, because the cost of the cap is paid by a real cashier. An
 * Egyptian shop's longest honest span at one till — opened before the doors at
 * 09:00, last customer near 01:00 — is under sixteen hours, so the cap lands
 * between shifts rather than mid-sale, and the re-login it forces is six digits
 * at the start of a day the till was going to be unlocked for anyway. Anything
 * near a working day (8h, 12h) signs the counter out while it is selling, which
 * is how a security control gets disabled by the people it protects.
 *
 * It is deliberately NOT a substitute for revocation: `revokeUser` still ends a
 * deactivated user's sessions immediately. This bounds the token nobody knows
 * to revoke.
 */
export const MAX_SESSION_MS = 16 * 60 * 60 * 1000;

// SECURITY: a bearer token presented without its device secret is refused every
// time, but the session it names ends only on the fifth such refusal inside ten
// minutes. Ending it on the first would let anyone holding a leaked token — and
// nothing else — sign the real holder out at will.
export const DEVICE_MISMATCH_LIMIT = 5;
export const DEVICE_MISMATCH_WINDOW_MS = 10 * 60 * 1000;

export interface SessionGrant {
  readonly userId: string;
  /** Resolved at login from the user's role — never from anything the client sends. */
  readonly permissions: readonly string[];
  readonly roleCode: string | null;
  readonly branchScope: ScopeSelection;
  readonly warehouseScope: ScopeSelection;
}

export interface StoredSession extends SessionGrant {
  /** For {@link MAX_SESSION_MS}. Never moves — that is the whole point of it. */
  readonly issuedAt: number;
  /** Canonical form of where `issue()` was called from; null is the in-process mount. */
  readonly issuedFrom: string | null;
  readonly deviceHash: string | null;
  readonly lastOrigin: string | null;
  readonly movedSincePin: boolean;
  readonly lastSeenAt: number;
  readonly deviceMismatches: readonly number[];
  readonly idleMs: number;
  readonly maxMs: number;
}

export enum SessionRefusalKind {
  Idle = "idle",
  Aged = "aged",
  Moved = "moved",
  Device = "device",
  Displaced = "displaced",
}

export const DISPLACED_SESSIONS_REMEMBERED = 1000;

export interface DisplacedSession {
  readonly userId: string;
  readonly issuedFrom: string | null;
  readonly at: number;
}

/**
 * Where sessions are held, keyed by the SHA-256 of the token — never the token.
 *
 * CONTRACT: `atomically` runs its body as one read-modify-write across every
 * process that shares the store. The registry reads outside it and repeats the
 * read inside it before any write, so a device-mismatch count, a revocation or
 * a displacement on one server instance is what the next instance sees.
 */
export interface SessionStore {
  /** How stale a stored `lastSeenAt` may be before a lookup rewrites it. */
  readonly lastSeenWriteIntervalMs: number;
  atomically<T>(work: () => T): T;
  get(key: string): StoredSession | null;
  put(key: string, session: StoredSession): void;
  remove(key: string): void;
  removeUser(userId: string): void;
  onDevice(deviceHash: string): ReadonlyArray<readonly [string, StoredSession]>;
  displaced(key: string): DisplacedSession | null;
  /** Bounded to {@link DISPLACED_SESSIONS_REMEMBERED}, oldest dropped first. */
  rememberDisplaced(key: string, ended: DisplacedSession): void;
  forgetDisplaced(key: string): void;
  sweep(at: number, displacedForMs: number): void;
}

function expiredAt(session: StoredSession, at: number, limits: SessionLimits): SessionRefusalKind | null {
  if (at - session.lastSeenAt > Math.min(session.idleMs, limits.idleMs)) return SessionRefusalKind.Idle;
  if (at - session.issuedAt > Math.min(session.maxMs, limits.maxMs)) return SessionRefusalKind.Aged;
  return null;
}

export function createMemorySessionStore(): SessionStore {
  const byHash = new Map<string, StoredSession>();
  // SECURITY: a record that a session ENDED, kept only so its holder can be
  // told why. It grants nothing, is bounded, and is forgotten after the idle
  // window; it is written only by another user's verified sign-in on the same
  // device, never by a revoke, a sign-out or anything a caller sends.
  const displaced = new Map<string, DisplacedSession>();
  return {
    lastSeenWriteIntervalMs: 0,
    atomically: (work) => work(),
    get: (key) => byHash.get(key) ?? null,
    put: (key, session) => void byHash.set(key, session),
    remove: (key) => void byHash.delete(key),
    removeUser(userId) {
      for (const [key, session] of byHash) if (session.userId === userId) byHash.delete(key);
    },
    onDevice: (deviceHash) => [...byHash].filter(([, session]) => session.deviceHash !== null && tokensMatch(session.deviceHash, deviceHash)),
    displaced: (key) => displaced.get(key) ?? null,
    rememberDisplaced(key, ended) {
      displaced.delete(key);
      displaced.set(key, ended);
      while (displaced.size > DISPLACED_SESSIONS_REMEMBERED) {
        const oldest = displaced.keys().next();
        if (oldest.done) break;
        displaced.delete(oldest.value);
      }
    },
    forgetDisplaced: (key) => void displaced.delete(key),
    sweep(at, displacedForMs) {
      for (const [key, session] of byHash) {
        if (expiredAt(session, at, session)) byHash.delete(key);
      }
      for (const [key, ended] of displaced) {
        if (at - ended.at > displacedForMs) displaced.delete(key);
      }
    },
  };
}

export interface SessionAddressChange {
  readonly userId: string;
  readonly from: string;
  readonly to: string;
}

export interface DeviceBoundSession {
  readonly token: string;
  readonly deviceSecret: string;
}

export { DEVICE_BINDING_HEADER, DEVICE_SECRET_HEADER };

export interface SessionRefusal {
  readonly reason: SessionRefusalKind;
  readonly sessionEnded: boolean;
  readonly userId: string;
  /** `"host"` for the in-process mount — a fact, not a missing value. */
  readonly issuedFrom: string;
  readonly presentedFrom: string;
}

export interface SessionLookup {
  readonly grant: SessionGrant | null;
  /** Null when the token was simply never issued, or was already revoked. */
  readonly refusal: SessionRefusal | null;
  readonly addressChange?: SessionAddressChange | null;
}

export interface SessionRegistry {
  /**
   * Mints a token for a grant resolved server-side. The plaintext is returned
   * once.
   *
   * `origin` BINDS the session: see {@link createSessionRegistry}. It defaults
   * to null — the in-process mount — so a caller that forgets it binds to the
   * host, and a network client presenting that token is refused. The default
   * therefore fails closed; supplying a caller-controlled value would not.
   */
  issue(grant: SessionGrant, origin?: string | null): string;
  // SECURITY: a session bound to a secret held by the device that signed in,
  // for a client whose address legitimately changes (a phone between networks).
  // The bearer token alone is then worth nothing: presented without the secret
  // it is refused and the session ends. The secret is a second factor of the
  // SESSION, never a credential on its own — every request still needs the
  // bearer token, so a browser that held it in a cookie would gain no
  // cross-site request surface from it.
  issueDeviceBound(grant: SessionGrant, origin?: string | null, heldSecret?: string | null): DeviceBoundSession;
  needsStepUp(token: string): boolean;
  confirmStepUp(token: string): void;
  find(token: string, origin?: string | null, device?: string | null): SessionGrant | null;
  /** Same lookup as {@link find}, but says WHY when it refuses. */
  inspect(token: string, origin?: string | null, device?: string | null): SessionLookup;
  revoke(token: string): void;
  revokeUser(userId: string): void;
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/**
 * Expands any legal IPv6 text form to its 16 bytes, or null when it is not one.
 *
 * Same job as the function of this name in @mezan/backend's
 * the outbound transport that used to live in packages/backend — kept here
 * rather than shared because this package may
 * not depend on that one — and its comment's lesson applies verbatim:
 * `::ffff:127.0.0.1`, `::ffff:7f00:1` and `0:0:0:0:0:ffff:7f00:1` are ONE
 * address, and every version of that check which pattern-matched spellings
 * missed a spelling.
 *
 * A DOTTED TAIL IS REWRITTEN TO ITS TWO HEX GROUPS rather than counted
 * separately, so `::` fills against a group count that is always eight. Counting
 * the tail apart from the placeholder that stands in for it in the text is how
 * `::ffff:192.168.1.5` ends up eighteen bytes long and unparseable — which,
 * over there merely over-blocked an outbound destination, and here would have
 * dropped a dual-stack till back to comparing raw strings.
 */
function ipv6Bytes(text: string): number[] | null {
  if (isIP(text) !== 6) return null;
  let head = text;
  const lastColon = head.lastIndexOf(":");
  const maybeV4 = head.slice(lastColon + 1);
  if (maybeV4.includes(".")) {
    if (isIP(maybeV4) !== 4) return null;
    const quad = maybeV4.split(".").map(Number) as [number, number, number, number];
    const high = ((quad[0] << 8) | quad[1]).toString(16);
    const low = ((quad[2] << 8) | quad[3]).toString(16);
    head = `${head.slice(0, lastColon + 1)}${high}:${low}`;
  }
  const [left, right] = head.includes("::") ? head.split("::") : [head, null];
  const leftGroups = left && left.length > 0 ? left.split(":") : [];
  const rightGroups = right && right.length > 0 ? right.split(":") : [];
  const fill = 8 - leftGroups.length - rightGroups.length;
  if (right === null && fill !== 0) return null;
  if (fill < 0) return null;
  const groups = [...leftGroups, ...Array<string>(fill).fill("0"), ...rightGroups];
  const bytes: number[] = [];
  for (const group of groups) {
    const value = parseInt(group, 16);
    if (Number.isNaN(value) || value < 0 || value > 0xffff) return null;
    bytes.push((value >> 8) & 0xff, value & 0xff);
  }
  return bytes.length === 16 ? bytes : null;
}

/**
 * The form two origins are compared in.
 *
 * A till binds one spelling and presents another otherwise. Node hands back
 * `::ffff:192.168.1.5` on a dual-stack listener and `192.168.1.5` on an IPv4
 * one; a link-local address arrives with a `%en0` zone the peer never chose;
 * `fe80::1` and `fe80:0:0:0:0:0:0:1` are the same machine. Compared raw, the
 * till would bind at login and be signed out on its next request — which is how
 * a binding check gets weakened to a warning and then to nothing.
 *
 * TWO INVARIANTS, both load-bearing:
 *   - null means THIS PROCESS (the desktop IPC mount) and nothing else. A
 *     non-null address must never canonicalise to null, or anything that can
 *     reach the socket could present a host-issued token.
 *   - anything that is not a parseable address is compared VERBATIM rather than
 *     normalised away. An unrecognised form must fail to match, not match
 *     loosely.
 */
export function canonicalOrigin(raw: string | null): string | null {
  if (raw === null) return null;
  const bare = (raw.trim().replace(/^\[/, "").replace(/\]$/, "").split("%")[0] ?? "").toLowerCase();
  if (bare === "") return raw;
  const kind = isIP(bare);
  if (kind !== 6) return bare;
  const bytes = ipv6Bytes(bare);
  if (!bytes) return bare;
  const firstTenZero = bytes.slice(0, 10).every((b) => b === 0);
  if (firstTenZero && bytes[10] === 0xff && bytes[11] === 0xff) {
    return `${bytes[12]}.${bytes[13]}.${bytes[14]}.${bytes[15]}`;
  }
  return bytes.map((b) => b.toString(16).padStart(2, "0")).join(":");
}

/** How an origin is named in an audit row and a refusal. */
function originLabel(origin: string | null): string {
  return origin ?? "host";
}

/**
 * Server-held sessions, BOUND to where they were issued.
 *
 * WHY THE BINDING. A `SessionGrant` used to name a user and nothing else, so a
 * token lifted from a till — read out of its storage, or taken off a machine
 * that was compromised — worked from any device on the shop wifi, as that user,
 * for at least twelve hours. TLS on the LAN socket ended passive sniffing; it
 * does nothing about a token that has already left the building. The origin
 * comes from the socket (./request-origin.ts), never a header, so the thing
 * being matched is not something the presenter can choose.
 *
 * THE MISMATCH RULE IS REVOKE, NEVER RE-BIND. A till's address can legitimately
 * change — a DHCP lease that expired while the machine was off, a move to a
 * different AP — and on that change the session ends and the cashier signs in
 * again. The alternative, quietly re-binding to whatever address turned up, is
 * arithmetically identical to not binding at all: the first request from the
 * thief re-binds the session to the thief. A re-login is six digits; the
 * silent re-bind is the defect this exists to close. (In practice a renewal of
 * a live lease keeps the same address, so the case that costs a login is the
 * one where the till was off the network long enough to have idled out anyway.)
 *
 * A HOST-ISSUED SESSION IS BOUND TO THE HOST, not to "anywhere". Null is one
 * specific origin — the in-process mount — and matches only null, so a token
 * minted over IPC is refused the moment it appears on the wire.
 */
export interface SessionLimits {
  readonly idleMs: number;
  readonly maxMs: number;
}

export const DEFAULT_SESSION_LIMITS: SessionLimits = { idleMs: IDLE_TIMEOUT_MS, maxMs: MAX_SESSION_MS };

interface Evaluation {
  readonly lookup: SessionLookup;
  /** undefined leaves the stored session alone, null ends it, a session replaces it. */
  readonly write?: StoredSession | null;
}

export function createSessionRegistry(
  now: () => number = Date.now,
  limits: SessionLimits = DEFAULT_SESSION_LIMITS,
  store: SessionStore = createMemorySessionStore(),
): SessionRegistry {
  function open(grant: SessionGrant, origin: string | null, deviceHash: string | null, at: number): string {
    const token = randomBytes(32).toString("base64url");
    const from = canonicalOrigin(origin);
    store.put(hashToken(token), {
      userId: grant.userId,
      permissions: [...grant.permissions],
      roleCode: grant.roleCode,
      branchScope: grant.branchScope,
      warehouseScope: grant.warehouseScope,
      issuedAt: at,
      issuedFrom: from,
      deviceHash,
      lastOrigin: from,
      movedSincePin: false,
      lastSeenAt: at,
      deviceMismatches: [],
      idleMs: limits.idleMs,
      maxMs: limits.maxMs,
    });
    return token;
  }

  const expired = (session: StoredSession, at: number) => expiredAt(session, at, limits);

  function seen(session: StoredSession, at: number): StoredSession | undefined {
    return at - session.lastSeenAt >= store.lastSeenWriteIntervalMs ? { ...session, lastSeenAt: at } : undefined;
  }

  function evaluate(key: string, at: number, presented: string | null, device: string | null): Evaluation {
    const session = store.get(key);
    if (!session) {
      const ended = store.displaced(key);
      if (!ended || at - ended.at > limits.idleMs) return { lookup: { grant: null, refusal: null } };
      return {
        lookup: {
          grant: null,
          refusal: { reason: SessionRefusalKind.Displaced, sessionEnded: true, userId: ended.userId, issuedFrom: originLabel(ended.issuedFrom), presentedFrom: originLabel(presented) },
        },
      };
    }

    if (session.deviceHash !== null) {
      const held = device !== null && device !== "" && tokensMatch(hashToken(device), session.deviceHash);
      const from = { userId: session.userId, issuedFrom: originLabel(session.issuedFrom), presentedFrom: originLabel(presented) };
      if (!held) {
        const deviceMismatches = [...session.deviceMismatches.filter((refusedAt) => at - refusedAt < DEVICE_MISMATCH_WINDOW_MS), at];
        const sessionEnded = deviceMismatches.length >= DEVICE_MISMATCH_LIMIT;
        return {
          lookup: { grant: null, refusal: { reason: SessionRefusalKind.Device, sessionEnded, ...from } },
          write: sessionEnded ? null : { ...session, deviceMismatches },
        };
      }
      const reason = expired(session, at);
      if (reason) return { lookup: { grant: null, refusal: { reason, sessionEnded: true, ...from } }, write: null };
      if (presented === session.lastOrigin) return { lookup: { grant: session, refusal: null }, write: seen(session, at) };
      const addressChange = { userId: session.userId, from: originLabel(session.lastOrigin), to: originLabel(presented) };
      const moved = { ...session, lastSeenAt: at, lastOrigin: presented, movedSincePin: true };
      return { lookup: { grant: moved, refusal: null, addressChange }, write: moved };
    }
    // ORIGIN BEFORE EXPIRY, deliberately. A token presented from a second
    // address is the signal an auditor wants whether or not it had also aged
    // out, and reporting "idle" for it would file a theft as housekeeping.
    const reason: SessionRefusalKind | null = presented !== session.issuedFrom ? SessionRefusalKind.Moved : expired(session, at);
    if (reason) {
      return {
        lookup: {
          grant: null,
          refusal: { reason, sessionEnded: true, userId: session.userId, issuedFrom: originLabel(session.issuedFrom), presentedFrom: originLabel(presented) },
        },
        write: null,
      };
    }
    return { lookup: { grant: session, refusal: null }, write: seen(session, at) };
  }

  const registry: SessionRegistry = {
    issue(grant, origin = null) {
      const at = now();
      return store.atomically(() => {
        store.sweep(at, limits.idleMs);
        return open(grant, origin, null, at);
      });
    },
    issueDeviceBound(grant, origin = null, heldSecret = null) {
      const at = now();
      return store.atomically(() => {
        store.sweep(at, limits.idleMs);
        // SECURITY: a secret the caller presents is adopted only when a LIVE
        // session of the SAME user was issued with it. Anything else — a value
        // the server never issued, or another user's secret planted on this
        // device — is discarded for a fresh one, so a sign-in can never be bound
        // to a secret somebody else chose. Adopting it ends that user's earlier
        // sessions on the device: the cookie that held their token is being
        // overwritten, so nothing legitimate presents it again.
        if (heldSecret) {
          const heldHash = hashToken(heldSecret);
          const onThisDevice = store.onDevice(heldHash).filter(([, session]) => !expired(session, at));
          const mine = onThisDevice.filter(([, session]) => session.userId === grant.userId);
          if (mine.length > 0) {
            for (const [key] of mine) store.remove(key);
            return { token: open(grant, origin, heldHash, at), deviceSecret: heldSecret };
          }
          for (const [key, session] of onThisDevice) {
            store.remove(key);
            store.rememberDisplaced(key, { userId: session.userId, issuedFrom: session.issuedFrom, at });
          }
        }
        const deviceSecret = randomBytes(32).toString("base64url");
        return { token: open(grant, origin, hashToken(deviceSecret), at), deviceSecret };
      });
    },
    needsStepUp(token) {
      return store.get(hashToken(token))?.movedSincePin === true;
    },
    confirmStepUp(token) {
      const key = hashToken(token);
      store.atomically(() => {
        const session = store.get(key);
        if (session?.movedSincePin) store.put(key, { ...session, movedSincePin: false });
      });
    },
    inspect(token, origin = null, device = null) {
      const at = now();
      const key = hashToken(token);
      const presented = canonicalOrigin(origin);
      const first = evaluate(key, at, presented, device);
      if (first.write === undefined) return first.lookup;
      // SECURITY: on a shared tenant connection this write can land inside
      // another request's open transaction and be rolled back with it. Nothing
      // depends on it surviving: every lookup re-applies expiry, origin and
      // device checks, so an ended session that came back is ended again on
      // its next presentation.
      return store.atomically(() => {
        const settled = evaluate(key, at, presented, device);
        if (settled.write === null) store.remove(key);
        else if (settled.write !== undefined) store.put(key, settled.write);
        return settled.lookup;
      });
    },
    find(token, origin = null, device = null) {
      return registry.inspect(token, origin, device).grant;
    },
    revoke(token) {
      const key = hashToken(token);
      store.atomically(() => {
        store.remove(key);
        store.forgetDisplaced(key);
      });
    },
    revokeUser(userId) {
      store.removeUser(userId);
    },
  };

  return registry;
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

const lookedUp = new WeakMap<SessionRegistry, WeakMap<Context, SessionLookup>>();

// ONE lookup per request, shared by everything that asks who the caller is. A
// lookup that refuses a moved token also revokes it, so a second lookup on the
// same request finds nothing and has nothing to say: whichever middleware
// asked first would swallow the refusal the forensic row is written from.
// Keyed by the context, not the Request: the body limit replaces `c.req.raw`
// when a body arrives with no declared length.
function sessionLookup(sessions: SessionRegistry, c: Context, token: string): SessionLookup {
  let perRequest = lookedUp.get(sessions);
  if (!perRequest) {
    perRequest = new WeakMap();
    lookedUp.set(sessions, perRequest);
  }
  let lookup = perRequest.get(c);
  if (!lookup) {
    lookup = sessions.inspect(token, requestOrigin(c), c.req.header(DEVICE_SECRET_HEADER) ?? null);
    perRequest.set(c, lookup);
  }
  return lookup;
}

const ANONYMOUS: AuthContext = createAuthContext({
  userId: "anonymous",
  permissions: [],
  branchScope: [],
  warehouseScope: [],
  // Nobody. The gate answers 401 for this, not 403 — "sign in again" and
  // "you may not do that" are different answers and need different screens.
  authenticated: false,
});

const existenceReads = new WeakSet<Request>();
const HEADER_MODE_READER = { "x-user-id": "system", "x-permissions": "*", "x-branch-scope": "*", "x-warehouse-scope": "*" };

// SECURITY: marks a GET this process builds for itself, to learn only whether
// a record exists. Membership is by object identity, so nothing that arrives
// over a socket can be in the set, and the answer's body is never handed to a
// caller — only its status is read (idempotent-create.ts `stillExists`).
export function existenceRead(url: URL | string, env?: unknown): { readonly request: Request; readonly env: unknown } {
  const request = new Request(url, { method: "GET", headers: HEADER_MODE_READER });
  existenceReads.add(request);
  return { request, env };
}

const EXISTENCE_READER: AuthContext = createAuthContext({
  userId: "system",
  permissions: ["*"],
  branchScope: ALL_SCOPE,
  warehouseScope: ALL_SCOPE,
});

// SECURITY: the identity an integration API key acts with, set by the cloud's `/api/v1` gateway
// on the env of a request it builds in-process. A symbol key cannot arrive over a socket, and
// the gateway forwards only to its own allow-list of read and draft-create routes.
const DELEGATED_GRANT = Symbol("mezan.delegated-grant");

export function delegatedGrantEnv<E extends object>(env: E, grant: SessionGrant): E {
  return { ...env, [DELEGATED_GRANT]: grant };
}

function delegatedGrantOf(c: Context): SessionGrant | null {
  const env = c.env as Record<symbol, unknown> | undefined;
  const grant = env?.[DELEGATED_GRANT];
  return grant && typeof grant === "object" ? (grant as SessionGrant) : null;
}

/**
 * Resolves the caller from the session registry. A request with no valid token
 * gets an AuthContext holding NO permissions, so every gated route answers 403
 * — never the permissive default the header resolver produced.
 */
export function createSessionAuthContextResolver(sessions: SessionRegistry): AuthContextResolver {
  return function resolveAuthContext(c: Context): AuthContext {
    if (existenceReads.has(c.req.raw)) return EXISTENCE_READER;
    const delegated = delegatedGrantOf(c);
    if (delegated) {
      return createAuthContext({
        userId: delegated.userId,
        permissions: [...delegated.permissions],
        roleCodes: delegated.roleCode ? [delegated.roleCode] : [],
        branchScope: delegated.branchScope,
        warehouseScope: delegated.warehouseScope,
      });
    }
    const token = readSessionToken(c);
    if (!token) return ANONYMOUS;
    // The second argument is the whole of the origin binding at the gate: a
    // token whose session was issued somewhere else resolves to nobody, and the
    // session is revoked on the way out. 401, never a quieter, smaller grant —
    // a mismatched origin degrading to reduced permissions would be a session
    // the thief still holds.
    const { grant, refusal } = sessionLookup(sessions, c, token);
    if (refusal?.reason === SessionRefusalKind.Displaced) markSessionDisplaced(c);
    if (!grant) return ANONYMOUS;
    return createAuthContext({
      userId: grant.userId,
      permissions: [...grant.permissions],
      roleCodes: grant.roleCode ? [grant.roleCode] : [],
      branchScope: narrowScope(grant.branchScope, c.req.header("x-branch-scope")),
      branchGrant: grant.branchScope,
      warehouseScope: narrowScope(grant.warehouseScope, c.req.header("x-warehouse-scope")),
      warehouseGrant: grant.warehouseScope,
    });
  };
}

/**
 * Records a token that turned up at an address it was not issued to.
 *
 * WHY IT IS A MIDDLEWARE AND NOT PART OF THE GATE. The refusal itself already
 * happens at the one choke point every route shares — `find()` revokes and the
 * gate answers 401 — and that must keep working in every composition,
 * including the ones (route-level unit tests, older desktop builds) that mount
 * no audit sink. This adds the forensic half where a sink exists. It NEVER
 * answers the request: `/auth/login` is reachable with a stale bearer token
 * still in the client's storage, and a middleware that 401'd it would lock a
 * till out of the login screen it needs to recover through.
 *
 * A token used from a second address is the single clearest signal in this
 * product that a credential has been copied, so it is CRITICAL — the same tier
 * as an account lockout and a tenant claim. It fires once per token, because
 * the mismatch revokes: the next request presents a token the registry no
 * longer knows, which is a 401 with nothing to say about it.
 */
export function sessionOriginReporting(sessions: SessionRegistry, audit: AuditSink): MiddlewareHandler {
  return async function reportMovedSessions(c, next) {
    const token = readSessionToken(c);
    if (token) {
      const { refusal, addressChange } = sessionLookup(sessions, c, token);
      if (addressChange) {
        await recordSecurityEventOrFallback(audit, {
          module: "auth",
          entityType: "AUTH_USER",
          entityId: addressChange.userId,
          action: "SESSION_ADDRESS_CHANGED",
          actor: addressChange.userId,
          severity: "INFO",
          details: { from: addressChange.from, to: addressChange.to },
        });
      }
      if (refusal?.reason === SessionRefusalKind.Device) {
        await recordSecurityEventOrFallback(audit, {
          module: "auth",
          entityType: "AUTH_USER",
          entityId: refusal.userId,
          action: "SESSION_DEVICE_REJECTED",
          actor: refusal.userId,
          severity: "CRITICAL",
          details: { issuedFrom: refusal.issuedFrom, presentedFrom: refusal.presentedFrom, sessionEnded: refusal.sessionEnded, method: c.req.method, path: new URL(c.req.url).pathname },
        });
      }
      if (refusal?.reason === SessionRefusalKind.Moved) {
        await recordSecurityEventOrFallback(audit, {
          module: "auth",
          entityType: "AUTH_USER",
          entityId: refusal.userId,
          action: "SESSION_ORIGIN_REJECTED",
          actor: refusal.userId,
          severity: "CRITICAL",
          details: {
            issuedFrom: refusal.issuedFrom,
            presentedFrom: refusal.presentedFrom,
            method: c.req.method,
            path: new URL(c.req.url).pathname,
          },
          // A forensic write must never turn a refusal into a 500.
        });
      }
    }
    await next();
  };
}

/** Constant-time compare for a caller-supplied token against a known one. */
export function tokensMatch(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

export const STEP_UP_REQUIRED = "STEP_UP_REQUIRED";

// SECURITY: an administrative change made on a device-bound session whose
// address has moved since the PIN was entered waits until it is entered again
// (`POST /auth/step-up`). A token and its device secret lifted together from
// one phone can then read, but cannot re-shape who may do what.
export function stepUpGate(sessions: SessionRegistry): MiddlewareHandler {
  return async function requireRecentPin(c, next) {
    if (c.req.method === "GET" || c.req.method === "HEAD") return next();
    const token = readSessionToken(c);
    if (!token || !sessions.needsStepUp(token)) return next();
    return c.json(
      { error: STEP_UP_REQUIRED, message: "تغيّر عنوان اتصالك منذ تسجيل الدخول. أعد إدخال رمز PIN لتأكيد هذا الإجراء." },
      403,
    );
  };
}
