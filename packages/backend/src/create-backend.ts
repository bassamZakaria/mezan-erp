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
  stockAdjustmentDocumentType,
  stockTransferDocumentType,
  createInventoryOpsStockHook,
  createInventoryGlPostingHook,
  PAYROLL_GL_ACCOUNTS,
  PhysicalCountService,
  SALES_INVOICE_ACTIVE_STATUSES,
  salesInvoiceTotals,
  purchaseInvoiceTotal,
  Qty,
  purchaseReturnGrandTotal,
  salesReturnGrandTotal,
  totalLandedCost,
  Money,
  getAdjustmentReasonDefinition,
  type AdjustmentReason,
  type StockAdjustmentDocLine,
  type StockTransferDocLine,
  EventBus,
  NotificationRulesEngine,
  WebhookDispatcher,
  type WebhookRetryPolicy,
  type WebhookTransportPort,
  type DocumentEventPublisher,
  type DocumentEventType,
  type EventCode,
  createProductTemplateSpecificationUsage,
} from "@mezan/domain";
import {
  openSqliteConnection,
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
  createSqliteHistoricalSalesArchiveStore,
  createStandaloneSqliteSalesReturnStore,
  createStandaloneSqlitePurchaseReturnStore,
  createStandaloneSqliteLandedCostStore,
  createStandaloneSqliteFollowUpStore,
  createSqlitePrintTemplateConfigStore,
  createSqliteInventoryOpsStore,
  createSqliteItemCatalogStores,
  createSqliteItemSpecificationRepository,
  createSqliteDepartmentRepository,
  createSqliteJobTitleRepository,
  createSqliteEmployeeRepository,
  createSqliteContractRepository,
  createSqliteHolidayRepository,
  createSqliteAttendanceRepository,
  createSqliteEmployeeAdvanceRepository,
  createSqliteLeaveAccrualBatchRepository,
  createSqliteLeaveBalanceRepository,
  createSqliteLeavePolicyRepository,
  createSqliteLeaveRequestRepository,
  createSqlitePayrollRunRepository,
  createSqlitePayslipRepository,
  createSqliteWritedownRunRepository,
  createSqliteProductTemplateStore,
  createSqliteNotificationRuleStore,
  createSqliteNotificationStore,
  createSqliteWorkflowConfigStore,
  createSqliteApprovalRequestStore,
  createDataMigrationTransactor,
  createSqliteApiKeyStore,
  createSqliteBarcodeConfigStore,
  createSqliteAuditSink,
  createSqliteLabelLayoutStore,
  createSqliteSequenceConfigStore,
  createSqliteSequenceStore,
  createSqliteWebhookStores,
} from "@mezan/persistence";
import {
  EtaService,
  DuplicateEtaSubmissionError,
  type SalesInvoiceRepository,
  type SalesInvoiceLine,
  type CustomerRepository,
} from "@mezan/domain";
import { createAuthRoutes } from "./auth-routes.js";
import { createDashboardRoutes } from "./dashboard-routes.js";
import { seedIfEmpty, type SeedStores } from "./seed.js";
import { seedDemoTenant } from "./demo-seed.js";
import { createHrTreasuryDisbursementPort } from "./hr-treasury-disbursement.js";
import { createFetchWebhookTransport, createHmacWebhookSigner } from "./webhook-transport.js";

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
 * GL accounts the inventory aging-based write-down batch posts to
 * (docs/backlog.md Phase 4 "aging-based inventory write-down batch",
 * packages/domain/src/accounts/coa-template.ts): 5060 the write-down expense,
 * 1190 the contra-asset provision.
 */
const INVENTORY_WRITEDOWN_GL_ACCOUNTS = {
  writedownExpenseAccountId: "5060",
  provisionAccountId: "1190",
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
 * Stock-adjustment reason → GL account mapping (R5.9). Every reason posts a
 * balanced entry now: the account each one moves value against is part of the
 * reason's own definition (packages/domain/src/inventory/reasons.ts), so it
 * cannot be decided per caller or omitted.
 *
 * Before this, only INITIAL_STOCK posted anything. The other seven — damage,
 * theft, expiry, shortage, supplier return, count correction and other —
 * moved value out of inventory and told the GL nothing, so the stock
 * sub-ledger and its 1200 control account drifted apart with no trace.
 */
function adjustmentGlAccountsForReason(reason: AdjustmentReason): { inventoryAccountId: string; counterpartAccountId: string } {
  return {
    inventoryAccountId: "1200",
    counterpartAccountId: getAdjustmentReasonDefinition(reason).counterpartAccountId,
  };
}

/**
 * The GL accounts التكاليف الإضافية posts against — the freight/customs
 * accrual reuses trade payables (2100) as its clearing account; no dedicated
 * "accrued landed cost" leaf exists in the template.
 */
const LANDED_COST_GL_ACCOUNTS = {
  inventoryAccountId: "1200",
  accruedLandedCostPayableId: "2100",
};

/**
 * Bridges the document framework's generic `DocumentEventPublisher` port
 * (`DOCUMENT_CONFIRMED`/`DOCUMENT_CANCELLED`/…, keyed by `docType` — see
 * `packages/domain/src/documents/hooks.ts`, "decoupled from the notification
 * catalog" by design) onto a real catalog `EventCode` published on the ONE
 * shared `EventBus` the notification-rules engine subscribes to. This is the
 * translation step docs/plan.md §5.6 anticipates but does not itself provide.
 *
 * `enrich` lets a document type attach extra template fields (this repo only
 * has one so far: sales invoices' customerName/amount) beyond the generic
 * `documentNumber` every bridged document gets for free.
 */
type DocumentEventMapping = Partial<Record<string, Partial<Record<DocumentEventType, EventCode>>>>;

/**
 * The event codes this build really publishes — read straight off the bridge
 * mappings above, so `/notification-rules/triggers`' honest `emitted` flag can
 * never drift from the wiring that produces it.
 */
function emittedEventCodesOf(...mappings: readonly DocumentEventMapping[]): EventCode[] {
  const codes = new Set<EventCode>();
  for (const mapping of mappings) {
    for (const byType of Object.values(mapping)) {
      for (const code of Object.values(byType ?? {})) {
        if (code) codes.add(code);
      }
    }
  }
  return [...codes];
}

function createDocumentEventBridge(
  eventBus: EventBus,
  mapping: DocumentEventMapping,
  enrich?: (docId: string) => Promise<Record<string, unknown>>,
): DocumentEventPublisher {
  return {
    publish(event) {
      const code = mapping[event.docType]?.[event.type];
      if (!code) return;
      const basePayload: Record<string, unknown> = { documentNumber: event.docNo ?? event.docId };
      if (!enrich) {
        eventBus.publish(code, basePayload, event.occurredAt);
        return;
      }
      // DocumentEventPublisher.publish is synchronous; the notification
      // engine's own dispatch is independently async, so a fire-and-forget
      // enrichment lookup here just widens the payload before that dispatch
      // runs — a failed lookup logs and drops the event rather than ever
      // throwing back into the document's own confirm/cancel transaction.
      void enrich(event.docId)
        .then((extra) => eventBus.publish(code, { ...basePayload, ...extra }, event.occurredAt))
        .catch((error: unknown) => {
          console.error(`[notifications] event bridge enrichment failed for ${event.docType}/${event.type}`, error);
        });
    },
  };
}

/**
 * The producer the ETA queue never had (D5): every confirmed sales invoice is
 * built into an ETA submission in status جاهز, ready for the e-invoicing screen
 * to submit. `EtaService.enqueue` and the whole submission lifecycle existed
 * already — no route and no event bridge ever called it, so `/eta/submissions`
 * could not have a row no matter what the user did.
 *
 * Deliberately fire-and-forget, like the notification and webhook bridges: a
 * queueing failure must never fail the confirm that emitted it. A document
 * already queued (a re-confirm after an approval) is not an error.
 */
function createEtaEnqueueBridge(deps: {
  readonly eta: EtaService;
  readonly invoices: Pick<SalesInvoiceRepository, "findById">;
  readonly customers: Pick<CustomerRepository, "findById">;
}): DocumentEventPublisher {
  return {
    publish(event) {
      if (event.type !== "DOCUMENT_CONFIRMED" || event.docType !== "SALES_INVOICE") return;
      void (async () => {
        const invoice = await deps.invoices.findById(event.docId);
        if (!invoice) return;
        const customer = await deps.customers.findById(invoice.customerId);
        const totals = salesInvoiceTotals(invoice);
        const lineTotals = new Map(totals.lines.map((l) => [l.lineId, l]));
        await deps.eta.enqueue({
          internalId: invoice.docNo ?? invoice.id,
          documentType: "invoice",
          issueDateTime: event.occurredAt,
          receiver: {
            registrationNumber: customer?.taxNumber ?? null,
            name: invoice.customerNameAr,
            type: customer?.taxNumber ? "B" : "P",
          },
          lines: invoice.lines.map((line: SalesInvoiceLine) => {
            const lt = lineTotals.get(line.lineId);
            return {
              description: line.itemNameAr,
              itemCode: line.itemId,
              quantity: line.qty.toString(),
              unitPrice: line.unitPrice.toString(),
              netTotal: (lt?.taxableBase ?? Money.zero()).toString(),
              taxSubType: "V009",
              taxRate: String(line.taxRatePercent),
              taxAmount: (lt?.tax ?? Money.zero()).toString(),
            };
          }),
          totalNet: totals.taxableTotal.toString(),
          totalTax: totals.taxTotal.toString(),
          totalAmount: totals.grandTotal.toString(),
        });
      })().catch((error: unknown) => {
        if (error instanceof DuplicateEtaSubmissionError) return;
        console.error(`[eta] could not queue ${event.docType}/${event.docId}`, error);
      });
    },
  };
}

/** Publishes one document event to several publishers — a document type has room for exactly one. */
function fanOutDocumentEvents(...publishers: readonly DocumentEventPublisher[]): DocumentEventPublisher {
  return {
    publish(event) {
      for (const publisher of publishers) publisher.publish(event);
    },
  };
}

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
  /**
   * Seeds the demo tenant profile (`demo-seed.ts`) on top of the empty-tenant
   * bootstrap. FOR TESTS AND LOCAL DEVELOPMENT ONLY — apps/server passes it
   * only on `MEZAN_SEED_DEMO=1`, and apps/desktop never passes it, so a real
   * install never receives invented data.
   */
  readonly seedDemoData?: boolean;
  /**
   * Outbound HTTP for the webhook dispatcher. Defaults to a real `fetch`
   * sender; a test or a demo run passes a stub so nothing leaves the machine.
   */
  readonly webhookTransport?: WebhookTransportPort;
  /**
   * Overrides the dispatcher's bounded retry policy (3 attempts, 500ms then
   * 2s, 10s per-attempt timeout). Tests shorten it; nothing else should.
   */
  readonly webhookRetry?: Partial<WebhookRetryPolicy>;
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

  // ONE shared connection for every store below, instead of each of the ~35
  // stores opening its own. They all point at the SAME on-disk file (or the
  // same ":memory:" instance), and several of them call into each other
  // *inside* an open write transaction — e.g. sales-invoice confirm runs
  // stock issue + GL posting inside the sales-invoice store's own BEGIN
  // IMMEDIATE. With separate connections, the inner write needs the SAME
  // file's write lock the outer connection is still holding — a same-call-
  // stack deadlock that `busy_timeout` cannot wait out (the outer connection
  // can't release the lock until the inner call returns), which is exactly
  // the SQLITE_BUSY ("database is locked") confirm used to throw against a
  // real file. One connection means those are just further statements on the
  // same writer — no cross-connection lock contention at all. `foreign_keys`
  // still needs setting per-store below since it's a per-connection pragma,
  // but harmless to set repeatedly on the same connection.
  const { sqlite } = openSqliteConnection(dbPath);

  const sequenceConfig = createSqliteSequenceConfigStore(sqlite);
  const sequenceCounters = createSqliteSequenceStore(sqlite);
  // The ONE audit sink for the whole backend. Without it the `audit_event`
  // table is never written and `/audit` reports an empty log.
  const auditSink = createSqliteAuditSink(sqlite);
  const apiKeys = createSqliteApiKeyStore(sqlite);
  const barcodeConfig = createSqliteBarcodeConfigStore(sqlite);
  const dataMigrationTransactor = createDataMigrationTransactor(sqlite);
  const webhookStores = createSqliteWebhookStores(sqlite);
  const labelLayouts = createSqliteLabelLayoutStore(sqlite);

  const uow = createSqliteUnitOfWork(sqlite);
  const settings = createSqliteSettingsStore(sqlite);
  const branches = createSqliteBranchStore(sqlite);
  const warehouses = createSqliteWarehouseStore(sqlite);
  const accounts = createSqliteAccountRepository(sqlite);
  const customers = createSqliteCustomerRepository(sqlite);
  const suppliers = createSqliteSupplierRepository(sqlite);
  const items = createSqliteItemStore(sqlite);
  const itemCatalog = createSqliteItemCatalogStores(sqlite);
  const itemSpecifications = createSqliteItemSpecificationRepository(sqlite);
  const taxRates = createSqliteTaxRateRepository(sqlite);
  const costCenters = createSqliteCostCenterRepository(sqlite);
  const treasuryAccounts = createSqliteTreasuryAccountRepository(sqlite);
  const fiscalPeriods = createSqliteFiscalPeriodRepository(sqlite);
  const ledger = createSqliteLedgerStore(sqlite, sequenceConfig);
  const priceLists = createSqlitePriceListStore(sqlite);
  const promotions = createSqlitePromotionStore(sqlite);
  const salesQuotes = createSqliteSalesQuoteStore(sqlite);
  const exchangeRates = createSqliteExchangeRateRepository(sqlite);
  const etaStore = createSqliteEtaStore(sqlite);
  const etaService = new EtaService({ config: etaStore.config, submissions: etaStore.submissions });
  const hasher = createScryptHasher();

  // --- phase9/operational-reports — read-only repositories the /reports routes aggregate over,
  // shared with phase5/full-sales's sales-invoice GL/stock hooks below (same tables, one connection each). ---
  const salesInvoices = createSqliteSalesInvoiceStore(sqlite);
  const purchaseInvoices = createSqlitePurchaseInvoiceStore(sqlite);
  const stockLedger = createSqliteStockLedgerStore(sqlite);
  const installmentPlans = createStandaloneSqliteInstallmentPlanStore(sqlite);

  // --- sweep/real-data-screens — the purchase chain's order/receipt stores and the
  // treasury-voucher store; `purchaseInvoices` above is shared with the /reports wiring
  // so both routes see the same confirmed invoices. ---
  const purchaseOrders = createSqlitePurchaseOrderStore(sqlite);
  const goodsReceipts = createSqliteGoodsReceiptStore(sqlite);
  const vouchers = createSqliteVoucherStore(sqlite);

  // --- phase7/treasury-completion — سجل الشيكات + تسوية كشوف البنك. The reconciliation
  // ledger reader resolves a treasury account's GL account and reads its posted movements,
  // so statement lines only ever link to entries the voucher/cheque engines already posted. ---
  const cheques = createSqliteChequeRepository(sqlite);
  const bankStatements = createSqliteBankReconciliationStore(sqlite);

  // --- phase11/crm-projects-assets-field — CRM, Projects, Fixed Assets, Field/Van Sales. ---
  const leads = createSqliteLeadRepository(sqlite);
  const opportunities = createSqliteOpportunityRepository(sqlite);
  const pipelineStages = createSqlitePipelineStageRepository(sqlite);
  const activities = createSqliteActivityRepository(sqlite);
  const projects = createSqliteProjectRepository(sqlite);
  const assetCategories = createSqliteAssetCategoryRepository(sqlite);
  const assets = createSqliteAssetRepository(sqlite);
  const depreciationRuns = createSqliteDepreciationRunRepository(sqlite);
  const vanTrips = createSqliteVanTripRepository(sqlite);

  // --- inv/labels-templates-writedown — the aging-based inventory write-down batch. ---
  const writedownRuns = createSqliteWritedownRunRepository(sqlite);

  // --- inv/labels-templates-writedown — Product Templates (attribute CRUD + variant generator). ---
  const productTemplateStore = createSqliteProductTemplateStore(sqlite);

  // --- sweep/finish-and-mount — manufacturing (docs/catalog/07: BOMs, work
  // orders, configurable products, custom manufacturing) and RFQ + historical
  // purchase import (docs/catalog/02). ---
  const manufacturing = createSqliteManufacturingStores(sqlite);
  const rfqStores = createSqliteRfqStores(sqlite);
  const historicalImportArchives = createSqliteHistoricalPurchaseArchiveStore(sqlite);
  const salesHistoricalImportArchives = createSqliteHistoricalSalesArchiveStore(sqlite);

  // --- w8/print-migration — Print Template designer config (docs/catalog/09
  // §"قوالب الطباعة"). The Data Migration wizard's department/employee steps
  // reuse hr/master-data's own `hrDepartments`/`hrEmployees` stores below. ---
  const printTemplateConfig = createSqlitePrintTemplateConfigStore(sqlite);

  // --- sweep/finish-and-mount — مرتجعات المبيعات/المشتريات, التكاليف
  // الإضافية, خطط الأقساط + متابعة التحصيل (docs/catalog/01, 02, 05). ---
  const salesReturnStore = createStandaloneSqliteSalesReturnStore(sqlite);
  const purchaseReturnStore = createStandaloneSqlitePurchaseReturnStore(sqlite);
  const landedCostStore = createStandaloneSqliteLandedCostStore(sqlite);
  const followUps = createStandaloneSqliteFollowUpStore(sqlite);

  // --- phase4/inventory-ops — Stock Adjustments, Stock Transfers, Physical
  // Counts document layer (docs/catalog/03), on the SAME shared connection
  // (createSqliteInventoryOpsStore reuses `sqlite` here rather than opening
  // its own — see packages/persistence/src/sqlite-connection.ts). ---
  const inventoryOps = createSqliteInventoryOpsStore(sqlite);

  // --- hr/master-data — departments, job titles, employees, contracts, holidays, leave requests (docs/catalog/06 §"الموارد البشرية"). ---
  const hrDepartments = createSqliteDepartmentRepository(sqlite);
  const hrJobTitles = createSqliteJobTitleRepository(sqlite);
  const hrEmployees = createSqliteEmployeeRepository(sqlite);
  const hrContracts = createSqliteContractRepository(sqlite);
  const hrHolidays = createSqliteHolidayRepository(sqlite);
  const hrLeaveRequests = createSqliteLeaveRequestRepository(sqlite);
  const hrAttendance = createSqliteAttendanceRepository(sqlite);
  const hrLeavePolicies = createSqliteLeavePolicyRepository(sqlite);
  const hrLeaveBalances = createSqliteLeaveBalanceRepository(sqlite);
  const hrLeaveAccrualBatches = createSqliteLeaveAccrualBatchRepository(sqlite);
  const hrAdvances = createSqliteEmployeeAdvanceRepository(sqlite);
  const hrPayrollRuns = createSqlitePayrollRunRepository(sqlite);
  const hrPayslips = createSqlitePayslipRepository(sqlite);

  // --- w8/notifications — قواعد الإشعارات rules engine. ONE EventBus for the
  // whole backend; the engine subscribes to every event and (per rule) writes
  // real, persisted in-app notifications. Document-confirm flows publish onto
  // it via `createDocumentEventBridge` below (see that function's docstring
  // for why a translation step is needed at all). ---
  const notificationRules = createSqliteNotificationRuleStore(sqlite);
  const notifications = createSqliteNotificationStore(sqlite);
  const eventBus = new EventBus({
    onError: (error, event) => {
      console.error(`[notifications] a subscriber failed handling "${event.code}"`, error);
    },
  });
  const notificationEngine = new NotificationRulesEngine({
    rules: notificationRules,
    notifications,
    users: uow.users,
    roles: uow.roles,
    generateId: () => randomUUID(),
  });
  eventBus.subscribeAll((event) => {
    void notificationEngine.handle(event).catch((error: unknown) => {
      console.error(`[notifications] engine failed handling "${event.code}"`, error);
    });
  });

  // --- Webhook dispatcher — the SECOND subscriber on the same bus. It POSTs a
  // signed body to every enabled subscription matching the fired code, retries
  // with bounded backoff, and records each attempt. Deliberately detached: the
  // handler returns immediately so a slow or broken receiver can never delay
  // or fail the confirm that emitted the event. ---
  const webhookDispatcher = new WebhookDispatcher({
    webhooks: webhookStores.webhooks,
    deliveries: webhookStores.deliveries,
    transport: options.webhookTransport ?? createFetchWebhookTransport(),
    signature: createHmacWebhookSigner(),
    generateId: () => randomUUID(),
    retry: options.webhookRetry,
    onError: (error, context) => {
      console.error(`[webhooks] dispatch failed for "${context.event.code}"`, error);
    },
  });
  eventBus.subscribeAll((event) => {
    void webhookDispatcher.handle(event).catch((error: unknown) => {
      console.error(`[webhooks] dispatcher rejected handling "${event.code}"`, error);
    });
  });

  // --- w8/workflow-ui — إعدادات الموافقات chain-builder + الموافقات inbox
  // (docs/catalog/09 §سير العمل). `workflowConfigs` is also the REAL
  // `resolveConfig` behind `createDocumentWorkflowGate` below — a tenant that
  // configures a chain for e.g. SALES_RETURN_CONFIRM has that document type
  // actually held بانتظار الموافقة on confirm, not just a config the /workflow
  // screen has no effect on. ---
  const workflowConfigs = createSqliteWorkflowConfigStore(sqlite);
  const approvalRequests = createSqliteApprovalRequestStore(sqlite);

  const salesInvoiceGl = { ledger, accounts, periods: fiscalPeriods, numbering: ledger.numbering };
  const stockService = new StockLedgerService({
    ledger: stockLedger.ledger,
    layers: stockLedger.layers,
    snapshots: stockLedger.snapshots,
    policy: { allowNegativeStock: false },
    transaction: stockLedger.transaction,
    // Only activates when a caller ALSO passes a per-call `gl` (StockLedgerService
    // posts only when BOTH are present) — today that's just stock-adjustments'
    // INITIAL_STOCK reason (createInventoryOpsStockHook below); every other stock
    // hook (sales invoices, purchases, manufacturing, transfers) posts its own GL
    // through a separate path and never passes `command.gl`, so this is additive.
    gl: createInventoryGlPostingHook(salesInvoiceGl),
  });
  const documentGl = createJournalGlHook(salesInvoiceGl);
  const documentWorkflowGate = createDocumentWorkflowGate(
    (actionType) => workflowConfigs.resolveSync(actionType),
    approvalRequests,
  );

  // Returns' notification events carry only `documentNumber` (the generic
  // framework doesn't expose a uniform customer/amount field across every
  // document flavour) — a rule can still target them, its template just
  // won't have `{{customerName}}`/`{{amount}}` to substitute.
  const returnsEventMapping = {
    SALES_RETURN: { DOCUMENT_CONFIRMED: "SALES_RETURN_CONFIRMED" },
    PURCHASE_RETURN: { DOCUMENT_CONFIRMED: "PURCHASE_RETURN_CONFIRMED", DOCUMENT_CANCELLED: "PURCHASE_RETURN_VOIDED" },
  } satisfies DocumentEventMapping;
  const returnsEventBridge = createDocumentEventBridge(eventBus, returnsEventMapping);

  // Sales invoices are the one document type the catalog's own email-template
  // preview names explicitly ("تم إنشاء الفاتورة INV-000123 بقيمة 1,150.00 ج.م
  // للعميل" — docs/catalog/09 §البريد الإلكتروني), so this bridge enriches the
  // generic documentNumber with the two other named template fields.
  const salesInvoiceEventMapping = {
    SALES_INVOICE: { DOCUMENT_CONFIRMED: "SALES_INVOICE_CONFIRMED", DOCUMENT_CANCELLED: "SALES_INVOICE_VOIDED" },
  } satisfies DocumentEventMapping;
  const salesInvoiceEventBridge = createDocumentEventBridge(
    eventBus,
    salesInvoiceEventMapping,
    async (docId) => {
      const invoice = await salesInvoices.findById(docId);
      if (!invoice) return {};
      const totals = salesInvoiceTotals(invoice);
      return { customerName: invoice.customerNameAr, amount: totals.grandTotal.toString() };
    },
  );

  const salesInvoiceEvents = fanOutDocumentEvents(
    salesInvoiceEventBridge,
    createEtaEnqueueBridge({ eta: etaService, invoices: salesInvoices, customers }),
  );

  const salesReturns = new DocumentService(createSalesReturnDocumentType(SALES_RETURN_GL_ACCOUNTS), {
    repo: salesReturnStore,
    numbering: { next: () => ledger.numbering.next("SALES_RETURN") },
    gl: documentGl,
    stock: createInventoryStockHook(stockService),
    workflow: documentWorkflowGate,
    events: returnsEventBridge,
  });
  const purchaseReturns = new DocumentService(createPurchaseReturnDocumentType(PURCHASE_RETURN_GL_ACCOUNTS), {
    repo: purchaseReturnStore,
    numbering: { next: () => ledger.numbering.next("PURCHASE_RETURN") },
    gl: documentGl,
    stock: createInventoryStockHook(stockService),
    workflow: documentWorkflowGate,
    events: returnsEventBridge,
  });
  const landedCostDocuments = new DocumentService(createLandedCostDocumentType(LANDED_COST_GL_ACCOUNTS), {
    repo: landedCostStore,
    numbering: { next: () => ledger.numbering.next("LANDED_COST") },
    gl: documentGl,
    workflow: documentWorkflowGate,
  });
  const landedCosts = new LandedCostService(landedCostDocuments, stockService);
  const installmentPlanDocuments = new DocumentService(installmentPlanDocumentType, {
    repo: installmentPlans,
    numbering: { next: () => ledger.numbering.next("INSTALLMENT_PLAN") },
    workflow: documentWorkflowGate,
  });

  // --- phase4/inventory-ops — Stock Adjustments/Transfers reuse the SAME
  // stock-ledger engine's stock hook (postAdjustment/postTransfer post GL
  // themselves when a mapping is given — see document-hooks.ts); Physical
  // Count is a bespoke service that drives the SAME adjustments DocumentService
  // (create draft → confirm) to post its reconciling adjustment. ---
  const inventoryOpsStockHook = createInventoryOpsStockHook(stockService, adjustmentGlAccountsForReason);
  const stockAdjustments = new DocumentService<StockAdjustmentDocLine>(stockAdjustmentDocumentType, {
    repo: inventoryOps.stockAdjustments,
    numbering: { next: () => ledger.numbering.next("STOCK_ADJUSTMENT") },
    stock: inventoryOpsStockHook,
  });
  const stockTransfers = new DocumentService<StockTransferDocLine>(stockTransferDocumentType, {
    repo: inventoryOps.stockTransfers,
    numbering: { next: () => ledger.numbering.next("STOCK_TRANSFER") },
    stock: inventoryOpsStockHook,
  });
  const physicalCounts = new PhysicalCountService({
    repo: inventoryOps.physicalCounts,
    stockLedger: stockService,
    adjustments: stockAdjustments,
    numbering: { next: () => ledger.numbering.next("PHYSICAL_COUNT") },
  });

  /**
   * مطابقة الأرصدة — Balance Reconciliation's sub-ledger side (docs/catalog/04):
   * the SAME AR/AP/inventory control accounts the purchase/sales-return/landed-
   * cost postings above already use (1105 trade receivables, 2100 trade
   * payables, 1200 inventory). AR/inventory sub-ledger totals are recomputed
   * independently of the GL (never read the ledger itself, or a mismatch could
   * never surface) — AR from live sales invoices' outstanding balance (the
   * SAME grandTotal-minus-amountPaid math credit-control exposure uses),
   * inventory from the stock-ledger's own WAC snapshots. Purchase invoices
   * don't track payments yet (purchasing/purchase-invoice.ts), so every
   * confirmed invoice's full total is outstanding AP — matching
   * reports/aging-suppliers.ts's own documented assumption.
   */
  async function resolveReconciliationControls() {
    const [invoices, purchInvoices, snapshots, salesReturnDocs, purchaseReturnDocs, landedCostDocs] = await Promise.all([
      salesInvoices.list(),
      purchaseInvoices.list(),
      stockLedger.snapshots.list(),
      salesReturns.list(),
      purchaseReturns.list(),
      landedCostDocuments.list(),
    ]);

    let arScaled = 0n;
    for (const inv of invoices) {
      if (!SALES_INVOICE_ACTIVE_STATUSES.has(inv.status)) continue;
      const totals = salesInvoiceTotals(inv);
      arScaled += totals.grandTotal.scaled - inv.amountPaid.scaled;
    }
    // A confirmed sales return credits AR in the GL. Omitting it here left the
    // control account moving while the sub-ledger stood still, so every tenant
    // that ever posted a return saw a false mismatch.
    for (const doc of salesReturnDocs) {
      if (doc.status !== "confirmed") continue;
      arScaled -= salesReturnGrandTotal(doc).scaled;
    }

    let apScaled = 0n;
    for (const inv of purchInvoices) {
      if (inv.status !== "confirmed") continue;
      apScaled += purchaseInvoiceTotal(inv).scaled;
    }
    // A purchase return debits AP; a landed cost credits it (the freight and
    // customs owed to a third party accrue to the same control account).
    for (const doc of purchaseReturnDocs) {
      if (doc.status !== "confirmed") continue;
      apScaled -= purchaseReturnGrandTotal(doc).scaled;
    }
    for (const doc of landedCostDocs) {
      if (doc.status !== "confirmed") continue;
      // costItems is denormalized onto EVERY target line, so summing per line
      // multiplies the document's total by its line count. One document, one
      // credit to AP — take the cost items from any single line.
      const costItems = doc.lines[0]?.costItems;
      if (costItems) apScaled += totalLandedCost(costItems).scaled;
    }

    let inventoryScaled = 0n;
    for (const snap of snapshots) {
      inventoryScaled += snap.totalValue.scaled;
    }

    return [
      { key: "inventory", label: "تقييم المخزون مقابل دفتر الأستاذ", controlAccountId: "1200", naturalBalance: "debit" as const, subLedgerBalance: Money.fromScaled(inventoryScaled) },
      { key: "ar", label: "ذمم العملاء مقابل دفتر الأستاذ", controlAccountId: "1105", naturalBalance: "debit" as const, subLedgerBalance: Money.fromScaled(arScaled) },
      { key: "ap", label: "ذمم الموردين مقابل دفتر الأستاذ", controlAccountId: "2100", naturalBalance: "credit" as const, subLedgerBalance: Money.fromScaled(apScaled) },
    ];
  }

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
    itemCatalog,
    labelLayouts,
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
  const hrTreasuryDisbursement = createHrTreasuryDisbursementPort({
    documents: vouchers.documents,
    ledger,
    accounts,
    periods: fiscalPeriods,
    numbering: ledger.numbering,
    treasuryAccounts,
    allocations: vouchers.allocations,
    invoices: vouchers.invoices,
    settings,
    resolveGateConfig: (actionType) => workflowConfigs.resolveSync(actionType),
    audit: auditSink,
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
    items: { repo: items, snapshots: stockLedger.snapshots },
    itemCatalog: { units: itemCatalog.units, categories: itemCatalog.categories },
    itemSpecifications: {
      repo: itemSpecifications,
      usage: createProductTemplateSpecificationUsage(productTemplateStore.templates),
    },
    labelLayouts: { repo: labelLayouts },
    sequences: { counters: sequenceCounters, config: sequenceConfig, audit: auditSink },
    audit: { store: auditSink },
    auditSink,
    barcodeConfigStore: barcodeConfig,
    apiKeys: { repo: apiKeys },
    webhooks: { webhooks: webhookStores.webhooks, deliveries: webhookStores.deliveries },
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
      audit: auditSink,
    },
    vouchers: {
      audit: auditSink,
      // A configured TREASURY_VOUCHER_CONFIRM chain used to be ignored
      // outright: without these two the gate resolved every config to null and
      // held requests were never persisted for the inbox.
      resolveGateConfig: (actionType) => workflowConfigs.resolveSync(actionType),
      approvalRequests,
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
      allocatable: vouchers.invoices,
      audit: auditSink,
      // Mounts POST /purchases/receipts/:id/cancel and /invoices/:id/cancel,
      // which 404 without it. app.ts derives the GL reversal port from this
      // being present, so omitting it silently disables both.
      layers: stockLedger.layers,
    },
    salesInvoices: {
      repo: salesInvoices,
      numbering: { next: () => ledger.numbering.next("SALES_INVOICE") },
      gl: createSalesInvoiceGlHook(salesInvoiceGl),
      stock: createSalesInvoiceStockHook(stockService),
      // Without this a configured SALES_INVOICE_CONFIRM chain had zero effect —
      // SalesInvoiceService.confirm skips its gate entirely when absent.
      workflow: documentWorkflowGate,
      audit: auditSink,
      events: salesInvoiceEvents,
      allocatable: vouchers.invoices,
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
    reconciliation: { ledger, resolveControls: resolveReconciliationControls },
    // --- phase4/inventory-ops ---
    stockAdjustments: { service: stockAdjustments },
    stockTransfers: { service: stockTransfers },
    physicalCounts: { service: physicalCounts },
    // --- phase11/crm-projects-assets-field ---
    crm: {
      leads,
      opportunities,
      pipelineStages,
      activities,
      customers,
    },
    // --- hr/master-data ---
    hr: {
      departments: hrDepartments,
      jobTitles: hrJobTitles,
      employees: hrEmployees,
      contracts: hrContracts,
      holidays: hrHolidays,
      leaveRequests: hrLeaveRequests,
      attendance: hrAttendance,
      leavePolicies: hrLeavePolicies,
      leaveBalances: hrLeaveBalances,
      leaveAccrualBatches: hrLeaveAccrualBatches,
      workflow: { configs: workflowConfigs, requests: approvalRequests },
      payroll: {
        advances: hrAdvances,
        runs: hrPayrollRuns,
        payslips: hrPayslips,
        gl: salesInvoiceGl,
        accounts: PAYROLL_GL_ACCOUNTS,
        treasury: hrTreasuryDisbursement,
      },
      users: uow.users,
      numbering: ledger.numbering,
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
    inventoryWritedown: {
      runs: writedownRuns,
      wacSnapshots: stockLedger.snapshots,
      stockLedger: stockLedger.ledger,
      gl: salesInvoiceGl,
      accounts: INVENTORY_WRITEDOWN_GL_ACCOUNTS,
    },
    productTemplates: {
      templates: productTemplateStore.templates,
      variants: productTemplateStore.variants,
      items,
      specifications: itemSpecifications,
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
    printTemplateConfig: {
      repo: printTemplateConfig,
    },
    dataMigration: {
      departments: hrDepartments,
      employees: hrEmployees,
      treasuryAccounts,
      suppliers,
      customers,
      items,
      assetCategories,
      assets,
      branches,
      warehouses,
      stockAdjustments,
      transact: dataMigrationTransactor,
      historicalCounts: async () => {
        const [purchaseArchives, salesArchives] = await Promise.all([
          historicalImportArchives.list(),
          salesHistoricalImportArchives.list(),
        ]);
        return {
          salesInvoices: salesArchives.filter((a) => a.docType === "SALES_INVOICE").length,
          salesReturns: salesArchives.filter((a) => a.docType === "SALES_RETURN").length,
          purchaseInvoices: purchaseArchives.filter((a) => a.docType === "PURCHASE_INVOICE").length,
          purchaseReturns: purchaseArchives.filter((a) => a.docType === "PURCHASE_RETURN").length,
        };
      },
    },
    // gl/accounts omitted — no historical-import GL adapter yet; archives
    // import without posting a remaining-balance journal entry.
    salesHistoricalImport: {
      archives: salesHistoricalImportArchives,
    },
    salesReturns: {
      service: salesReturns,
      /**
       * Derives the returnable quantity from the invoice minus what confirmed
       * returns have already taken. Before this the server validated against a
       * figure the CLIENT supplied, so the same goods could be returned
       * repeatedly by claiming the full invoiced quantity each time.
       */
      invoices: {
        async findConfirmedInvoice(id: string) {
          const invoice = await salesInvoices.findById(id);
          if (!invoice || !SALES_INVOICE_ACTIVE_STATUSES.has(invoice.status)) return null;
          const priorReturns = await salesReturns.list();
          const returnedByItem = new Map<string, Qty>();
          for (const doc of priorReturns) {
            if (doc.status !== "confirmed") continue;
            for (const line of doc.lines) {
              if (line.sourceInvoiceId !== id) continue;
              returnedByItem.set(line.itemId, (returnedByItem.get(line.itemId) ?? Qty.zero()).add(line.qty));
            }
          }
          return {
            id: invoice.id,
            number: invoice.docNo ?? invoice.id,
            customerId: invoice.customerId,
            warehouseId: invoice.warehouseId,
            date: invoice.date,
            status: "confirmed" as const,
            lines: invoice.lines.map((l) => ({
              itemId: l.itemId,
              itemName: l.itemNameAr,
              qty: l.qty,
              alreadyReturnedQty: returnedByItem.get(l.itemId) ?? Qty.zero(),
              unitPrice: l.unitPrice,
              unitCost: l.unitPrice,
              taxAmount: Money.zero(),
            })),
          };
        },
      },
    },
    purchaseReturns: {
      service: purchaseReturns,
      /** See salesReturns.invoices — same defect, same fix. */
      invoices: {
        async findConfirmedInvoice(id: string) {
          const invoice = await purchaseInvoices.findById(id);
          if (!invoice || invoice.status !== "confirmed") return null;
          const priorReturns = await purchaseReturns.list();
          const returnedByItem = new Map<string, Qty>();
          for (const doc of priorReturns) {
            if (doc.status !== "confirmed") continue;
            for (const line of doc.lines) {
              if (line.sourceInvoiceId !== id) continue;
              returnedByItem.set(line.itemId, (returnedByItem.get(line.itemId) ?? Qty.zero()).add(line.qty));
            }
          }
          return {
            id: invoice.id,
            number: invoice.number ?? invoice.id,
            supplierId: invoice.supplierId,
            warehouseId: invoice.warehouseId,
            date: invoice.date,
            status: "confirmed" as const,
            lines: invoice.lines
              .filter((l) => l.itemId !== null)
              .map((l) => ({
                itemId: l.itemId as string,
                itemName: l.description ?? (l.itemId as string),
                qty: l.qty,
                alreadyReturnedQty: returnedByItem.get(l.itemId as string) ?? Qty.zero(),
                unitCost: l.unitCost,
                taxAmount: Money.zero(),
              })),
          };
        },
      },
    },
    landedCosts: { documents: landedCostDocuments, service: landedCosts },
    installments: { plans: installmentPlanDocuments, plansRepo: installmentPlans, followUps },
    reports: {
      allocatable: vouchers.invoices,
      salesInvoices,
      purchaseInvoices,
      customers,
      suppliers,
      items,
      boms: manufacturing.boms,
      warehouses,
      stockLedger: stockLedger.ledger,
      costLayers: stockLedger.layers,
      wacSnapshots: stockLedger.snapshots,
      installmentPlans,
      // القوائم المالية read the SAME posted GL + chart of accounts every other
      // accounting surface uses — no fixture ledger behind the statements.
      ledger,
      accounts,
      // مبيعات المندوبين reads the same van-trip store /field/van-trips writes.
      vanTrips,
      employees: hrEmployees,
    },
    financialReports: {
      ledger,
      accounts,
      vatAccounts: { outputVatAccountId: "2200", inputVatAccountId: "1400" },
      cashAccountIds: ["1300-1", "1310", "1315", "1320", "1330"],
    },
    notificationRuleRepo: notificationRules,
    emittedEventCodes: emittedEventCodesOf(returnsEventMapping, salesInvoiceEventMapping),
    notificationRepo: notifications,
    workflow: { configs: workflowConfigs, requests: approvalRequests },
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
    writedownRuns,
    productTemplateStore,
    manufacturing,
    rfqStores,
    historicalImportArchives,
    salesHistoricalImportArchives,
    salesReturnStore,
    purchaseReturnStore,
    landedCostStore,
    inventoryOps,
    followUps,
    printTemplateConfig,
    hrDepartments,
    hrJobTitles,
    hrEmployees,
    hrContracts,
    hrHolidays,
    hrLeaveRequests,
    hrAttendance,
    hrLeavePolicies,
    hrLeaveBalances,
    hrLeaveAccrualBatches,
    notificationRules,
    notifications,
    workflowConfigs,
    approvalRequests,
    sequenceConfig,
    sequenceCounters,
    auditSink,
    apiKeys,
    barcodeConfig,
    webhookStores,
    labelLayouts,
  ];

  if (options.seedDemoData) {
    await seedDemoTenant(app);
  }

  return {
    app,
    close() {
      // Before the connection goes: retries waiting on a backoff pause would
      // otherwise wake up against a closed store and throw while recording.
      webhookDispatcher.stop();
      // Every store above shares the ONE `sqlite` connection opened at the
      // top of this function, so each store's own close() is a no-op (it
      // doesn't own the connection) — this loop is harmless belt-and-braces,
      // and the real close is the shared connection itself, once.
      for (const h of closers) {
        (h as { close?: () => void }).close?.();
      }
      sqlite.close();
    },
  };
}
