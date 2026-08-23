import { randomUUID } from "node:crypto";
import { createApp, type App } from "@mezan/api";
import {
  StockLedgerService,
  createSalesInvoiceGlHook,
  createSalesInvoiceStockHook,
  createTreasuryLedgerReader,
  VoucherService,
  type TreasuryTransferInput,
  DocumentService,
  createDocumentWorkflowGate,
  createJournalGlHook,
  createInventoryStockHook,
  createSalesReturnDocumentType,
  createPurchaseReturnDocumentType,
  createLandedCostDocumentType,
  LandedCostService,
  installmentPlanDocumentType,
} from "@mezan/domain";
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
  createSqliteStockLedgerStore,
  createSqliteSalesInvoiceStore,
  createSqlitePriceListStore,
  createSqlitePromotionStore,
  createSqliteSalesQuoteStore,
  createSqliteExchangeRateRepository,
  createSqliteEtaStore,
  createScryptHasher,
  createSqlitePurchaseOrderStore,
  createSqliteGoodsReceiptStore,
  createSqlitePurchaseInvoiceStore,
  createSqliteVoucherStore,
  createStandaloneSqliteInstallmentPlanStore,
  createSqliteChequeRepository,
  createSqliteBankReconciliationStore,
  createSqliteLeadRepository,
  createSqliteOpportunityRepository,
  createSqlitePipelineStageRepository,
  createSqliteActivityRepository,
  createSqliteProjectRepository,
  createSqliteAssetCategoryRepository,
  createSqliteAssetRepository,
  createSqliteDepreciationRunRepository,
  createSqliteVanTripRepository,
  createSqliteManufacturingStores,
  createSqliteRfqStores,
  createSqliteHistoricalPurchaseArchiveStore,
  createStandaloneSqliteSalesReturnStore,
  createStandaloneSqlitePurchaseReturnStore,
  createStandaloneSqliteLandedCostStore,
  createStandaloneSqliteFollowUpStore,
} from "@mezan/persistence";
import { EtaService, Money } from "@mezan/domain";
import { createAuthRoutes } from "./auth-routes.js";
import { createDashboardRoutes } from "./dashboard-routes.js";
import { seedIfEmpty, type SeedStores } from "./seed.js";

/**
 * The GL accounts the purchase chain's invoice confirm posts against —
 * docs/catalog/04's standard COA (packages/domain/src/accounts/coa-template.ts):
 * inventory (1200), trade payables (2100), input VAT (1400), freight (5200).
 */
const PURCHASE_GL_ACCOUNTS = {
  inventoryAccountId: "1200",
  payableAccountId: "2100",
  taxAccountId: "1400",
  freightAccountId: "5200",
};

/**
 * System-default fixed-assets GL accounts (docs/catalog/07 §تصنيفات الأصول
 * "افتراضيات الإهلاك" helper text) — used whenever a depreciation run posts
 * for an asset/category that didn't override its own account mapping.
 */
const FIXED_ASSETS_GL_ACCOUNTS = {
  depreciationExpenseAccountId: "5400",
  accumulatedDepreciationAccountId: "1590",
};

/**
 * The GL accounts a completed work order's WIP posting debits/credits
 * (packages/domain/src/manufacturing/types.ts's `WorkOrderGlAccounts`) —
 * the 4 dedicated leaves added to the standard COA template
 * (packages/domain/src/accounts/coa-template.ts): raw inventory (1210),
 * finished goods (1220), labor applied (5110), overhead applied (5210).
 */
const MANUFACTURING_GL_ACCOUNTS = {
  finishedGoodsAccountId: "1220",
  rawInventoryAccountId: "1210",
  laborAppliedAccountId: "5110",
  overheadAppliedAccountId: "5210",
};

/**
 * The GL accounts مرتجعات المبيعات posts against — reuses the same standard
 * COA leaves the sales-invoice/purchase-chain postings already use (no
 * dedicated contra-revenue account exists in the template, so the return
 * debits sales revenue directly rather than a separate returns account).
 */
const SALES_RETURN_GL_ACCOUNTS = {
  accountsReceivableId: "1105",
  salesReturnsAccountId: "4100",
  outputTaxPayableAccountId: "2200",
  inventoryAccountId: "1200",
  cogsAccountId: "5100",
};

/** The GL accounts مرتجعات المشتريات posts against — mirrors `PURCHASE_GL_ACCOUNTS`. */
const PURCHASE_RETURN_GL_ACCOUNTS = {
  accountsPayableId: "2100",
  inputTaxPayableId: "1400",
  inventoryAccountId: "1200",
};

/**
 * The GL accounts التكاليف الإضافية posts against — the freight/customs
 * accrual reuses trade payables (2100) as its clearing account; no dedicated
 * "accrued landed cost" leaf exists in the template.
 */
const LANDED_COST_GL_ACCOUNTS = {
  inventoryAccountId: "1200",
  accruedLandedCostPayableId: "2100",
};

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
  const priceLists = createSqlitePriceListStore(dbPath);
  const promotions = createSqlitePromotionStore(dbPath);
  const salesQuotes = createSqliteSalesQuoteStore(dbPath);
  const exchangeRates = createSqliteExchangeRateRepository(dbPath);
  const etaStore = createSqliteEtaStore(dbPath);
  const etaService = new EtaService({ config: etaStore.config, submissions: etaStore.submissions });
  const hasher = createScryptHasher();

  // --- phase9/operational-reports — read-only repositories the /reports routes aggregate over,
  // shared with phase5/full-sales's sales-invoice GL/stock hooks below (same tables, one connection each). ---
  const salesInvoices = createSqliteSalesInvoiceStore(dbPath);
  const purchaseInvoices = createSqlitePurchaseInvoiceStore(dbPath);
  const stockLedger = createSqliteStockLedgerStore(dbPath);
  const installmentPlans = createStandaloneSqliteInstallmentPlanStore(dbPath);

  // --- sweep/real-data-screens — the purchase chain's order/receipt stores and the
  // treasury-voucher store; `purchaseInvoices` above is shared with the /reports wiring
  // so both routes see the same confirmed invoices. ---
  const purchaseOrders = createSqlitePurchaseOrderStore(dbPath);
  const goodsReceipts = createSqliteGoodsReceiptStore(dbPath);
  const vouchers = createSqliteVoucherStore(dbPath);

  // --- phase7/treasury-completion — سجل الشيكات + تسوية كشوف البنك. The reconciliation
  // ledger reader resolves a treasury account's GL account and reads its posted movements,
  // so statement lines only ever link to entries the voucher/cheque engines already posted. ---
  const cheques = createSqliteChequeRepository(dbPath);
  const bankStatements = createSqliteBankReconciliationStore(dbPath);

  // --- phase11/crm-projects-assets-field — CRM, Projects, Fixed Assets, Field/Van Sales. ---
  const leads = createSqliteLeadRepository(dbPath);
  const opportunities = createSqliteOpportunityRepository(dbPath);
  const pipelineStages = createSqlitePipelineStageRepository(dbPath);
  const activities = createSqliteActivityRepository(dbPath);
  const projects = createSqliteProjectRepository(dbPath);
  const assetCategories = createSqliteAssetCategoryRepository(dbPath);
  const assets = createSqliteAssetRepository(dbPath);
  const depreciationRuns = createSqliteDepreciationRunRepository(dbPath);
  const vanTrips = createSqliteVanTripRepository(dbPath);

  // --- sweep/finish-and-mount — manufacturing (docs/catalog/07: BOMs, work
  // orders, configurable products, custom manufacturing) and RFQ + historical
  // purchase import (docs/catalog/02). ---
  const manufacturing = createSqliteManufacturingStores(dbPath);
  const rfqStores = createSqliteRfqStores(dbPath);
  const historicalImportArchives = createSqliteHistoricalPurchaseArchiveStore(dbPath);

  // --- sweep/finish-and-mount — مرتجعات المبيعات/المشتريات, التكاليف
  // الإضافية, خطط الأقساط + متابعة التحصيل (docs/catalog/01, 02, 05). ---
  const salesReturnStore = createStandaloneSqliteSalesReturnStore(dbPath);
  const purchaseReturnStore = createStandaloneSqlitePurchaseReturnStore(dbPath);
  const landedCostStore = createStandaloneSqliteLandedCostStore(dbPath);
  const followUps = createStandaloneSqliteFollowUpStore(dbPath);

  const stockService = new StockLedgerService({
    ledger: stockLedger.ledger,
    layers: stockLedger.layers,
    snapshots: stockLedger.snapshots,
    policy: { allowNegativeStock: false },
    transaction: stockLedger.transaction,
  });
  const salesInvoiceGl = { ledger, accounts, periods: fiscalPeriods, numbering: ledger.numbering };
  const documentGl = createJournalGlHook(salesInvoiceGl);
  const noWorkflow = createDocumentWorkflowGate(() => null);

  const salesReturns = new DocumentService(createSalesReturnDocumentType(SALES_RETURN_GL_ACCOUNTS), {
    repo: salesReturnStore,
    numbering: { next: () => ledger.numbering.next("SALES_RETURN") },
    gl: documentGl,
    stock: createInventoryStockHook(stockService),
    workflow: noWorkflow,
  });
  const purchaseReturns = new DocumentService(createPurchaseReturnDocumentType(PURCHASE_RETURN_GL_ACCOUNTS), {
    repo: purchaseReturnStore,
    numbering: { next: () => ledger.numbering.next("PURCHASE_RETURN") },
    gl: documentGl,
    stock: createInventoryStockHook(stockService),
    workflow: noWorkflow,
  });
  const landedCostDocuments = new DocumentService(createLandedCostDocumentType(LANDED_COST_GL_ACCOUNTS), {
    repo: landedCostStore,
    numbering: { next: () => ledger.numbering.next("LANDED_COST") },
    gl: documentGl,
    workflow: noWorkflow,
  });
  const landedCosts = new LandedCostService(landedCostDocuments, stockService);
  const installmentPlanDocuments = new DocumentService(installmentPlanDocumentType, {
    repo: installmentPlans,
    numbering: { next: () => ledger.numbering.next("INSTALLMENT_PLAN") },
    workflow: noWorkflow,
  });

  const seedStores: SeedStores = {
    accounts,
    branches,
    warehouses,
    settings,
    taxRates,
    fiscalPeriods,
    uow,
    hasher,
    pipelineStages,
  };
  await seedIfEmpty(seedStores);

  // --- Field/Van Sales' openVanTrip/settleVanTrip reuse the REAL treasury
  // voucher engine for the opening cash float / cash-handed-in transfer: a
  // confirmed "inter_treasury_transfer" voucher between the two treasury
  // accounts, posted through the same GL engine every other voucher uses. ---
  const vanTripVoucherService = new VoucherService({
    documents: vouchers.documents,
    ledger,
    accounts,
    periods: fiscalPeriods,
    numbering: ledger.numbering,
    treasuryAccounts,
    allocations: vouchers.allocations,
    invoices: vouchers.invoices,
  });
  async function vanTripTreasuryTransfer(input: TreasuryTransferInput): Promise<void> {
    const [from, to] = await Promise.all([
      treasuryAccounts.findById(input.fromTreasuryAccountId),
      treasuryAccounts.findById(input.toTreasuryAccountId),
    ]);
    const id = randomUUID();
    await vanTripVoucherService.createVoucher({
      id,
      date: input.date,
      voucherType: "inter_treasury_transfer",
      amount: input.amount,
      branchId: input.branchId,
      paymentMethod: "cash",
      treasuryAccountId: input.fromTreasuryAccountId,
      treasuryGlAccountId: from?.glAccountId ?? "1010",
      counterTreasuryAccountId: input.toTreasuryAccountId,
      counterTreasuryGlAccountId: to?.glAccountId ?? "1010",
    });
    await vanTripVoucherService.confirmVoucher(id);
  }

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
    inventory: { service: stockService },
    gl: {
      ledger,
      accounts,
      periods: fiscalPeriods,
      numbering: ledger.numbering,
    },
    vouchers: {
      documents: vouchers.documents,
      allocations: vouchers.allocations,
      invoices: vouchers.invoices,
      ledger,
      accounts,
      periods: fiscalPeriods,
      numbering: ledger.numbering,
      treasuryAccounts,
    },
    purchases: {
      orders: purchaseOrders,
      receipts: goodsReceipts,
      invoices: purchaseInvoices,
      numbering: ledger.numbering,
      stock: stockService,
      gl: salesInvoiceGl,
      accounts: PURCHASE_GL_ACCOUNTS,
    },
    salesInvoices: {
      repo: salesInvoices,
      numbering: { next: () => ledger.numbering.next("SALES_INVOICE") },
      gl: createSalesInvoiceGlHook(salesInvoiceGl),
      stock: createSalesInvoiceStockHook(stockService),
    },
    cheques: {
      cheques,
      gl: salesInvoiceGl,
    },
    bankReconciliation: {
      statements: bankStatements.statements,
      mappings: bankStatements.mappings,
      ledgerReader: createTreasuryLedgerReader({ treasuryAccounts, ledger }),
    },
    priceListRepo: priceLists,
    promotionRepo: promotions,
    salesQuotes: {
      repo: salesQuotes,
      numbering: { next: () => ledger.numbering.next("SALES_QUOTE") },
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
    // --- phase11/crm-projects-assets-field ---
    crm: {
      leads,
      opportunities,
      pipelineStages,
      activities,
      customers,
    },
    projects: {
      projects,
      costCenters,
    },
    fixedAssets: {
      categories: assetCategories,
      assets,
      runs: depreciationRuns,
      gl: salesInvoiceGl,
      defaultAccounts: FIXED_ASSETS_GL_ACCOUNTS,
    },
    fieldSales: {
      trips: vanTrips,
      stock: stockService,
      treasuryTransfer: vanTripTreasuryTransfer,
    },
    manufacturing: {
      boms: manufacturing.boms,
      workOrders: manufacturing.workOrders,
      configurableProducts: manufacturing.configurableProducts,
      configInstances: manufacturing.configInstances,
      numbering: ledger.numbering,
      stock: stockService,
      gl: salesInvoiceGl,
      accounts: MANUFACTURING_GL_ACCOUNTS,
      resolveUnitCost: async (itemId: string) => {
        const item = await items.findById(itemId);
        return item?.costPrice ?? Money.zero();
      },
    },
    rfq: {
      rfqs: rfqStores.rfqs,
      quotes: rfqStores.quotes,
      orders: purchaseOrders,
      numbering: ledger.numbering,
    },
    // gl/accounts omitted — no historical-import GL adapter yet; archives
    // import without posting a remaining-balance journal entry.
    historicalImport: {
      archives: historicalImportArchives,
    },
    salesReturns: { service: salesReturns },
    purchaseReturns: { service: purchaseReturns },
    landedCosts: { documents: landedCostDocuments, service: landedCosts },
    installments: { plans: installmentPlanDocuments, plansRepo: installmentPlans, followUps },
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
    priceLists,
    promotions,
    salesQuotes,
    exchangeRates,
    etaStore,
    salesInvoices,
    purchaseInvoices,
    stockLedger,
    installmentPlans,
    purchaseOrders,
    goodsReceipts,
    vouchers,
    cheques,
    bankStatements,
    leads,
    opportunities,
    pipelineStages,
    activities,
    projects,
    assetCategories,
    assets,
    depreciationRuns,
    vanTrips,
    manufacturing,
    rfqStores,
    historicalImportArchives,
    salesReturnStore,
    purchaseReturnStore,
    landedCostStore,
    followUps,
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
