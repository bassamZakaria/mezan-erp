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

/**
 * LEDGER INVARIANT: a create that names its own id runs in one transaction, and
 * the store's refusal of a taken id rolls ALL of it back — the document number
 * it minted, the audit row, any posting — on every route, one added later
 * included. No route looks the id up first: the insert-only write is the only
 * thing that refuses it, so there is nothing a refused create can leave behind.
 */
export function refusedCreateRollsBack(transactor: ConfigTransactor): MiddlewareHandler {
  return async function refusedCreate(c, next) {
    if (c.req.method !== "POST" || !namesAnId(await readJson(c))) return next();
    try {
      await transactor.run(async () => {
        await next();
        if (refusedRequests.has(c.req.raw)) throw new RefusedCreateRollback();
      });
    } catch (err) {
      if (!(err instanceof RefusedCreateRollback)) throw err;
    }
  };
}
