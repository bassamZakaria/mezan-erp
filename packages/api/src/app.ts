import { Hono } from "hono";
import {
  Money,
  postJournalEntrySpike,
  UnbalancedEntryError,
  InvalidJournalEntryError,
  SeatSessionRegistry,
  createEntitlements,
  type JournalEntry,
  type UnitOfWork,
  type AccountRepository,
  type SettingsRepository,
  type BranchRepository,
  type WarehouseRepository,
  type CustomerRepository,
  type SupplierRepository,
  type ItemRepository,
  type Entitlements,
  type TaxRateRepository,
  type CostCenterRepository,
  type TreasuryAccountRepository,
  type FiscalPeriodRepository,
  type StockLedgerService,
  type DocumentService,
  type StockAdjustmentDocLine,
  type StockTransferDocLine,
  type PhysicalCountService,
} from "@mezan/domain";
import { createScryptHasher } from "@mezan/persistence";
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
import { createRolesRoutes } from "./roles-routes.js";
import { createUsersRoutes } from "./users-routes.js";
import { createTaxRatesRoutes } from "./tax-rates-routes.js";
import { createCostCentersRoutes } from "./cost-centers-routes.js";
import { createTreasuryAccountsRoutes } from "./treasury-accounts-routes.js";
import { createFiscalPeriodsRoutes } from "./fiscal-periods-routes.js";
import { createInventoryRoutes } from "./inventory-routes.js";
import { createGlRoutes, type GlRoutesDeps } from "./gl-routes.js";
import { createDocumentsRoutes } from "./documents-routes.js";
import {
  createStockAdjustmentsRoutes,
  createStockTransfersRoutes,
  createPhysicalCountsRoutes,
} from "./stock-documents-routes.js";

/**
 * The demo tenant's module list (docs/catalog/09 §recon — "Cyag"), used as
 * the default entitlements the `/roles` route validates grants against when
 * the mounting app does not supply its own `resolveEntitlements`. Phase 1 has
 * no real session/login wiring yet — apps/server / apps/desktop override this
 * once real auth + a real entitlements source land.
 */
const DEMO_ACTIVE_MODULES = [
  "sales",
  "purchases",
  "inventory",
  "accounting",
  "treasury",
  "installments",
  "financial_papers",
  "crm",
  "pos",
  "hr",
  "manufacturing",
  "assets",
  "notifications",
  "loyalty",
  "field",
];

function defaultEntitlementsResolver(): EntitlementsResolver {
  const entitlements: Entitlements = createEntitlements({
    plan: "ENTERPRISE",
    activeModules: DEMO_ACTIVE_MODULES,
    features: {},
    seats: 10,
    expiresAt: null,
  });
  return () => entitlements;
}

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
  /** Mounts `/tax-rates` (docs/catalog/04 "الضرائب") when present — omit it for no `/tax-rates` route. */
  readonly taxRateRepo?: TaxRateRepository;
  /** Mounts `/cost-centers` (docs/catalog/04 "مراكز التكلفة") when present — omit it for no `/cost-centers` route. */
  readonly costCenterRepo?: CostCenterRepository;
  /** Mounts `/treasury-accounts` (docs/catalog/04 "حسابات الخزينة") when present — omit it for no `/treasury-accounts` route. */
  readonly treasuryAccountRepo?: TreasuryAccountRepository;
  /** Mounts `/fiscal-periods` (docs/catalog/04 "الفترات المالية") when present — omit it for no `/fiscal-periods` route. */
  readonly fiscalPeriodRepo?: FiscalPeriodRepository;
  /**
   * Mounts `/inventory` (docs/catalog/03 — the costing + stock-ledger engine)
   * when present. The caller builds the `StockLedgerService` (wiring the SQLite
   * store, the negative-stock policy, and any event/GL adapters) — omit it and
   * the app behaves exactly as before (no `/inventory` routes).
   */
  readonly inventory?: {
    readonly service: StockLedgerService;
    readonly resolveAuthContext?: AuthContextResolver;
  };
  /**
   * Mounts `/inventory/stock-adjustments` (docs/catalog/03 §"تسويات المخزون")
   * — the document-layer draft/confirm CRUD built on `stockAdjustmentDocumentType`
   * — when present. Omit it for no such route (the raw `/inventory/adjustments`
   * engine endpoint above is unaffected either way).
   */
  readonly stockAdjustments?: {
    readonly service: DocumentService<StockAdjustmentDocLine>;
    readonly resolveAuthContext?: AuthContextResolver;
  };
  /** Mounts `/inventory/stock-transfers` (docs/catalog/03 §"تحويلات المخزون") when present. */
  readonly stockTransfers?: {
    readonly service: DocumentService<StockTransferDocLine>;
    readonly resolveAuthContext?: AuthContextResolver;
  };
  /** Mounts `/inventory/physical-counts` (docs/catalog/03 §"الجرد الفعلي") when present. */
  readonly physicalCounts?: {
    readonly service: PhysicalCountService;
    readonly resolveAuthContext?: AuthContextResolver;
  };
  /**
   * Mounts the GL posting engine under `/gl` (docs/catalog/04 §القيود المحاسبية)
   * when present — omit it for no `/gl` routes. Bundles its own ledger,
   * account/period lookups and numbering engine (all connection-shared for
   * atomic no-gap numbering); optional audit sink + domain-event publisher.
   */
  readonly gl?: GlRoutesDeps;
  /**
   * Resolves the caller's AuthContext for the settings/branches/warehouses/
   * customers/suppliers routes. Defaults to `headerAuthContextResolver` (see
   * permission-gate.ts), the same default `createAccountsRouter` uses — omit
   * it to get that header-driven spike behavior; a real deployment injects a
   * resolver derived from the JWT/session instead.
   */
  readonly resolveAuthContext?: AuthContextResolver;
  /**
   * Entitlements resolver the `/roles` route validates permission grants
   * against (docs/catalog/09 §الأدوار — only licensed-module permissions are
   * grantable). Defaults to a broad demo entitlements set (`DEMO_ACTIVE_MODULES`)
   * since there is no real per-tenant entitlements source wired up yet.
   */
  readonly resolveEntitlements?: EntitlementsResolver;
  /** Secret hasher for `/users` password/PIN storage. Defaults to `createScryptHasher()`. */
  readonly hasher?: ReturnType<typeof createScryptHasher>;
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
  const resolveEntitlements = options.resolveEntitlements ?? defaultEntitlementsResolver();
  const hasher = options.hasher ?? createScryptHasher();

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
  if (options.taxRateRepo) {
    app.route("/tax-rates", createTaxRatesRoutes(options.taxRateRepo, options.resolveAuthContext));
  }
  if (options.costCenterRepo) {
    app.route("/cost-centers", createCostCentersRoutes(options.costCenterRepo, options.resolveAuthContext));
  }
  if (options.treasuryAccountRepo) {
    app.route("/treasury-accounts", createTreasuryAccountsRoutes(options.treasuryAccountRepo, options.resolveAuthContext));
  }
  if (options.fiscalPeriodRepo) {
    app.route("/fiscal-periods", createFiscalPeriodsRoutes(options.fiscalPeriodRepo, options.resolveAuthContext));
  }
  if (options.gl) {
    app.route("/gl", createGlRoutes(options.gl, options.resolveAuthContext));
  }
  // Generic document framework (docs/execution-plan.md W4): read-only type
  // registry + pure effects computation. No persistence, so always mounted.
  app.route("/documents", createDocumentsRoutes(options.resolveAuthContext));

  if (options.items) {
    app.route("/items", createItemsRouter(options.items.repo, options.items.resolveAuthContext));
  }
  if (options.inventory) {
    app.route(
      "/inventory",
      createInventoryRoutes(options.inventory.service, options.inventory.resolveAuthContext),
    );
  }
  if (options.stockAdjustments) {
    app.route(
      "/inventory/stock-adjustments",
      createStockAdjustmentsRoutes(options.stockAdjustments.service, options.stockAdjustments.resolveAuthContext),
    );
  }
  if (options.stockTransfers) {
    app.route(
      "/inventory/stock-transfers",
      createStockTransfersRoutes(options.stockTransfers.service, options.stockTransfers.resolveAuthContext),
    );
  }
  if (options.physicalCounts) {
    app.route(
      "/inventory/physical-counts",
      createPhysicalCountsRoutes(options.physicalCounts.service, options.physicalCounts.resolveAuthContext),
    );
  }

  app.route("/roles", createRolesRoutes(uow, resolveEntitlements, options.resolveAuthContext));
  app.route("/users", createUsersRoutes(uow, hasher, options.resolveAuthContext));

  app.post("/journal-entries", async (c) => {
    const parsed = createJournalEntrySchema.safeParse(await c.req.json());
    if (!parsed.success) {
      return c.json(
        { error: "VALIDATION_ERROR", details: parsed.error.flatten() },
        400,
      );
    }

    try {
      const entry = await postJournalEntrySpike(
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
