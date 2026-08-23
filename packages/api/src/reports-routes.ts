import { Hono, type Context } from "hono";
import {
  Money,
  type AllocatableInvoiceRepository,
  runReport,
  createSalesByPeriodReport,
  createSalesByItemReport,
  createSalesByCustomerReport,
  createTopProductsReport,
  createPurchasesByPeriodReport,
  createPurchasesBySupplierReport,
  createPurchasesByItemReport,
  createInventoryStockLevelsReport,
  createInventoryMovementReport,
  createInventoryLedgerReport,
  createInventoryValuationReport,
  createInventoryAgingReport,
  createInventoryExpiringReport,
  createInventorySlowMovingReport,
  createInventoryDriftReport,
  createMakeVsBuyReport,
  createAgingCustomersReport,
  createAgingSuppliersReport,
  createInstallmentsOverviewReport,
  createInstallmentsOverdueReport,
  createVanSalesReport,
  createTrialBalanceReport,
  createIncomeStatementReport,
  createBalanceSheetReport,
  createCashFlowReport,
  createVatReturnReport,
  createGeneralLedgerReport,
  createAccountLedgerReport,
  OUTPUT_VAT_ACCOUNT_ID,
  INPUT_VAT_ACCOUNT_ID,
  type GlReportContext,
  type SalesInvoiceRepository,
  type PurchaseInvoiceRepository,
  type CustomerRepository,
  type SupplierRepository,
  type ItemRepository,
  type BomRepository,
  type WarehouseRepository,
  type StockLedgerRepository,
  type CostLayerRepository,
  type WacSnapshotRepository,
  type DocumentRepository,
  type InstallmentLine,
  type LedgerRepository,
  type AccountRepository,
  type VanTripRepository,
  type EmployeeRepository,
  type RunReportOutcome,
} from "@mezan/domain";
import { createPermissionGate, headerAuthContextResolver, type AuthContextResolver } from "./permission-gate.js";

/**
 * التقارير — operational reports (docs/catalog/08-reports.md), mounted under
 * `/reports`. Every route follows the SAME shape: fetch the real persisted
 * rows this report needs (straight off the repositories other modules
 * already use — no report-specific data duplication), hand them to the
 * report engine's `runReport()` as `ctx`, and return its outcome verbatim.
 * All aggregation/validation lives in `@mezan/domain/reports/*` — this file
 * is wiring only.
 */
export interface ReportsRoutesDeps {
  readonly salesInvoices: SalesInvoiceRepository;
  /** Allocation sub-ledger — lets the aging reports deduct what has actually been settled. */
  readonly allocatable?: AllocatableInvoiceRepository;
  readonly purchaseInvoices: PurchaseInvoiceRepository;
  readonly customers: CustomerRepository;
  readonly suppliers: SupplierRepository;
  readonly items: ItemRepository;
  /**
   * التصنيع أم الشراء data source. Optional: the make-vs-buy report route is
   * only mounted when a composition wires the manufacturing module's BOMs,
   * so an app without manufacturing serves no make-vs-buy report at all
   * rather than an empty one.
   */
  readonly boms?: BomRepository;
  readonly warehouses: WarehouseRepository;
  readonly stockLedger: StockLedgerRepository;
  readonly costLayers: CostLayerRepository;
  readonly wacSnapshots: WacSnapshotRepository;
  readonly installmentPlans: DocumentRepository<InstallmentLine>;
  /**
   * القوائم المالية data source (docs/catalog/08 — الميزان/قائمة الدخل/الميزانية/
   * التدفقات/الإقرار الضريبي/الأستاذ العام/دفتر حساب). The seven financial
   * statements aggregate over the SAME posted GL the journal/dashboard read —
   * `ledger` supplies the posted entries, `accounts` the chart to classify them.
   */
  readonly ledger: LedgerRepository;
  readonly accounts: AccountRepository;
  /**
   * مبيعات المندوبين data source. Optional: the van-sales report route is only
   * mounted when a composition actually wires field sales, so an app without
   * van trips serves no van-sales report at all rather than an empty one.
   */
  readonly vanTrips?: VanTripRepository;
  /** Resolves van-trip crew ids to employee names; ids are shown verbatim when absent. */
  readonly employees?: EmployeeRepository;
  /** ISO `YYYY-MM-DD` "today" — overridable for tests; defaults to the real date. */
  readonly today?: () => string;
}

function todayIso(deps: ReportsRoutesDeps): string {
  return deps.today ? deps.today() : new Date().toISOString().slice(0, 10);
}

function firstOfMonth(today: string): string {
  return `${today.slice(0, 7)}-01`;
}

function firstOfYear(today: string): string {
  return `${today.slice(0, 4)}-01-01`;
}

/**
 * The GL context every financial statement reads: the real posted journal
 * entries plus the chart of accounts to classify them. Only `posted` entries
 * feed the statements — drafts/pending/reversed never reach a report.
 */
async function loadGlContext(deps: ReportsRoutesDeps): Promise<GlReportContext> {
  const [accounts, journalEntries] = await Promise.all([
    deps.accounts.list(),
    deps.ledger.list({ status: "posted" }),
  ]);
  return { accounts, journalEntries };
}

function respond(c: Context, outcome: RunReportOutcome<unknown, unknown>): Response {
  if (!outcome.ok) {
    return c.json({ error: "VALIDATION_ERROR", errors: outcome.errors }, 400);
  }
  return c.json({
    params: outcome.params,
    rows: outcome.rows,
    groups: outcome.groups,
    grandTotals: outcome.grandTotals,
    reconciliation: outcome.reconciliation,
  });
}

/** Every stock movement across every position — the shared ledger the inventory reports slice differently. */
async function loadAllMovements(deps: ReportsRoutesDeps) {
  const positions = await deps.stockLedger.listPositions();
  const lists = await Promise.all(positions.map((p) => deps.stockLedger.listByPosition(p.itemId, p.warehouseId)));
  return lists.flat();
}

/** Every cost layer across every position (aging + drift both need the full set). */
async function loadAllLayers(deps: ReportsRoutesDeps) {
  const positions = await deps.stockLedger.listPositions();
  const lists = await Promise.all(positions.map((p) => deps.costLayers.listByPosition(p.itemId, p.warehouseId)));
  return lists.flat();
}

async function settledByInvoiceId(
  deps: ReportsRoutesDeps,
  kind: "sales" | "purchase",
): Promise<ReadonlyMap<string, Money>> {
  if (!deps.allocatable) return new Map();
  const open = await deps.allocatable.listOpen({ kind });
  return new Map(open.map((i) => [i.id, i.allocated]));
}

export function createReportsRoutes(
  deps: ReportsRoutesDeps,
  resolveAuthContext: AuthContextResolver = headerAuthContextResolver,
) {
  const app = new Hono();
  const gate = createPermissionGate(resolveAuthContext);

  function queryParams(c: Context): Record<string, string> {
    const out: Record<string, string> = {};
    for (const [key, value] of new URL(c.req.url).searchParams) out[key] = value;
    return out;
  }

  // --- المبيعات ------------------------------------------------------

  app.get("/sales/by-period", gate("sales.invoice.view"), async (c) => {
    const today = todayIso(deps);
    const definition = createSalesByPeriodReport(firstOfMonth(today), today);
    const invoices = await deps.salesInvoices.list();
    const allocatedByInvoiceId = await settledByInvoiceId(deps, "sales");
    return respond(
      c,
      runReport(definition, { ...definition.defaultParams, ...queryParams(c) }, { invoices, allocatedByInvoiceId }),
    );
  });

  app.get("/sales/by-item", gate("sales.invoice.view"), async (c) => {
    const today = todayIso(deps);
    const definition = createSalesByItemReport(firstOfMonth(today), today);
    const invoices = await deps.salesInvoices.list();
    const allocatedByInvoiceId = await settledByInvoiceId(deps, "sales");
    return respond(
      c,
      runReport(definition, { ...definition.defaultParams, ...queryParams(c) }, { invoices, allocatedByInvoiceId }),
    );
  });

  app.get("/sales/by-customer", gate("sales.invoice.view"), async (c) => {
    const today = todayIso(deps);
    const definition = createSalesByCustomerReport(firstOfMonth(today), today);
    const invoices = await deps.salesInvoices.list();
    return respond(c, runReport(definition, { ...definition.defaultParams, ...queryParams(c) }, { invoices }));
  });

  app.get("/sales/top-products", gate("sales.invoice.view"), async (c) => {
    const today = todayIso(deps);
    const definition = createTopProductsReport(firstOfMonth(today), today);
    const invoices = await deps.salesInvoices.list();
    return respond(c, runReport(definition, { ...definition.defaultParams, ...queryParams(c) }, { invoices }));
  });

  // --- المشتريات -----------------------------------------------------

  app.get("/purchases/by-period", gate("purchases.invoice.view"), async (c) => {
    const today = todayIso(deps);
    const definition = createPurchasesByPeriodReport(firstOfMonth(today), today);
    const invoices = await deps.purchaseInvoices.list();
    return respond(c, runReport(definition, { ...definition.defaultParams, ...queryParams(c) }, { invoices }));
  });

  app.get("/purchases/by-supplier", gate("purchases.invoice.view"), async (c) => {
    const today = todayIso(deps);
    const definition = createPurchasesBySupplierReport(firstOfMonth(today), today);
    const [invoices, suppliers] = await Promise.all([deps.purchaseInvoices.list(), deps.suppliers.findAll()]);
    const allocatedByInvoiceId = await settledByInvoiceId(deps, "purchase");
    return respond(
      c,
      runReport(definition, { ...definition.defaultParams, ...queryParams(c) }, { invoices, suppliers, allocatedByInvoiceId }),
    );
  });

  app.get("/purchases/by-item", gate("purchases.invoice.view"), async (c) => {
    const today = todayIso(deps);
    const definition = createPurchasesByItemReport(firstOfMonth(today), today);
    const [invoices, items] = await Promise.all([deps.purchaseInvoices.list(), deps.items.list()]);
    return respond(c, runReport(definition, { ...definition.defaultParams, ...queryParams(c) }, { invoices, items }));
  });

  // --- المخزون -------------------------------------------------------

  app.get("/inventory/stock-levels", gate("inventory.stock.view"), async (c) => {
    const definition = createInventoryStockLevelsReport();
    const [items, snapshots] = await Promise.all([deps.items.list(), deps.wacSnapshots.list()]);
    return respond(c, runReport(definition, { ...definition.defaultParams, ...queryParams(c) }, { items, snapshots }));
  });

  app.get("/inventory/movement", gate("inventory.stock.view"), async (c) => {
    const today = todayIso(deps);
    const definition = createInventoryMovementReport(firstOfMonth(today), today);
    const [movements, items, warehouses] = await Promise.all([loadAllMovements(deps), deps.items.list(), deps.warehouses.findAll()]);
    return respond(c, runReport(definition, { ...definition.defaultParams, ...queryParams(c) }, { movements, items, warehouses }));
  });

  app.get("/inventory/ledger", gate("inventory.stock.view"), async (c) => {
    const definition = createInventoryLedgerReport();
    const [movements, items, warehouses] = await Promise.all([loadAllMovements(deps), deps.items.list(), deps.warehouses.findAll()]);
    return respond(c, runReport(definition, { ...definition.defaultParams, ...queryParams(c) }, { movements, items, warehouses }));
  });

  app.get("/inventory/valuation", gate("inventory.valuation.view"), async (c) => {
    const definition = createInventoryValuationReport();
    const [items, snapshots] = await Promise.all([deps.items.list(), deps.wacSnapshots.list()]);
    return respond(c, runReport(definition, { ...definition.defaultParams, ...queryParams(c) }, { items, snapshots }));
  });

  app.get("/inventory/aging", gate("inventory.stock.view"), async (c) => {
    const definition = createInventoryAgingReport(todayIso(deps));
    const [items, warehouses, layers] = await Promise.all([deps.items.list(), deps.warehouses.findAll(), loadAllLayers(deps)]);
    return respond(c, runReport(definition, { ...definition.defaultParams, ...queryParams(c) }, { items, warehouses, layers }));
  });

  app.get("/inventory/expiring", gate("inventory.stock.view"), async (c) => {
    const definition = createInventoryExpiringReport(todayIso(deps));
    const [items, warehouses, layers] = await Promise.all([deps.items.list(), deps.warehouses.findAll(), loadAllLayers(deps)]);
    return respond(c, runReport(definition, { ...definition.defaultParams, ...queryParams(c) }, { items, warehouses, layers }));
  });

  app.get("/inventory/slow-moving", gate("inventory.stock.view"), async (c) => {
    const definition = createInventorySlowMovingReport(todayIso(deps));
    const [items, snapshots, invoices] = await Promise.all([deps.items.list(), deps.wacSnapshots.list(), deps.salesInvoices.list()]);
    return respond(c, runReport(definition, { ...definition.defaultParams, ...queryParams(c) }, { items, snapshots, invoices }));
  });

  app.get("/inventory/drift", gate("inventory.valuation.view"), async (c) => {
    const definition = createInventoryDriftReport();
    const [snapshots, movements, items, warehouses] = await Promise.all([
      deps.wacSnapshots.list(),
      loadAllMovements(deps),
      deps.items.list(),
      deps.warehouses.findAll(),
    ]);
    return respond(c, runReport(definition, { ...definition.defaultParams, ...queryParams(c) }, { snapshots, movements, items, warehouses }));
  });

  // --- التصنيع أم الشراء -----------------------------------------------

  if (deps.boms) {
    const boms = deps.boms;
    app.get("/manufacturing/make-vs-buy", gate("manufacturing.bom.view"), async (c) => {
      const definition = createMakeVsBuyReport();
      const [items, bomList, invoices] = await Promise.all([deps.items.list(), boms.list(), deps.purchaseInvoices.list()]);
      return respond(
        c,
        runReport(definition, { ...definition.defaultParams, ...queryParams(c) }, { items, boms: bomList, purchaseInvoices: invoices }),
      );
    });
  }

  // --- أعمار الديون ---------------------------------------------------

  app.get("/aging/customers", gate("sales.invoice.view"), async (c) => {
    const definition = createAgingCustomersReport(todayIso(deps));
    const invoices = await deps.salesInvoices.list();
    return respond(c, runReport(definition, { ...definition.defaultParams, ...queryParams(c) }, { invoices }));
  });

  app.get("/aging/suppliers", gate("purchases.invoice.view"), async (c) => {
    const definition = createAgingSuppliersReport(todayIso(deps));
    const [invoices, suppliers] = await Promise.all([deps.purchaseInvoices.list(), deps.suppliers.findAll()]);
    const allocatedByInvoiceId = await settledByInvoiceId(deps, "purchase");
    return respond(
      c,
      runReport(definition, { ...definition.defaultParams, ...queryParams(c) }, { invoices, suppliers, allocatedByInvoiceId }),
    );
  });

  // --- الأقساط ---------------------------------------------------------

  app.get("/installments/overview", gate("installments.plan.view"), async (c) => {
    const definition = createInstallmentsOverviewReport(todayIso(deps));
    const [plans, customers] = await Promise.all([deps.installmentPlans.list(), deps.customers.findAll()]);
    return respond(c, runReport(definition, { ...definition.defaultParams, ...queryParams(c) }, { plans, customers }));
  });

  app.get("/installments/overdue", gate("installments.plan.view"), async (c) => {
    const definition = createInstallmentsOverdueReport(todayIso(deps));
    const [plans, customers] = await Promise.all([deps.installmentPlans.list(), deps.customers.findAll()]);
    return respond(c, runReport(definition, { ...definition.defaultParams, ...queryParams(c) }, { plans, customers }));
  });

  // --- المبيعات الميدانية ------------------------------------------------

  if (deps.vanTrips) {
    const vanTrips = deps.vanTrips;
    app.get("/field/van-sales", gate("field.van_trip.view"), async (c) => {
      const today = todayIso(deps);
      const definition = createVanSalesReport(firstOfMonth(today), today);
      const [trips, employees] = await Promise.all([vanTrips.list(), deps.employees?.list() ?? []]);
      return respond(c, runReport(definition, { ...definition.defaultParams, ...queryParams(c) }, { trips, employees }));
    });
  }

  // --- القوائم المالية — Financial statements (docs/catalog/08) -------------
  // The seven statements below all compute from the REAL posted GL (loadGlContext),
  // never a fixture ledger. Each recreates the SAME `ReportDefinition` the web
  // screen renders through, so params/columns/reconciliation can never drift.

  app.get("/accounting/trial-balance", gate("accounting.reports.view"), async (c) => {
    const today = todayIso(deps);
    const definition = createTrialBalanceReport(today);
    const ctx = await loadGlContext(deps);
    return respond(c, runReport(definition, { ...definition.defaultParams, ...queryParams(c) }, ctx));
  });

  app.get("/accounting/income-statement", gate("accounting.reports.view"), async (c) => {
    const today = todayIso(deps);
    const definition = createIncomeStatementReport({ periodFrom: firstOfYear(today), periodTo: today });
    const ctx = await loadGlContext(deps);
    return respond(c, runReport(definition, { ...definition.defaultParams, ...queryParams(c) }, ctx));
  });

  app.get("/accounting/balance-sheet", gate("accounting.reports.view"), async (c) => {
    const today = todayIso(deps);
    const definition = createBalanceSheetReport(today);
    const ctx = await loadGlContext(deps);
    return respond(c, runReport(definition, { ...definition.defaultParams, ...queryParams(c) }, ctx));
  });

  app.get("/accounting/cash-flow", gate("accounting.reports.view"), async (c) => {
    const today = todayIso(deps);
    const definition = createCashFlowReport({ periodFrom: firstOfYear(today), periodTo: today });
    const ctx = await loadGlContext(deps);
    return respond(c, runReport(definition, { ...definition.defaultParams, ...queryParams(c) }, ctx));
  });

  app.get("/accounting/vat-return", gate("accounting.reports.view"), async (c) => {
    const today = todayIso(deps);
    const definition = createVatReturnReport({ periodFrom: firstOfYear(today), periodTo: today });
    const ctx = await loadGlContext(deps);
    // Resolve the VAT control accounts from the real chart (standard COA codes
    // 2200 output / 1400 input), falling back to the fixture ids if absent.
    const outputVatAccountId = ctx.accounts.find((a) => a.code === "2200")?.id ?? OUTPUT_VAT_ACCOUNT_ID;
    const inputVatAccountId = ctx.accounts.find((a) => a.code === "1400")?.id ?? INPUT_VAT_ACCOUNT_ID;
    return respond(
      c,
      runReport(definition, { ...definition.defaultParams, ...queryParams(c) }, { ...ctx, outputVatAccountId, inputVatAccountId }),
    );
  });

  app.get("/accounting/general-ledger", gate("accounting.reports.view"), async (c) => {
    const today = todayIso(deps);
    const definition = createGeneralLedgerReport({ periodFrom: firstOfYear(today), periodTo: today });
    const ctx = await loadGlContext(deps);
    return respond(c, runReport(definition, { ...definition.defaultParams, ...queryParams(c) }, ctx));
  });

  app.get("/accounting/account-ledger", gate("accounting.reports.view"), async (c) => {
    const today = todayIso(deps);
    const ctx = await loadGlContext(deps);
    const firstPostable = ctx.accounts.find((a) => !a.isHeader);
    const definition = createAccountLedgerReport(ctx.accounts, {
      accountId: firstPostable?.id ?? "",
      periodFrom: firstOfYear(today),
      periodTo: today,
    });
    return respond(c, runReport(definition, { ...definition.defaultParams, ...queryParams(c) }, ctx));
  });

  return app;
}
