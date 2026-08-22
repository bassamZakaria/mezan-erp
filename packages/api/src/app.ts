import { Hono } from "hono";
import {
  Money,
  postJournalEntry,
  UnbalancedEntryError,
  InvalidJournalEntryError,
  SeatSessionRegistry,
  type JournalEntry,
  type UnitOfWork,
  type AccountRepository,
} from "@mezan/domain";
import { createJournalEntrySchema } from "@mezan/contracts";
import { createLanRoutes } from "./lan/routes.js";
import type { EntitlementsResolver } from "./module-gate.js";
import { createAccountsRouter } from "./accounts.js";
import type { AuthContextResolver } from "./permission-gate.js";

/** Wire representation of an entry — money as decimal strings, byte-stable. */
function serialize(entry: JournalEntry) {
  return {
    id: entry.id,
    date: entry.date,
    memo: entry.memo,
    status: entry.status,
    lines: entry.lines.map((l) => ({
      accountId: l.accountId,
      debit: l.debit.toString(),
      credit: l.credit.toString(),
    })),
  };
}

export interface CreateAppOptions {
  /**
   * Mounts `/lan/*` (docs/plan.md §2.6/§6.3.3) on this same app instance when
   * present. Desktop passes this so the SAME app answers both over IPC
   * (host-local) and a LAN socket (till/tablet clients) — omit it and the app
   * behaves exactly as before (no `/lan` routes at all), which is what
   * apps/server and every existing caller/test still gets by default.
   */
  readonly lan?: {
    readonly resolveEntitlements: EntitlementsResolver;
    /** Pass a shared instance to persist seat state across app.fetch() calls; defaults to a fresh, empty registry. */
    readonly registry?: SeatSessionRegistry;
    readonly sseHeartbeatMs?: number;
  };
  /**
   * Mounts `/accounts/*` (docs/catalog/04 "دليل الحسابات") when present. The
   * Chart of Accounts isn't part of the journal-posting `UnitOfWork` yet, so
   * its repository is injected separately — omit it and the app behaves
   * exactly as before (no `/accounts` routes), same as any existing caller.
   */
  readonly accounts?: {
    readonly repo: AccountRepository;
    readonly resolveAuthContext?: AuthContextResolver;
  };
}

/**
 * The ONE Hono app. A Hono app is a `(Request) => Promise<Response>` function,
 * so this exact instance is mounted two ways with no code difference:
 *   - over HTTP by apps/server (cloud shape), and
 *   - in-process via `app.fetch(new Request(...))` by apps/desktop-spike
 *     (Electron main-process shape).
 * Routes carry no business logic — they validate, call the domain, serialize.
 */
export function createApp(uow: UnitOfWork, options: CreateAppOptions = {}) {
  const app = new Hono();

  if (options.accounts) {
    app.route("/accounts", createAccountsRouter(options.accounts.repo, options.accounts.resolveAuthContext));
  }

  app.post("/journal-entries", async (c) => {
    const parsed = createJournalEntrySchema.safeParse(await c.req.json());
    if (!parsed.success) {
      return c.json(
        { error: "VALIDATION_ERROR", details: parsed.error.flatten() },
        400,
      );
    }

    try {
      const entry = await postJournalEntry(
        {
          id: parsed.data.id,
          date: parsed.data.date,
          memo: parsed.data.memo,
          lines: parsed.data.lines.map((l) => ({
            accountId: l.accountId,
            debit: Money.fromMajor(l.debit),
            credit: Money.fromMajor(l.credit),
          })),
        },
        uow,
      );
      return c.json(serialize(entry), 201);
    } catch (err) {
      if (err instanceof UnbalancedEntryError) {
        return c.json(
          {
            error: err.code,
            message: err.message,
            totalDebit: err.totalDebit.toString(),
            totalCredit: err.totalCredit.toString(),
          },
          422,
        );
      }
      if (err instanceof InvalidJournalEntryError) {
        return c.json({ error: err.code, message: err.message }, 400);
      }
      throw err;
    }
  });

  app.get("/journal-entries/:id", async (c) => {
    const entry = await uow.journal.findById(c.req.param("id"));
    if (!entry) return c.json({ error: "NOT_FOUND" }, 404);
    return c.json(serialize(entry));
  });

  if (options.lan) {
    const registry = options.lan.registry ?? new SeatSessionRegistry(0);
    app.route(
      "/lan",
      createLanRoutes({
        resolveEntitlements: options.lan.resolveEntitlements,
        registry,
        sseHeartbeatMs: options.lan.sseHeartbeatMs,
      }),
    );
  }

  return app;
}

export type App = ReturnType<typeof createApp>;
