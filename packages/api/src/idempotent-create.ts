import { createHash } from "node:crypto";
import type { MiddlewareHandler } from "hono";
import type { AuditSink } from "@mezan/domain";
import { MutatingMethod, preloadBody } from "./audit-boundary.js";
import type { AuthContextResolver } from "./permission-gate.js";

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

export enum IdempotencyRefusal {
  KeyReused = "IDEMPOTENCY_KEY_REUSED",
}

export const IDEMPOTENT_REPLAY_HEADER = "idempotent-replay";

/** Creates that post money or stock on one request, or open a document a second copy of which would be confirmed too. */
export const IDEMPOTENT_CREATES: readonly string[] = ["/sales-invoices", "/vouchers", "/vouchers/collections"];

const KEPT_FOR_MS = 7 * 24 * 60 * 60_000;
const FORGET_EVERY = 500;
const SUCCESS_FROM = 200;
const SUCCESS_BELOW = 300;
const JSON_TYPE = "application/json; charset=UTF-8";

export interface IdempotentCreateOptions {
  readonly requests: IdempotentRequests;
  readonly resolveAuthContext: AuthContextResolver;
  readonly audit?: AuditSink;
  readonly now?: () => Date;
}

function clientKey(body: unknown): string | null {
  if (body === null || typeof body !== "object") return null;
  const id = (body as { id?: unknown }).id;
  return typeof id === "string" && id !== "" ? id : null;
}

// A CREATE WHOSE ANSWER WAS LOST MUST NOT RUN TWICE. A till that timed out, a
// browser that dropped its connection, a clerk who pressed the button again:
// each resends the same create, and the first one may well have posted. The
// client mints the document's id once per document it means to create, and that
// id is the key — the same key with the same body is answered with what the
// first attempt was told, and with a different body it is refused.
// Registered AHEAD of the connection's turn: the lookup is a read, the answer is
// read off the response once the turn is over, and recording it is a turn of
// its own. If the process dies between the create and that record, the resend
// reaches the handler and is refused there as a duplicate id — never run twice.
export function idempotentCreate(options: IdempotentCreateOptions): MiddlewareHandler {
  const { requests, resolveAuthContext, audit } = options;
  const now = options.now ?? (() => new Date());
  const inFlight = new Map<string, Promise<void>>();
  let recorded = 0;

  const inATurn = <T>(work: () => T): Promise<T> => (audit?.turn ? audit.turn(async () => work()) : Promise.resolve(work()));

  return async (c, next) => {
    if (c.req.method !== MutatingMethod.Post) return next();
    await preloadBody(c);
    const text = await c.req.text().catch(() => "");
    let body: unknown = null;
    try {
      body = JSON.parse(text);
    } catch {
      return next();
    }
    const key = clientKey(body);
    if (key === null) return next();
    const caller = await resolveAuthContext(c);
    if (!caller.authenticated) return next();

    const scope = `${c.req.path}\u0000${caller.userId}`;
    const slot = `${scope}\u0000${key}`;
    const requestHash = createHash("sha256").update(text, "utf8").digest("hex");
    // ORDER MATTERS: nothing is awaited between the last look at `inFlight` and
    // the claim below, or two sends of one create both find the slot free.
    for (let ahead = inFlight.get(slot); ahead; ahead = inFlight.get(slot)) await ahead;
    await audit?.settled?.();
    for (let ahead = inFlight.get(slot); ahead; ahead = inFlight.get(slot)) await ahead;

    const earlier = requests.find(scope, key);
    if (earlier) {
      if (earlier.requestHash !== requestHash) {
        return c.json(
          {
            error: IdempotencyRefusal.KeyReused,
            message: "سبق تسجيل مستند بهذا المعرّف ببيانات مختلفة، فلم يُسجَّل هذا الطلب. حدّث الصفحة وأعد المحاولة.",
            messageEn: "A document was already recorded under this id with different contents, so this request was not recorded. Reload and try again.",
          },
          409,
        );
      }
      return new Response(earlier.body, {
        status: earlier.status,
        headers: { "content-type": JSON_TYPE, [IDEMPOTENT_REPLAY_HEADER]: "true" },
      });
    }

    let finished!: () => void;
    inFlight.set(
      slot,
      new Promise<void>((resolve) => {
        finished = resolve;
      }),
    );
    try {
      await next();
      const status = c.res.status;
      if (status < SUCCESS_FROM || status >= SUCCESS_BELOW) return;
      const answer = await c.res.clone().text();
      await inATurn(() => {
        requests.record(scope, key, { requestHash, status, body: answer }, now().toISOString());
        recorded += 1;
        if (recorded % FORGET_EVERY === 0) requests.forget(new Date(now().getTime() - KEPT_FOR_MS).toISOString());
      });
    } finally {
      inFlight.delete(slot);
      finished();
    }
  };
}
