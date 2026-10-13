import { createHash } from "node:crypto";
import type { Context, MiddlewareHandler } from "hono";
import type { AuditSink } from "@mezan/domain";
import { IdempotencyRefusal, IDEMPOTENT_REPLAY_HEADER } from "@mezan/contracts";
import { MutatingMethod, preloadBody } from "./audit-boundary.js";
import type { AuthContextResolver } from "./permission-gate.js";

export { IdempotencyRefusal, IDEMPOTENT_REPLAY_HEADER };

export interface IdempotentAnswer {
  readonly requestHash: string;
  readonly status: number;
  readonly body: string;
}

export interface IdempotentRequests {
  find(scope: string, key: string): IdempotentAnswer | null;
  record(scope: string, key: string, answer: IdempotentAnswer, recordedAt: string): void;
  forget(before: string): number;
}

export enum IdempotencyKeyField {
  Id = "id",
  AllocationId = "allocationId",
}

export interface IdempotentCreate {
  readonly path: string;
  readonly key?: IdempotencyKeyField;
  readonly read: (key: string, requestPath: string) => string;
  readonly merge?: (first: unknown, current: unknown) => unknown;
}

const byId =
  (mount: string) =>
  (id: string): string =>
    `${mount}/${encodeURIComponent(id)}`;

const underTheRequest = (key: string, requestPath: string): string => `${requestPath}/${encodeURIComponent(key)}`;
const parentOfTheRequest = (_key: string, requestPath: string): string => requestPath.slice(0, requestPath.lastIndexOf("/"));

export const IDEMPOTENT_CREATES: readonly IdempotentCreate[] = [
  { path: "/sales-invoices", read: byId("/sales-invoices") },
  { path: "/vouchers", read: byId("/vouchers") },
  { path: "/vouchers/collections", read: byId("/vouchers"), merge: (first, voucher) => ({ ...(first as object), voucher }) },
  { path: "/vouchers/:id/allocations", key: IdempotencyKeyField.AllocationId, read: underTheRequest },
  { path: "/sales-returns", read: byId("/sales-returns") },
  { path: "/sales-returns/from-invoice", read: byId("/sales-returns") },
  { path: "/purchase-returns", read: byId("/purchase-returns") },
  { path: "/purchases/invoices", read: byId("/purchases/invoices") },
  { path: "/cheques", read: byId("/cheques") },
  { path: "/cheques/:id/allocations", key: IdempotencyKeyField.AllocationId, read: parentOfTheRequest },
  { path: "/landed-costs", read: byId("/landed-costs") },
  { path: "/gl/journal-entries", read: byId("/gl/journal-entries") },
  { path: "/inventory/stock-adjustments/draft", read: byId("/inventory/stock-adjustments") },
  { path: "/inventory/stock-transfers/draft", read: byId("/inventory/stock-transfers") },
];

const SEGMENT_PARAMETER = /:[A-Za-z]\w*/g;
const REGEXP_SPECIALS = /[.*+?^${}()|[\]\\]/g;

function matcherOf(path: string): RegExp {
  const literal = path.split(SEGMENT_PARAMETER).map((part) => part.replace(REGEXP_SPECIALS, "\\$&"));
  return new RegExp(`^${literal.join("[^/]+")}$`);
}

const KEPT_FOR_MS = 7 * 24 * 60 * 60_000;
const FORGET_EVERY_MS = 60 * 60_000;
const SUCCESS_FROM = 200;
const SUCCESS_BELOW = 300;
const NOT_FOUND = 404;
const RETRY_AFTER_SECONDS = "2";
const JSON_TYPE = "application/json; charset=UTF-8";

export interface IdempotentCreateOptions {
  readonly requests: IdempotentRequests;
  readonly resolveAuthContext: AuthContextResolver;
  readonly audit?: AuditSink;
  readonly now?: () => Date;
  readonly creates?: readonly IdempotentCreate[];
  readonly readCurrent: (c: Context, path: string) => Response | Promise<Response>;
  /**
   * Whether the document is still there at all, whoever may read it. A caller
   * allowed to create a document is not always allowed to read it back, and a
   * refused read must not be answered as a document that was never made.
   */
  readonly stillExists?: (c: Context, path: string) => Promise<boolean>;
}

export interface IdempotentCreateMiddleware {
  /** Registered AHEAD of the connection's turn: answers a resend, refuses a reused id. */
  readonly replay: MiddlewareHandler;
  /** Registered INSIDE the turn: runs the create and keeps its answer in one transaction. */
  readonly record: MiddlewareHandler;
}

interface Pending {
  readonly scope: string;
  readonly key: string;
  readonly requestHash: string;
}

class AnswerNotRecorded extends Error {}

function clientKey(body: unknown, field: IdempotencyKeyField): string | null {
  if (body === null || typeof body !== "object") return null;
  const id = (body as Partial<Record<IdempotencyKeyField, unknown>>)[field];
  return typeof id === "string" && id !== "" ? id : null;
}

// The same create re-serialised by another client — or by the same one after a
// reload — orders its keys differently. Keys are sorted; a list keeps its
// order, because the order of an invoice's lines is part of what was asked.
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value === null || typeof value !== "object") return value;
  const sorted: Record<string, unknown> = {};
  for (const key of Object.keys(value).sort()) sorted[key] = canonical((value as Record<string, unknown>)[key]);
  return sorted;
}

// A CREATE WHOSE ANSWER WAS LOST MUST NOT RUN TWICE. A till that timed out, a
// browser that dropped its connection, a clerk who pressed the button again:
// each resends the same create, and the first one may well have posted. The
// client mints the document's id once per document it means to create, and that
// id is the key — the same key with the same body is answered with the document
// as it now stands, and with a different body it is refused.
// The create and the record of its answer commit TOGETHER: an answer that
// cannot be kept rolls the create back, so no caller is ever told a create
// failed when the document exists.
export function idempotentCreate(options: IdempotentCreateOptions): IdempotentCreateMiddleware {
  const { requests, resolveAuthContext, audit, readCurrent } = options;
  const now = options.now ?? (() => new Date());
  const declared = options.creates ?? IDEMPOTENT_CREATES;
  const exact = new Map(declared.filter((create) => !create.path.includes(":")).map((create) => [create.path, create]));
  const patterned = declared.filter((create) => create.path.includes(":")).map((create) => ({ create, matches: matcherOf(create.path) }));
  const createAt = (path: string): IdempotentCreate | undefined =>
    exact.get(path) ?? patterned.find((candidate) => candidate.matches.test(path))?.create;
  const inFlight = new Map<string, Promise<void>>();
  const pending = new WeakMap<Context, Pending>();
  let forgotAt: number | null = null;

  const forgetOld = (): void => {
    const at = now().getTime();
    if (forgotAt !== null && at - forgotAt < FORGET_EVERY_MS) return;
    forgotAt = at;
    requests.forget(new Date(at - KEPT_FOR_MS).toISOString());
  };

  async function asItStandsNow(c: Context, create: IdempotentCreate, key: string, first: IdempotentAnswer): Promise<Response> {
    const headers = { "content-type": JSON_TYPE, [IDEMPOTENT_REPLAY_HEADER]: "true" };
    const readAt = create.read(key, c.req.path);
    const current = await readCurrent(c, readAt);
    if (current.status === NOT_FOUND) {
      const gone = options.stillExists ? !(await options.stillExists(c, readAt)) : true;
      if (gone) return new Response(await current.text(), { status: NOT_FOUND, headers });
      return new Response(first.body, { status: first.status, headers });
    }
    if (current.status < SUCCESS_FROM || current.status >= SUCCESS_BELOW) return new Response(first.body, { status: first.status, headers });
    const body = create.merge ? JSON.stringify(create.merge(JSON.parse(first.body), await current.json())) : await current.text();
    return new Response(body, { status: first.status, headers });
  }

  const replay: MiddlewareHandler = async (c, next) => {
    const create = createAt(c.req.path);
    if (!create || c.req.method !== MutatingMethod.Post) return next();
    await preloadBody(c);
    let body: unknown = null;
    try {
      body = JSON.parse(await c.req.text());
    } catch {
      return next();
    }
    const key = clientKey(body, create.key ?? IdempotencyKeyField.Id);
    if (key === null) return next();
    const caller = await resolveAuthContext(c);
    if (!caller.authenticated) return next();

    const scope = `${c.req.path}\u0000${caller.userId}`;
    const slot = `${scope}\u0000${key}`;
    const requestHash = createHash("sha256").update(JSON.stringify(canonical(body)), "utf8").digest("hex");
    // ORDER MATTERS: nothing is awaited between the last look at `inFlight` and
    // the claim below, or two sends of one create both find the slot free.
    for (let ahead = inFlight.get(slot); ahead; ahead = inFlight.get(slot)) await ahead;
    await audit?.settled?.();
    for (let ahead = inFlight.get(slot); ahead; ahead = inFlight.get(slot)) await ahead;

    const earlier = requests.find(scope, key);
    if (earlier) {
      if (earlier.requestHash === requestHash) return asItStandsNow(c, create, key, earlier);
      return c.json(
        {
          error: IdempotencyRefusal.KeyReused,
          message: "سبق تسجيل مستند بهذا المعرّف ببيانات مختلفة، فلم يُسجَّل هذا الطلب. افتح المستند المسجَّل أو أنشئ مستندًا جديدًا.",
          messageEn: "A document was already recorded under this id with different contents, so this request was not recorded. Open the recorded document or start a new one.",
        },
        409,
      );
    }

    let finished!: () => void;
    inFlight.set(
      slot,
      new Promise<void>((resolve) => {
        finished = resolve;
      }),
    );
    pending.set(c, { scope, key, requestHash });
    try {
      await next();
    } finally {
      inFlight.delete(slot);
      finished();
    }
  };

  const record: MiddlewareHandler = async (c, next) => {
    const create = pending.get(c);
    if (!create) return next();
    const keep = async (): Promise<void> => {
      await next();
      const status = c.res.status;
      if (status < SUCCESS_FROM || status >= SUCCESS_BELOW) return;
      const answer = await c.res.clone().text();
      try {
        requests.record(create.scope, create.key, { requestHash: create.requestHash, status, body: answer }, now().toISOString());
        forgetOld();
      } catch (err) {
        console.error(`[idempotency] could not keep the answer to ${c.req.method} ${c.req.path}; the create was rolled back`, err);
        throw new AnswerNotRecorded();
      }
    };
    try {
      await (audit?.atomic ? audit.atomic(keep) : keep());
    } catch (err) {
      if (!(err instanceof AnswerNotRecorded)) throw err;
      c.res = undefined;
      c.res = c.json(
        {
          error: IdempotencyRefusal.NotRecorded,
          message: "تعذّر حفظ نتيجة العملية، فلم يُسجَّل المستند. أعد المحاولة.",
          messageEn: "The result of this operation could not be kept, so the document was not recorded. Try again.",
        },
        503,
        { "retry-after": RETRY_AFTER_SECONDS },
      );
    }
  };

  return { replay, record };
}
