import type { Context, MiddlewareHandler, Next } from "hono";
import { AuditRecordingError, ConnectionTurnLostError, type AuditSink } from "@mezan/domain";
import { reportTurnYield } from "./turn-yields.js";

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
  ClientGone = "client-gone",
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
  // REQUIRED: close and lock commit the period, its sealed summary and their
  // audit row in one synchronous transaction of their own, and refuse to run
  // inside any other. Wrapping them in this boundary's transaction would make
  // every close answer PERIOD_CLOSE_CONTENDED.
  { prefix: "/fiscal-periods", only: /^(?!\/[^/]+\/(close|lock)$)/ },
  { prefix: "/cheques" },
  { prefix: "/bank-statements", only: /^\/(rules(\/|$)|[^/]+\/finalize$)/ },
  { prefix: "/crm", only: /^\/(leads\/[^/]+\/convert|opportunities|opportunities\/[^/]+\/(move-stage|assign))$/ },
  {
    prefix: "/hr",
    only: /^\/(advances\/[^/]+\/repay|payroll\/statutory-tables\/insurance-years\/[^/]+|payroll\/statutory-flag|self\/clock(\/credential)?|employees\/[^/]+\/clock-credential\/reset|attendance\/import\/commit|attendance\/(?!import)[^/]+|employees\/[^/]+\/correct-termination-date|employees\/[^/]+\/salary-payment|payroll\/runs\/[^/]+\/bank-file)$/,
  },
  { prefix: "/assets", only: /^\/([^/]+\/internal-hourly-rate|depreciation\/runs\/[^/]+\/discard)$/ },
  { prefix: "/revaluation", only: /^\/runs\/[^/]+\/reverse$/ },
  { prefix: "/inventory", only: /^\/(adjustments|stock-adjustments)\/[^/]+\/reverse$/ },
  { prefix: "/sales-invoices", only: /^\/[^/]+\/(void|lines\/[^/]+)$/ },
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
  { prefix: "/pricing-guard", only: /^\/rules(\/|$)/ },
  { prefix: "/contracting" },
  { prefix: "/collections", only: /^(?!\/outbox\/drain$)/ },
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

type CommittedWork = () => Promise<void>;

const committedWork = new WeakMap<Request, CommittedWork[]>();

// REQUIRED ORDERING: work that waits on the outside world for a change this
// request makes — a mail server, another company's database — is queued here
// and runs once the audit transaction has committed. Awaited inside the
// transaction it rolls the change back while whatever it reached outside stays
// done; a request that rolls back runs none of it. False means there is no
// boundary around the caller, which then does the work itself.
export function afterAuditCommit(c: Context, work: CommittedWork): boolean {
  if (!insideAuditBoundary(c)) return false;
  const queued = committedWork.get(c.req.raw) ?? [];
  queued.push(work);
  committedWork.set(c.req.raw, queued);
  return true;
}

// An audit event on a mutating request that shares no transaction with the
// write it records is the defect the boundary exists to close, so it is refused
// rather than appended — a handler added outside `only` fails its first test.
export function assertAuditIsTransactional(audit: AuditSink, c: Context): void {
  if (!audit.atomic || !isMutatingRequest(c)) return;
  if (insideAuditBoundary(c) || audit.insideTransaction?.() === true) return;
  throw new AuditOutsideTransactionError(c.req.method, c.req.path);
}

export type BoundaryPreparation = (c: Context) => Promise<(() => void) | Response | void>;

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

const preloaded = new WeakMap<Request, Promise<void>>();

// Read BEFORE the connection is taken, whatever the content type says: the body
// arrives over the socket, and a handler awaiting it with the turn held keeps
// every other request of the tenant waiting on a slow client. Read as BYTES, so
// a handler may still parse it as JSON under any content type; a form is parsed
// from those bytes with its own content type, which Hono's cache would drop.
// Once per request, however many middlewares ask.
export function preloadBody(c: Context): Promise<void> {
  const already = preloaded.get(c.req.raw);
  if (already) return already;
  const type = c.req.header("content-type") ?? "";
  const lowered = type.toLowerCase();
  const isForm = lowered.includes("multipart/form-data") || lowered.includes("application/x-www-form-urlencoded");
  const loading = c.req.arrayBuffer().then(
    (bytes) => {
      if (!isForm) return;
      const form = new Response(bytes, { headers: { "content-type": type } }).formData();
      form.catch(() => undefined);
      (c.req.bodyCache as { formData?: Promise<FormData> }).formData = form;
    },
    () => undefined,
  );
  preloaded.set(c.req.raw, loading);
  return loading;
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
    let committed = false;
    try {
      await atomic(async () => {
        openBoundaries.set(c.req.raw, state);
        const probe = setImmediate(() => {
          yielded = true;
        });
        try {
          await next();
          const thrown = c.error;
          if (thrown instanceof AuditRecordingError) markAuditFailure(c, thrown.cause);
        } finally {
          clearImmediate(probe);
          openBoundaries.delete(c.req.raw);
        }
        if (state.failed || yielded || handlerFailed(c)) throw new BoundaryRollback();
      });
      committed = true;
    } catch (err) {
      if (!(err instanceof BoundaryRollback)) throw err;
    }
    const queued = committedWork.get(c.req.raw) ?? [];
    committedWork.delete(c.req.raw);
    if (committed) {
      for (const work of queued) await work();
      return;
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
    if (release instanceof Response) return release;
    try {
      await next();
    } finally {
      release?.();
    }
  };
}

const CONNECTION_TURN_TIMEOUT_MS = 10_000;
const SIGN_IN_TURN_TIMEOUT_MS = 2_500;
const CONNECTION_TURN_MAX_WAITING = 64;
const CONNECTION_HELD_WARNING_MS = 10_000;
const SIGN_IN_PATH = /\/auth\/[^/]+$/;

export interface ConnectionTurnOptions {
  readonly timeoutMs?: number | ((c: Context) => number);
  readonly maxWaiting?: number;
  readonly heldWarningMs?: number;
  readonly onHeldTooLong?: (c: Context, heldMs: number) => void;
  readonly onYield?: (c: Context) => void;
  readonly retakeTimeoutMs?: number;
  readonly completedRetakeTimeoutMs?: number;
}

function defaultTimeoutMs(c: Context): number {
  return SIGN_IN_PATH.test(c.req.path) ? SIGN_IN_TURN_TIMEOUT_MS : CONNECTION_TURN_TIMEOUT_MS;
}

function defaultOnHeldTooLong(c: Context, heldMs: number): void {
  console.error(`[db] ${c.req.method} ${c.req.path} has held the tenant's connection for ${heldMs}ms; every other write is waiting behind it`);
}

function defaultOnTurnYield(c: Context): void {
  reportTurnYield(`${c.req.method} ${c.req.routePath}`);
}

function busy(c: Context, reason: ConnectionBusyReason): Response {
  const res = refusal(
    c,
    AuditBoundaryRefusal.ConnectionBusy,
    503,
    "قاعدة البيانات مشغولة بعملية لم تنتهِ، فلم يُنفَّذ طلبك. حاول مرة أخرى بعد قليل.",
    "The database is busy with an operation that has not finished, so your request was not carried out. Try again shortly.",
  );
  res.headers.set("retry-after", "5");
  res.headers.set("x-busy-reason", reason);
  return res;
}

enum Wait {
  Queued = "queued",
  Arrived = "arrived",
  GaveUp = "gave-up",
}

// A MUTATING request holds the connection's turn for its database work, so no
// other request's write can land inside a transaction it opens and vanish with
// a rollback. A READ only waits out a transaction that is open when it arrives:
// the shared connection would show it uncommitted rows, but it writes nothing,
// so it never queues behind a turn that has no BEGIN open, and it is not counted
// against the bound on queued writes.
export function connectionTurn(audit: AuditSink | undefined, options: ConnectionTurnOptions = {}): MiddlewareHandler {
  const timeoutFor = typeof options.timeoutMs === "function" ? options.timeoutMs : () => (options.timeoutMs as number | undefined);
  const maxWaiting = options.maxWaiting ?? CONNECTION_TURN_MAX_WAITING;
  const heldWarningMs = options.heldWarningMs ?? CONNECTION_HELD_WARNING_MS;
  const onHeldTooLong = options.onHeldTooLong ?? defaultOnHeldTooLong;
  const onYield = options.onYield ?? defaultOnTurnYield;
  let waiting = 0;

  const refuseTimedOut = (c: Context, timeoutMs: number): Response => {
    console.error(`[db] ${c.req.method} ${c.req.path} waited ${timeoutMs}ms for the tenant's connection`);
    return busy(c, ConnectionBusyReason.TimedOut);
  };

  async function read(c: Context, next: Next, settled: () => Promise<void>, timeoutMs: number): Promise<Response | void> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timedOut = new Promise<true>((resolve) => {
      timer = setTimeout(() => resolve(true), timeoutMs);
      timer.unref?.();
    });
    const refused = await Promise.race([settled().then(() => false as const), timedOut]);
    clearTimeout(timer);
    if (refused) return refuseTimedOut(c, timeoutMs);
    return next();
  }

  return async (c, next) => {
    const settled = audit?.settled?.bind(audit);
    const turn = audit?.turn?.bind(audit);
    if (!settled || !turn) return next();
    const timeoutMs = timeoutFor(c) ?? defaultTimeoutMs(c);
    if (!isMutatingRequest(c)) return read(c, next, settled, timeoutMs);

    await preloadBody(c);
    const signal = c.req.raw.signal;
    if (signal.aborted) return busy(c, ConnectionBusyReason.ClientGone);
    // ORDER MATTERS: nothing may be awaited between this check and the count
    // below, or a burst arriving in one tick all passes the check together.
    if (waiting >= maxWaiting) return busy(c, ConnectionBusyReason.QueueFull);
    waiting += 1;

    let wait = Wait.Queued;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let onAbort: (() => void) | undefined;
    const leaveTheQueue = (as: Wait): boolean => {
      if (wait !== Wait.Queued) return false;
      wait = as;
      waiting -= 1;
      clearTimeout(timer);
      if (onAbort) signal.removeEventListener("abort", onAbort);
      return true;
    };
    const gaveUp = new Promise<ConnectionBusyReason>((resolve) => {
      timer = setTimeout(() => {
        if (leaveTheQueue(Wait.GaveUp)) resolve(ConnectionBusyReason.TimedOut);
      }, timeoutMs);
      timer.unref?.();
      onAbort = () => {
        if (leaveTheQueue(Wait.GaveUp)) resolve(ConnectionBusyReason.ClientGone);
      };
      signal.addEventListener("abort", onAbort);
    });

    let watchdog: ReturnType<typeof setInterval> | undefined;
    let heldSince: number | null = null;
    let warned = false;
    let turnOver = false;
    const unwatch = (): void => {
      clearInterval(watchdog);
      watchdog = undefined;
      if (heldSince === null) return;
      const heldMs = Date.now() - heldSince;
      heldSince = null;
      if (!warned && heldMs >= heldWarningMs) onHeldTooLong(c, heldMs);
    };
    // REQUIRED: the watch belongs to the TURN, not to the handler. Work a
    // handler leaves running takes the connection again after the handler has
    // answered; a watch started then must still be stopped, so it is stopped
    // when the turn settles and can never start once it has.
    const watch = (): void => {
      if (turnOver) return;
      unwatch();
      const since = Date.now();
      heldSince = since;
      warned = false;
      watchdog = setInterval(() => {
        warned = true;
        onHeldTooLong(c, Date.now() - since);
      }, heldWarningMs);
      watchdog.unref?.();
    };
    const held = turn(
      async () => {
        if (!leaveTheQueue(Wait.Arrived)) return;
        watch();
        await next();
      },
      { onYield: () => onYield(c), onSuspend: unwatch, onResume: watch, retakeTimeoutMs: options.retakeTimeoutMs, completedRetakeTimeoutMs: options.completedRetakeTimeoutMs },
    );
    const turnSettled = (): void => {
      turnOver = true;
      unwatch();
    };
    held.then(turnSettled, turnSettled);
    const reason = await Promise.race([held.then(() => undefined), gaveUp]);
    if (reason === undefined) {
      if (!(c.error instanceof ConnectionTurnLostError)) return;
      console.error(`[db] ${c.req.method} ${c.req.path} handed the tenant's connection back and could not take it again; it was stopped before it wrote`);
      c.res = undefined;
      c.res = busy(c, ConnectionBusyReason.TimedOut);
      return;
    }
    held.catch(() => undefined);
    return reason === ConnectionBusyReason.TimedOut ? refuseTimedOut(c, timeoutMs) : busy(c, reason);
  };
}
