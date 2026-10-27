import type { Context, MiddlewareHandler } from "hono";
import { DuplicateRecordIdError } from "@mezan/domain";
import { terminalRoutePathOf } from "./branch-policy.js";
import type { ConfigTransactor } from "./config-transactor.js";
import { ID_CARRYING_CREATE_ROUTES } from "./id-carrying-create-routes.js";

const refusedRequests = new WeakSet<Request>();

export function duplicateIdRefusal(c: Context, err: DuplicateRecordIdError): Response {
  refusedRequests.add(c.req.raw);
  return c.json({ error: err.code, message: err.message, messageEn: err.messageEn }, 409);
}

class RefusedCreateRollback extends Error {}

const REFUSED_FROM = 400;
const REFUSED_FOR_THE_CALLER: ReadonlySet<number> = new Set([401, 403]);

/**
 * LEDGER INVARIANT: a create route that takes an id from its caller runs in one
 * transaction, and any answer but a success rolls ALL of it back — the document number it
 * drew, the stock it moved, any posting — so a refused or faulted create
 * leaves no gap in a sequence and nothing half-done. No route looks the id up
 * first: the insert-only write is the only thing that refuses a taken one.
 *
 * SECURITY: the ROUTE decides whether a request runs in that transaction, never
 * its body — a caller who could choose would choose whether the audit row of
 * their own refused attempt is kept. An attempt refused for who the caller is
 * (401, 403) keeps what it recorded unless it had already drawn a number,
 * which `numbersDrawn` reads off the counters; the composition root passes a
 * transactor that writes security events after the rollback either way.
 */
export function refusedCreateRollsBack(transactor: ConfigTransactor, numbersDrawn?: () => string | Promise<string>, createRoutes: ReadonlySet<string> = ID_CARRYING_CREATE_ROUTES): MiddlewareHandler {
  return async function refusedCreate(c, next) {
    const routePath = c.req.method === "POST" ? terminalRoutePathOf(c) : undefined;
    if (routePath === undefined || !createRoutes.has(routePath)) return next();
    try {
      await transactor.run(async () => {
        const before = await numbersDrawn?.();
        await next();
        if (refusedRequests.has(c.req.raw)) throw new RefusedCreateRollback();
        const answered = c.res.status;
        if (answered < REFUSED_FROM) return;
        if (!REFUSED_FOR_THE_CALLER.has(answered) || (numbersDrawn !== undefined && (await numbersDrawn()) !== before)) throw new RefusedCreateRollback();
      });
    } catch (err) {
      if (!(err instanceof RefusedCreateRollback)) throw err;
    }
  };
}
