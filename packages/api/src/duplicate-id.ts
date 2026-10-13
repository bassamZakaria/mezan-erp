import type { Context, MiddlewareHandler } from "hono";
import { DuplicateRecordIdError } from "@mezan/domain";
import type { ConfigTransactor } from "./config-transactor.js";

const refusedRequests = new WeakSet<Request>();

export function duplicateIdRefusal(c: Context, err: DuplicateRecordIdError): Response {
  refusedRequests.add(c.req.raw);
  return c.json({ error: err.code, message: err.message, messageEn: err.messageEn }, 409);
}

class RefusedCreateRollback extends Error {}

const ID_KEY = "id";

function namesAnId(body: unknown): boolean {
  if (body === null || typeof body !== "object" || Array.isArray(body)) return false;
  const record = body as Record<string, unknown>;
  if (typeof record[ID_KEY] === "string") return true;
  return Object.values(record).some((value) => value !== null && typeof value === "object" && !Array.isArray(value) && typeof (value as Record<string, unknown>)[ID_KEY] === "string");
}

async function readJson(c: Context): Promise<unknown> {
  try {
    return JSON.parse(await c.req.text());
  } catch {
    return undefined;
  }
}

const REFUSED_FROM = 400;
const REFUSED_FOR_THE_CALLER: ReadonlySet<number> = new Set([401, 403]);

/**
 * LEDGER INVARIANT: a create that names its own id runs in one transaction,
 * and any answer but a success rolls ALL of it back — the document number it
 * drew, the stock it moved, any posting — so a refused or faulted create
 * leaves no gap in a sequence and nothing half-done. No route looks the id up
 * first: the insert-only write is the only thing that refuses a taken one.
 *
 * SECURITY: an attempt refused for who the caller is (401, 403) keeps what it
 * recorded — that is the audit row of the attempt — unless it had already
 * drawn a number, which `numbersDrawn` reads off the counters.
 */
export function refusedCreateRollsBack(transactor: ConfigTransactor, numbersDrawn?: () => string): MiddlewareHandler {
  return async function refusedCreate(c, next) {
    if (c.req.method !== "POST" || !namesAnId(await readJson(c))) return next();
    try {
      await transactor.run(async () => {
        const before = numbersDrawn?.();
        await next();
        if (refusedRequests.has(c.req.raw)) throw new RefusedCreateRollback();
        const answered = c.res.status;
        if (answered < REFUSED_FROM) return;
        if (!REFUSED_FOR_THE_CALLER.has(answered) || (numbersDrawn !== undefined && numbersDrawn() !== before)) throw new RefusedCreateRollback();
      });
    } catch (err) {
      if (!(err instanceof RefusedCreateRollback)) throw err;
    }
  };
}
