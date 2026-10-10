import type { Context, MiddlewareHandler } from "hono";
import type { AuditSink } from "@mezan/domain";

export enum MutatingMethod {
  Post = "POST",
  Put = "PUT",
  Patch = "PATCH",
  Delete = "DELETE",
}

export enum AuditBoundaryRefusal {
  AuditUnavailable = "AUDIT_UNAVAILABLE",
  Yielded = "AUDIT_BOUNDARY_YIELDED",
  ConnectionBusy = "DATABASE_BUSY",
}

export enum ConnectionBusyReason {
  TimedOut = "timed-out",
  QueueFull = "queue-full",
}

const MUTATING_METHODS: ReadonlySet<string> = new Set(Object.values(MutatingMethod));

export function isMutatingRequest(c: Context): boolean {
  return MUTATING_METHODS.has(c.req.method);
}

export interface AuditedMount {
  readonly prefix: string;
  readonly only?: RegExp;
}

// A handler matched here runs with a BEGIN open on the ONE connection every
// store shares. No other request can write into that transaction — each
// mutating request holds the connection's turn from start to finish
// (connectionTurn below) — but a timer-driven task still could, and a read
// already under way would see its uncommitted rows. So between the BEGIN and
// the COMMIT a handler must never give the event loop back (network, disk, a
// timer, a thread-pool hash): one that does is rolled back and refused, in
// every environment. `only` names the audited handlers and nothing else.
export const AUDITED_MOUNTS: readonly AuditedMount[] = [
  { prefix: "/settings", only: /^\/?$/ },
  { prefix: "/customers" },
  { prefix: "/suppliers" },
  { prefix: "/accounts" },
  { prefix: "/tax-rates" },
  { prefix: "/cost-centers" },
  { prefix: "/treasury-accounts" },
  { prefix: "/fiscal-periods" },
  { prefix: "/cheques" },
  { prefix: "/bank-statements", only: /^\/(rules(\/|$)|[^/]+\/finalize$)/ },
  { prefix: "/crm", only: /^\/leads\/[^/]+\/convert$/ },
  {
    prefix: "/hr",
    only: /^\/(advances\/[^/]+\/repay|payroll\/statutory-tables\/insurance-years\/[^/]+|payroll\/statutory-flag|self\/clock(\/credential)?|employees\/[^/]+\/clock-credential\/reset|attendance\/import\/commit|attendance\/(?!import)[^/]+)$/,
  },
  { prefix: "/assets", only: /^\/[^/]+\/internal-hourly-rate$/ },
  { prefix: "/sales-invoices", only: /^\/[^/]+\/void$/ },
  { prefix: "/price-lists" },
  { prefix: "/promotions" },
  { prefix: "/notification-rules" },
  { prefix: "/exchange-rates" },
  { prefix: "/eta", only: /^\/item-mappings\// },
  { prefix: "/items", only: /^(\/[^/]*)?$/ },
  { prefix: "/item-brands" },
  { prefix: "/item-seasons" },
  { prefix: "/roles" },
  { prefix: "/users", only: /^(?!\/[^/]+\/erase$)/ },
  { prefix: "/data-migration", only: /^\/[^/]+\/commit$/ },
  { prefix: "/workflow" },
  { prefix: "/cash-forecast", only: /^\/threshold$/ },
];

interface BoundaryState {
  failure: unknown;
  failed: boolean;
}

const openBoundaries = new WeakMap<Request, BoundaryState>();

class BoundaryRollback extends Error {}

export class AuditOutsideTransactionError extends Error {
  constructor(method: string, path: string) {
    super(
      `${method} ${path} recorded an audit event outside any transaction: add its path to AUDITED_MOUNTS (audit-boundary.ts) ` +
        "or record the event inside the transaction that makes the write",
    );
    this.name = "AuditOutsideTransactionError";
  }
}

export function markAuditFailure(c: Context, err: unknown): void {
  const state = openBoundaries.get(c.req.raw);
  if (!state) return;
  state.failed = true;
  state.failure = err;
}

export function insideAuditBoundary(c: Context): boolean {
  return openBoundaries.has(c.req.raw);
}

// An audit event on a mutating request that shares no transaction with the
// write it records is the defect the boundary exists to close, so it is refused
// rather than appended — a handler added outside `only` fails its first test.
export function assertAuditIsTransactional(audit: AuditSink, c: Context): void {
  if (!audit.atomic || !isMutatingRequest(c)) return;
  if (insideAuditBoundary(c) || audit.insideTransaction?.() === true) return;
  throw new AuditOutsideTransactionError(c.req.method, c.req.path);
}

export type BoundaryPreparation = (c: Context) => Promise<(() => void) | void>;

export interface AuditBoundaryOptions {
  readonly only?: RegExp;
  readonly prefix?: string;
  readonly onAuditFailure?: (err: unknown, c: Context) => void;
  readonly onYield?: (c: Context) => void;
}

const SERVER_ERROR = 500;

function mountedAt(c: Context, prefix: string): string {
  const route = c.req.routePath.replace(/\/\*$/, "");
  return route.endsWith(prefix) ? route : prefix;
}

function subPath(c: Context, prefix: string | undefined): string {
  const path = c.req.path;
  if (!prefix) return path;
  const mount = mountedAt(c, prefix);
  return path === mount || path.startsWith(`${mount}/`) ? path.slice(mount.length) : path;
}

// Read BEFORE the connection is taken, whatever the content type says: the body
// arrives over the socket, and a handler awaiting it with the turn held keeps
// every other request of the tenant waiting on a slow client. Hono serves later
// reads from this cache — as bytes, so a body that is not text survives it.
async function preloadBody(c: Context): Promise<void> {
  const type = (c.req.header("content-type") ?? "").toLowerCase();
  const isForm = type.includes("multipart/form-data") || type.includes("application/x-www-form-urlencoded");
  await (isForm ? c.req.formData() : c.req.arrayBuffer()).catch(() => undefined);
}

function defaultOnYield(c: Context): void {
  console.error(
    `[audit] ${c.req.method} ${c.req.routePath} gave the event loop back inside its audit transaction and was rolled back; ` +
      "do its I/O before the transaction or leave it out of AUDITED_MOUNTS",
  );
}

function defaultOnAuditFailure(err: unknown, c: Context): void {
  console.error(`[audit] could not record ${c.req.method} ${c.req.path}; the change was rolled back`, err);
}

function refusal(c: Context, code: AuditBoundaryRefusal, status: 500 | 503, message: string, messageEn: string): Response {
  return c.json({ error: code, message, messageEn }, status);
}

function handlerFailed(c: Context): boolean {
  return c.error !== undefined || c.res.status >= SERVER_ERROR;
}

export function auditBoundary(audit: AuditSink | undefined, options: AuditBoundaryOptions = {}): MiddlewareHandler {
  const onAuditFailure = options.onAuditFailure ?? defaultOnAuditFailure;
  const onYield = options.onYield ?? defaultOnYield;
  return async (c, next) => {
    const atomic = audit?.atomic?.bind(audit);
    if (!atomic || !isMutatingRequest(c) || insideAuditBoundary(c)) return next();
    if (options.only && !options.only.test(subPath(c, options.prefix))) return next();

    await preloadBody(c);

    const state: BoundaryState = { failed: false, failure: undefined };
    let yielded = false;
    try {
      await atomic(async () => {
        openBoundaries.set(c.req.raw, state);
        const probe = setImmediate(() => {
          yielded = true;
        });
        try {
          await next();
        } finally {
          clearImmediate(probe);
          openBoundaries.delete(c.req.raw);
        }
        if (state.failed || yielded || handlerFailed(c)) throw new BoundaryRollback();
      });
    } catch (err) {
      if (!(err instanceof BoundaryRollback)) throw err;
    }

    if (yielded) onYield(c);
    if (state.failed) {
      onAuditFailure(state.failure, c);
      c.res = undefined;
      c.res = refusal(
        c,
        AuditBoundaryRefusal.AuditUnavailable,
        503,
        "تعذّر تسجيل العملية في سجل التدقيق، فلم يُحفظ أي تغيير. حاول مرة أخرى.",
        "The audit log could not record this action, so nothing was saved. Try again.",
      );
      return;
    }
    if (!yielded) return;
    c.res = undefined;
    c.res = refusal(
      c,
      AuditBoundaryRefusal.Yielded,
      500,
      "عملية داخل معاملة التدقيق انتظرت إدخالًا أو إخراجًا، فأُلغيت.",
      `${c.req.method} ${c.req.routePath} awaited I/O inside its audit transaction and was rolled back`,
    );
  };
}

// Registered AHEAD of connectionTurn: work a mount must not do while holding the
// connection (a thread-pool hash) is done here, and what `prepare` returns runs
// once the request is over.
export function beforeTheTurn(prepare: BoundaryPreparation): MiddlewareHandler {
  return async (c, next) => {
    if (!isMutatingRequest(c)) return next();
    await preloadBody(c);
    const release = await prepare(c);
    try {
      await next();
    } finally {
      release?.();
    }
  };
}

const CONNECTION_TURN_TIMEOUT_MS = 30_000;
const CONNECTION_TURN_MAX_WAITING = 64;
const CONNECTION_HELD_WARNING_MS = 10_000;

export interface ConnectionTurnOptions {
  readonly timeoutMs?: number;
  readonly maxWaiting?: number;
  readonly heldWarningMs?: number;
  readonly onHeldTooLong?: (c: Context, heldMs: number) => void;
}

function defaultOnHeldTooLong(c: Context, heldMs: number): void {
  console.error(`[db] ${c.req.method} ${c.req.path} has held the tenant's connection for ${heldMs}ms; every other write is waiting behind it`);
}

function busy(c: Context, reason: ConnectionBusyReason): Response {
  const res = refusal(
    c,
    AuditBoundaryRefusal.ConnectionBusy,
    503,
    "قاعدة البيانات مشغولة بعملية لم تنتهِ. حاول مرة أخرى بعد قليل.",
    "The database is busy with an operation that has not finished. Try again shortly.",
  );
  res.headers.set("retry-after", "5");
  res.headers.set("x-busy-reason", reason);
  return res;
}

// A MUTATING request holds the connection's turn from its first statement to
// its last, so no other request's write can land inside a transaction it opens
// and vanish with a rollback. A READ only waits out a transaction that is open
// when it arrives: the shared connection would show it uncommitted rows, but it
// writes nothing, so it never queues behind a turn that has no BEGIN open.
// Waiters are bounded and time out, so a holder that never finishes answers 503
// to the requests behind it instead of collecting them.
export function connectionTurn(audit: AuditSink | undefined, options: ConnectionTurnOptions = {}): MiddlewareHandler {
  const timeoutMs = options.timeoutMs ?? CONNECTION_TURN_TIMEOUT_MS;
  const maxWaiting = options.maxWaiting ?? CONNECTION_TURN_MAX_WAITING;
  const heldWarningMs = options.heldWarningMs ?? CONNECTION_HELD_WARNING_MS;
  const onHeldTooLong = options.onHeldTooLong ?? defaultOnHeldTooLong;
  let waiting = 0;

  const refuseTimedOut = (c: Context): Response => {
    console.error(`[db] ${c.req.method} ${c.req.path} waited ${timeoutMs}ms for the tenant's connection`);
    return busy(c, ConnectionBusyReason.TimedOut);
  };

  return async (c, next) => {
    const settled = audit?.settled?.bind(audit);
    const turn = audit?.turn?.bind(audit);
    if (!settled || !turn) return next();
    if (waiting >= maxWaiting) return busy(c, ConnectionBusyReason.QueueFull);

    const mutating = isMutatingRequest(c);
    if (mutating) await preloadBody(c);

    let arrived = false;
    let gaveUp = false;
    let waitTimer: ReturnType<typeof setTimeout> | undefined;
    const timedOut = new Promise<true>((resolve) => {
      waitTimer = setTimeout(() => {
        if (arrived) return;
        gaveUp = true;
        resolve(true);
      }, timeoutMs);
      waitTimer.unref?.();
    });
    const arrive = (): boolean => {
      arrived = true;
      clearTimeout(waitTimer);
      waiting -= 1;
      return !gaveUp;
    };
    waiting += 1;

    if (!mutating) {
      const refused = await Promise.race([settled().then(() => false as const), timedOut]);
      if (!arrive() || refused) return refuseTimedOut(c);
      return next();
    }

    const held = turn(async () => {
      if (!arrive()) return;
      const since = Date.now();
      const watchdog = setInterval(() => onHeldTooLong(c, Date.now() - since), heldWarningMs);
      watchdog.unref?.();
      try {
        await next();
      } finally {
        clearInterval(watchdog);
      }
    });
    const refused = await Promise.race([held.then(() => false as const), timedOut]);
    if (!refused) return;
    held.catch(() => undefined);
    return refuseTimedOut(c);
  };
}
