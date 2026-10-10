import type { Context, MiddlewareHandler } from "hono";
import type { AuditSink } from "@mezan/domain";

/**
 * The transaction an administrative write shares with the audit event that
 * records it.
 *
 * `recordAdminEvent` / `recordFieldChanges` run AFTER the entity write, in
 * dozens of handlers. Rather than re-order every one of them, the request
 * itself runs inside the sink's own transaction: the entity write, any nested
 * store transaction (a SAVEPOINT) and the audit append commit together, and a
 * sink that fails rolls all of it back and answers 503 — never "saved, but
 * nobody knows who did it".
 */
export interface AuditedMount {
  readonly prefix: string;
  /** Narrows the boundary to the sub-paths whose handlers audit; the rest of the mount is left exactly as it was. */
  readonly only?: RegExp;
}

// A handler under one of these mounts runs with a BEGIN open on the connection
// every store shares. It must not await real I/O (network, disk, a timer, a
// thread-pool hash) between its first write and its return: other requests'
// writes would land inside this transaction and be lost if it rolls back.
// Mounts whose audited handlers sit beside network calls name the audited
// sub-paths in `only`.
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
  { prefix: "/crm" },
  { prefix: "/hr" },
  { prefix: "/assets", only: /^\/[^/]+\/internal-hourly-rate$/ },
  { prefix: "/sales-invoices", only: /^\/[^/]+\/void$/ },
  { prefix: "/price-lists" },
  { prefix: "/promotions" },
  { prefix: "/notification-rules" },
  { prefix: "/exchange-rates" },
  { prefix: "/eta", only: /^\/item-mappings\// },
  { prefix: "/items" },
  { prefix: "/item-brands" },
  { prefix: "/item-seasons" },
  { prefix: "/roles" },
  { prefix: "/users" },
  { prefix: "/data-migration" },
  { prefix: "/workflow" },
  { prefix: "/cash-forecast" },
];

const MUTATING_METHODS: ReadonlySet<string> = new Set(["POST", "PUT", "PATCH", "DELETE"]);

interface BoundaryState {
  failure: unknown;
  failed: boolean;
}

const openBoundaries = new WeakMap<Request, BoundaryState>();

class AuditRollback extends Error {}

/** Called by the audit helpers when the sink refuses an event, so the boundary rolls the request back even if the handler swallowed the throw. */
export function markAuditFailure(c: Context, err: unknown): void {
  const state = openBoundaries.get(c.req.raw);
  if (!state) return;
  state.failed = true;
  state.failure = err;
}

export function insideAuditBoundary(c: Context): boolean {
  return openBoundaries.has(c.req.raw);
}

export interface AuditBoundaryOptions {
  readonly only?: RegExp;
  readonly prefix?: string;
  readonly onAuditFailure?: (err: unknown, c: Context) => void;
  readonly onYield?: (c: Context) => void;
}

function subPath(path: string, prefix: string | undefined): string {
  if (!prefix) return path;
  const at = path.indexOf(prefix);
  return at === -1 ? path : path.slice(at + prefix.length);
}

async function preloadJsonBody(c: Context): Promise<void> {
  const type = c.req.header("content-type") ?? "";
  if (!type.toLowerCase().includes("json")) return;
  await c.req.text().catch(() => undefined);
}

const reportedYields = new Set<string>();

function defaultOnYield(c: Context): void {
  const key = `${c.req.method} ${c.req.routePath}`;
  if (reportedYields.has(key)) return;
  reportedYields.add(key);
  console.warn(`[audit] ${key} awaited real I/O inside its audit transaction; move the I/O before the first write`);
}

function defaultOnAuditFailure(err: unknown, c: Context): void {
  console.error(`[audit] could not record ${c.req.method} ${c.req.path}; the change was rolled back`, err);
}

export function auditBoundary(audit: AuditSink | undefined, options: AuditBoundaryOptions = {}): MiddlewareHandler {
  const onAuditFailure = options.onAuditFailure ?? defaultOnAuditFailure;
  const onYield = options.onYield ?? defaultOnYield;
  return async (c, next) => {
    const atomic = audit?.atomic?.bind(audit);
    if (!atomic || !MUTATING_METHODS.has(c.req.method) || insideAuditBoundary(c)) return next();
    if (options.only && !options.only.test(subPath(c.req.path, options.prefix))) return next();

    // Read BEFORE the BEGIN: the body arrives over the socket, and awaiting it
    // with the transaction open is exactly the window described above.
    await preloadJsonBody(c);

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
        if (state.failed) throw new AuditRollback();
      });
    } catch (err) {
      if (!(err instanceof AuditRollback)) throw err;
    }
    if (yielded) onYield(c);
    if (!state.failed) return;

    onAuditFailure(state.failure, c);
    c.res = undefined;
    c.res = c.json(
      {
        error: "AUDIT_UNAVAILABLE",
        message: "تعذّر تسجيل العملية في سجل التدقيق، فلم يُحفظ أي تغيير. حاول مرة أخرى.",
        messageEn: "The audit log could not record this action, so nothing was saved. Try again.",
      },
      503,
    );
  };
}
