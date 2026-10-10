import type { Context, MiddlewareHandler } from "hono";
import type { AuditSink } from "@mezan/domain";
import { isProductionRuntime } from "./permission-gate.js";

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

const MUTATING_METHODS: ReadonlySet<string> = new Set(Object.values(MutatingMethod));

export function isMutatingRequest(c: Context): boolean {
  return MUTATING_METHODS.has(c.req.method);
}

export interface AuditedMount {
  readonly prefix: string;
  readonly only?: RegExp;
}

// A handler matched here runs with a BEGIN open on the ONE connection every
// store shares. Between that BEGIN and its COMMIT it must never give the event
// loop back (network, disk, a timer, a thread-pool hash): any other request
// that ran in the gap would write into this transaction and lose its write if
// this one rolled back. `only` therefore names the audited handlers and nothing
// else, and a handler that yields is refused outright outside production.
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
    only: /^\/(advances\/[^/]+\/repay|payroll\/statutory-tables\/insurance-years\/[^/]+|payroll\/statutory-flag|self\/clock(\/credential)?|employees\/[^/]+\/clock-credential\/reset|attendance\/(?!import)[^/]+)$/,
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

/** Work a mount must finish BEFORE the transaction opens; the returned function runs once the request is over. */
export type BoundaryPreparation = (c: Context) => Promise<(() => void) | void>;

export interface AuditBoundaryOptions {
  readonly only?: RegExp;
  readonly prefix?: string;
  readonly prepare?: BoundaryPreparation;
  /** Defaults to refusing everywhere but production, where a yield is counted and logged instead. */
  readonly failOnYield?: boolean;
  readonly onAuditFailure?: (err: unknown, c: Context) => void;
  readonly onYield?: (c: Context) => void;
}

function subPath(path: string, prefix: string | undefined): string {
  if (!prefix) return path;
  const at = path.indexOf(prefix);
  return at === -1 ? path : path.slice(at + prefix.length);
}

// Read BEFORE the BEGIN, whatever the content type says: the body arrives over
// the socket, and a handler awaiting it with the transaction open is exactly
// the gap described above. Hono serves later reads from this cache.
async function preloadBody(c: Context): Promise<void> {
  const type = (c.req.header("content-type") ?? "").toLowerCase();
  const isForm = type.includes("multipart/form-data") || type.includes("application/x-www-form-urlencoded");
  await (isForm ? c.req.formData() : c.req.text()).catch(() => undefined);
}

let yieldsInProduction = 0;

export function auditBoundaryYieldCount(): number {
  return yieldsInProduction;
}

function defaultOnYield(c: Context): void {
  yieldsInProduction += 1;
  console.error(
    `[audit] ${c.req.method} ${c.req.routePath} gave the event loop back inside its audit transaction (${yieldsInProduction} so far); ` +
      "do its I/O before the transaction or leave it out of AUDITED_MOUNTS",
  );
}

function defaultOnAuditFailure(err: unknown, c: Context): void {
  console.error(`[audit] could not record ${c.req.method} ${c.req.path}; the change was rolled back`, err);
}

function refusal(c: Context, code: AuditBoundaryRefusal, status: 500 | 503, message: string, messageEn: string): Response {
  return c.json({ error: code, message, messageEn }, status);
}

export function auditBoundary(audit: AuditSink | undefined, options: AuditBoundaryOptions = {}): MiddlewareHandler {
  const onAuditFailure = options.onAuditFailure ?? defaultOnAuditFailure;
  const onYield = options.onYield ?? defaultOnYield;
  const failOnYield = options.failOnYield ?? !isProductionRuntime();
  return async (c, next) => {
    const atomic = audit?.atomic?.bind(audit);
    if (!atomic || !isMutatingRequest(c) || insideAuditBoundary(c)) return next();
    if (options.only && !options.only.test(subPath(c.req.path, options.prefix))) return next();

    await preloadBody(c);
    const release = await options.prepare?.(c);

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
        if (state.failed || (yielded && failOnYield)) throw new BoundaryRollback();
      });
    } catch (err) {
      if (!(err instanceof BoundaryRollback)) throw err;
    } finally {
      release?.();
    }

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
    onYield(c);
    if (!failOnYield) return;
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

const CONNECTION_TURN_TIMEOUT_MS = 30_000;

/**
 * Every request waits here until no transaction is open on the tenant's
 * connection, so it can neither read another request's uncommitted rows nor
 * write into its transaction. A transaction that never ends answers 503 after
 * the timeout instead of hanging every caller behind it.
 */
export function connectionTurn(audit: AuditSink | undefined, timeoutMs: number = CONNECTION_TURN_TIMEOUT_MS): MiddlewareHandler {
  return async (c, next) => {
    const settled = audit?.settled?.bind(audit);
    if (!settled) return next();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timedOut = new Promise<true>((resolve) => {
      timer = setTimeout(() => resolve(true), timeoutMs);
      timer.unref?.();
    });
    const busy = await Promise.race([settled().then(() => false as const), timedOut]);
    clearTimeout(timer);
    if (!busy) return next();
    console.error(`[db] ${c.req.method} ${c.req.path} waited ${timeoutMs}ms for a transaction that did not end`);
    return refusal(
      c,
      AuditBoundaryRefusal.ConnectionBusy,
      503,
      "قاعدة البيانات مشغولة بعملية لم تنتهِ. حاول مرة أخرى بعد قليل.",
      "The database is busy with an operation that has not finished. Try again shortly.",
    );
  };
}
