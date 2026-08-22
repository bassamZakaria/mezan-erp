import { createApp, type App } from "@mezan/api";
import {
  createSqliteUnitOfWork,
  createSqliteAccountRepository,
  createSqliteSettingsStore,
  createSqliteBranchStore,
  createSqliteWarehouseStore,
  createSqliteCustomerRepository,
  createSqliteSupplierRepository,
  createSqliteItemStore,
  createSqliteTaxRateRepository,
  createSqliteCostCenterRepository,
  createSqliteTreasuryAccountRepository,
  createSqliteFiscalPeriodRepository,
  createSqliteLedgerStore,
  createSqliteExchangeRateRepository,
  createSqliteEtaStore,
  createScryptHasher,
  createSqliteSalesInvoiceStore,
  createSqlitePurchaseInvoiceStore,
  createSqliteStockLedgerStore,
  createStandaloneSqliteInstallmentPlanStore,
} from "@mezan/persistence";
import { EtaService } from "@mezan/domain";
import { createAuthRoutes } from "./auth-routes.js";
import { createDashboardRoutes } from "./dashboard-routes.js";
import { seedIfEmpty, type SeedStores } from "./seed.js";

export interface BackendHandle {
  readonly app: App;
  close(): void;
}

export interface CreateBackendOptions {
  /**
   * SQLite location. A file path gives durable, shared-across-restarts storage
   * (apps/server, Electron); `:memory:` gives an ephemeral per-process DB
   * (web dev/e2e) that is freshly seeded on every start. Defaults to `:memory:`.
   */
  readonly dbPath?: string;
}

/**
 * Builds the ONE seeded Hono app for every edition. Opens SQLite, lets each
 * repository bootstrap its own tables, SEEDS an empty DB with sensible defaults
 * (COA / VAT / fiscal year / main branch+warehouse / settings / admin user),
 * then mounts the full @mezan/api surface plus the real `/auth`, `/bootstrap`
 * and `/dashboard` routes. The returned `app.fetch` is what apps/server serves
 * over HTTP, the Vite dev plugin mounts as middleware, and Electron calls over
 * IPC — one app, three transports, no behavioural difference.
 */
export async function createBackend(options: CreateBackendOptions = {}): Promise<BackendHandle> {
  const dbPath = options.dbPath ?? ":memory:";

  const uow = createSqliteUnitOfWork(dbPath);
  const settings = createSqliteSettingsStore(dbPath);
  const branches = createSqliteBranchStore(dbPath);
  const warehouses = createSqliteWarehouseStore(dbPath);
  const accounts = createSqliteAccountRepository(dbPath);
  const customers = createSqliteCustomerRepository(dbPath);
  const suppliers = createSqliteSupplierRepository(dbPath);
  const items = createSqliteItemStore(dbPath);
  const taxRates = createSqliteTaxRateRepository(dbPath);
  const costCenters = createSqliteCostCenterRepository(dbPath);
  const treasuryAccounts = createSqliteTreasuryAccountRepository(dbPath);
  const fiscalPeriods = createSqliteFiscalPeriodRepository(dbPath);
  const ledger = createSqliteLedgerStore(dbPath);
  const exchangeRates = createSqliteExchangeRateRepository(dbPath);
  const etaStore = createSqliteEtaStore(dbPath);
  const etaService = new EtaService({ config: etaStore.config, submissions: etaStore.submissions });
  const hasher = createScryptHasher();

  // --- phase9/operational-reports — read-only repositories the /reports routes aggregate over ---
  const salesInvoices = createSqliteSalesInvoiceStore(dbPath);
  const purchaseInvoices = createSqlitePurchaseInvoiceStore(dbPath);
  const stockLedger = createSqliteStockLedgerStore(dbPath);
  const installmentPlans = createStandaloneSqliteInstallmentPlanStore(dbPath);

  const seedStores: SeedStores = {
    accounts,
    branches,
    warehouses,
    settings,
    taxRates,
    fiscalPeriods,
    uow,
    hasher,
  };
  await seedIfEmpty(seedStores);

  const app = createApp(uow, {
    settingsStore: settings,
    branchStore: branches,
    warehouseStore: warehouses,
    customerStore: customers,
    supplierStore: suppliers,
    accounts: { repo: accounts },
    items: { repo: items },
    taxRateRepo: taxRates,
    costCenterRepo: costCenters,
    treasuryAccountRepo: treasuryAccounts,
    fiscalPeriodRepo: fiscalPeriods,
    hasher,
    gl: {
      ledger,
      accounts,
      periods: fiscalPeriods,
      numbering: ledger.numbering,
    },
    // --- phase9/accounting-depth ---
    exchangeRateRepo: exchangeRates,
    costCenterPl: { ledger, accounts, costCenters },
    fxRevaluation: {
      ledger,
      accounts,
      periods: fiscalPeriods,
      numbering: ledger.numbering,
      exchangeRates,
      // فائض/عجز الصندوق double as the FX gain/loss accounts (postable leaves in the standard COA).
      gainAccountId: "4900",
      lossAccountId: "5900",
    },
    eta: { service: etaService, setClientSecret: (secret) => etaStore.config.setClientSecret(secret) },
    reports: {
      salesInvoices,
      purchaseInvoices,
      customers,
      suppliers,
      items,
      warehouses,
      stockLedger: stockLedger.ledger,
      costLayers: stockLedger.layers,
      wacSnapshots: stockLedger.snapshots,
      installmentPlans,
    },
  });

  app.get("/health", (c) => c.json({ ok: true }));
  app.route("/", createAuthRoutes({ uow, hasher, settings, seedStores }));
  app.route(
    "/",
    createDashboardRoutes({
      accounts,
      ledger,
      countCustomers: async () => (await customers.findAll()).length,
      countSuppliers: async () => (await suppliers.findAll()).length,
      countItems: async () => (await items.list()).length,
      uow,
    }),
  );

  const closers = [
    uow,
    settings,
    branches,
    warehouses,
    accounts,
    customers,
    suppliers,
    items,
    taxRates,
    costCenters,
    treasuryAccounts,
    fiscalPeriods,
    ledger,
    exchangeRates,
    etaStore,
    salesInvoices,
    purchaseInvoices,
    stockLedger,
    installmentPlans,
  ];

  return {
    app,
    close() {
      for (const h of closers) {
        (h as { close?: () => void }).close?.();
      }
    },
  };
}
