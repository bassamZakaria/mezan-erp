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
  type SettingsRepository,
  type BranchRepository,
  type WarehouseRepository,
  type CustomerRepository,
  type SupplierRepository,
  type ItemRepository,
} from "@mezan/domain";
import { createJournalEntrySchema } from "@mezan/contracts";
import { createLanRoutes } from "./lan/routes.js";
import type { EntitlementsResolver } from "./module-gate.js";
import { createAccountsRouter } from "./accounts.js";
import type { AuthContextResolver } from "./permission-gate.js";
import { createSettingsRoutes } from "./settings-routes.js";
import { createBranchesRoutes } from "./branches-routes.js";
import { createWarehousesRoutes } from "./warehouses-routes.js";
import { createCustomersRouter } from "./customers-routes.js";
import { createSuppliersRouter } from "./suppliers-routes.js";
import { createItemsRouter } from "./items-routes.js";

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
  /**
   * Mounts `/items` (docs/catalog/03 "الأصناف") when present. Items aren't
   * part of the journal-posting `UnitOfWork` yet, so its repository is
   * injected separately — omit it and the app behaves exactly as before (no
   * `/items` routes), same as any existing caller.
   */
  readonly items?: {
    readonly repo: ItemRepository;
    readonly resolveAuthContext?: AuthContextResolver;
  };
  /** Mounts `/settings` (docs/catalog/09) when present — omit it for no `/settings` route. */
  readonly settingsStore?: SettingsRepository;
  /** Mounts `/branches` (docs/catalog/09) when present — omit it for no `/branches` route. */
  readonly branchStore?: BranchRepository;
  /** Mounts `/warehouses` (docs/catalog/09) when present — omit it for no `/warehouses` route. */
  readonly warehouseStore?: WarehouseRepository;
  /** Mounts `/customers` (docs/catalog/01 "العملاء") when present — omit it for no `/customers` route. */
  readonly customerStore?: CustomerRepository;
  /** Mounts `/suppliers` (docs/catalog/02 "الموردون") when present — omit it for no `/suppliers` route. */
  readonly supplierStore?: SupplierRepository;
  /**
   * Resolves the caller's AuthContext for the settings/branches/warehouses/
   * customers/suppliers routes. Defaults to `headerAuthContextResolver` (see
   * permission-gate.ts), the same default `createAccountsRouter` uses — omit
   * it to get that header-driven spike behavior; a real deployment injects a
   * resolver derived from the JWT/session instead.
   */
  readonly resolveAuthContext?: AuthContextResolver;
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

  if (options.settingsStore) {
    app.route("/settings", createSettingsRoutes(options.settingsStore, options.resolveAuthContext));
  }
  if (options.branchStore) {
    app.route("/branches", createBranchesRoutes(options.branchStore, options.resolveAuthContext));
  }
  if (options.warehouseStore) {
    app.route("/warehouses", createWarehousesRoutes(options.warehouseStore, options.resolveAuthContext));
  }
  if (options.customerStore) {
    app.route("/customers", createCustomersRouter(options.customerStore, options.resolveAuthContext));
  }
  if (options.supplierStore) {
    app.route("/suppliers", createSuppliersRouter(options.supplierStore, options.resolveAuthContext));
  }

  if (options.accounts) {
    app.route("/accounts", createAccountsRouter(options.accounts.repo, options.accounts.resolveAuthContext));
  }

  if (options.items) {
    app.route("/items", createItemsRouter(options.items.repo, options.items.resolveAuthContext));
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
