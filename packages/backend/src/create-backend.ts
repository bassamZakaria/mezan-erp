import { randomUUID } from "node:crypto";
import { createApp, type App } from "@mezan/api";
import {
  StockLedgerService,
  applyAllocatedSettlement,
  InvalidSalesInvoicePaymentError,
  InvalidPurchaseDocumentError,
  postJournalEntry,
  resolvePrice,
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
  purchaseInvoiceBaseTotal,
  Qty,
  purchaseReturnGrandTotal,
  salesReturnGrandTotal,
  SalesReturnNotRefundableError,
  totalLandedCost,
  Money,
  getAdjustmentReasonDefinition,
  type AdjustmentReason,
  type AccountRouting,
  routedAccountId,
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
  createSqliteVatFilingStore,
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
  createSqliteAccountRoutingStore,
  createSqliteTaxGroupStore,
  createSqliteItemSpecificationRepository,
  createSqliteAttachmentRepository,
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
  createSqlitePayrollComponentRepository,
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
  resolveEtaVatSubType,
  createDefaultSettings,
  type EtaBranchCodeRepository,
  type EtaUnitMappingRepository,
  type SalesInvoiceRepository,
  type SalesInvoiceLine,
  type CustomerRepository,
  type ItemRepository,
  type TaxRateRepository,
  extend as extendQtyByPrice,
  unitCostOf,
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
 * inventory (1200), trade payables (2100), input VAT (1400), freight (5200),
 * other purchase expenses (5910).
 */
const PURCHASE_GL_ACCOUNTS = {
  inventoryAccountId: "1200",
  payableAccountId: "2100",
  taxAccountId: "1400",
  freightAccountId: "5200",
  // R4.2: a general expense line on a purchase invoice is not freight; routing
  // it to 5200 made "مصروفات الشحن والنقل" the bin for everything non-stock.
  expenseAccountId: "5910",
};

/**
 * System-default fixed-assets GL accounts (docs/catalog/07 §تصنيفات الأصول
 * "افتراضيات الإهلاك" helper text) — used whenever a depreciation run posts
 * for an asset/category that didn't override its own account mapping.
 */
const FIXED_ASSETS_GL_ACCOUNTS = {
  depreciationExpenseAccountId: "5400",
  accumulatedDepreciationAccountId: "1590",
  // Disposal clears the asset's cost and its accumulated depreciation, and the
  // difference against the proceeds is a gain or a loss (D13). 1510 is only the
  // last-resort fallback: every seeded category names its own asset account,
  // and 1500 itself is a header, so nothing may post to it.
  assetAccountId: "1510",
  disposalGainAccountId: "4500",
  disposalLossAccountId: "5450",
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
  // Both inventory legs post to the ONE control account the stock ledger moves
  // value through. 1210/1220 are presentational sub-classifications the stock
  // engine does not distinguish, and posting to them left GL 1200 flat while
  // the sub-ledger moved by labour plus overhead (D3) — `accountBalance` has no
  // subtree rollup, so a control account only ever sees what was posted to it.
  finishedGoodsAccountId: "1200",
  rawInventoryAccountId: "1200",
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
  priceVarianceAccountId: "5080",
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
function adjustmentGlAccountsForReason(
  reason: AdjustmentReason,
  routing: AccountRouting | null,
): { inventoryAccountId: string; counterpartAccountId: string } {
  return {
    inventoryAccountId: routedAccountId(routing, "item_type.inventory") ?? "1200",
    // The tenant's routing table wins; the reason's own account is the
    // shipped default, so a tenant that never opens the routing screen posts
    // exactly where the hard-coded version did (R6.1).
    counterpartAccountId:
      routedAccountId(routing, `inventory_adjustment.${reason}`) ??
      getAdjustmentReasonDefinition(reason).counterpartAccountId,
    // SUPPLIER_RETURN routes to 2110 مرتجعات موردين تحت التسوية — a CLEARING
    // account, deliberately not AP 2100. The payable side belongs to a
    // purchase-return document, which owns both halves; moving 2100 from an
    // adjustment would credit a supplier with no document behind it and break
    // the AP reconciliation.
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
 * The producer the ETA queue never had (D5): a confirmed sales invoice is built
 * into an ETA submission in status جاهز, ready for the e-invoicing screen to
 * submit. `EtaService.enqueue` and the whole submission lifecycle existed
 * already — no route and no event bridge ever called it, so `/eta/submissions`
 * could not have a row no matter what the user did, and الإرسال التلقائي عند
 * التأكيد was a setting nothing read.
 *
 * The payload carries the registered codes, not the tenant's own: the item's
 * EGS/GPC code, the unit's mapped code, the branch's code with the authority
 * and the tax rate's VAT sub-type. An unregistered record falls back to the
 * tenant's own value, which is what the readiness checklist is counting.
 *
 * Deliberately fire-and-forget, like the notification and webhook bridges: a
 * queueing failure must never fail the confirm that emitted it. A document
 * already queued (a re-confirm after an approval) is not an error.
 */
function createEtaEnqueueBridge(deps: {
  readonly eta: EtaService;
  readonly invoices: Pick<SalesInvoiceRepository, "findById">;
  readonly customers: Pick<CustomerRepository, "findById">;
  readonly items: Pick<ItemRepository, "findById">;
  readonly taxRates: Pick<TaxRateRepository, "list">;
  readonly branchCodes: EtaBranchCodeRepository;
  readonly unitMappings: EtaUnitMappingRepository;
}): DocumentEventPublisher {
  return {
    publish(event) {
      if (event.type !== "DOCUMENT_CONFIRMED" || event.docType !== "SALES_INVOICE") return;
      void (async () => {
        const config = await deps.eta.getConfig();
        if (!config.autoSubmitOnConfirm) return;
        const invoice = await deps.invoices.findById(event.docId);
        if (!invoice) return;
        const customer = await deps.customers.findById(invoice.customerId);
        const totals = salesInvoiceTotals(invoice);
        const lineTotals = new Map(totals.lines.map((l) => [l.lineId, l]));
        const [taxRates, branchCodes, unitMappings] = await Promise.all([
          deps.taxRates.list(),
          deps.branchCodes.list(),
          deps.unitMappings.list(),
        ]);
        const unitByCode = new Map(unitMappings.map((m) => [m.unitCode, m.etaUnitCode]));
        const lineItems = await Promise.all(invoice.lines.map((line: SalesInvoiceLine) => deps.items.findById(line.itemId)));
        await deps.eta.enqueue({
          internalId: invoice.docNo ?? invoice.id,
          documentType: "invoice",
          issueDateTime: event.occurredAt,
          branchCode: branchCodes.find((b) => b.branchId === invoice.branchId)?.etaBranchCode ?? null,
          receiver: {
            registrationNumber: customer?.taxNumber ?? null,
            name: invoice.customerNameAr,
            type: customer?.taxNumber ? "B" : "P",
          },
          lines: invoice.lines.map((line: SalesInvoiceLine, index: number) => {
            const lt = lineTotals.get(line.lineId);
            const item = lineItems[index] ?? null;
            // The unit the LINE was priced in, not the item's base unit: the
            // quantity and unit price below are both per entered unit, so
            // filing the base unit code would misstate the quantity sold.
            const unitCode = line.unitCode !== "" ? line.unitCode : (item?.baseUnitCode ?? "");
            const taxRate = taxRates.find((r) => r.status === "active" && r.rate === line.taxRatePercent);
            return {
              description: line.itemNameAr,
              itemCode: item?.etaItemCode ?? item?.code ?? line.itemId,
              quantity: line.qty.toString(),
              unitType: unitByCode.get(unitCode) ?? unitCode,
              unitPrice: line.unitPrice.toString(),
              netTotal: (lt?.taxableBase ?? Money.zero()).toString(),
              taxSubType: resolveEtaVatSubType(taxRate?.etaSubType, line.taxRatePercent),
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
  const vatFilings = createSqliteVatFilingStore(sqlite);
  const branches = createSqliteBranchStore(sqlite);
  const warehouses = createSqliteWarehouseStore(sqlite);
  const accounts = createSqliteAccountRepository(sqlite);
  const customers = createSqliteCustomerRepository(sqlite);
  const suppliers = createSqliteSupplierRepository(sqlite);
  const items = createSqliteItemStore(sqlite);
  const itemCatalog = createSqliteItemCatalogStores(sqlite);
  const accountRouting = createSqliteAccountRoutingStore(sqlite);
  const taxGroups = createSqliteTaxGroupStore(sqlite);
  const itemSpecifications = createSqliteItemSpecificationRepository(sqlite);
  const attachments = createSqliteAttachmentRepository(sqlite);
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
  const hrPayrollComponents = createSqlitePayrollComponentRepository(sqlite);

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

  // vatFilings rides along so a DOCUMENT confirm is gated by a filed return
  // exactly as a hand-written journal entry is (D29).
  const salesInvoiceGl = { ledger, accounts, periods: fiscalPeriods, numbering: ledger.numbering, vatFilings };
  const stockService = new StockLedgerService({
    ledger: stockLedger.ledger,
    layers: stockLedger.layers,
    snapshots: stockLedger.snapshots,
    // Read per movement, not captured here: سياسة المخزون's two switches are
    // tenant settings an administrator changes between one confirm and the next.
    policy: async () => {
      const current = (await settings.get()) ?? createDefaultSettings();
      return { allowNegativeStock: current.allowNegativeStock, allowBackorder: current.allowBackorder };
    },
    transaction: stockLedger.transaction,
    // Only activates when a caller ALSO passes a per-call `gl` (StockLedgerService
    // posts only when BOTH are present) — today that's every stock-adjustment
    // reason (createInventoryOpsStockHook below); every other stock
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
    createEtaEnqueueBridge({
      eta: etaService,
      invoices: salesInvoices,
      customers,
      items,
      taxRates,
      branchCodes: etaStore.branchCodes,
      unitMappings: etaStore.unitMappings,
    }),
  );

  const salesReturns = new DocumentService(createSalesReturnDocumentType(SALES_RETURN_GL_ACCOUNTS), {
    repo: salesReturnStore,
    numbering: { next: (opts) => ledger.numbering.next("SALES_RETURN", { branchId: opts?.branchId }) },
    gl: documentGl,
    stock: createInventoryStockHook(stockService),
    workflow: documentWorkflowGate,
    events: returnsEventBridge,
  });
  const purchaseReturns = new DocumentService(createPurchaseReturnDocumentType(PURCHASE_RETURN_GL_ACCOUNTS), {
    repo: purchaseReturnStore,
    numbering: { next: (opts) => ledger.numbering.next("PURCHASE_RETURN", { branchId: opts?.branchId }) },
    gl: documentGl,
    stock: createInventoryStockHook(stockService),
    workflow: documentWorkflowGate,
    events: returnsEventBridge,
  });
  const landedCostDocuments = new DocumentService(createLandedCostDocumentType(LANDED_COST_GL_ACCOUNTS), {
    repo: landedCostStore,
    numbering: { next: (opts) => ledger.numbering.next("LANDED_COST", { branchId: opts?.branchId }) },
    gl: documentGl,
    workflow: documentWorkflowGate,
  });
  const landedCosts = new LandedCostService(landedCostDocuments, stockService);
  const installmentPlanDocuments = new DocumentService(installmentPlanDocumentType, {
    repo: installmentPlans,
    numbering: { next: (opts) => ledger.numbering.next("INSTALLMENT_PLAN", { branchId: opts?.branchId }) },
    workflow: documentWorkflowGate,
  });

  // --- phase4/inventory-ops — Stock Adjustments/Transfers reuse the SAME
  // stock-ledger engine's stock hook (postAdjustment/postTransfer post GL
  // themselves when a mapping is given — see document-hooks.ts); Physical
  // Count is a bespoke service that drives the SAME adjustments DocumentService
  // (create draft → confirm) to post its reconciling adjustment. ---
  const inventoryOpsStockHook = createInventoryOpsStockHook(stockService, async (reason) =>
    adjustmentGlAccountsForReason(reason, await accountRouting.get()),
  );
  const stockAdjustments = new DocumentService<StockAdjustmentDocLine>(stockAdjustmentDocumentType, {
    repo: inventoryOps.stockAdjustments,
    numbering: { next: (opts) => ledger.numbering.next("STOCK_ADJUSTMENT", { branchId: opts?.branchId }) },
    stock: inventoryOpsStockHook,
  });
  const stockTransfers = new DocumentService<StockTransferDocLine>(stockTransferDocumentType, {
    repo: inventoryOps.stockTransfers,
    numbering: { next: (opts) => ledger.numbering.next("STOCK_TRANSFER", { branchId: opts?.branchId }) },
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
   * never surface) — inventory from the stock-ledger's own WAC snapshots, AR
   * and AP from the documents minus what the ALLOCATION sub-ledger records as
   * settled.
   *
   * Allocations are the single store of "how much of this invoice is paid"
   * (D1/D18). Reading the invoice's own `amountPaid` counted collections that
   * had never moved cash, and ignoring allocations entirely on the AP side left
   * every supplier payment moving GL 2100 while the sub-ledger stood still.
   * Historical-import archives carry opening balances that post to the same two
   * control accounts (D23), so their remaining balances belong here too.
   */
  async function resolveReconciliationControls() {
    const [invoices, purchInvoices, snapshots, salesReturnDocs, purchaseReturnDocs, landedCostDocs, purchaseArchives, salesArchives] = await Promise.all([
      salesInvoices.list(),
      purchaseInvoices.list(),
      stockLedger.snapshots.list(),
      salesReturns.list(),
      purchaseReturns.list(),
      landedCostDocuments.list(),
      historicalImportArchives.list(),
      salesHistoricalImportArchives.list(),
    ]);
    /**
     * Every confirmed voucher that names a control account as its counterparty
     * moves that account the moment it confirms — a collection, a supplier
     * payment, a refund either way. Whether the money was applied to a specific
     * invoice is a DISTRIBUTION question, not a second movement: an allocation
     * says which invoice the cash belongs to, it does not move the GL again. So
     * the sub-ledger follows the voucher, not the allocation.
     *
     * A receipt credits its counterparty (money in settles a receivable, or
     * un-settles a payable when a supplier refunds); a payment debits it.
     */
    const voucherEffect = { receivable: 0n, payable: 0n };
    for (const doc of await vouchers.documents.list({ status: "confirmed" })) {
      const line = doc.lines[0];
      if (!line || line.direction === "transfer") continue;
      const credited = line.direction === "receipt";
      if (line.counterpartyGlAccountId === "1105") {
        voucherEffect.receivable += credited ? -line.amount.scaled : line.amount.scaled;
      }
      if (line.counterpartyGlAccountId === "2100") {
        voucherEffect.payable += credited ? line.amount.scaled : -line.amount.scaled;
      }
    }

    /**
     * A cheque reclassifies a receivable/payable the moment it is written: an
     * incoming cheque credits AR into cheques-under-collection, an outgoing one
     * debits AP into cheques-payable. Both move the control account, so the
     * sub-ledger has to follow them or it reads permanently high. Only an
     * OUTGOING bounce credits the counterparty back — an incoming bounce moves
     * under-collection to the bounced account and leaves AR where it is.
     */
    const chequeEffect = { receivable: 0n, payable: 0n };
    for (const cheque of await cheques.list()) {
      const restored = cheque.direction === "outgoing" && cheque.status === "bounced";
      const net = restored ? 0n : -cheque.amount.scaled;
      if (cheque.counterpartyGlAccountId === "1105") chequeEffect.receivable += net;
      if (cheque.counterpartyGlAccountId === "2100") chequeEffect.payable += net;
    }

    let arScaled = 0n;
    for (const inv of invoices) {
      if (!SALES_INVOICE_ACTIVE_STATUSES.has(inv.status)) continue;
      const totals = salesInvoiceTotals(inv);
      arScaled += totals.grandTotal.scaled;
    }
    for (const archive of salesArchives) {
      if (archive.settled) continue;
      arScaled += archive.docType === "SALES_RETURN"
        ? -archive.remainingBalance.scaled
        : archive.remainingBalance.scaled;
    }
    arScaled += voucherEffect.receivable;
    arScaled += chequeEffect.receivable;
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
      // The BASE-currency figure, which is what the control account holds.
      apScaled += purchaseInvoiceBaseTotal(inv).scaled;
    }
    for (const archive of purchaseArchives) {
      if (archive.settled) continue;
      apScaled += archive.docType === "PURCHASE_RETURN"
        ? -archive.remainingBalance.scaled
        : archive.remainingBalance.scaled;
    }
    apScaled += voucherEffect.payable;
    apScaled += chequeEffect.payable;
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
    // A van's opening float is a real cash movement out of a real خزنة, so it
    // answers to the same سياسة الخزينة every other voucher does; without this
    // it read the service's own built-in default instead.
    settings,
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

  /**
   * Roadside takings, posted into the van's own treasury as a receipt voucher
   * (D22). A sale is revenue; a collection is a customer advance until someone
   * applies it to an invoice — crediting AR here instead would move GL 1105
   * with no allocation behind it and break the AR reconciliation, because the
   * movement carries no customer to allocate against.
   */
  async function recordVanCashTaking(input: {
    tripId: string;
    movementId: string;
    kind: "sale" | "collection";
    amount: Money;
    date: string;
    branchId: string;
    vanTreasuryAccountId: string;
  }): Promise<void> {
    if (input.amount.scaled <= 0n) return;
    const van = await treasuryAccounts.findById(input.vanTreasuryAccountId);
    const id = `VAN-CASH:${input.movementId}`;
    await vanTripVoucherService.createVoucher({
      id,
      date: input.date,
      memo: `${input.kind === "sale" ? "بيع" : "تحصيل"} ميداني — رحلة ${input.tripId}`,
      voucherType: "other_income",
      amount: input.amount,
      branchId: input.branchId,
      paymentMethod: "cash",
      treasuryAccountId: input.vanTreasuryAccountId,
      treasuryGlAccountId: van?.glAccountId ?? "1010",
      counterpartyGlAccountId: input.kind === "sale" ? "4100" : "2160",
    });
    await vanTripVoucherService.confirmVoucher(id);
  }

  /**
   * The settlement's counted-versus-expected difference, written off the van's
   * treasury to عجز/فائض الصندوق. The transfer only hands back what was
   * counted, so without this the difference stays on the van's books as cash
   * nobody holds and the next trip inherits it.
   */
  async function recordVanCashVariance(input: {
    tripId: string;
    date: string;
    branchId: string;
    vanTreasuryAccountId: string;
    variance: Money;
  }): Promise<void> {
    if (input.variance.scaled === 0n) return;
    const shortage = input.variance.scaled < 0n;
    const van = await treasuryAccounts.findById(input.vanTreasuryAccountId);
    const id = `VAN-VAR:${input.tripId}`;
    await vanTripVoucherService.createVoucher({
      id,
      date: input.date,
      memo: `${shortage ? "عجز" : "فائض"} تسوية رحلة ${input.tripId}`,
      voucherType: shortage ? "other_expense" : "other_income",
      amount: Money.fromScaled(shortage ? -input.variance.scaled : input.variance.scaled),
      branchId: input.branchId,
      paymentMethod: "cash",
      treasuryAccountId: input.vanTreasuryAccountId,
      treasuryGlAccountId: van?.glAccountId ?? "1010",
      counterpartyGlAccountId: shortage ? "5900" : "4900",
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
    accountRouting: { repo: accountRouting },
    taxGroupRepo: taxGroups,
    itemCatalog: {
      units: itemCatalog.units,
      categories: itemCatalog.categories,
      brands: itemCatalog.brands,
      seasons: itemCatalog.seasons,
    },
    itemSpecifications: {
      repo: itemSpecifications,
      usage: createProductTemplateSpecificationUsage(productTemplateStore.templates),
    },
    attachments: { repo: attachments },
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
    inventory: {
      service: stockService,
      /**
       * مخزون محجوز (R5.6), derived rather than stored: a draft sales invoice
       * has spoken for its stock lines, and a draft transfer has spoken for
       * its source warehouse's. Confirming either moves the stock and drops
       * the reservation by construction, so there is no counter to forget.
       */
      reservations: {
        async list() {
          const [invoices, transfers] = await Promise.all([
            salesInvoices.list({ status: "draft" }),
            inventoryOps.stockTransfers.list({ status: "draft" }),
          ]);
          const lines: { itemId: string; warehouseId: string; qty: Qty }[] = [];
          for (const invoice of invoices) {
            for (const line of invoice.lines) {
              if (!line.isStock) continue;
              lines.push({ itemId: line.itemId, warehouseId: invoice.warehouseId, qty: line.qty });
            }
          }
          for (const transfer of transfers) {
            for (const line of transfer.lines) {
              // The SOURCE only: the destination gains nothing until the
              // transfer confirms, so reserving there would invent stock.
              lines.push({ itemId: line.itemId, warehouseId: line.fromWarehouseId, qty: line.qty });
            }
          }
          return lines;
        },
      },
    },
    gl: {
      ledger,
      accounts,
      periods: fiscalPeriods,
      numbering: ledger.numbering,
      audit: auditSink,
      vatFilings,
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
      // Without this the treasury guard reads its own hardcoded default and both
      // سياسة الخزينة switches on the settings screen do nothing (D19).
      settings,
      // Allocating a collection has to reach the invoice document, or the GL
      // credits AR while the invoice still reports amountPaid 0 forever (D1).
      // Purchase invoices carry no paid field; their settled figure lives in the
      // allocation sub-ledger, which the reconciliation above now reads.
      settlement: {
        applySettled: async ({ invoiceId, kind, settled }) => {
          if (kind !== "sales") return;
          await applyAllocatedSettlement(salesInvoices, invoiceId, settled);
        },
      },
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
      // Without these a foreign-currency invoice posted its foreign figures as
      // though they were EGP, and the debt was invisible to revaluation (D24).
      exchangeRates,
      baseCurrency: "EGP",
      audit: auditSink,
      // «من إيصال استلام» omits lines, so the route builds them from the receipt
      // — and without this port every one of those lines was taxed at 0% (D50).
      resolveTaxRate: async (itemId) => (await items.findById(itemId))?.taxRatePercent ?? 0,
      /**
       * سداد للمورد from the invoice itself (R4.4) — the purchase-side mirror of
       * the sales `collect` adapter below. It creates, confirms and allocates a
       * REAL سند صرف: an invoice that reads "مدفوع" with nothing posted behind
       * it is the failure D40 was filed for.
       */
      pay: async (input) => {
        const treasury = await treasuryAccounts.findById(input.treasuryAccountId);
        if (!treasury?.glAccountId) {
          throw new InvalidPurchaseDocumentError(["حساب الخزينة غير موجود أو بلا حساب دفتري."]);
        }
        const voucherId = `PAY:${input.invoiceId}:${randomUUID()}`;
        const service = new VoucherService({
          documents: vouchers.documents,
          ledger,
          accounts,
          periods: fiscalPeriods,
          numbering: ledger.numbering,
          treasuryAccounts,
          allocations: vouchers.allocations,
          invoices: vouchers.invoices,
          settings,
          audit: auditSink,
          actor: input.actor,
        });
        await service.createVoucher({
          id: voucherId,
          date: input.date,
          memo: input.memo,
          voucherType: "supplier_payment",
          amount: input.amount,
          branchId: input.branchId,
          paymentMethod: input.paymentMethod,
          treasuryAccountId: input.treasuryAccountId,
          treasuryGlAccountId: treasury.glAccountId,
          counterpartyGlAccountId: PURCHASE_GL_ACCOUNTS.payableAccountId,
          supplierId: input.supplierId,
          referenceNo: input.referenceNo,
        });
        await service.confirmVoucher(voucherId);
        await service.allocate(voucherId, {
          allocationId: `${voucherId}:A1`,
          invoiceId: input.invoiceId,
          amount: input.amount,
        });
        // The number is stamped by the confirm, not the create — read it back so
        // the screen can name the voucher instead of showing its internal id.
        const posted = await vouchers.documents.findById(voucherId);
        return { voucherId, voucherNo: posted?.docNo ?? null };
      },
      // Mounts POST /purchases/receipts/:id/cancel and /invoices/:id/cancel,
      // which 404 without it. app.ts derives the GL reversal port from this
      // being present, so omitting it silently disables both.
      layers: stockLedger.layers,
    },
    salesInvoices: {
      repo: salesInvoices,
      numbering: { next: (opts) => ledger.numbering.next("SALES_INVOICE", { branchId: opts?.branchId }) },
      gl: createSalesInvoiceGlHook(salesInvoiceGl),
      // "السماح بالبيع من مستودع آخر": only when the document's warehouse holds
      // NONE of the item, and only when one other warehouse can cover the whole
      // line — a line split across two warehouses would have two costs, and an
      // invoice line records exactly one.
      stock: createSalesInvoiceStockHook(stockService, async ({ itemId, qty, warehouseId }) => {
        const tenant = (await settings.get()) ?? createDefaultSettings();
        if (!tenant.allowCrossWarehouseSales) return null;
        const positions = await stockLedger.snapshots.list();
        const here = positions.find((p) => p.itemId === itemId && p.warehouseId === warehouseId);
        if (here && !here.onHand.isZero()) return null;
        const elsewhere = positions
          .filter((p) => p.itemId === itemId && p.warehouseId !== warehouseId && p.onHand.compare(qty) >= 0)
          .sort((a, b) => b.onHand.compare(a.onHand));
        return elsewhere[0]?.warehouseId ?? null;
      }),
      // Without this a configured SALES_INVOICE_CONFIRM chain had zero effect —
      // SalesInvoiceService.confirm skips its gate entirely when absent.
      workflow: documentWorkflowGate,
      audit: auditSink,
      events: salesInvoiceEvents,
      allocatable: vouchers.invoices,
      // The customer's own price list, consulted SERVER-side. The engine
      // (resolvePrice) always existed and no route called it, so the whole
      // pricing order held only in the browser (D35).
      /**
       * تحصيل من عميل — the invoice screen's collect action. It creates and
       * CONFIRMS a real collection voucher and allocates it to the invoice, so
       * the money lands in a treasury account, AR is credited in the ledger,
       * and the invoice's amountPaid follows from the allocation. It used to
       * increment amountPaid and post nothing (D1).
       */
      collect: async (input) => {
        const treasury = await treasuryAccounts.findById(input.treasuryAccountId);
        if (!treasury?.glAccountId) {
          throw new InvalidSalesInvoicePaymentError("حساب الخزينة غير موجود أو بلا حساب دفتري.");
        }
        const voucherId = `COLL:${input.invoiceId}:${randomUUID()}`;
        const service = new VoucherService({
          documents: vouchers.documents,
          ledger,
          accounts,
          periods: fiscalPeriods,
          numbering: ledger.numbering,
          treasuryAccounts,
          allocations: vouchers.allocations,
          invoices: vouchers.invoices,
          settings,
          settlement: {
            applySettled: async ({ invoiceId, kind, settled }) => {
              if (kind !== "sales") return;
              await applyAllocatedSettlement(salesInvoices, invoiceId, settled);
            },
          },
          audit: auditSink,
          actor: input.actor,
        });
        await service.createVoucher({
          id: voucherId,
          date: input.date,
          memo: input.memo ?? undefined,
          voucherType: "customer_collection",
          amount: input.amount,
          branchId: input.branchId,
          paymentMethod: input.paymentMethod,
          treasuryAccountId: input.treasuryAccountId,
          treasuryGlAccountId: treasury.glAccountId,
          counterpartyGlAccountId: "1105",
          customerId: input.customerId,
          referenceNo: input.referenceNo ?? null,
        });
        await service.confirmVoucher(voucherId);
        await service.allocate(voucherId, {
          allocationId: `${voucherId}:A1`,
          invoiceId: input.invoiceId,
          amount: input.amount,
        });
        return { voucherId };
      },
      pricing: {
        listPriceFor: async (customerId: string, itemId: string, qty: Qty) => {
          // تفعيل قوائم الأسعار (settings §"الرقابة الائتمانية"): with price
          // lists switched off no invoice may be measured against one, or the
          // toggle would only hide the screen while the variance check ran on.
          const tenant = (await settings.get()) ?? createDefaultSettings();
          if (!tenant.priceListsEnabled) return null;
          const customer = await customers.findById(customerId);
          if (!customer?.priceListId) return null;
          const list = await priceLists.findById(customer.priceListId);
          if (!list) return null;
          const item = await items.findById(itemId);
          const fallback = item?.salePrice ?? Money.zero();
          const resolved = resolvePrice(list, itemId, fallback, qty);
          return resolved.scaled === 0n ? null : resolved;
        },
      },
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
      numbering: { next: (opts) => ledger.numbering.next("SALES_QUOTE", { branchId: opts?.branchId }) },
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
    eta: {
      service: etaService,
      setClientSecret: (secret) => etaStore.config.setClientSecret(secret),
      items,
      units: itemCatalog.units,
      branches,
      taxRates,
      branchCodes: etaStore.branchCodes,
      unitMappings: etaStore.unitMappings,
    },
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
        payrollComponents: hrPayrollComponents,
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
      settings,
    },
    inventoryWritedown: {
      runs: writedownRuns,
      wacSnapshots: stockLedger.snapshots,
      stockLedger: stockLedger.ledger,
      gl: salesInvoiceGl,
      accounts: INVENTORY_WRITEDOWN_GL_ACCOUNTS,
      settings,
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
      recordCashTaking: recordVanCashTaking,
      recordCashVariance: recordVanCashVariance,
    },
    manufacturing: {
      boms: manufacturing.boms,
      workOrders: manufacturing.workOrders,
      configurableProducts: manufacturing.configurableProducts,
      configInstances: manufacturing.configInstances,
      numbering: ledger.numbering,
      stock: stockService,
      /** Feeds the materials tab's available/shortage columns (R9.2). */
      positions: async () => {
        const { positions } = await stockService.getValuation();
        return positions.map((position) => ({
          itemId: position.itemId,
          warehouseId: position.warehouseId,
          onHand: Number(position.onHand.toString()),
        }));
      },
      /** The three activity feeds behind the movements, journal and audit tabs (R9.2). */
      movementsOfDocument: async (sourceDocId: string) =>
        (await stockService.getMovementsOfDocument(sourceDocId)).map((m) => ({
          id: m.id,
          itemId: m.itemId,
          warehouseId: m.warehouseId,
          direction: m.direction,
          qty: m.qty.toString(),
          unitCost: m.unitCost.toString(),
          occurredAt: m.occurredAt,
        })),
      journalEntriesOfDocument: async (sourceDocId: string) =>
        (await ledger.list({ sourceDocId })).map((entry) => ({
          id: entry.id,
          entryNo: entry.entryNo ?? null,
          date: entry.date,
          memo: entry.memo ?? null,
          status: entry.status,
          totalDebit: Money.sum(entry.lines.map((line) => line.debit)).toString(),
          totalCredit: Money.sum(entry.lines.map((line) => line.credit)).toString(),
        })),
      auditOfDocument: async (entityId: string) =>
        (await auditSink.queryEvents({ entityId })).events.map((event) => ({
          action: event.action,
          actor: event.actor,
          timestamp: event.timestamp,
          severity: event.severity,
        })),
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
    historicalImport: {
      archives: historicalImportArchives,
      // Without these the domain's opening-balance branch never runs and a
      // migrated business owes its suppliers nothing in the ledger (D23).
      gl: {
        post: async (posting) => {
          await postJournalEntry(
            {
              id: `HIST-PI-JE:${posting.sourceDocId}`,
              date: posting.date,
              memo: posting.memo,
              source: "system",
              lines: posting.lines.map((l) => ({ accountId: l.accountId, debit: l.debit, credit: l.credit })),
            },
            salesInvoiceGl,
          );
        },
      },
      accounts: { openingBalanceAccountId: "3210", payableAccountId: "2100" },
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
    salesHistoricalImport: {
      archives: salesHistoricalImportArchives,
      gl: {
        post: async (posting) => {
          await postJournalEntry(
            {
              id: `HIST-SI-JE:${posting.sourceDocId}`,
              date: posting.date,
              memo: posting.memo,
              source: "system",
              lines: posting.lines.map((l) => ({ accountId: l.accountId, debit: l.debit, credit: l.credit })),
            },
            salesInvoiceGl,
          );
        },
      },
      accounts: { openingBalanceAccountId: "3210", receivableAccountId: "1105" },
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
            // A return is quoted in BASE units, because that is what it puts
            // back into the stock ledger. A line sold as 5 cartons of 12 is
            // returnable as up to 60 pieces at the per-piece price, so the
            // credit still reconciles to the line and the ledger to the count.
            lines: invoice.lines.map((l) => ({
              itemId: l.itemId,
              itemName: l.itemNameAr,
              qty: l.baseQty,
              alreadyReturnedQty: returnedByItem.get(l.itemId) ?? Qty.zero(),
              unitPrice: unitCostOf(extendQtyByPrice(l.qty, l.unitPrice), l.baseQty),
              unitCost: unitCostOf(extendQtyByPrice(l.qty, l.unitPrice), l.baseQty),
              taxAmount: Money.zero(),
            })),
          };
        },
      },
      /**
       * «استرداد للعميل» (R3.9). A confirmed return credits AR and moves no
       * money; this pays the credit note out as a REAL رد مبلغ لعميل voucher —
       * debit AR 1105, credit the till — so the sub-ledger and the ledger move
       * together. `list` recomputes what has already been refunded from the
       * confirmed vouchers rather than from a stored flag, so reversing one
       * restores the ledger AND the awaiting-refund state in a single act.
       *
       * The voucher id encodes the return it settles (`REFUND:<returnId>:…`);
       * that prefix is the only link between the two, so it must not change.
       */
      refunds: {
        async list(returnId: string) {
          const prefix = `REFUND:${returnId}:`;
          const all = await vouchers.documents.list();
          return all
            .filter((doc) => doc.id.startsWith(prefix) && doc.status === "confirmed" && doc.reversesDocId === null)
            .map((doc) => ({
              voucherId: doc.id,
              voucherNo: doc.docNo,
              date: doc.date,
              amount: doc.lines[0]?.amount ?? Money.zero(),
            }));
        },
        async post(command) {
          const treasury = await treasuryAccounts.findById(command.treasuryAccountId);
          if (!treasury?.glAccountId) {
            throw new SalesReturnNotRefundableError("حساب الخزينة غير موجود أو بلا حساب دفتري.");
          }
          const customer = await customers.findById(command.customerId);
          const voucherId = `REFUND:${command.returnId}:${randomUUID()}`;
          const service = new VoucherService({
            documents: vouchers.documents,
            ledger,
            accounts,
            periods: fiscalPeriods,
            numbering: ledger.numbering,
            treasuryAccounts,
            allocations: vouchers.allocations,
            invoices: vouchers.invoices,
            settings,
            audit: auditSink,
            actor: command.actor,
          });
          await service.createVoucher({
            id: voucherId,
            date: command.date,
            memo: command.memo ?? undefined,
            voucherType: "customer_refund",
            amount: command.amount,
            branchId: treasury.branchId,
            paymentMethod: command.paymentMethod,
            treasuryAccountId: command.treasuryAccountId,
            treasuryGlAccountId: treasury.glAccountId,
            counterpartyGlAccountId: "1105",
            customerId: customer?.id ?? command.customerId,
            referenceNo: command.referenceNo,
          });
          await service.confirmVoucher(voucherId);
          // The number is stamped by the confirm, not the create.
          const posted = await vouchers.documents.findById(voucherId);
          return { voucherId, voucherNo: posted?.docNo ?? null };
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
      // The customer aging ladder has to net every credit the GL already
      // posted against 1105, or it and the dashboard tile report two
      // different receivables (D37).
      salesReturnDocs: salesReturns,
      cheques,
      voucherDocuments: vouchers.documents,
      allocations: vouchers.allocations,
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
