import { createHash, randomUUID } from "node:crypto";
import {
  createApp,
  createPeriodCloseGuardSlot,
  createLoginThrottle,
  createSessionAuthContextResolver,
  createSessionRegistry,
  createSimplifiedRegimeRoutes,
  MasterDataKind,
  type MasterDataChecks,
  type App,
  type ConfigTransactor,
  type PermissionRefusal,
  type CreateAppOptions,
  type InstallmentCollectPort,
  type SessionRegistry,
  sendNotificationEmail,
} from "@mezan/api";
import {
  chequeLedgerDays,
  ALL_SCOPE,
  SiteService,
  StockLedgerService,
  applyAllocatedSettlement,
  InvalidSalesInvoicePaymentError,
  InvalidPurchaseDocumentError,
  assertPeriodOpen,
  assertVatNotFiled,
  NoFiscalPeriodForDateError,
  postJournalEntry,
  reverseJournalEntry,
  resolvePrice,
  createSalesInvoiceGlHook,
  createSalesInvoiceStockHook,
  SalesInvoiceService,
  CertificateService,
  SubcontractService,
  SubCertificateService,
  createPurchaseInvoice,
  confirmPurchaseInvoice,
  type PurchaseGlPosting,
  type PurchaseGlPostingPort,
  type SubCertificateInvoicingPort,
  type SubcontractSupplierPort,
  type SubcontractVoucherPort,
  type ClientCertifiedQuantityPort,
  type SubcontractConsumptionPort,
  type SubcontractRetentionInvoicingPort,
  CERTIFICATE_WORKS_ITEM_ID,
  RETENTION_RELEASE_ITEM_ID,
  GuaranteeService,
  type CertificateInvoicingPort,
  type RetentionReleaseInvoicingPort,
  type CertificateGuaranteePort,
  type ContractGuaranteePort,
  isGuaranteeOutstanding,
  type ContractBillingRoutingPort,
  createTreasuryLedgerReader,
  createVoucherBankEntryPoster,
  VoucherService,
  voucherLine,
  ChequeService,
  type ChequeRaisingDocumentPort,
  type VoucherChequeRegistrationPort,
  VOUCHER_DOC_TYPE,
  NO_SIMPLIFIED_REGIME,
  simplifiedRegimeActiveOn,
  type TreasuryTransferInput,
  DocumentService,
  createDocumentWorkflowGate,
  createJournalGlHook,
  createInventoryStockHook,
  createSalesReturnDocumentType,
  createPurchaseReturnDocumentType,
  createLandedCostDocumentType,
  LANDED_COST_DOC_TYPE,
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
  purchaseInvoiceLineTax,
  salesInvoiceBaseGrandTotal,
  type OpenPartyDocument,
  purchaseInvoiceTotal,
  purchaseInvoiceBaseTotal,
  voucherBaseAmount,
  assertOpenForPosting,
  ledgerPresenceAsOf,
  reversalChainPresenceAsOf,
  isActive,
  type DocumentStatus,
  purchaseInvoiceCancelEntryId,
  salesInvoiceVoidEntryId,
  PartyRequiredOnControlAccountError,
  CUSTOMER_OPENING_BALANCE_DOC_TYPE,
  SUPPLIER_OPENING_BALANCE_DOC_TYPE,
  fxRevaluationNet,
  replay,
  type StockMovement,
  Qty,
  purchaseReturnGrandTotal,
  salesReturnGrandTotal,
  SalesReturnNotRefundableError,
  totalLandedCost,
  Money,
  getAdjustmentReasonDefinition,
  type AdjustmentReason,
  type AccountRouting,
  costToDateOf,
  routedAccountId,
  addMissingStandardAccounts,
  type StockAdjustmentDocLine,
  type StockTransferDocLine,
  EventBus,
  NotificationRulesEngine,
  type DocumentEventPublisher,
  type DocumentEventType,
  type EventCode,
  createProductTemplateSpecificationUsage,
  recordSecurityEvent,
  unwindAdvanceVoucher,
  type VoucherAdvanceUnwindPort,
  type Entitlements,
  type RealisedFxPort,
  type FxDifferenceAccounts,
  type InvoiceReturnCreditPort,
  SettlementRateMissingError,
  salesReturnCreditByInvoice,
  purchaseReturnCreditByInvoice,
  type OpeningBalanceDuplicatesContext,
  type OpeningBalanceEntryRef,
  tenantTodayIso,
  BASE_CURRENCY,
} from "@mezan/domain";
import {
  openSqliteConnection,
  withSqliteTransaction,
  type SqliteOpenOptions,
  createSqliteUnitOfWork,
  createSqliteAccountRepository,
  createSqliteSettingsStore,
  createSqliteVatFilingStore,
  createSqliteSimplifiedRegimeStore,
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
  createSqliteWorksContractStore,
  createSqliteContractingSiteStore,
  createSqliteGuaranteeStore,
  createSqliteProgressCertificateStore,
  createSqliteSubcontractStore,
  createSqliteContractingRecognitionStore,
  createSqliteContractingControlsStore,
  createSqliteAssetCategoryRepository,
  createSqliteAssetInternalRateHistoryRepository,
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
  createSqliteClockCredentialRepository,
  createSqliteWebauthnChallengeRepository,
  createSqliteLeaveAccrualBatchRepository,
  createSqliteLeaveBalanceRepository,
  createSqliteLeavePolicyRepository,
  createSqliteLeaveRequestRepository,
  createSqlitePayrollRunRepository,
  createSqlitePayslipRepository,
  createSqlitePayrollComponentRepository,
  createSqliteGarnishmentRepository,
  createSqliteStatutoryOverrideRepository,
  createSqlitePayrollStatutoryFlagRepository,
  createSqliteWritedownRunRepository,
  createSqliteProductTemplateStore,
  createSqliteNotificationRuleStore,
  createSqliteNotificationStore,
  createSqliteWorkflowConfigStore,
  createSqliteApprovalRequestStore,
  createDataMigrationTransactor,
  createSqliteBarcodeConfigStore,
  createSqliteUserPreferencesStore,
  createSqliteAuditSink,
  createSqlitePeriodCloseStore,
  deriveAuditChainKey,
  createSqliteLabelLayoutStore,
  createSqliteSequenceConfigStore,
  createSqliteSequenceStore,
  CURRENT_SCHEMA_VERSION,
} from "@mezan/persistence";
import {
  EtaService,
  createEtaHttpTransmitPort,
  createExternalCommandSigner,
  fetchEtaHttpClient,
  convertToBase,
  createDefaultSettings,
  NotificationDispatcher,
  type NotificationTransport,
  type EtaCommandResult,
  type EtaCommandRunner,
  type EtaHttpClient,
  type DocumentRepository,
  type FrameworkDocument,
  extend as extendQtyByPrice,
  unitCostOf,
} from "@mezan/domain";
import { runExternalSigningCommand } from "./eta-signing-command.js";
import {
  createEtaEnqueueBridge,
  createEtaInvoiceRequeueRebuilder,
  createEtaReceiptIssuer,
  createReturnEtaEnqueueBridge,
  type EtaReceiptIssuer,
} from "./eta-receipts.js";
import { createAuthRoutes } from "./auth-routes.js";
import { createDashboardRoutes } from "./dashboard-routes.js";
import { createPreferencesRoutes } from "./preferences-routes.js";
import { SEED_ADMIN_USER_ID, seedIfEmpty, type SeedStores } from "./seed.js";
import type { BackendModuleContext } from "./module-context.js";
import { mountPos } from "./pos/index.js";
import { ENH_EMITTED_EVENT_CODES, mountEnhancements } from "./enh/index.js";
import { seedDemoTenant } from "./demo-seed.js";
import { createHrTreasuryDisbursementPort } from "./hr-treasury-disbursement.js";

/** The confirmed returns citing any of `ids`, in one query where the store can answer it. */
async function listReturnsCiting<L>(
  repo: { listByLineRef?: DocumentRepository<L>["listByLineRef"]; list: DocumentRepository<L>["list"] },
  ids: readonly string[],
): Promise<readonly FrameworkDocument<L>[]> {
  return repo.listByLineRef ? repo.listByLineRef("sourceInvoiceId", ids, { status: "confirmed" }) : repo.list({ status: "confirmed" });
}

/**
 * The GL accounts the purchase chain's invoice confirm posts against —
 * docs/archive/catalog/04's standard COA (packages/domain/src/accounts/coa-template.ts):
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
  // D53: receiving goods now posts Dr 1200 / Cr 2120, and the invoice clears
  // 2120 rather than debiting inventory a second time.
  goodsReceivedNotInvoicedAccountId: "2120",
  priceVarianceAccountId: "5080",
};

/**
 * System-default fixed-assets GL accounts (docs/archive/catalog/07 §تصنيفات الأصول
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
 * (docs/archive/phase-backlog.md Phase 4 "aging-based inventory write-down batch",
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
  // Scrap beyond the BOM's waste allowance is a loss of the period, not part
  // of what the product cost to make (EAS/IAS 2), so it gets its own leaf
  // rather than sharing 5070 with damaged stock in a warehouse.
  abnormalScrapAccountId: "5220",
  wipAccountId: "1250",
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
 *
 * `unabsorbedCostAccountId` is تكلفة البضاعة المباعة (5100, `item_type.cogs`).
 * A landed cost that arrives after the goods were sold cannot raise the basis
 * of stock that is gone, so that part is a period cost and is reclassified out
 * of 1200 into 5100 — otherwise GL inventory exceeds the valuation report by
 * exactly that figure, permanently (D84).
 */
const LANDED_COST_GL_ACCOUNTS = {
  inventoryAccountId: "1200",
  // 2130 تكاليف إضافية مستحقة, NOT 2100 ذمم موردين تجاريين. Crediting the AP
  // CONTROL account with no supplier document behind it made the AP sub-ledger
  // and GL 2100 disagree by every landed cost posted (D75).
  accruedLandedCostPayableId: "2130",
  unabsorbedCostAccountId: "5100",
};

/**
 * Bridges the document framework's generic `DocumentEventPublisher` port
 * (`DOCUMENT_CONFIRMED`/`DOCUMENT_CANCELLED`/…, keyed by `docType` — see
 * `packages/domain/src/documents/hooks.ts`, "decoupled from the notification
 * catalog" by design) onto a real catalog `EventCode` published on the ONE
 * shared `EventBus` the notification-rules engine subscribes to. This is the
 * translation step docs/archive/plan.md §5.6 anticipates but does not itself provide.
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
  /**
   * الإيصال الإلكتروني — issues a consumer sale's (or return's) e-receipt
   * synchronously, on the chain of the device serial given. The POS till calls
   * this with its terminal serial and the tender it actually took. Optional
   * only so hand-built test handles need not carry one; `createBackend`
   * always does.
   */
  readonly etaReceipts?: EtaReceiptIssuer;
  /**
   * The live session registry.
   *
   * Exposed so a caller can END sessions — an admin who changes a user's role
   * or deactivates them must not leave that user's open tabs holding the old
   * grant — and so the scenario harness can act as a named identity, which it
   * used to do by writing `x-user-id` and is exactly what the server no longer
   * accepts from a client.
   */
  readonly sessions: SessionRegistry;
  /**
   * Copies the live database to `destination` via better-sqlite3's online
   * backup API — safe to call while the app keeps serving writes, since the
   * backup reads through SQLite's own consistent snapshot rather than
   * pausing the connection.
   */
  backupTo(destination: string): Promise<void>;
  /**
   * Resolves once the confirm-time e-receipt tasks still in flight have
   * settled. Those tasks deliberately outlive the confirm that started them,
   * so a caller that closes the backend right after doing work — the
   * demo-tenant provisioner does exactly that — must await this first, or
   * they resume against a closed connection and their receipts are lost.
   */
  drain(): Promise<void>;
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
   * Pins the fallback admin's PIN for THIS database only. For the public demo
   * tenant alone: its instance re-seeds from scratch on every wake, so a
   * generated PIN would change each time, and every demo persona shares the
   * published PIN anyway. Refused without `seedDemoData: true` so a real tenant
   * can never be opened with a known admin PIN.
   */
  readonly seedAdminPin?: string;
  /** Outbound HTTP for the ETA gateway. Tests inject a fake server; nothing else should. */
  readonly etaHttpClient?: EtaHttpClient;
  /** Runs the operator's external CAdES-BES signing program. Tests inject a fake. */
  readonly etaSigningRunner?: EtaCommandRunner;
  /**
   * Mounts the LAN multi-till routes (`/lan/*`).
   *
   * Supplied by apps/desktop, which is the only edition that binds a LAN
   * socket. Routing it through here rather than through a second `createApp`
   * call is the point: the app built here is the one that carries the session
   * resolver, and `/lan` is precisely the surface that must not be resolving
   * its caller from a header.
   */
  readonly lan?: NonNullable<CreateAppOptions["lan"]>;
  /**
   * Driver + encryption key for the ONE connection opened below.
   *
   * Supplied only by apps/desktop, which opens the tenant database with
   * SQLite3MultipleCiphers and a key sealed to the OS user account (see
   * apps/desktop/src/main/encrypted-database.ts). Omitted — apps/server, the
   * scenario harness, the web dev plugin and every test — this is plain
   * better-sqlite3 with no key, exactly as before.
   */
  readonly connection?: SqliteOpenOptions;
  /**
   * The verified-license state every mutating request is gated against
   * (docs/archive/plan.md §2.5). Supplied by apps/desktop from the Ed25519
   * offline license; omitted by every other edition, which stays fully
   * writable.
   */
  readonly resolveLicenseState?: CreateAppOptions["resolveLicenseState"];
  /**
   * The VERIFIED capability set every module-gated route group is checked
   * against, and that `GET /entitlements` and `/roles` report.
   *
   * Supplied by apps/desktop from the signed licence, and ONLY when a licence
   * actually produced it: omitted — every other edition, and an unpackaged
   * desktop with no licence file — the API keeps its own all-modules default,
   * so nothing is gated by an absence.
   */
  readonly entitlements?: Entitlements;
  /**
   * The tenant's subscription-derived capability set (docs/archive/plan.md §2.5).
   * Supplied by apps/server from the platform database; omitted by every other
   * edition, which falls back to `createApp`'s own default resolver.
   *
   * Distinct from `entitlements` above and both are kept: the desktop edition
   * proves its capabilities from a signed licence file, the cloud edition reads
   * them from the platform subscription. Collapsing them would leave one of the
   * two editions with no way to state what it is entitled to.
   */
  readonly resolveEntitlements?: CreateAppOptions["resolveEntitlements"];
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
/**
 * ذمم العملاء — the control account every AR path in this composition names
 * (the reconciliation report's own control id, the voucher counterparty, the
 * opening-balance receivable). The certificate's invoice and its deductions
 * entry both have to land on THIS one or the sub-ledger and GL 1105 drift.
 */
const CERTIFICATE_AR_ACCOUNT_ID = "1105";

export async function createBackend(options: CreateBackendOptions = {}): Promise<BackendHandle> {
  if (options.seedAdminPin !== undefined && options.seedDemoData !== true) {
    throw new Error("createBackend: seedAdminPin is only accepted together with seedDemoData: true");
  }
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
  const { sqlite } = openSqliteConnection(dbPath, options.connection);

  /*
   * DEC-17 removed the API-key and webhook back end. Their stores are gone, so
   * a new database never creates these tables — but an existing one still
   * carries them, holding hashed keys and signing secrets for a surface that no
   * longer exists. Dropping them here is the only migration step this repo has:
   * every store builds its own schema on open, so there is no central runner to
   * put it in. Safe to remove once no deployed database predates this commit.
   */
  for (const table of ["webhook_delivery", "webhook", "api_key"]) {
    sqlite.exec(`DROP TABLE IF EXISTS ${table}`);
  }

  const sequenceConfig = createSqliteSequenceConfigStore(sqlite);
  const sequenceCounters = createSqliteSequenceStore(sqlite);
  // The ONE audit sink for the whole backend. Without it the `audit_event`
  // table is never written and `/audit` reports an empty log.
  // The chain head is MAC'd under a key derived from the DATABASE key, which
  // lives in the OS keychain and not in the file an attacker is holding. With
  // no encryption key (dev, apps/server) it falls back to a per-install 0600
  // file beside the database — see audit-sink.ts's resolveChainKey.
  const auditSink = createSqliteAuditSink(sqlite, {
    ...(options.connection?.key ? { chainKey: deriveAuditChainKey(options.connection.key) } : {}),
  });
  const barcodeConfig = createSqliteBarcodeConfigStore(sqlite);
  const userPreferences = createSqliteUserPreferencesStore(sqlite);
  const dataMigrationTransactor = createDataMigrationTransactor(sqlite);
  // The boundary a route-level config write shares with its audit row (D298).
  // Same shared connection the audit sink writes on, so the append nests as a
  // SAVEPOINT rather than opening a second transaction.
  const configTransactor: ConfigTransactor = { run: (fn) => withSqliteTransaction(sqlite, fn) };
  const labelLayouts = createSqliteLabelLayoutStore(sqlite);

  const uow = createSqliteUnitOfWork(sqlite);
  const settings = createSqliteSettingsStore(sqlite);
  const vatFilings = createSqliteVatFilingStore(sqlite);
  const simplifiedRegime = createSqliteSimplifiedRegimeStore(sqlite);
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
  const masterDataChecks: MasterDataChecks = {
    [MasterDataKind.Customer]: customers,
    [MasterDataKind.Supplier]: suppliers,
    [MasterDataKind.Warehouse]: warehouses,
    [MasterDataKind.Branch]: branches,
    [MasterDataKind.CostCenter]: costCenters,
  };
  const treasuryAccounts = createSqliteTreasuryAccountRepository(sqlite);
  const fiscalPeriods = createSqliteFiscalPeriodRepository(sqlite);
  const periodCloseGuard = createPeriodCloseGuardSlot();
  const fxRevaluationRuns = createSqlitePeriodCloseStore(sqlite).fxRuns;
  const ledger = createSqliteLedgerStore(sqlite, sequenceConfig);
  const priceLists = createSqlitePriceListStore(sqlite);
  const promotions = createSqlitePromotionStore(sqlite);
  const salesQuotes = createSqliteSalesQuoteStore(sqlite);
  const exchangeRates = createSqliteExchangeRateRepository(sqlite);
  const etaStore = createSqliteEtaStore(sqlite);
  /**
   * The real ETA leg (P-1). Offline-safe by construction: the transmit port
   * refuses with `EtaOfflineError` until a client id AND a stored secret exist,
   * so an unconfigured install never opens a socket. The signer shells out to
   * the operator's own program because a CAdES-BES signature is made on the
   * taxpayer's hardware token and cannot be produced in-process.
   */
  const etaTransmit = createEtaHttpTransmitPort({
    http: options.etaHttpClient ?? fetchEtaHttpClient(),
    credentials: {
      read: async () => {
        const config = await etaStore.config.get();
        const clientSecret = await etaStore.config.getClientSecret();
        if (!config.clientId || !clientSecret) return null;
        return { clientId: config.clientId, clientSecret };
      },
    },
    // The e-receipt leg authenticates as the DEVICE that issued the receipt
    // (D284), with credentials read from the sealed branch registration.
    posCredentials: { forSerial: (serial) => etaStore.posCredentialsForSerial(serial) },
  });
  const etaSigner = createExternalCommandSigner({
    config: () => etaStore.config.get(),
    run: options.etaSigningRunner ?? runExternalSigningCommand,
  });
  const etaService = new EtaService({
    config: etaStore.config,
    submissions: etaStore.submissions,
    transmit: etaTransmit,
    signer: etaSigner,
    // EXTERNAL CONTRACT: the e-receipt UUID is the SHA-256 of the authority's
    // canonical serialization of the document, computed by the till before the
    // paper is printed. Without this port no consumer sale can be receipted at
    // all — the service refuses rather than inventing an identifier.
    receiptUuid: { compute: async (canonical) => createHash("sha256").update(canonical, "utf8").digest("hex") },
    receiptChain: etaStore.receiptChain,
    receiptGaps: etaStore.receiptGaps,
  });
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
  const invoiceSettlement = {
    applySettled: async ({ invoiceId, kind, settled }: { invoiceId: string; kind: string; settled: Money }) => {
      if (kind !== "sales") return;
      await applyAllocatedSettlement(salesInvoices, invoiceId, settled);
    },
  };
  const bankStatements = createSqliteBankReconciliationStore(sqlite);

  // --- phase11/crm-projects-assets-field — CRM, Projects, Fixed Assets, Field/Van Sales. ---
  const leads = createSqliteLeadRepository(sqlite);
  const opportunities = createSqliteOpportunityRepository(sqlite);
  const pipelineStages = createSqlitePipelineStageRepository(sqlite);
  const activities = createSqliteActivityRepository(sqlite);
  const projects = createSqliteProjectRepository(sqlite);
  const worksContracts = createSqliteWorksContractStore(sqlite);
  const contractingSiteStore = createSqliteContractingSiteStore(sqlite);
  const guarantees = createSqliteGuaranteeStore(sqlite);
  const progressCertificates = createSqliteProgressCertificateStore(sqlite);
  const subcontracts = createSqliteSubcontractStore(sqlite);
  const recognitionRuns = createSqliteContractingRecognitionStore(sqlite);
  const retentionReleases = createSqliteContractingControlsStore(sqlite);
  const assetCategories = createSqliteAssetCategoryRepository(sqlite);
  const assets = createSqliteAssetRepository(sqlite);
  const assetRateHistory = createSqliteAssetInternalRateHistoryRepository(sqlite);
  const depreciationRuns = createSqliteDepreciationRunRepository(sqlite);
  const vanTrips = createSqliteVanTripRepository(sqlite);

  /**
   * Which branch each posted journal entry belongs to (P-7).
   *
   * A journal entry has no branch of its own, so this resolves it through the
   * document that posted it. Called ONLY when a statement is actually being
   * narrowed to a branch; an entry whose source document cannot be found is
   * unattributed and drops out of a branch-limited statement rather than being
   * counted in it.
   */
  const resolveEntryBranches = async (
    entries: readonly { readonly id: string; readonly sourceDocId?: string | null }[],
  ): Promise<ReadonlyMap<string, string | null>> => {
    const wanted = new Set(entries.map((e) => e.sourceDocId).filter((id): id is string => !!id));
    const branchByDocId = new Map<string, string | null>();
    if (wanted.size > 0) {
      for (const invoice of await salesInvoices.list()) {
        if (wanted.has(invoice.id)) branchByDocId.set(invoice.id, invoice.branchId);
      }
      for (const invoice of await purchaseInvoices.list()) {
        if (wanted.has(invoice.id)) branchByDocId.set(invoice.id, invoice.branchId);
      }
      for (const doc of await vouchers.documents.list({ status: "confirmed" })) {
        if (wanted.has(doc.id)) branchByDocId.set(doc.id, doc.lines[0]?.branchId ?? null);
      }
    }
    return new Map(
      entries.map((e) => [e.id, e.sourceDocId ? branchByDocId.get(e.sourceDocId) ?? null : null]),
    );
  };

  /**
   * N-9 — the name a stale-document refusal carries. A 409 that says only
   * "somebody changed it" ends the conversation; one that names the person
   * starts it.
   */
  const displayNameOf = async (userId: string): Promise<string | null> => {
    const user = await uow.users.findById(userId);
    return user ? user.nameAr : null;
  };

  // --- inv/labels-templates-writedown — the aging-based inventory write-down batch. ---
  const writedownRuns = createSqliteWritedownRunRepository(sqlite);

  // --- inv/labels-templates-writedown — Product Templates (attribute CRUD + variant generator). ---
  const productTemplateStore = createSqliteProductTemplateStore(sqlite);

  // --- sweep/finish-and-mount — manufacturing (docs/archive/catalog/07: BOMs, work
  // orders, configurable products, custom manufacturing) and RFQ + historical
  // purchase import (docs/archive/catalog/02). ---
  const manufacturing = createSqliteManufacturingStores(sqlite);
  const rfqStores = createSqliteRfqStores(sqlite);
  const historicalImportArchives = createSqliteHistoricalPurchaseArchiveStore(sqlite);
  const salesHistoricalImportArchives = createSqliteHistoricalSalesArchiveStore(sqlite);

  // --- w8/print-migration — Print Template designer config (docs/archive/catalog/09
  // §"قوالب الطباعة"). The Data Migration wizard's department/employee steps
  // reuse hr/master-data's own `hrDepartments`/`hrEmployees` stores below. ---
  const printTemplateConfig = createSqlitePrintTemplateConfigStore(sqlite);

  // --- sweep/finish-and-mount — مرتجعات المبيعات/المشتريات, التكاليف
  // الإضافية, خطط الأقساط + متابعة التحصيل (docs/archive/catalog/01, 02, 05). ---
  const salesReturnStore = createStandaloneSqliteSalesReturnStore(sqlite);
  const purchaseReturnStore = createStandaloneSqlitePurchaseReturnStore(sqlite);
  const landedCostStore = createStandaloneSqliteLandedCostStore(sqlite);
  const followUps = createStandaloneSqliteFollowUpStore(sqlite);
  /** What confirmed returns took off each invoice, in base — the allocation sub-ledger nets it (D242). */
  const invoiceReturnCredits: InvoiceReturnCreditPort = {
    async returnedByIds(ids, kind) {
      if (ids.length === 0) return new Map();
      const wanted = new Set(ids);
      const credits =
        kind === "sales"
          ? salesReturnCreditByInvoice(await listReturnsCiting(salesReturnStore, ids))
          : purchaseReturnCreditByInvoice(await listReturnsCiting(purchaseReturnStore, ids));
      return new Map([...credits].filter(([id]) => wanted.has(id)));
    },
  };

  // --- phase4/inventory-ops — Stock Adjustments, Stock Transfers, Physical
  // Counts document layer (docs/archive/catalog/03), on the SAME shared connection
  // (createSqliteInventoryOpsStore reuses `sqlite` here rather than opening
  // its own — see packages/persistence/src/sqlite-connection.ts). ---
  const inventoryOps = createSqliteInventoryOpsStore(sqlite);

  // --- hr/master-data — departments, job titles, employees, contracts, holidays, leave requests (docs/archive/catalog/06 §"الموارد البشرية"). ---
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
  const advanceVoucherUnwind: VoucherAdvanceUnwindPort = {
    onVoucherReversed: (voucherId) => unwindAdvanceVoucher(voucherId, { advances: hrAdvances }),
  };
  const hrClockCredentials = createSqliteClockCredentialRepository(sqlite);
  const hrChallenges = createSqliteWebauthnChallengeRepository(sqlite);
  const hrPayrollRuns = createSqlitePayrollRunRepository(sqlite);
  const hrPayslips = createSqlitePayslipRepository(sqlite);
  const hrPayrollComponents = createSqlitePayrollComponentRepository(sqlite);
  const hrGarnishments = createSqliteGarnishmentRepository(sqlite);
  const hrStatutoryOverrides = createSqliteStatutoryOverrideRepository(sqlite);
  const hrStatutoryFlag = createSqlitePayrollStatutoryFlagRepository(sqlite);

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

  // DEC-17: no webhook dispatcher subscribes to this bus. `/webhooks` is not
  // mounted (packages/api/src/app.ts), so nothing in the product can register a
  // target — a dispatcher here would only be an outbound HTTP surface with no
  // caller and no verifier. Re-add it in the same place if that decision is
  // reversed and the mount comes back.
  // --- w8/workflow-ui — إعدادات الموافقات chain-builder + الموافقات inbox
  // (docs/archive/catalog/09 §سير العمل). `workflowConfigs` is also the REAL
  // `resolveConfig` behind `createDocumentWorkflowGate` below — a tenant that
  // configures a chain for e.g. SALES_RETURN_CONFIRM has that document type
  // actually held بانتظار الموافقة on confirm, not just a config the /workflow
  // screen has no effect on. ---
  const workflowConfigs = createSqliteWorkflowConfigStore(sqlite);
  const approvalRequests = createSqliteApprovalRequestStore(sqlite);

  /**
   * The contracting control and contract-cost accounts, resolved through the
   * routing store, whose journal lines MUST name a project. A hand-written
   * entry that moved 1230 or 2160 with no `projectId` produced a figure no
   * project report could roll up and no module could reconcile.
   *
   * The memorandum pair, the restricted-cash margin and «خسائر عقود متوقعة»
   * are deliberately NOT in the set: a forfeited خطاب ضمان ابتدائي belongs to a
   * TENDER, which by construction has no project yet.
   */
  const PROJECT_REQUIRED_ROUTING_KEYS = [
    "contracting.wip",
    "contracting.contract_asset",
    "contracting.contract_liability",
    "contracting.billings",
    "contracting.retention_receivable",
    "contracting.retention_payable",
    "contracting.customer_advances",
    "contracting.cost_of_revenue",
    "contracting.social_insurance",
    "contracting.social_insurance_withheld",
    "contracting.employer_materials",
    "contracting.stamp_duty",
    "contracting.utilities",
    "contracting.onerous_provision",
    "contracting.wht_receivable",
    "contracting.wht_payable",
    "contracting.subcontractor_advances",
  ] as const;
  const projectRequiredAccountIds = new Set<string>(
    (
      await Promise.all(
        PROJECT_REQUIRED_ROUTING_KEYS.map(async (key) =>
          routedAccountId(await accountRouting.get(), key),
        ),
      )
    ).filter((id): id is string => id !== null),
  );
  // `audit` so every posting this composition makes — the contracting module's
  // included — leaves a forensic row naming the entry, its date and its actor.
  // vatFilings rides along so a DOCUMENT confirm is gated by a filed return
  // exactly as a hand-written journal entry is (D29).
  const salesInvoiceGl = {
    ledger,
    accounts,
    periods: fiscalPeriods,
    numbering: ledger.numbering,
    vatFilings,
    projects,
    projectRequiredAccountIds,
    audit: auditSink,
  };
  const historicalImportGate = {
    assertPostable: async (date: string): Promise<void> => {
      await assertPeriodOpen(date, fiscalPeriods);
      await assertVatNotFiled(date, vatFilings);
    },
    transaction: <T>(fn: () => Promise<T>): Promise<T> => ledger.transaction(fn),
  };
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
    // A tenant that never generated a period has no calendar to be outside of.
    // Once it has one, a day no period covers is refused as the GL refuses it.
    periodGate: async (date) => {
      const period = await fiscalPeriods.findByDate(date);
      if (period) return assertOpenForPosting(period);
      if ((await fiscalPeriods.list()).length > 0) throw new NoFiscalPeriodForDateError(date);
    },
    // Only activates when a caller ALSO passes a per-call `gl` (StockLedgerService
    // posts only when BOTH are present) — today that's every stock-adjustment
    // reason (createInventoryOpsStockHook below); every other stock
    // hook (sales invoices, purchases, manufacturing, transfers) posts its own GL
    // through a separate path and never passes `command.gl`, so this is additive.
    gl: createInventoryGlPostingHook(salesInvoiceGl),
    // The last-resort cost for an issue out of a position that holds nothing
    // and was never received anywhere. Without it such an issue was written at
    // zero and COGS was understated by the whole deficit (D101).
    fallbackUnitCost: async (itemId) => (await items.findById(itemId))?.costPrice ?? null,
  });
  /**
   * The expense accounts a contract's التكلفة حتى تاريخه must NOT count:
   * غرامة التأخير (a deduction from the price — counting it would raise the
   * percentage of completion for being late), the plant-recovery contra of a
   * cost already in WIP, the run's own onerous-loss line, and the
   * inventory-adjustment accounts 5060–5080, which are shrinkage rather than
   * anything built. Everything else expense-type still counts.
   */
  const contractingCostExclusions = async (): Promise<ReadonlySet<string>> => {
    const routing = await accountRouting.get();
    const excluded = new Set<string>([
      routedAccountId(routing, "contracting.late_penalty") ?? "5910",
      routedAccountId(routing, "contracting.plant_recovery") ?? "5160",
      routedAccountId(routing, "contracting.onerous_loss") ?? "5930",
    ]);
    for (const account of await accounts.list()) {
      if (account.type === "expense" && account.code >= "5060" && account.code <= "5080") excluded.add(account.id);
    }
    return excluded;
  };

  /**
   * التكلفة حتى تاريخه for a project on the recognition run's own basis. The
   * cost-overrun exception report reads it through THIS function rather than
   * summing the ledger itself, so the report and the run can never disagree
   * about what a contract has cost.
   */
  const contractingProjectCostToDate = async (projectId: string, toDate: string): Promise<Money> => {
    const [routing, accountList, excluded, lines] = await Promise.all([
      accountRouting.get(),
      accounts.list(),
      contractingCostExclusions(),
      ledger.listLines?.({ projectId, toDate }) ?? [],
    ]);
    const expenseAccountIds = new Set(accountList.filter((a) => a.type === "expense").map((a) => a.id));
    return costToDateOf(
      lines,
      expenseAccountIds,
      {
        wip: routedAccountId(routing, "contracting.wip") ?? "1230",
        onerousLoss: routedAccountId(routing, "contracting.onerous_loss") ?? "5930",
        plantRecovery: routedAccountId(routing, "contracting.plant_recovery") ?? "5160",
      },
      excluded,
    );
  };

  // المقاولات 4A — site issues/receipts move stock through the branch transit
  // store, consumption relieves it into WIP, and plant hours post their own
  // entry. It shares `stockService` and `salesInvoiceGl` so the movements and
  // the postings land in the SAME ledger every other document writes to.
  const siteService = new SiteService({
    issues: contractingSiteStore.issues,
    receipts: contractingSiteStore.receipts,
    consumptions: contractingSiteStore.consumptions,
    custody: contractingSiteStore.custody,
    equipmentLogs: contractingSiteStore.equipmentLogs,
    warehouses,
    projects,
    assets,
    assetRateHistory,
    stockLedger: stockService,
    gl: salesInvoiceGl,
    audit: auditSink,
    numbering: ledger.numbering,
    accountRouting,
    transaction: (fn) => contractingSiteStore.transaction(fn),
    // A boqLineId on a consumption or a plant-hours log must name a real BOQ
    // line, or the consumed-vs-theoretical comparison silently drops the row.
    boqLines: {
      exists: async (boqLineId) => {
        for (const contract of await worksContracts.listContracts()) {
          if ((await worksContracts.listBoqLines(contract.id)).some((line) => line.id === boqLineId)) return true;
        }
        return false;
      },
    },
    // A project running under a live works contract is measured against its
    // جدول الكميات, so consumption on it MUST name the line it was spent on or
    // it never reaches انحراف الاستهلاك.
    worksContracts: {
      hasActiveContract: async (projectId) =>
        (await worksContracts.listContracts({ projectId })).some((c) => c.status === "active"),
    },
  });
  // Sales invoices are the one document type the catalog's own email-template
  // preview names explicitly ("تم إنشاء الفاتورة INV-000123 بقيمة 1,150.00 ج.م
  // للعميل" — docs/archive/catalog/09 §البريد الإلكتروني), so this bridge enriches the
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

  /**
   * The e-receipt producer (D283): issues synchronously for the confirm route
   * and a future POS till, and from the confirm events for every other path.
   */
  const etaReceipts = createEtaReceiptIssuer({
    eta: etaService,
    invoices: salesInvoices,
    returns: salesReturnStore,
    customers,
    items,
    taxRates,
    branchCodes: etaStore.branchCodes,
    unitMappings: etaStore.unitMappings,
    companyTradeName: async () => ((await settings.get()) ?? createDefaultSettings()).companyName,
    tenderOf: async (invoiceId) => {
      const allocations = (await vouchers.allocations.listByInvoice(invoiceId)).filter((a) => a.status === "active");
      const largest = [...allocations].sort((a, b) => (b.amount.scaled > a.amount.scaled ? 1 : b.amount.scaled < a.amount.scaled ? -1 : 0))[0];
      if (!largest) return null;
      const voucher = await vouchers.documents.findById(largest.voucherId);
      return voucher?.lines[0]?.paymentMethod ?? null;
    },
  });

  const etaEnqueueBridge = createEtaEnqueueBridge({
    eta: etaService,
    issuer: etaReceipts,
    invoices: salesInvoices,
    customers,
    items,
    taxRates,
    branchCodes: etaStore.branchCodes,
    unitMappings: etaStore.unitMappings,
  });
  const salesInvoiceEvents = fanOutDocumentEvents(salesInvoiceEventBridge, etaEnqueueBridge);

  /**
   * D-03's billing arrow, enforced on EVERY sales invoice and not just the ones
   * a certificate raises: a project running a LIVE cost_to_cost works contract
   * recognises revenue from the monthly EAS 48 run, so an ordinary invoice on
   * it must credit البللينغ 2165 rather than إيرادات — otherwise the same work
   * is counted twice, once by the invoice and once by the run.
   *
   * `revenueAccountIds` is the tenant's own chart, so a retention-release line
   * (whose "revenue" account is the retention asset) and a billings line are
   * left exactly where they are.
   */
  const contractBillingRouting: ContractBillingRoutingPort = {
    async resolve(projectId) {
      const live = (await worksContracts.listContracts()).find(
        (contract) =>
          contract.projectId === projectId &&
          contract.status === "active" &&
          contract.recognitionPolicy === "cost_to_cost",
      );
      if (!live) return null;
      const [routing, chart] = await Promise.all([accountRouting.get(), accounts.list()]);
      const billingsAccountId = routedAccountId(routing, "contracting.billings") ?? "2165";
      return {
        billingsAccountId,
        revenueAccountIds: new Set(chart.filter((a) => a.type === "revenue").map((a) => a.id)),
        memoAr: `عقد مقاولات بنظام نسبة الإتمام — الإيراد يُعترف به بمسيرة EAS 48 الشهرية، وهذه الفاتورة تُرحّل إلى حساب فواتير المستخلصات (${billingsAccountId}).`,
      };
    },
  };

  /**
   * المستخلص 2 — the certificate BILLS through the EXISTING sales-invoice
   * engine (D-02). The certificate stays its own document and the invoice a
   * thin derived one, so AR, aging, ETA and voucher allocation are reused
   * unchanged.
   *
   * INVARIANT: `settle` bumps the invoice's allocated total by exactly what
   * the deductions entry credited to AR. The GL and the receivables
   * sub-ledger move together, or the invoice reads as owing the gross while
   * the control account holds the net.
   */
  const certificateInvoicing: CertificateInvoicingPort = {
    async issue(cmd) {
      const [customer, branchList, warehouseList, routing] = await Promise.all([
        customers.findById(cmd.customerId),
        branches.findAll(),
        warehouses.findAll(),
        accountRouting.get(),
      ]);
      const branchId = branchList[0]?.id;
      const warehouseId = warehouseList[0]?.id;
      if (!branchId || !warehouseId) {
        throw new Error("لا يمكن إصدار فاتورة المستخلص قبل تعريف فرع ومستودع واحد على الأقل.");
      }
      const invoiceId = `${cmd.certificateId}-INV`;
      const service = new SalesInvoiceService({
        repo: salesInvoices,
        numbering: { next: (opts) => ledger.numbering.next("SALES_INVOICE", { branchId: opts?.branchId }) },
        gl: createSalesInvoiceGlHook(salesInvoiceGl),
        stock: createSalesInvoiceStockHook(stockService),
        allocatable: vouchers.invoices,
        audit: auditSink,
        // INVARIANT: the SAME publisher the /sales/invoices routes use. A
        // derived invoice confirmed without it is a live invoice the ETA queue
        // never hears about (D5) — the authority sees the tenant's certificate
        // billing simply missing.
        events: salesInvoiceEvents,
        // The REAL actor, not "system": this invoice is a live receivable, and
        // its audit row named nobody.
        actor: cmd.actor ?? "system",
      });
      await service.createDraft({
        id: invoiceId,
        date: cmd.date,
        dueDate: cmd.dueDate,
        customerId: cmd.customerId,
        customerNameAr: customer?.nameAr ?? cmd.customerId,
        warehouseId,
        branchId,
        projectId: cmd.projectId,
        currency: "EGP",
        notes: cmd.memoAr,
        arAccountId: CERTIFICATE_AR_ACCOUNT_ID,
        taxAccountId: routedAccountId(routing, "tax.output_vat") ?? "2200",
        lines: [
          {
            lineId: `${invoiceId}-L1`,
            itemId: CERTIFICATE_WORKS_ITEM_ID,
            itemNameAr: cmd.lineDescriptionAr,
            isStock: false,
            qty: Qty.fromMajor("1"),
            unitPrice: cmd.amount,
            // The invoice engine takes a percent, so the transitional basis is
            // carried as its EFFECTIVE rate (14% × 36% = 5.04%) and the basis
            // itself is stated in the memo — there is no second rate field to
            // put "36% of value" in.
            taxRatePercent: Number(cmd.taxRatePercent),
            revenueAccountId: cmd.revenueAccountId,
          },
        ],
      });
      const confirmed = await service.confirm(invoiceId, { actor: cmd.actor ?? "system" });
      const totals = salesInvoiceTotals(confirmed.invoice);
      return {
        invoiceId,
        invoiceDocNo: confirmed.invoice.docNo ?? invoiceId,
        arAccountId: confirmed.invoice.arAccountId,
        total: salesInvoiceBaseGrandTotal(totals, confirmed.invoice.fxRate),
      };
    },
    async status(invoiceId) {
      const invoice = await salesInvoices.findById(invoiceId);
      if (!invoice) return null;
      const total = salesInvoiceBaseGrandTotal(salesInvoiceTotals(invoice), invoice.fxRate);
      const sub = await vouchers.invoices.findById(invoiceId);
      const allocated = sub?.allocated ?? Money.zero();
      const returned = (await invoiceReturnCredits.returnedByIds([invoiceId], "sales")).get(invoiceId) ?? Money.zero();
      return {
        invoiceId,
        docNo: invoice.docNo,
        total,
        amountPaid: allocated,
        remainingBalance: Money.fromScaled(total.scaled - allocated.scaled - returned.scaled),
        dueDate: invoice.dueDate,
        status: invoice.status,
      };
    },
    async settle(invoiceId, amount) {
      const sub = await vouchers.invoices.findById(invoiceId);
      if (!sub) return;
      await vouchers.invoices.save({ ...sub, allocated: Money.fromScaled(sub.allocated.scaled + amount.scaled) });
    },
    /**
     * The void, mirroring /sales/invoices/:id/void: a LINKED reversing entry
     * (never an edit or a delete), the invoice moved to «معكوس», and the
     * receivable sub-ledger row zeroed so it leaves AR with the control
     * account. The certificate's own lines are never stock, so there is
     * nothing to put back into the store.
     */
    async voidInvoice(invoiceId, date, reasonAr) {
      const invoice = await salesInvoices.findById(invoiceId);
      if (!invoice) return;
      if (invoice.status === "reversed" || invoice.status === "cancelled") return;
      if (invoice.journalEntryId) {
        await reverseJournalEntry(invoice.journalEntryId, salesInvoiceGl, {
          reversalId: `${invoice.id}:void`,
          date,
          memo: `عكس فاتورة مستخلص ${invoice.docNo ?? invoice.id} — ${reasonAr}`,
        });
      }
      await salesInvoices.update({ ...invoice, status: "reversed" });
      const sub = await vouchers.invoices.findById(invoiceId);
      if (sub) await vouchers.invoices.save({ ...sub, total: Money.zero(), allocated: Money.zero() });
    },
  };

  /**
   * خطاب ضمان الدفعة المقدمة reduces in step with recovery (Law 182/2018
   * Art. 44). Optional: a contract with no advance guarantee on the register
   * simply has nothing to reduce.
   */
  /**
   * التأمين النهائي (قانون ١٨٢ لسنة ٢٠١٨): the outstanding خطابات حسن التنفيذ
   * a public contract's 5% security is covered by. `reduced` counts — a letter
   * stepped down is still the employer's security for what is left of it.
   */
  const contractPerformanceGuarantees: ContractGuaranteePort = {
    async listPerformanceGuarantees(contractId) {
      return (await guarantees.list())
        .filter((g) => g.contractId === contractId && g.kind === "performance" && isGuaranteeOutstanding(g))
        .map((g) => ({ id: g.id, docNo: g.docNo, currentValue: g.currentValue, expiryDate: g.expiryDate }));
    },
  };

  const certificateGuarantees: CertificateGuaranteePort = {
    async reduceAdvanceGuarantee({ contractId, projectId, date, amount, sourceRef, actor }) {
      const live = (await guarantees.list()).find(
        (g) =>
          // The register links a letter to a project OR to a contract, and the
          // advance guarantee is commonly filed against the project — matching
          // only on contractId leaves it never reducing at all.
          (g.contractId === contractId || (g.contractId === null && g.projectId === projectId)) &&
          g.kind === "advance" &&
          (g.status === "active" || g.status === "reduced") &&
          g.currentValue.scaled > 0n,
      );
      if (!live) return;
      const capped = amount.scaled > live.currentValue.scaled ? live.currentValue : amount;
      const service = new GuaranteeService({
        guarantees,
        treasuryAccounts,
        accounts,
        projects,
        routing: accountRouting,
        gl: salesInvoiceGl,
        audit: auditSink,
      });
      await service.reduce(live.id, {
        date,
        amount: capped,
        reason: "خصم الدفعة المقدمة من المستخلص",
        sourceRef,
        userId: actor ?? null,
      });
    },
    async restoreAdvanceGuarantee({ contractId, projectId, date, amount, sourceRef }) {
      const live = (await guarantees.list()).find(
        (g) =>
          (g.contractId === contractId || (g.contractId === null && g.projectId === projectId)) &&
          g.kind === "advance" &&
          (g.status === "active" || g.status === "reduced"),
      );
      if (!live) return;
      const headroom = live.faceValue.scaled - live.currentValue.scaled;
      if (headroom <= 0n) return;
      const capped = amount.scaled > headroom ? Money.fromScaled(headroom) : amount;
      const service = new GuaranteeService({
        guarantees,
        treasuryAccounts,
        accounts,
        projects,
        routing: accountRouting,
        gl: salesInvoiceGl,
        audit: auditSink,
      });
      await service.restore(live.id, {
        date,
        amount: capped,
        reason: "إلغاء مستخلص — استرجاع تخفيض الدفعة المقدمة",
        sourceRef,
      });
    },
  };

  /**
   * الإفراج عن المحتجزات 5B — the release becomes a RECEIVABLE, not a new sale.
   * The generated invoice carries one non-stock, zero-tax line whose "revenue"
   * account is the RETENTION account, so the invoice's own posting is the
   * Dr 1105 / Cr 1150 reclass and the AR sub-ledger moves by exactly what the
   * control account did.
   *
   * INVARIANT: `dueDate` is the RELEASE EVENT, never the release date and never
   * the certificate's — retention aged as ordinary AR reads 120-days-overdue
   * the day it is created (design §06).
   */
  const retentionInvoicing: RetentionReleaseInvoicingPort = {
    async issue(cmd) {
      const [customer, branchList, warehouseList, routing] = await Promise.all([
        customers.findById(cmd.customerId),
        branches.findAll(),
        warehouses.findAll(),
        accountRouting.get(),
      ]);
      const branchId = branchList[0]?.id;
      const warehouseId = warehouseList[0]?.id;
      if (!branchId || !warehouseId) {
        throw new Error("لا يمكن إصدار مستند الإفراج عن المحتجزات قبل تعريف فرع ومستودع واحد على الأقل.");
      }
      const invoiceId = `${cmd.releaseId}-INV`;
      const service = new SalesInvoiceService({
        repo: salesInvoices,
        numbering: { next: (opts) => ledger.numbering.next("SALES_INVOICE", { branchId: opts?.branchId }) },
        gl: createSalesInvoiceGlHook(salesInvoiceGl),
        stock: createSalesInvoiceStockHook(stockService),
        allocatable: vouchers.invoices,
        audit: auditSink,
        // INVARIANT: the same publisher the /sales/invoices routes use — see the certificate's port above.
        events: salesInvoiceEvents,
        // The REAL actor, not "system": this invoice is a live receivable, and
        // its audit row named nobody.
        actor: cmd.actor ?? "system",
      });
      await service.createDraft({
        id: invoiceId,
        date: cmd.date,
        dueDate: cmd.dueDate,
        customerId: cmd.customerId,
        customerNameAr: customer?.nameAr ?? cmd.customerId,
        warehouseId,
        branchId,
        projectId: cmd.projectId,
        currency: "EGP",
        notes: cmd.memoAr,
        arAccountId: CERTIFICATE_AR_ACCOUNT_ID,
        taxAccountId: routedAccountId(routing, "tax.output_vat") ?? "2200",
        lines: [
          {
            lineId: `${invoiceId}-L1`,
            itemId: cmd.itemId,
            itemNameAr: cmd.lineDescriptionAr,
            isStock: false,
            qty: Qty.fromMajor("1"),
            unitPrice: cmd.amount,
            // No VAT: the works were taxed on the certificate that withheld
            // this money. Taxing the release again would charge it twice.
            taxRatePercent: 0,
            revenueAccountId: cmd.retentionAccountId,
          },
        ],
      });
      const confirmed = await service.confirm(invoiceId, { actor: cmd.actor ?? "system" });
      const totals = salesInvoiceTotals(confirmed.invoice);
      return {
        invoiceId,
        invoiceDocNo: confirmed.invoice.docNo ?? invoiceId,
        arAccountId: confirmed.invoice.arAccountId,
        total: salesInvoiceBaseGrandTotal(totals, confirmed.invoice.fxRate),
      };
    },
    async status(invoiceId) {
      const invoice = await salesInvoices.findById(invoiceId);
      if (!invoice) return null;
      const total = salesInvoiceBaseGrandTotal(salesInvoiceTotals(invoice), invoice.fxRate);
      const sub = await vouchers.invoices.findById(invoiceId);
      const allocated = sub?.allocated ?? Money.zero();
      const returned = (await invoiceReturnCredits.returnedByIds([invoiceId], "sales")).get(invoiceId) ?? Money.zero();
      return {
        invoiceId,
        docNo: invoice.docNo,
        total,
        amountPaid: allocated,
        remainingBalance: Money.fromScaled(total.scaled - allocated.scaled - returned.scaled),
        dueDate: invoice.dueDate,
        status: invoice.status,
      };
    },
  };

  /**
   * فصل المهام — read per call, never captured. The wildcard admin is bound by
   * preparer ≠ certifier ≠ approver like everyone else UNLESS the tenant has
   * turned on «وضع المشغّل الواحد», which a genuinely one-person install does
   * and nobody else should.
   */
  const segregationWaived = async (actor: { wildcardAdmin: boolean }): Promise<boolean> => {
    if (!actor.wildcardAdmin) return false;
    const tenant = (await settings.get()) ?? createDefaultSettings();
    return tenant.contractingSingleOperatorMode;
  };

  const certificateDeps = {
    store: progressCertificates,
    contracts: worksContracts,
    numbering: ledger.numbering,
    gl: salesInvoiceGl,
    routing: accountRouting,
    invoicing: certificateInvoicing,
    guarantees: certificateGuarantees,
    accounts,
    projects,
    cbeCreditDiscountRatePercent: async () => {
      const tenant = (await settings.get()) ?? createDefaultSettings();
      const rate = tenant.contractingCbeCreditDiscountRatePercent;
      return rate === null ? null : String(rate);
    },
    audit: auditSink,
    segregationWaived,
  };
  const certificateService = new CertificateService(certificateDeps);

  /**
   * عقود الباطن — slice 3. The mirror of the certificate wiring above, with
   * every engine reused rather than re-implemented: a real purchase invoice
   * through the purchasing module, the real AP allocation sub-ledger, the real
   * voucher store for the advance, and the CLIENT certificates as the ceiling.
   */
  const subcontractPurchaseGl: PurchaseGlPostingPort = {
    post: async (posting: PurchaseGlPosting) => {
      await postJournalEntry(
        {
          id: `PI-JE:${posting.sourceDocId}`,
          date: posting.date,
          memo: posting.memo,
          source: "system",
          sourceDocType: posting.sourceDocType,
          sourceDocId: posting.sourceDocId,
          sourceDocNumber: posting.sourceDocNumber ?? null,
          lines: posting.lines.map((l) => ({
            accountId: l.accountId,
            debit: l.debit,
            credit: l.credit,
            currency: l.currency ?? null,
            fxRate: l.fxRate ?? null,
            taxRatePercent: l.taxRatePercent ?? null,
            projectId: l.projectId ?? null,
            costCategory: l.costCategory ?? null,
          })),
        },
        salesInvoiceGl,
      );
    },
  };

  /**
   * INVARIANT: `settle` bumps the purchase invoice's allocated total by exactly
   * what the deductions entry debited to AP. The GL and the payables sub-ledger
   * move together, or the invoice reads as owing the gross while the control
   * account holds the net.
   */
  /**
   * INVARIANT: a subcontract's invoice is booked in the PROJECT's own branch
   * and site store, resolved from مستودع الموقع. Falling back to the first
   * branch in the list put every project's cost in the head-office branch and
   * made per-branch reporting silently wrong.
   */
  const projectPosting = async (projectId: string): Promise<{ branchId: string; warehouseId: string }> => {
    const siteStore = (await warehouses.findAll()).find(
      (w) => w.type === "SITE" && w.projectId === projectId && w.active,
    );
    if (!siteStore) {
      throw new Error(
        `لا يمكن إصدار مستند على المشروع "${projectId}" قبل تعريف مستودع موقع له — الفرع والمستودع يُقرآن منه.`,
      );
    }
    return { branchId: siteStore.branchId, warehouseId: siteStore.id };
  };

  const subCertificateInvoicing: SubCertificateInvoicingPort = {
    async issue(cmd) {
      const { branchId, warehouseId } = await projectPosting(cmd.projectId);
      const invoiceId = `${cmd.certificateId}-PINV`;
      await createPurchaseInvoice(
        {
          id: invoiceId,
          supplierId: cmd.supplierId,
          date: cmd.date,
          dueDate: cmd.dueDate,
          supplierInvoiceNumber: cmd.certificateDocNo,
          branchId,
          warehouseId,
          currency: "EGP",
          notes: cmd.memoAr,
          projectId: cmd.projectId,
          createdBy: cmd.actor ?? "system",
          lines: [
            {
              itemId: null,
              kind: "expense",
              description: cmd.lineDescriptionAr,
              qty: Qty.fromMajor("1"),
              unitCost: cmd.amount,
              // The invoice engine takes a percent, so the transitional basis is
              // carried as its EFFECTIVE rate and the basis itself is stated in
              // the memo.
              taxRatePercent: Number(cmd.taxRatePercent),
              costCategory: "subcontract",
            },
          ],
        },
        { invoices: purchaseInvoices, numbering: ledger.numbering },
      );
      const { invoice } = await confirmPurchaseInvoice(invoiceId, {
        invoices: purchaseInvoices,
        stock: stockService,
        gl: subcontractPurchaseGl,
        // The expense account is the SUBCONTRACT's: a subcontractor's certified
        // work is أعمال تحت التنفيذ (1230), relieved to cost of contract revenue
        // by the monthly recognition run, never a period expense on 5910.
        accounts: { ...PURCHASE_GL_ACCOUNTS, expenseAccountId: cmd.expenseAccountId },
        allocatable: vouchers.invoices,
        exchangeRates,
        baseCurrency: "EGP",
        audit: auditSink,
        actor: cmd.actor ?? "system",
      });
      return {
        invoiceId,
        invoiceDocNo: invoice.number,
        apAccountId: PURCHASE_GL_ACCOUNTS.payableAccountId,
        total: purchaseInvoiceBaseTotal(invoice),
      };
    },
    async status(invoiceId) {
      const invoice = await purchaseInvoices.findById(invoiceId);
      if (!invoice) return null;
      const total = purchaseInvoiceBaseTotal(invoice);
      const sub = await vouchers.invoices.findById(invoiceId);
      const allocated = sub?.allocated ?? Money.zero();
      const returned = (await invoiceReturnCredits.returnedByIds([invoiceId], "purchase")).get(invoiceId) ?? Money.zero();
      return {
        invoiceId,
        docNo: invoice.number,
        total,
        amountPaid: allocated,
        remainingBalance: Money.fromScaled(total.scaled - allocated.scaled - returned.scaled),
        dueDate: invoice.dueDate,
        status: invoice.status,
      };
    },
    async settle(invoiceId, amount) {
      const sub = await vouchers.invoices.findById(invoiceId);
      if (!sub) return;
      await vouchers.invoices.save({ ...sub, allocated: Money.fromScaled(sub.allocated.scaled + amount.scaled) });
    },
  };

  /**
   * INVARIANT: الإفراج عن محتجزات الباطن is a purchase invoice whose single
   * expense line debits 2195, so its own posting is Dr 2195 / Cr AP: the AP
   * sub-ledger moves with GL 2100 and a payment voucher can settle it. Its due
   * date is the release EVENT, not the invoice date plus payment terms.
   */
  const subcontractRetentionInvoicing: SubcontractRetentionInvoicingPort = {
    async issue(cmd) {
      const { branchId, warehouseId } = await projectPosting(cmd.projectId);
      const invoiceId = `${cmd.releaseId}-PINV`;
      await createPurchaseInvoice(
        {
          id: invoiceId,
          supplierId: cmd.supplierId,
          date: cmd.date,
          dueDate: cmd.dueDate,
          supplierInvoiceNumber: cmd.subcontractDocNo,
          branchId,
          warehouseId,
          currency: "EGP",
          notes: cmd.memoAr,
          projectId: cmd.projectId,
          createdBy: cmd.actor ?? "system",
          lines: [
            {
              itemId: null,
              kind: "expense",
              description: cmd.lineDescriptionAr,
              qty: Qty.fromMajor("1"),
              unitCost: cmd.amount,
              taxRatePercent: 0,
            },
          ],
        },
        { invoices: purchaseInvoices, numbering: ledger.numbering },
      );
      const { invoice } = await confirmPurchaseInvoice(invoiceId, {
        invoices: purchaseInvoices,
        stock: stockService,
        gl: subcontractPurchaseGl,
        accounts: { ...PURCHASE_GL_ACCOUNTS, expenseAccountId: cmd.retentionAccountId },
        allocatable: vouchers.invoices,
        exchangeRates,
        baseCurrency: "EGP",
        audit: auditSink,
        actor: cmd.actor ?? "system",
      });
      return {
        invoiceId,
        invoiceDocNo: invoice.number,
        journalEntryId: `PI-JE:${invoiceId}`,
      };
    },
  };

  const subcontractSuppliers: SubcontractSupplierPort = {
    async find(supplierId) {
      const supplier = await suppliers.findById(supplierId);
      if (!supplier) return null;
      return {
        id: supplier.id,
        nameAr: supplier.nameAr,
        taxNumber: supplier.taxNumber,
        bankAccount: supplier.bankAccount,
      };
    },
  };

  const subcontractVouchers: SubcontractVoucherPort = {
    async find(voucherId) {
      const doc = await vouchers.documents.findById(voucherId);
      const line = doc?.lines[0];
      if (!doc || !line) return null;
      return {
        id: doc.id,
        docNo: doc.docNo,
        date: doc.date,
        amount: line.amount,
        supplierId: line.supplierId ?? null,
        counterpartyGlAccountId: line.counterpartyGlAccountId ?? null,
        status: doc.status,
        direction: line.direction,
      };
    },
  };

  /**
   * The back-to-back ceiling. Only certificates the consultant has SIGNED count
   * — a quantity still at حصر is one nobody outside the company has agreed to —
   * and the latest one carries the cumulative, so it is the one that is read.
   */
  const clientCertifiedQuantities: ClientCertifiedQuantityPort = {
    async certifiedCumulativeByBoqLine(contractId) {
      const signed = (await progressCertificates.listByContract(contractId)).filter(
        (c) =>
          c.status === "certified" || c.status === "approved_for_payment" || c.status === "invoiced",
      );
      const latest = signed.length === 0 ? null : signed[signed.length - 1];
      const map = new Map<string, Qty>();
      for (const line of latest?.workLines ?? []) {
        map.set(line.boqLineId, line.cumulativeQty);
      }
      return map;
    },
  };

  const subcontractConsumptions: SubcontractConsumptionPort = {
    async materialsIssuedTo(subcontractId) {
      const rows = await contractingSiteStore.consumptions.list({ subcontractId, status: "confirmed" });
      return Money.sum(rows.map((r) => r.totalCost));
    },
  };

  const subcontractDeps = {
    store: subcontracts,
    contracts: worksContracts,
    numbering: ledger.numbering,
    gl: salesInvoiceGl,
    routing: accountRouting,
    suppliers: subcontractSuppliers,
    vouchers: subcontractVouchers,
    retentionInvoicing: subcontractRetentionInvoicing,
    audit: auditSink,
  };
  const subCertificateDeps = {
    store: subcontracts,
    contracts: worksContracts,
    numbering: ledger.numbering,
    gl: salesInvoiceGl,
    routing: accountRouting,
    invoicing: subCertificateInvoicing,
    suppliers: subcontractSuppliers,
    clientCertificates: clientCertifiedQuantities,
    consumptions: subcontractConsumptions,
    audit: auditSink,
    segregationWaived,
  };


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

  /*
   * The purchase chain is not a `DocumentService`, so it never had a publisher
   * and five catalogued codes had no producer at all (DEC-5). Routing the chain
   * through the document framework would have touched receipt→PO status
   * propagation, invoice-from-receipt auto-fill, the `layers` cancel path and
   * D75's landed-cost accounting — a large blast radius for a notification
   * feature — so it gets a publisher of its own instead. A later migration
   * reuses this same port.
   */
  const purchasesEventMapping = {
    PURCHASE_ORDER: { DOCUMENT_CONFIRMED: "PURCHASE_ORDER_CONFIRMED" },
    GOODS_RECEIPT: { DOCUMENT_CONFIRMED: "PURCHASE_RECEIPT_CONFIRMED", DOCUMENT_CANCELLED: "PURCHASE_RECEIPT_VOIDED" },
    PURCHASE_INVOICE: { DOCUMENT_CONFIRMED: "PURCHASE_INVOICE_CONFIRMED", DOCUMENT_CANCELLED: "PURCHASE_INVOICE_VOIDED" },
  } satisfies DocumentEventMapping;
  const purchasesEventBridge = createDocumentEventBridge(eventBus, purchasesEventMapping);

  /*
   * `VoucherService` has declared an `events` port since it was written and
   * nothing ever passed one, so `CASH_VOUCHER_CONFIRMED` was a sixth silent
   * code — catalogued, selectable in a notification rule, and unreachable.
   */
  const voucherEventMapping = {
    [VOUCHER_DOC_TYPE]: { DOCUMENT_CONFIRMED: "CASH_VOUCHER_CONFIRMED" },
  } satisfies DocumentEventMapping;
  const voucherEventBridge = createDocumentEventBridge(eventBus, voucherEventMapping);

  const salesReturnEvents = fanOutDocumentEvents(
    returnsEventBridge,
    createReturnEtaEnqueueBridge({
      eta: etaService,
      issuer: etaReceipts,
      returns: salesReturnStore,
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
    events: salesReturnEvents,
    /*
     * WITHOUT THIS the document's confirm and cancel write nothing to the
     * audit trail. `DocumentService.recordAudit` is guarded on `deps.audit`,
     * so an omitted sink is silent: the document posts, the ledger moves, and
     * the act leaves no forensic record at all.
     *
     * Found because تقرير التعديلات بعد الترحيل was empty on a seeded tenant
     * that demonstrably cancels a confirmed purchase return — the report was
     * right and the trail it reads was never written.
     */
    audit: auditSink,
    auditModule: "sales",
  });
  const purchaseReturns = new DocumentService(createPurchaseReturnDocumentType(PURCHASE_RETURN_GL_ACCOUNTS), {
    repo: purchaseReturnStore,
    numbering: { next: (opts) => ledger.numbering.next("PURCHASE_RETURN", { branchId: opts?.branchId }) },
    gl: documentGl,
    stock: createInventoryStockHook(stockService),
    workflow: documentWorkflowGate,
    events: returnsEventBridge,
    /*
     * WITHOUT THIS the document's confirm and cancel write nothing to the
     * audit trail. `DocumentService.recordAudit` is guarded on `deps.audit`,
     * so an omitted sink is silent: the document posts, the ledger moves, and
     * the act leaves no forensic record at all.
     *
     * Found because تقرير التعديلات بعد الترحيل was empty on a seeded tenant
     * that demonstrably cancels a confirmed purchase return — the report was
     * right and the trail it reads was never written.
     */
    audit: auditSink,
    auditModule: "purchases",
  });
  const landedCostDocuments = new DocumentService(createLandedCostDocumentType(LANDED_COST_GL_ACCOUNTS), {
    repo: landedCostStore,
    numbering: { next: (opts) => ledger.numbering.next("LANDED_COST", { branchId: opts?.branchId }) },
    gl: documentGl,
    workflow: documentWorkflowGate,
    /*
     * WITHOUT THIS the document's confirm and cancel write nothing to the
     * audit trail. `DocumentService.recordAudit` is guarded on `deps.audit`,
     * so an omitted sink is silent: the document posts, the ledger moves, and
     * the act leaves no forensic record at all.
     *
     * Found because تقرير التعديلات بعد الترحيل was empty on a seeded tenant
     * that demonstrably cancels a confirmed purchase return — the report was
     * right and the trail it reads was never written.
     */
    audit: auditSink,
    auditModule: "purchases",
  });
  const landedCosts = new LandedCostService(landedCostDocuments, stockService, {
    postUnabsorbed: async (posting) => {
      await postJournalEntry(
        {
          id: posting.entryId,
          date: posting.date,
          memo: posting.memo,
          source: "system",
          sourceDocType: LANDED_COST_DOC_TYPE,
          sourceDocId: posting.sourceDocId,
          sourceDocNumber: posting.sourceDocNumber,
          lines: [
            {
              accountId: LANDED_COST_GL_ACCOUNTS.unabsorbedCostAccountId,
              debit: posting.amount,
              credit: Money.zero(),
            },
            {
              accountId: LANDED_COST_GL_ACCOUNTS.inventoryAccountId,
              debit: Money.zero(),
              credit: posting.amount,
            },
          ],
        },
        salesInvoiceGl,
      );
    },
    reverseUnabsorbed: async (entryId, opts) => {
      const entry = await ledger.findById(entryId);
      if (!entry || entry.status !== "posted") return;
      await reverseJournalEntry(entryId, salesInvoiceGl, { reversalId: opts.reversalId, date: opts.date });
    },
  }, {
    layerOwnerOf: async (sourceDocId) => (await purchaseInvoices.findById(sourceDocId))?.receiptId ?? sourceDocId,
  });
  const installmentPlanDocuments = new DocumentService(installmentPlanDocumentType, {
    repo: installmentPlans,
    numbering: { next: (opts) => ledger.numbering.next("INSTALLMENT_PLAN", { branchId: opts?.branchId }) },
    workflow: documentWorkflowGate,
    /*
     * WITHOUT THIS the document's confirm and cancel write nothing to the
     * audit trail. `DocumentService.recordAudit` is guarded on `deps.audit`,
     * so an omitted sink is silent: the document posts, the ledger moves, and
     * the act leaves no forensic record at all.
     *
     * Found because تقرير التعديلات بعد الترحيل was empty on a seeded tenant
     * that demonstrably cancels a confirmed purchase return — the report was
     * right and the trail it reads was never written.
     */
    audit: auditSink,
    auditModule: "installments",
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
    workflow: documentWorkflowGate,
  });
  const stockTransfers = new DocumentService<StockTransferDocLine>(stockTransferDocumentType, {
    repo: inventoryOps.stockTransfers,
    numbering: { next: (opts) => ledger.numbering.next("STOCK_TRANSFER", { branchId: opts?.branchId }) },
    stock: inventoryOpsStockHook,
    workflow: documentWorkflowGate,
  });
  const physicalCounts = new PhysicalCountService({
    repo: inventoryOps.physicalCounts,
    stockLedger: stockService,
    adjustments: stockAdjustments,
    numbering: { next: () => ledger.numbering.next("PHYSICAL_COUNT") },
  });

  /**
   * مطابقة الأرصدة — Balance Reconciliation's sub-ledger side (docs/archive/catalog/04):
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
  /**
   * Every open receivable and payable, carrying the currency it was raised in
   * and the rate it was booked at — the input to `GET /gl/balances-by-currency`
   * (R1.16). The base figure comes from the same helpers the control-account
   * reconciliation uses, so the report's totals tie to GL 1105 / 2100 rather
   * than to a second arithmetic.
   */
  async function collectOpenPartyDocuments(): Promise<OpenPartyDocument[]> {
    const [invoices, purchInvoices, customerRows, supplierRows] = await Promise.all([
      salesInvoices.list(),
      purchaseInvoices.list(),
      customers.findAll(),
      suppliers.findAll(),
    ]);
    const customerName = new Map(customerRows.map((r) => [r.id, r.nameAr]));
    const supplierName = new Map(supplierRows.map((r) => [r.id, r.nameAr]));
    const base = ((await settings.get()) ?? createDefaultSettings()).currency;
    const out: OpenPartyDocument[] = [];

    // ONE sub-ledger lookup for every document in scope. This used to be an
    // awaited `findById` per row inside each loop, so the two reports walked
    // the whole document history one synchronous round trip at a time.
    const activeInvoices = invoices.filter((inv) => SALES_INVOICE_ACTIVE_STATUSES.has(inv.status));
    const confirmedPurchases = purchInvoices.filter((inv) => inv.status === "confirmed");
    const allocatedById = await vouchers.invoices.allocatedByIds([
      ...activeInvoices.map((inv) => inv.id),
      ...confirmedPurchases.map((inv) => inv.id),
    ]);

    for (const inv of activeInvoices) {
      const allocated = allocatedById.get(inv.id) ?? Money.zero();
      out.push({
        kind: "receivable",
        documentId: inv.id,
        documentNo: inv.docNo ?? inv.id,
        partyId: inv.customerId,
        partyName: customerName.get(inv.customerId) ?? inv.customerNameAr,
        date: inv.date,
        currency: inv.currency || base,
        fxRate: inv.fxRate ?? null,
        totalBase: salesInvoiceBaseGrandTotal(salesInvoiceTotals(inv), inv.fxRate),
        allocatedBase: allocated,
      });
    }

    for (const inv of confirmedPurchases) {
      const allocated = allocatedById.get(inv.id) ?? Money.zero();
      out.push({
        kind: "payable",
        documentId: inv.id,
        documentNo: inv.number,
        partyId: inv.supplierId,
        partyName: supplierName.get(inv.supplierId) ?? inv.supplierId,
        date: inv.date,
        currency: inv.currency || base,
        fxRate: inv.fxRate ?? null,
        totalBase: purchaseInvoiceBaseTotal(inv),
        allocatedBase: allocated,
      });
    }

    return out;
  }

  /**
   * الرصيد الافتتاحي للعميل/المورد — the master-data figure, posted (B-2).
   *
   * It used to be stored and nowhere else: never posted, counted in the
   * customer KPI and the browser statement, invisible to `/reconciliation` and
   * to the aging ladder. The historical-import path already posted the exact
   * same entry, so this routes the field through it.
   *
   * ONE live entry per party, keyed deterministically, so re-running the
   * backfill or re-saving the record posts nothing new. A CHANGED opening
   * balance is corrected the only legal way — the standing entry is reversed
   * and a fresh one posted — never by editing a posted entry.
   */
  const OPENING_BALANCE_EQUITY = "3210";

  interface PartyOpeningBalanceInput {
    readonly id: string;
    readonly code: string;
    readonly nameAr: string;
    readonly openingBalance: Money;
  }

  /**
   * The date an opening balance posts on: the first day of the earliest OPEN
   * fiscal period. A tenant enters opening balances at setup, and dating them
   * "today" would drop them into whatever month the operator happened to be
   * in — or into a closed one, where the posting is simply refused.
   */
  async function resolveOpeningBalanceDate(): Promise<string> {
    const open = (await fiscalPeriods.list())
      .filter((p) => p.status === "open")
      .sort((a, b) => a.startDate.localeCompare(b.startDate));
    return open[0]?.startDate ?? tenantTodayIso();
  }

  function openingEntryId(kind: "customer" | "supplier", partyId: string, generation: number): string {
    const base = kind === "customer" ? `OB-CUST-JE:${partyId}` : `OB-SUPP-JE:${partyId}`;
    return generation === 0 ? base : `${base}:v${generation}`;
  }

  /**
   * `"sync"` is the ONE poster the customers/suppliers screens and the manual
   * duplicate-repair action call: it corrects a changed balance by reversing
   * the standing entry and posting the new figure, never by editing (D241).
   *
   * `"backfill"` is the unattended start-up sweep. It only ever fills a gap —
   * if a deterministic entry already exists for this party it leaves it
   * exactly alone, posted or reversed, matching or not. Reversing an existing
   * entry with no human driving it and no permission gate in front of it
   * would silently erase the evidence the duplicate-openings report exists to
   * show; that repair is `"sync"`'s job, run explicitly and audited.
   */
  async function postPartyOpeningBalance(
    kind: "customer" | "supplier",
    party: PartyOpeningBalanceInput,
    mode: "sync" | "backfill" = "sync",
    dateOverride?: string,
  ): Promise<boolean> {
    let generation = 0;
    let live: Awaited<ReturnType<typeof ledger.findById>> = null;
    for (;;) {
      const found = await ledger.findById(openingEntryId(kind, party.id, generation));
      if (!found) break;
      live = found;
      generation += 1;
    }
    if (mode === "backfill" && live) return false;

    const openingBalanceDate = dateOverride ?? (await resolveOpeningBalanceDate());
    const routing = await accountRouting.get();
    const controlAccountId =
      kind === "customer"
        ? routedAccountId(routing, "control.receivable") ?? "1105"
        : routedAccountId(routing, "control.payable") ?? "2100";

    // The customers screen posts each change of an opening balance as its own
    // CUST-OPEN-JE entry. Those stand beside this one, so they count towards
    // what the control account already holds — ignoring them posted every
    // customer's opening balance a second time on the next start (D241).
    const docType = kind === "customer" ? CUSTOMER_OPENING_BALANCE_DOC_TYPE : SUPPLIER_OPENING_BALANCE_DOC_TYPE;
    const onControl = (entry: { lines: readonly { accountId: string; debit: Money; credit: Money }[] }) =>
      entry.lines.filter((l) => l.accountId === controlAccountId).reduce((acc, l) => acc.add(l.debit).add(l.credit.negate()), Money.zero());
    const postedElsewhere = (await ledger.list({ sourceDocId: party.id }))
      .filter((entry) => entry.sourceDocType === docType && entry.status !== "draft" && !entry.id.startsWith(openingEntryId(kind, party.id, 0)))
      .reduce((acc, entry) => acc.add(onControl(entry)), Money.zero());
    const wanted = kind === "customer" ? party.openingBalance : party.openingBalance.negate();
    const remainder = wanted.add(postedElsewhere.negate());

    // Tracks whether THIS call actually moved the ledger — not merely
    // whether a (possibly already-reversed, from an earlier call) entry
    // exists — so a repeat call reports honestly that nothing happened
    // (D241's repair action must be idempotent in what it REPORTS, not only
    // in what it posts).
    let reversed = false;
    if (live && live.status === "posted") {
      if (onControl(live).equals(remainder)) return false;
      await reverseJournalEntry(live.id, salesInvoiceGl, {
        reversalId: `${live.id}:REV`,
        date: openingBalanceDate,
        memo: `عكس الرصيد الافتتاحي ${party.code}`,
        // The line may predate the party dimension below (a pre-D241 entry
        // never carried one) — the reversal names the party regardless, so
        // the sub-ledger can follow it even when the entry it offsets could not.
        linePatch: (line) => (line.accountId === controlAccountId ? { ...line, partyId: party.id } : line),
      });
      reversed = true;
    }

    if (remainder.scaled === 0n) return reversed;

    const owed = kind === "customer" ? remainder : remainder.negate();
    const magnitude = owed.scaled < 0n ? owed.negate() : owed;
    // A customer owes us (Dr AR / Cr 3210); a supplier is owed (Cr AP / Dr
    // 3210). A negative opening balance is the same fact the other way round.
    const controlIsDebit = (kind === "customer") !== (owed.scaled < 0n);
    await postJournalEntry(
      {
        id: openingEntryId(kind, party.id, generation),
        date: openingBalanceDate,
        memo: `رصيد افتتاحي ${kind === "customer" ? "عميل" : "مورد"} ${party.code} — ${party.nameAr}`,
        source: "system",
        sourceDocType: kind === "customer" ? CUSTOMER_OPENING_BALANCE_DOC_TYPE : SUPPLIER_OPENING_BALANCE_DOC_TYPE,
        sourceDocId: party.id,
        sourceDocNumber: party.code,
        // No `partyId` on this line, deliberately: `partyOpenItems` (D204/D205)
        // reads an opening balance by `sourceDocType`/its deterministic id, and
        // a control-account line that names a party is read as a MANUAL
        // journal fact instead — tagging it here double-counted the balance
        // (the manual-journal reading, plus the party-record fallback that
        // still fires because nothing landed in the opening-balance bucket).
        // The reversal that repairs a duplicate (D241) tags its own line
        // instead, which nets against this one's bucket correctly.
        lines: controlIsDebit
          ? [
              { accountId: controlAccountId, debit: magnitude, credit: Money.zero() },
              { accountId: OPENING_BALANCE_EQUITY, debit: Money.zero(), credit: magnitude },
            ]
          : [
              { accountId: OPENING_BALANCE_EQUITY, debit: magnitude, credit: Money.zero() },
              { accountId: controlAccountId, debit: Money.zero(), credit: magnitude },
            ],
      },
      salesInvoiceGl,
    );
    return true;
  }

  const customerOpeningBalances = {
    post: (party: PartyOpeningBalanceInput, date?: string) => postPartyOpeningBalance("customer", party, "sync", date).then(() => undefined),
  };
  const supplierOpeningBalances = {
    post: (party: PartyOpeningBalanceInput, date?: string) => postPartyOpeningBalance("supplier", party, "sync", date).then(() => undefined),
  };

  /**
   * The duplicate-openings repair action (D241): re-runs the same `"sync"`
   * poster a screen edit would, against the party's OWN current
   * `openingBalance` — nothing about the wanted figure changes, so the only
   * thing that can happen is the standing entry getting reversed down to it.
   * Idempotent by construction: a party with nothing left to reverse (already
   * repaired, or never duplicated) reports no movement.
   */
  async function repairOpeningBalanceDuplicate(kind: "customer" | "supplier", partyId: string): Promise<boolean | null> {
    const party = kind === "customer" ? await customers.findById(partyId) : await suppliers.findById(partyId);
    if (!party) return null;
    return postPartyOpeningBalance(kind, party, "sync");
  }

  /**
   * Every line the duplicate-openings report (D241) needs, across BOTH
   * control accounts — one query, read once per report run rather than once
   * per party.
   */
  async function resolveOpeningBalanceDuplicatesContext(): Promise<OpeningBalanceDuplicatesContext> {
    const routing = await accountRouting.get();
    const arControl = routedAccountId(routing, "control.receivable") ?? "1105";
    const apControl = routedAccountId(routing, "control.payable") ?? "2100";
    const [customerRows, supplierRows, rawEntries] = await Promise.all([
      customers.findAll(),
      suppliers.findAll(),
      ledger.list({ sourceDocTypes: [CUSTOMER_OPENING_BALANCE_DOC_TYPE, SUPPLIER_OPENING_BALANCE_DOC_TYPE] }),
    ]);
    const entries: OpeningBalanceEntryRef[] = rawEntries.map((entry) => {
      const controlId = entry.sourceDocType === CUSTOMER_OPENING_BALANCE_DOC_TYPE ? arControl : apControl;
      const controlMovement = entry.lines
        .filter((l) => l.accountId === controlId)
        .reduce((acc, l) => acc.add(l.debit).add(l.credit.negate()), Money.zero());
      return {
        id: entry.id,
        entryNo: entry.entryNo ?? null,
        date: entry.date,
        status: entry.status,
        sourceDocType: entry.sourceDocType ?? null,
        sourceDocId: entry.sourceDocId ?? null,
        controlMovement,
      };
    });
    return {
      customers: customerRows.map((c) => ({ id: c.id, code: c.code, nameAr: c.nameAr, openingBalance: c.openingBalance })),
      suppliers: supplierRows.map((s) => ({ id: s.id, code: s.code, nameAr: s.nameAr, openingBalance: s.openingBalance })),
      entries,
    };
  }

  /** The accounts a hand-written line must name its customer or supplier on (D205). */
  async function resolvePartyControlAccounts(): Promise<ReadonlyMap<string, "customer" | "supplier">> {
    const routing = await accountRouting.get();
    return new Map<string, "customer" | "supplier">([
      [routedAccountId(routing, "control.receivable") ?? "1105", "customer"],
      [routedAccountId(routing, "control.payable") ?? "2100", "supplier"],
    ]);
  }

  async function inventoryValueAsOf(asOfDate: string): Promise<bigint> {
    const { listAll } = stockLedger.ledger;
    const movements = listAll
      ? await listAll.call(stockLedger.ledger)
      : (await Promise.all((await stockLedger.ledger.listPositions()).map((p) => stockLedger.ledger.listByPosition(p.itemId, p.warehouseId)))).flat();
    const byPosition = new Map<string, StockMovement[]>();
    for (const movement of movements) {
      if (movement.occurredAt.slice(0, 10) > asOfDate) continue;
      const key = JSON.stringify([movement.itemId, movement.warehouseId]);
      const list = byPosition.get(key);
      if (list) list.push(movement);
      else byPosition.set(key, [movement]);
    }
    let value = 0n;
    for (const list of byPosition.values()) {
      const first = list[0];
      if (first) value += replay(first.itemId, first.warehouseId, list).totalValue.scaled;
    }
    return value;
  }

  async function resolveReconciliationControls(asOfDate?: string) {
    const upTo = (date: string | null | undefined): boolean => asOfDate === undefined || (date ?? "").slice(0, 10) <= asOfDate;
    const standingCertificate = (certificate: { status: string; approvedAt: string | null; executionDate: string; voidedAt: string | null }): boolean =>
      upTo(certificate.approvedAt ?? certificate.executionDate) && (certificate.status !== "voided" || !upTo(certificate.voidedAt));
    type ChainLink = { id: string; status: DocumentStatus; date: string; reversesDocId: string | null; reversedByDocId: string | null };
    const linksById = <T extends ChainLink>(docs: readonly T[]): ReadonlyMap<string, T> => new Map(docs.map((d) => [d.id, d]));
    // A reversal is never counted on its own: its effect is read through the document it reverses, link by link down the chain.
    const frameworkPresence = (doc: ChainLink, docs: ReadonlyMap<string, ChainLink>): bigint => {
      if (doc.reversesDocId) return 0n;
      const dates = [doc.date];
      const seen = new Set([doc.id]);
      let link = doc;
      while (link.status === "reversed" && link.reversedByDocId) {
        const next = docs.get(link.reversedByDocId);
        if (!next || seen.has(next.id)) break;
        seen.add(next.id);
        dates.push(next.date);
        link = next;
      }
      if (!isActive(link.status)) return 0n;
      return BigInt(reversalChainPresenceAsOf(dates, asOfDate));
    };
    const entryDatesOf = async (ids: readonly (string | null)[]): Promise<ReadonlyMap<string, string>> => {
      const wanted = ids.filter((id): id is string => id !== null);
      if (asOfDate === undefined || wanted.length === 0) return new Map();
      if (ledger.entryDates) return ledger.entryDates(wanted);
      const found = await Promise.all(wanted.map(async (id) => [id, (await ledger.findById(id))?.date ?? null] as const));
      return new Map(found.filter((pair): pair is readonly [string, string] => pair[1] !== null));
    };
    const invoicePresence = (date: string, live: boolean, endedOn: string | null): bigint => BigInt(ledgerPresenceAsOf({ date, live, endedOn }, asOfDate));
    // The tenant's own control accounts (B-8). Comparing a recoded chart
    // against a compiled-in "1105"/"2100"/"1200" reported a mismatch equal to
    // every collection ever made.
    const routing = await accountRouting.get();
    const AR_CONTROL = routedAccountId(routing, "control.receivable") ?? "1105";
    const AP_CONTROL = routedAccountId(routing, "control.payable") ?? "2100";
    const INVENTORY_CONTROL = routedAccountId(routing, "control.inventory") ?? "1200";

    const [invoices, purchInvoices, snapshots, salesReturnDocs, purchaseReturnDocs, landedCostDocs, purchaseArchives, salesArchives, customerRows, supplierRows] = await Promise.all([
      salesInvoices.list(),
      purchaseInvoices.list(),
      stockLedger.snapshots.list(),
      salesReturns.list(),
      purchaseReturns.list(),
      landedCostDocuments.list(),
      historicalImportArchives.list(),
      salesHistoricalImportArchives.list(),
      customers.findAll(),
      suppliers.findAll(),
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
    const allVouchers = await vouchers.documents.list();
    const voucherDates = linksById(allVouchers);
    for (const doc of allVouchers) {
      const presence = frameworkPresence(doc, voucherDates);
      if (presence === 0n) continue;
      const line = doc.lines[0];
      if (!line || line.direction === "transfer") continue;
      const credited = line.direction === "receipt";
      // BASE, as the voucher posted it: a foreign voucher's own `amount` is in
      // its currency (D194's twin).
      const amount = presence * voucherBaseAmount(line).scaled;
      if (line.counterpartyGlAccountId === AR_CONTROL) {
        voucherEffect.receivable += credited ? -amount : amount;
      }
      if (line.counterpartyGlAccountId === AP_CONTROL) {
        voucherEffect.payable += credited ? amount : -amount;
      }
    }

    /**
     * A cheque reclassifies a receivable/payable the moment it is written: an
     * incoming cheque credits AR into cheques-under-collection, an outgoing one
     * debits AP into cheques-payable. Both move the control account, so the
     * sub-ledger has to follow them or it reads permanently high. A bounce in
     * either direction reverses that posting onto the counterparty (D192), and
     * a replaced cheque was bounced first — its replacement is a cheque of its
     * own and carries the new credit.
     */
    const chequeEffect = { receivable: 0n, payable: 0n };
    const allCheques = await cheques.list();
    // Each side of a cheque is read on the day its own journal entry is dated: `bouncedAt` is the instant the bounce was recorded, and a replacement's entry is not dated on the day written on the cheque.
    const chequeEntryDates = await entryDatesOf(allCheques.flatMap((cheque) => [cheque.creationJournalEntryId, cheque.bounceJournalEntryId]));
    for (const cheque of allCheques) {
      const { raised, undone } = chequeLedgerDays(cheque, (entryId) => chequeEntryDates.get(entryId));
      if (!upTo(raised)) continue;
      const restored = undone !== null && upTo(undone);
      const net = restored ? 0n : -cheque.amount.scaled;
      if (cheque.counterpartyGlAccountId === AR_CONTROL) chequeEffect.receivable += net;
      if (cheque.counterpartyGlAccountId === AP_CONTROL) chequeEffect.payable += net;
    }

    const undoneEntryDates = await entryDatesOf([
      ...invoices.filter((inv) => inv.status === "reversed").map((inv) => salesInvoiceVoidEntryId(inv.id)),
      ...purchInvoices.filter((inv) => inv.status === "cancelled").map((inv) => purchaseInvoiceCancelEntryId(inv.id)),
    ]);
    let arScaled = 0n;
    for (const inv of invoices) {
      const live = SALES_INVOICE_ACTIVE_STATUSES.has(inv.status);
      const presence = invoicePresence(inv.date, live, undoneEntryDates.get(salesInvoiceVoidEntryId(inv.id)) ?? null);
      if (presence === 0n) continue;
      const totals = salesInvoiceTotals(inv);
      // The BASE-currency figure, which is what the control account holds — a
      // USD invoice's own total is not an EGP amount (D24).
      arScaled += presence * salesInvoiceBaseGrandTotal(totals, inv.fxRate).scaled;
    }
    for (const archive of salesArchives) {
      if (archive.settled || !upTo(archive.date)) continue;
      arScaled += archive.docType === "SALES_RETURN"
        ? -archive.remainingBalance.scaled
        : archive.remainingBalance.scaled;
    }
    // Opening balances are posted to the control account now (B-2), so the
    // sub-ledger side has to carry them or the two part company by exactly
    // Σ opening balances — the same gap, mirrored.
    if (asOfDate === undefined) for (const customer of customerRows) arScaled += customer.openingBalance.scaled;
    arScaled += voucherEffect.receivable;
    arScaled += chequeEffect.receivable;
    // A confirmed sales return credits AR in the GL. Omitting it here left the
    // control account moving while the sub-ledger stood still, so every tenant
    // that ever posted a return saw a false mismatch.
    const salesReturnDates = linksById(salesReturnDocs);
    for (const doc of salesReturnDocs) {
      arScaled -= frameworkPresence(doc, salesReturnDates) * salesReturnGrandTotal(doc).scaled;
    }
    /**
     * An approved مستخلص credits AR by its deductions block — retention, the
     * advance recovered, WHT, social insurance and the rest — against the
     * invoice it generated. The control account moves; the sub-ledger has to
     * follow it, or every tenant that ever approved a certificate reads a
     * false mismatch for the whole deduction.
     */
    for (const certificate of await progressCertificates.list()) {
      // A VOIDED certificate has had its deductions entry mirrored, so the
      // control account is back where it was and the sub-ledger must not
      // subtract them a second time.
      if (!standingCertificate(certificate)) continue;
      arScaled -= certificate.postedDeductionsTotal.scaled;
    }

    let apScaled = 0n;
    for (const inv of purchInvoices) {
      const presence = invoicePresence(inv.date, inv.status === "confirmed", undoneEntryDates.get(purchaseInvoiceCancelEntryId(inv.id)) ?? null);
      // The BASE-currency figure, which is what the control account holds.
      if (presence !== 0n) apScaled += presence * purchaseInvoiceBaseTotal(inv).scaled;
    }
    for (const archive of purchaseArchives) {
      if (archive.settled || !upTo(archive.date)) continue;
      apScaled += archive.docType === "PURCHASE_RETURN"
        ? -archive.remainingBalance.scaled
        : archive.remainingBalance.scaled;
    }
    if (asOfDate === undefined) for (const supplier of supplierRows) apScaled += supplier.openingBalance.scaled;
    apScaled += voucherEffect.payable;
    apScaled += chequeEffect.payable;
    // A purchase return debits AP; a landed cost credits it (the freight and
    // customs owed to a third party accrue to the same control account).
    const purchaseReturnDates = linksById(purchaseReturnDocs);
    for (const doc of purchaseReturnDocs) {
      apScaled -= frameworkPresence(doc, purchaseReturnDates) * purchaseReturnGrandTotal(doc).scaled;
    }
    /**
     * An approved مستخلص باطن DEBITS AP by its deductions block — the retention
     * withheld from the subcontractor, the advance recovered, the WHT owed to
     * the ETA and the rest — against the purchase invoice it generated. The
     * control account moves; the sub-ledger has to follow it or every tenant
     * that ever approved a sub certificate reads a false mismatch for the whole
     * deduction.
     *
     * A retention RELEASE is NOT added here: it is itself a purchase invoice
     * (Dr 2195 / Cr AP), already counted with every other confirmed one above.
     */
    for (const certificate of await subcontracts.listCertificates()) {
      if (!upTo(certificate.approvedAt ?? certificate.executionDate)) continue;
      apScaled -= certificate.postedDeductionsTotal.scaled;
    }
    // Landed costs are deliberately NOT added here any more. They used to be,
    // to compensate for the document crediting GL 2100 — so the invariant
    // "tied" only because the sub-ledger figure was inflated to match a GL
    // entry that never belonged in AP (D75). The accrual now goes to 2130, and
    // this figure is again what it claims to be: what real supplier documents
    // say is owed.

    /**
     * FX revaluation restates 1105/2100 without touching a document, so the
     * sub-ledger — every document at the rate it was booked at — carries the
     * unreversed restatement as its one non-document term (D194).
     */
    const partyControlLines = (await ledger.listLines?.({ accountIds: [AR_CONTROL, AP_CONTROL], toDate: asOfDate })) ?? [];
    arScaled += fxRevaluationNet(partyControlLines, AR_CONTROL).scaled;
    apScaled -= fxRevaluationNet(partyControlLines, AP_CONTROL).scaled;
    // A manual journal line names its party (D205) and no document records it.
    // An opening-balance line can ALSO name a party now (D241's reversal, so
    // its own D205 lookup works even for a legacy entry that never carried
    // one) but that movement is already in `customerRows`/`supplierRows`
    // above — counting it again here is exactly the double-post D241 was.
    for (const line of partyControlLines) {
      const openingBalance = line.sourceDocType === CUSTOMER_OPENING_BALANCE_DOC_TYPE || line.sourceDocType === SUPPLIER_OPENING_BALANCE_DOC_TYPE;
      if (openingBalance ? asOfDate === undefined : !line.partyId) continue;
      const net = line.debit.scaled - line.credit.scaled;
      if (line.accountId === AR_CONTROL) arScaled += net;
      if (line.accountId === AP_CONTROL) apScaled -= net;
    }

    let inventoryScaled = 0n;
    if (asOfDate === undefined) {
      for (const snap of snapshots) inventoryScaled += snap.totalValue.scaled;
    } else {
      inventoryScaled = await inventoryValueAsOf(asOfDate);
    }

    /**
     * المقاولات — six more control accounts, each read from the MODULE's own
     * store the same way the poster moved the ledger. Without these rows the
     * whole contracting module stood outside the one instrument that proves a
     * sub-ledger and its control account still agree, which is the only reason
     * the certificate, the subcontract and the site store can be trusted.
     */
    const [certificates, subContracts, subCerts, releases, consumptions, equipmentLogs, runs] =
      await Promise.all([
        progressCertificates.list(),
        subcontracts.list(),
        subcontracts.listCertificates(),
        retentionReleases.list(),
        contractingSiteStore.consumptions.list({ status: "confirmed" }),
        contractingSiteStore.equipmentLogs.list({ status: "confirmed" }),
        recognitionRuns.list(),
      ]);
    const account = (key: string, fallback: string): string => routedAccountId(routing, key) ?? fallback;

    /** Only a certificate whose deductions entry is actually on the ledger, and was not reversed. */
    const postedCertificates = certificates.filter((c) => c.journalEntryId !== null && standingCertificate(c));
    // A subcontractor certificate is read on the day its own entry is dated; `approvedAt` is the instant the approval was recorded. A posted one is never cancelled, and a recognition run's reversal is dated the run's own period end, so each stands or is gone on one day at every reading.
    const subCertificateEntryDates = await entryDatesOf(subCerts.map((c) => c.journalEntryId));
    const postedSubCertificates = subCerts.filter(
      (c) => c.journalEntryId !== null && upTo(subCertificateEntryDates.get(c.journalEntryId) ?? c.approvedAt ?? c.executionDate),
    );
    const postedRuns = runs.filter((r) => r.status === "posted" && upTo(r.periodEnd));
    const deduction = (
      rows: readonly { key: string; thisCertificate: Money }[],
      key: string,
    ): bigint => rows.find((d) => d.key === key)?.thisCertificate.scaled ?? 0n;

    let retentionReceivableScaled = 0n;
    for (const c of postedCertificates) retentionReceivableScaled += deduction(c.computed.deductions, "retention");
    for (const r of releases) {
      if (r.status === "released" && upTo(r.date)) retentionReceivableScaled -= r.amount.scaled;
    }

    let retentionPayableScaled = 0n;
    for (const c of postedSubCertificates) retentionPayableScaled += deduction(c.computed.deductions, "retention");
    for (const sub of subContracts) {
      for (const release of sub.retentionReleases) if (upTo(release.date)) retentionPayableScaled -= release.amount.scaled;
    }

    /**
     * دفعات مقدمة من العملاء: the advance voucher credits it, every certificate
     * that recovers part of the advance debits it. The advance is received once
     * and recovered many times, so both halves have to be read.
     */
    const advanceAccountId = account("contracting.customer_advances", "2160");
    let customerAdvancesScaled = 0n;
    for (const doc of allVouchers) {
      const presence = frameworkPresence(doc, voucherDates);
      const line = doc.lines[0];
      if (presence === 0n || !line || line.counterpartyGlAccountId !== advanceAccountId) continue;
      const amount = presence * voucherBaseAmount(line).scaled;
      customerAdvancesScaled += line.direction === "receipt" ? amount : -amount;
    }
    for (const c of postedCertificates) {
      customerAdvancesScaled -= deduction(c.computed.deductions, "advanceRecovery");
    }

    /**
     * أعمال تحت التنفيذ: what the site store consumed into it, what the plant
     * logs charged to it, and what the subcontractors' certified work put into
     * it — less what the monthly recognition run has already relieved.
     */
    let wipScaled = 0n;
    for (const row of consumptions) if (upTo(row.date)) wipScaled += row.totalCost.scaled;
    for (const log of equipmentLogs) if (upTo(log.date)) wipScaled += log.amount.scaled;
    for (const c of postedSubCertificates) wipScaled += c.computed.invoiceBase.scaled;
    for (const run of postedRuns) wipScaled -= run.wipRelieved.scaled;

    /**
     * فواتير مستخلصات على العقود: what the certificates of cost-to-cost
     * contracts billed, less what each run has reclassified out of 2165.
     */
    const billingsAccountId = account("contracting.billings", "2165");
    let billingsScaled = 0n;
    for (const inv of invoices) {
      if (!inv.lines.some((line) => line.revenueAccountId === billingsAccountId)) continue;
      const presence = await invoicePresence(inv.date, SALES_INVOICE_ACTIVE_STATUSES.has(inv.status), inv.status === "reversed" ? salesInvoiceVoidEntryId(inv.id) : null);
      if (presence === 0n) continue;
      const lineTotals = salesInvoiceTotals(inv).lines;
      inv.lines.forEach((line, index) => {
        if (line.revenueAccountId !== billingsAccountId) return;
        const stated = lineTotals[index]?.taxableBase;
        if (stated) billingsScaled += presence * (inv.fxRate ? convertToBase(stated, inv.fxRate) : stated).scaled;
      });
    }
    for (const run of postedRuns) billingsScaled -= run.billedInPeriod.scaled;

    /** أصل/التزام العقد: the latest posted run per contract IS the position. */
    const latestRunByContract = new Map<string, (typeof postedRuns)[number]>();
    for (const run of postedRuns) {
      const seen = latestRunByContract.get(run.contractId);
      if (!seen || run.periodEnd > seen.periodEnd) latestRunByContract.set(run.contractId, run);
    }
    let contractAssetScaled = 0n;
    let contractLiabilityScaled = 0n;
    for (const run of latestRunByContract.values()) {
      contractAssetScaled += run.contractAsset.scaled;
      contractLiabilityScaled += run.contractLiability.scaled;
    }

    return [
      { key: "inventory", label: "تقييم المخزون مقابل دفتر الأستاذ", controlAccountId: INVENTORY_CONTROL, naturalBalance: "debit" as const, subLedgerBalance: Money.fromScaled(inventoryScaled) },
      { key: "ar", label: "ذمم العملاء مقابل دفتر الأستاذ", controlAccountId: AR_CONTROL, naturalBalance: "debit" as const, subLedgerBalance: Money.fromScaled(arScaled) },
      { key: "ap", label: "ذمم الموردين مقابل دفتر الأستاذ", controlAccountId: AP_CONTROL, naturalBalance: "credit" as const, subLedgerBalance: Money.fromScaled(apScaled) },
      { key: "contracting_retention_receivable", label: "محتجزات لدى العملاء مقابل دفتر الأستاذ", controlAccountId: account("contracting.retention_receivable", "1150"), naturalBalance: "debit" as const, subLedgerBalance: Money.fromScaled(retentionReceivableScaled) },
      { key: "contracting_retention_payable", label: "محتجزات مقاولي الباطن مقابل دفتر الأستاذ", controlAccountId: account("contracting.retention_payable", "2195"), naturalBalance: "credit" as const, subLedgerBalance: Money.fromScaled(retentionPayableScaled) },
      { key: "contracting_customer_advances", label: "دفعات مقدمة من العملاء مقابل دفتر الأستاذ", controlAccountId: advanceAccountId, naturalBalance: "credit" as const, subLedgerBalance: Money.fromScaled(customerAdvancesScaled) },
      { key: "contracting_wip", label: "أعمال تحت التنفيذ مقابل دفتر الأستاذ", controlAccountId: account("contracting.wip", "1230"), naturalBalance: "debit" as const, subLedgerBalance: Money.fromScaled(wipScaled) },
      { key: "contracting_billings", label: "فواتير مستخلصات على العقود مقابل دفتر الأستاذ", controlAccountId: billingsAccountId, naturalBalance: "credit" as const, subLedgerBalance: Money.fromScaled(billingsScaled) },
      { key: "contracting_contract_asset", label: "أصل العقد مقابل دفتر الأستاذ", controlAccountId: account("contracting.contract_asset", "1170"), naturalBalance: "debit" as const, subLedgerBalance: Money.fromScaled(contractAssetScaled) },
      { key: "contracting_contract_liability", label: "التزام العقد مقابل دفتر الأستاذ", controlAccountId: account("contracting.contract_liability", "2175"), naturalBalance: "credit" as const, subLedgerBalance: Money.fromScaled(contractLiabilityScaled) },
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
  await seedIfEmpty(seedStores, undefined, { adminPin: options.seedAdminPin });

  /**
   * Books seeded before a template account existed get it now (D229: the
   * exchange-difference accounts). Idempotent; it adds, and never renames or
   * repurposes an account — posted history stays where it was posted.
   */
  {
    const { added, skipped } = await addMissingStandardAccounts(accounts);
    if (added.length > 0) console.info(`[chart-of-accounts] added standard account(s) ${added.join(", ")}`);
    if (skipped.length > 0) {
      console.warn(`[chart-of-accounts] ${skipped.join(", ")} already used by another account; map the fx.* slots in account routing`);
    }
  }

  /**
   * One-off backfill for tenants migrated before B-2: every customer/supplier
   * carrying a non-zero opening balance that was never posted gets its entry
   * now. It is idempotent (the deterministic entry id is already there on a
   * second run) and logged, because a tenant's trial balance moves the first
   * time it runs and the operator must be able to see why.
   */
  {
    let posted = 0;
    try {
      for (const customer of await customers.findAll()) {
        if (customer.openingBalance.scaled !== 0n && (await postPartyOpeningBalance("customer", customer, "backfill"))) posted += 1;
      }
      for (const supplier of await suppliers.findAll()) {
        if (supplier.openingBalance.scaled !== 0n && (await postPartyOpeningBalance("supplier", supplier, "backfill"))) posted += 1;
      }
      if (posted > 0) {
        console.info(`[opening-balances] posted ${posted} previously-unposted party opening balance(s) to the ledger`);
      }
    } catch (error) {
      // A refused posting (no fiscal period yet, a closed one) must not stop
      // the server: the same backfill runs again on the next start.
      console.error("[opening-balances] backfill could not complete", error);
    }
  }

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
    projects,
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
    projects,
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

  /**
   * Sessions live here, and the resolver below is what every gated route on
   * this app reads its caller from. Before this the routes fell back to the
   * header resolver, so a request declared its own permissions.
   */
  const sessions = createSessionRegistry();
  const resolveAuthContext = createSessionAuthContextResolver(sessions);
  /**
   * ONE throttle for the whole backend. `/auth/login` counts against it and
   * `POST /users/:id/unlock` clears it, and those only agree if it is the same
   * object: a per-router throttle would let an admin "unlock" an account that
   * stays locked at the login route.
   */
  const loginThrottle = createLoginThrottle();

  /**
   * Refused requests, recorded.
   *
   * `createPermissionGate` answered 403 and wrote nothing, so "who was refused
   * which screen fifty times last night" was not a question this product could
   * answer at all — and a refusal is a free oracle over the org's authority
   * map, which makes the probing worth seeing. Rate-limited per
   * (actor, permission) so a screen that polls a route the user cannot reach
   * writes one row a minute rather than one row a second.
   */
  const refusalSeenAt = new Map<string, number>();
  const onPermissionRefused = (refusal: PermissionRefusal) => {
    if (!refusal.authenticated) return; // an expired session is a 401 story, not a probe
    const key = `${refusal.userId}|${refusal.permission}`;
    const now = Date.now();
    const last = refusalSeenAt.get(key) ?? 0;
    if (now - last < 60_000) return;
    refusalSeenAt.set(key, now);
    if (refusalSeenAt.size > 5_000) refusalSeenAt.clear();
    void recordSecurityEvent(auditSink, {
      module: "admin",
      entityType: "PERMISSION",
      entityId: refusal.permission,
      action: "PERMISSION_DENIED",
      actor: refusal.userId,
      severity: "WARNING",
      details: { permission: refusal.permission, method: refusal.method, path: refusal.path },
    }).catch(() => undefined);
  };

  /**
   * D196 — the cheque behind a «شيك» voucher, registered when the voucher
   * posts. The voucher already credited the party (Dr treasury / Cr 1105, or
   * Dr 2100 / Cr treasury), so the cheque must NOT credit it again: its
   * creation posting only moves the amount from the voucher's treasury leg
   * into the cheque control account (Dr 1320 / Cr treasury, or Dr treasury /
   * Cr 2150), and the cheque's counterparty is that treasury account. The
   * sub-ledgers count only cheques whose counterparty is a party control
   * account, so this cheque is never netted twice. It shares the voucher's id,
   * so the voucher's allocations are the cheque's allocations. A bounce
   * reverses that reclassification and then the voucher itself, which puts
   * the debt back on the party (D192); a replacement credits the party's own
   * control account.
   */
  /** Exchange differences post to their own accounts, routed so a tenant can remap them — never 4900/5900, the till's over and short (D229). */
  async function fxDifferenceAccounts(kind: "realised" | "unrealised"): Promise<FxDifferenceAccounts> {
    const routing = await accountRouting.get();
    return kind === "realised"
      ? {
          gainAccountId: routedAccountId(routing, "fx.realised_gain") ?? "4920",
          lossAccountId: routedAccountId(routing, "fx.realised_loss") ?? "5920",
        }
      : {
          gainAccountId: routedAccountId(routing, "fx.unrealised_gain") ?? "4940",
          lossAccountId: routedAccountId(routing, "fx.unrealised_loss") ?? "5940",
        };
  }
  async function otherIncomeExpenseAccountIds(): Promise<readonly string[]> {
    const [realised, unrealised] = await Promise.all([fxDifferenceAccounts("realised"), fxDifferenceAccounts("unrealised")]);
    return [realised.gainAccountId, realised.lossAccountId, unrealised.gainAccountId, unrealised.lossAccountId];
  }
  /** The rates a settlement of a foreign invoice is measured with, and where the realised difference goes (D221, D229). */
  const realisedFx: RealisedFxPort = {
    async invoiceFx(invoiceId, kind) {
      if (kind === "sales") {
        const invoice = await salesInvoices.findById(invoiceId);
        return invoice?.fxRate && invoice.currency ? { currency: invoice.currency, fxRate: invoice.fxRate } : null;
      }
      const invoice = await purchaseInvoices.findById(invoiceId);
      return invoice?.fxRate && invoice.currency ? { currency: invoice.currency, fxRate: invoice.fxRate } : null;
    },
    async rateOn(currency, date) {
      return (await exchangeRates.findRate(currency, date))?.rate ?? null;
    },
    differenceAccounts: () => fxDifferenceAccounts("realised"),
  };
  const settlementPreviewer = new VoucherService({
    documents: vouchers.documents,
    ledger,
    accounts,
    periods: fiscalPeriods,
    numbering: ledger.numbering,
    treasuryAccounts,
    allocations: vouchers.allocations,
    invoices: vouchers.invoices,
    realisedFx,
    returns: invoiceReturnCredits,
  });
  /** An invoice collect or pay route's cap for base money dated `date` (D221); a missing rate is refused in that module's own terms. */
  const previewSettlement =
    (refuse: (message: string) => Error) =>
    async (invoiceId: string, amount: Money, date: string) => {
      try {
        const split = await settlementPreviewer.settlementPreview(invoiceId, { amount, currency: "EGP", fxRate: null, date });
        return { relief: split.relief, capacity: split.capacity };
      } catch (err) {
        if (err instanceof SettlementRateMissingError) throw refuse(err.message);
        throw err;
      }
    };
  const voucherChequeControls = {
    incoming: { underCollectionAccountId: "1320", bouncedAccountId: "1360" },
    outgoing: { underCollectionAccountId: "2150", bouncedAccountId: null },
  } as const;
  const raisingVoucherOf = async (cheque: { readonly id: string; readonly counterpartyGlAccountId: string }) => {
    const doc = await vouchers.documents.findById(cheque.id);
    if (!doc || doc.reversesDocId) return null;
    const line = voucherLine(doc);
    return line.paymentMethod === "cheque" && line.treasuryGlAccountId === cheque.counterpartyGlAccountId ? doc : null;
  };
  const chequeRaisedByVoucher: ChequeRaisingDocumentPort = {
    async onBounced(cheque, { date, actor }) {
      const doc = await raisingVoucherOf(cheque);
      if (!doc || doc.status !== "confirmed") return;
      await new VoucherService({
        documents: vouchers.documents,
        ledger,
        accounts,
        periods: fiscalPeriods,
        numbering: ledger.numbering,
        projects,
        treasuryAccounts,
        allocations: vouchers.allocations,
        invoices: vouchers.invoices,
        settings,
        settlement: invoiceSettlement,
        audit: auditSink,
        events: voucherEventBridge,
        actor,
      }).reverseVoucher(doc.id, {
        reversalId: `${doc.id}:BOUNCED`,
        date,
        memo: `عكس السند لارتداد الشيك رقم ${cheque.chequeNumber}`,
      });
    },
    async partyControlAccountOf(cheque) {
      const doc = await raisingVoucherOf(cheque);
      return doc ? voucherLine(doc).counterpartyGlAccountId : null;
    },
    async partyLineOf(cheque) {
      const doc = await raisingVoucherOf(cheque);
      if (!doc) return null;
      const line = voucherLine(doc);
      return { currency: line.currency, fxRate: line.fxRate ?? null };
    },
  };
  const voucherChequeRegister = new ChequeService({
    cheques,
    gl: salesInvoiceGl,
    allocation: { allocations: vouchers.allocations, invoices: vouchers.invoices, settlement: invoiceSettlement, returns: invoiceReturnCredits },
    raisedBy: chequeRaisedByVoucher,
    realisedFx,
  });
  const voucherCheques: VoucherChequeRegistrationPort = {
    async register(input) {
      // Cheque.partyId is required, and a cheque nobody owes is not one the
      // register can chase; «إيراد آخر» by cheque posts as before.
      if (!input.partyId) return null;
      const cheque = await voucherChequeRegister.createCheque({
        id: input.voucherId,
        direction: input.direction,
        chequeNumber: input.chequeNumber ?? input.voucherNo ?? input.voucherId,
        // The voucher form does not capture the drawee bank or a due date yet;
        // the register shows the gap rather than inventing either.
        bankName: "غير مسجّل",
        amount: input.amount,
        currency: input.currency,
        issueDate: input.issueDate,
        dueDate: input.issueDate,
        branchId: input.branchId,
        notes: input.memo,
        partyId: input.partyId,
        counterpartyGlAccountId: input.treasuryGlAccountId,
        controlAccounts: voucherChequeControls[input.direction],
        journalEntryId: `CHQ-JE:${input.voucherId}`,
        actor: input.actor,
      });
      return { chequeId: cheque.id };
    },
    async blocksReversal(voucherId) {
      const cheque = await cheques.findById(voucherId);
      return cheque !== null && cheque.status !== "bounced" && cheque.status !== "replaced";
    },
  };

  /**
   * تحصيل من عميل — creates and CONFIRMS a real collection voucher and
   * allocates it to the invoice, so the money lands in a treasury account, AR
   * is credited in the ledger, and the invoice's amountPaid follows from the
   * allocation. It used to increment amountPaid and post nothing (D1). Shared
   * by the sales invoice screen and the instalment collection route.
   */
  const baseTreasuryOnlyAr = (currency: string) =>
    `حساب الخزينة بعملة ${currency}، والتحصيل والسداد من الفاتورة بالعملة الأساسية؛ اختر حساب خزينة بالعملة الأساسية أو سجّل سنداً بعملة الحساب.`;
  const collectFromCustomer: InstallmentCollectPort = async (input) => {
    const treasury = await treasuryAccounts.findById(input.treasuryAccountId);
    if (!treasury?.glAccountId) {
      throw new InvalidSalesInvoicePaymentError("حساب الخزينة غير موجود أو بلا حساب دفتري.");
    }
    if (treasury.currency !== BASE_CURRENCY) {
      throw new InvalidSalesInvoicePaymentError(baseTreasuryOnlyAr(treasury.currency));
    }
    const voucherId = `COLL:${input.invoiceId}:${randomUUID()}`;
    const service = new VoucherService({
      documents: vouchers.documents,
      ledger,
      accounts,
      periods: fiscalPeriods,
      numbering: ledger.numbering,
      projects,
      treasuryAccounts,
      allocations: vouchers.allocations,
      invoices: vouchers.invoices,
      settings,
      settlement: invoiceSettlement,
      audit: auditSink,
      actor: input.actor,
      cheques: voucherCheques,
      realisedFx,
      returns: invoiceReturnCredits,
    });
    await service.createConfirmAndAllocate(
      {
        id: voucherId,
        date: input.date,
        memo: input.memo ?? undefined,
        voucherType: "customer_collection",
        amount: input.amount,
        currency: treasury.currency,
        branchId: input.branchId,
        paymentMethod: input.paymentMethod,
        treasuryAccountId: input.treasuryAccountId,
        treasuryGlAccountId: treasury.glAccountId,
        counterpartyGlAccountId: "1105",
        customerId: input.customerId,
        referenceNo: input.referenceNo ?? null,
      },
      [{ allocationId: `${voucherId}:A1`, invoiceId: input.invoiceId, amount: input.amount }],
    );
    return { voucherId };
  };

  const app = createApp(uow, {
    resolveAuthContext,
    security: { sessions, loginThrottle },
    onPermissionRefused,
    // The LAN routes need the SAME session registry the auth routes issue
    // into, or a disconnect revokes a token nobody is holding.
    ...(options.lan ? { lan: { ...options.lan, sessions } } : {}),
    ...(options.resolveLicenseState ? { resolveLicenseState: options.resolveLicenseState } : {}),
    ...(options.resolveEntitlements
      ? { resolveEntitlements: options.resolveEntitlements }
      : options.entitlements
        ? { resolveEntitlements: () => options.entitlements! }
        : {}),
    settingsStore: settings,
    branchStore: branches,
    warehouseStore: warehouses,
    customerStore: customers,
    supplierStore: suppliers,
    customerOpeningBalances,
    supplierOpeningBalances,
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
    sequences: { counters: sequenceCounters, config: sequenceConfig, audit: auditSink, transactor: configTransactor },
    audit: { store: auditSink },
    auditSink,
    barcodeConfigStore: barcodeConfig,
    taxRateRepo: taxRates,
    costCenterRepo: costCenters,
    treasuryAccountRepo: treasuryAccounts,
    fiscalPeriodRepo: fiscalPeriods,
    periodCloseGuard: periodCloseGuard.source,
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
      projects,
      audit: auditSink,
      // The HAND-WRITTEN journal is exactly where an uncategorised movement on
      // a contracting control account gets in, so the same set guards it.
      projectRequiredAccountIds,
      resolvePartyControlAccounts,
      partyExists: async (kind, id) =>
        kind === "customer" ? (await customers.findById(id)) !== null : (await suppliers.findById(id)) !== null,
      vatFilings,
      openPartyDocuments: () => collectOpenPartyDocuments(),
      baseCurrency: async () => ((await settings.get()) ?? createDefaultSettings()).currency,
    },
    vouchers: {
      receivableAccountId: CERTIFICATE_AR_ACCOUNT_ID,
      masterData: masterDataChecks,
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
      projects,
      treasuryAccounts,
      // Without this the treasury guard reads its own hardcoded default and both
      // سياسة الخزينة switches on the settings screen do nothing (D19).
      settings,
      // A foreign-currency voucher converts to base at the rate of its own date
      // and carries it onto the counterparty line; without these its foreign
      // digits posted as EGP and settled the wrong amount (B-4/B-5).
      exchangeRates,
      baseCurrency: "EGP",
      // Allocating a collection has to reach the invoice document, or the GL
      // credits AR while the invoice still reports amountPaid 0 forever (D1).
      // Purchase invoices carry no paid field; their settled figure lives in the
      // allocation sub-ledger, which the reconciliation above now reads.
      settlement: invoiceSettlement,
      events: voucherEventBridge,
      cheques: voucherCheques,
      realisedFx,
      returns: invoiceReturnCredits,
      // Reversing an ADV-CV/ADV-RV voucher mirrors GL 1160 سلف الموظفين; without
      // this the advance record kept the disbursement (or the repayment) and the
      // two sides parted company.
      advanceSubLedger: advanceVoucherUnwind,
      // Law 6/2025 exempts a regime taxpayer from withholding, so the route
      // refuses a voucher that withholds rather than posting a liability the
      // authority does not recognise (DEC-13).
      simplifiedRegimeActiveOn: async (day: string) =>
        simplifiedRegimeActiveOn((await simplifiedRegime.get()) ?? NO_SIMPLIFIED_REGIME, day),
    },
    purchases: {
      itemCheck: items,
      masterData: masterDataChecks,
      orders: purchaseOrders,
      receipts: goodsReceipts,
      invoices: purchaseInvoices,
      orderVersions: { versions: purchaseOrders.versions, displayNameOf },
      invoiceVersions: { versions: purchaseInvoices.versions, displayNameOf },
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
      events: purchasesEventBridge,
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
        if (treasury.currency !== BASE_CURRENCY) {
          throw new InvalidPurchaseDocumentError([baseTreasuryOnlyAr(treasury.currency)]);
        }
        const voucherId = `PAY:${input.invoiceId}:${randomUUID()}`;
        const service = new VoucherService({
          documents: vouchers.documents,
          ledger,
          accounts,
          periods: fiscalPeriods,
          numbering: ledger.numbering,
          projects,
          treasuryAccounts,
          allocations: vouchers.allocations,
          invoices: vouchers.invoices,
          settings,
          audit: auditSink,
          actor: input.actor,
          cheques: voucherCheques,
          realisedFx,
          returns: invoiceReturnCredits,
        });
        await service.createConfirmAndAllocate(
          {
            id: voucherId,
            date: input.date,
            memo: input.memo,
            voucherType: "supplier_payment",
            amount: input.amount,
            currency: treasury.currency,
            branchId: input.branchId,
            paymentMethod: input.paymentMethod,
            treasuryAccountId: input.treasuryAccountId,
            treasuryGlAccountId: treasury.glAccountId,
            counterpartyGlAccountId: PURCHASE_GL_ACCOUNTS.payableAccountId,
            supplierId: input.supplierId,
            referenceNo: input.referenceNo,
          },
          [{ allocationId: `${voucherId}:A1`, invoiceId: input.invoiceId, amount: input.amount }],
        );
        // The number is stamped by the confirm, not the create — read it back so
        // the screen can name the voucher instead of showing its internal id.
        const posted = await vouchers.documents.findById(voucherId);
        return { voucherId, voucherNo: posted?.docNo ?? null };
      },
      settlementPreview: previewSettlement((message) => new InvalidPurchaseDocumentError([message])),
      // Mounts POST /purchases/receipts/:id/cancel and /invoices/:id/cancel,
      // which 404 without it. app.ts derives the GL reversal port from this
      // being present, so omitting it silently disables both.
      layers: stockLedger.layers,
      landedCostsStandingOn: (documentId) => landedCosts.standingOn(documentId),
    },
    salesInvoices: {
      repo: salesInvoices,
      versionGuard: { versions: salesInvoices.versions, displayNameOf },
      itemCheck: items,
      masterData: masterDataChecks,
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
      // The tenant's real chart, so an invoice cannot name an account it does
      // not have — the browser fills any unmapped item from constants (D108).
      accounts,
      allocatable: vouchers.invoices,
      contractBilling: contractBillingRouting,
      // The customer's own price list, consulted SERVER-side. The engine
      // (resolvePrice) always existed and no route called it, so the whole
      // pricing order held only in the browser (D35).
      collect: collectFromCustomer,
      issueEtaReceipt: async (invoiceId, receiptOptions) => {
        const issued = await etaReceipts.issueInvoiceReceipt(invoiceId, receiptOptions);
        if (issued) etaReceipts.scheduleSubmission();
        return issued;
      },
      hasEtaReceipt: (invoiceId) => etaReceipts.hasInvoiceReceipt(invoiceId),
      stockRestore: createInventoryStockHook(stockService),
      settlementPreview: previewSettlement((message) => new InvalidSalesInvoicePaymentError(message)),
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
      masterData: masterDataChecks,
      cheques,
      gl: salesInvoiceGl,
      // A cheque applied against an invoice lives in the same allocation
      // sub-ledger as a voucher, so a bounce can reopen what it settled (D192).
      allocation: { allocations: vouchers.allocations, invoices: vouchers.invoices, settlement: invoiceSettlement, returns: invoiceReturnCredits },
      raisedBy: chequeRaisedByVoucher,
      realisedFx,
    },
    bankReconciliation: {
      statements: bankStatements.statements,
      mappings: bankStatements.mappings,
      suggestions: bankStatements.suggestions,
      rules: bankStatements.rules,
      audit: auditSink,
      accounts,
      costCenters,
      treasuryAccounts,
      baseCurrency: "EGP",
      ledgerReader: createTreasuryLedgerReader({
        treasuryAccounts,
        baseCurrency: "EGP",
        ledger,
        vouchers: vouchers.documents,
        partyName: async (kind, id) => {
          const party = kind === "customer" ? await customers.findById(id) : await suppliers.findById(id);
          return party ? [party.nameAr, party.nameEn].filter(Boolean).join(" ") : null;
        },
      }),
      entryPoster: createVoucherBankEntryPoster({
        documents: vouchers.documents,
        allocations: vouchers.allocations,
        invoices: vouchers.invoices,
        ledger,
        accounts,
        periods: fiscalPeriods,
        numbering: ledger.numbering,
        projects,
        treasuryAccounts,
        settings,
        exchangeRates,
        baseCurrency: "EGP",
        resolveGateConfig: (actionType) => workflowConfigs.resolveSync(actionType),
        approvalRequests,
        audit: auditSink,
        events: voucherEventBridge,
      }),
    },
    priceListRepo: priceLists,
    promotionRepo: promotions,
    salesQuotes: {
      repo: salesQuotes,
      versionGuard: { versions: salesQuotes.versions, displayNameOf },
      itemCheck: items,
      masterData: masterDataChecks,
      numbering: { next: (opts) => ledger.numbering.next("SALES_QUOTE", { branchId: opts?.branchId }) },
    },
    // --- phase9/accounting-depth ---
    exchangeRateRepo: exchangeRates,
    costCenterPl: { ledger, accounts, costCenters },
    fxRevaluation: {
      recordRun: (run) => fxRevaluationRuns.record(run),
      ledger,
      accounts,
      periods: fiscalPeriods,
      numbering: ledger.numbering,
      projects,
      exchangeRates,
      differenceAccounts: () => fxDifferenceAccounts("unrealised"),
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
      companyTradeName: async () => ((await settings.get()) ?? createDefaultSettings()).companyName,
      // ENH-011b "Fix & Requeue" (WF-04 step 4): rebuilds the payload and the
      // pre-validation from the CURRENT masters, so a fixed item code or
      // customer TIN actually clears the finding that blocked submit.
      rebuildSubmission: createEtaInvoiceRequeueRebuilder({
        eta: etaService,
        items,
        taxRates,
        branchCodes: etaStore.branchCodes,
        unitMappings: etaStore.unitMappings,
        invoices: salesInvoices,
        customers,
      }),
      issueDocumentReceipt: async (kind, docId) => {
        const issued =
          kind === "invoice" ? await etaReceipts.issueInvoiceReceipt(docId) : await etaReceipts.issueReturnReceipt(docId);
        if (issued) etaReceipts.scheduleSubmission();
        return issued;
      },
      // D-B4 — corrects and re-issues a REJECTED receipt inside the authority's
      // 96-hour window, referencing the rejected one via header.referenceOldUUID.
      reissueDocumentReceipt: async (kind, docId) => {
        const issued =
          kind === "invoice"
            ? await etaReceipts.reissueInvoiceReceipt(docId)
            : await etaReceipts.reissueReturnReceipt(docId);
        if (issued) etaReceipts.scheduleSubmission();
        return issued;
      },
    },
    reconciliation: { ledger, resolveControls: () => resolveReconciliationControls() },
    openingBalanceDuplicates: {
      resolveContext: resolveOpeningBalanceDuplicatesContext,
      repair: repairOpeningBalanceDuplicate,
      audit: auditSink,
      transactor: configTransactor,
    },
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
      masterData: masterDataChecks,
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
      audit: auditSink,
      clockCredentials: hrClockCredentials,
      challenges: hrChallenges,
      payroll: {
        masterData: masterDataChecks,
        advances: hrAdvances,
        runs: hrPayrollRuns,
        payslips: hrPayslips,
        gl: salesInvoiceGl,
        accounts: PAYROLL_GL_ACCOUNTS,
        treasury: hrTreasuryDisbursement,
        payrollComponents: hrPayrollComponents,
        garnishmentRegister: hrGarnishments,
        settings,
        statutoryOverrides: hrStatutoryOverrides,
        statutoryFlag: hrStatutoryFlag,
        exchangeRates,
        // The leave provision compares the computed obligation against what
        // 2180 already carries, so it reads the posted ledger.
        ledger,
        audit: auditSink,
      },
      users: uow.users,
      numbering: ledger.numbering,
    },
    projects: {
      masterData: masterDataChecks,
      projects,
      costCenters,
      ledger,
      accounts,
      routing: accountRouting,
      worksContracts,
      recognitionRuns,
    },
    contractingContracts: {
      store: worksContracts,
      numbering: ledger.numbering,
      projects,
      customers,
      // Slice 2's مستخلص ختامي check: a contract closes on a final
      // certificate, so one with certificates still in flight — or with none
      // of them final — is refused rather than quietly closed.
      completionGuard: (contractId) => certificateService.completionRefusal(contractId),
      guarantees: contractPerformanceGuarantees,
    },
    contractingCertificates: certificateDeps,
    contractingSubcontracts: { subcontracts: subcontractDeps, certificates: subCertificateDeps },
    contractingSite: { service: siteService },
    // تشغيل الاعتراف بالإيراد reads billings, WIP and the contract position
    // straight off the posted ledger and posts back through the same engine, so
    // the run can never disagree with the accounts it is derived from.
    // تقارير الاستثناءات الستة وتقويم المحتجزات 5B — every report is assembled
    // from the OTHER slices' own ports (certificates, contracts, site) and the
    // posted ledger, so nothing here re-queries what they already answer.
    contractingControls: {
      releases: retentionReleases,
      contracts: worksContracts,
      certificates: progressCertificates,
      gl: salesInvoiceGl,
      numbering: ledger.numbering,
      routing: accountRouting,
      invoicing: retentionInvoicing,
      site: siteService,
      equipmentLogs: contractingSiteStore.equipmentLogs,
      projects,
      // The payable half of the retention: the sub side has its own clock, and
      // an early release to a subcontractor is the same exception as one to a
      // client.
      subcontracts: { list: () => new SubcontractService(subcontractDeps).list() },
      guarantees: contractPerformanceGuarantees,
      projectCostToDate: contractingProjectCostToDate,
      releaseItemId: RETENTION_RELEASE_ITEM_ID,
      segregationWaived,
      audit: auditSink,
    },
    contractingRecognition: {
      runs: recognitionRuns,
      contracts: worksContracts,
      accounts,
      ledger,
      routing: accountRouting,
      gl: salesInvoiceGl,
      audit: auditSink,
      costExcludedAccountIds: contractingCostExclusions,
    },
    // خطابات الضمان posts the memorandum pair AND the restricted-cash margin
    // through the SAME GL engine every other document uses, so the register's
    // outstanding total and the 9100 balance can never drift apart.
    contractingGuarantees: {
      guarantees,
      treasuryAccounts,
      treasuryAccountsList: treasuryAccounts,
      accounts,
      projects,
      projectsList: projects,
      routing: accountRouting,
      gl: salesInvoiceGl,
      audit: auditSink,
      contracts: { exists: async (id) => (await worksContracts.findContractById(id)) !== null },
    },
    fixedAssets: {
      masterData: masterDataChecks,
      categories: assetCategories,
      assets,
      rateHistory: assetRateHistory,
      runs: depreciationRuns,
      periods: fiscalPeriods,
      gl: salesInvoiceGl,
      defaultAccounts: FIXED_ASSETS_GL_ACCOUNTS,
      settings,
      audit: auditSink,
    },
    inventoryWritedown: {
      masterData: masterDataChecks,
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
      masterData: masterDataChecks,
      trips: vanTrips,
      // The registry the van→warehouse→treasury cascade resolves against, and
      // the check that a crew member is a real employee: the trip form took a
      // TYPED employee id, which is the field-binding defect this closes.
      vans: vanTrips.vans,
      employeeExists: async (employeeId: string) => (await hrEmployees.findById(employeeId)) !== null,
      stock: stockService,
      treasuryTransfer: vanTripTreasuryTransfer,
      recordCashTaking: recordVanCashTaking,
      recordCashVariance: recordVanCashVariance,
      numbering: { next: (opts) => ledger.numbering.next("VAN_TRIP", { branchId: opts?.branchId }) },
    },
    manufacturing: {
      masterData: masterDataChecks,
      boms: manufacturing.boms,
      workOrders: manufacturing.workOrders,
      configurableProducts: manufacturing.configurableProducts,
      configInstances: manufacturing.configInstances,
      workStations: manufacturing.workStations,
      /** المشغّل on a shop-floor action is an employee id, resolved against the HR register. */
      operators: {
        findById: async (id: string) => {
          const employee = await hrEmployees.findById(id);
          if (!employee) return null;
          const arabic = [employee.firstNameAr, employee.lastNameAr].filter(Boolean).join(" ").trim();
          return { id: employee.id, fullName: arabic || `${employee.firstName} ${employee.lastName}`.trim() };
        },
      },
      /** المستودعات — a work order's three warehouse ids are resolved against the real registry. */
      warehouses: {
        findById: async (id: string) => {
          const warehouse = await warehouses.findById(id);
          return warehouse ? { id: warehouse.id, name: warehouse.name, active: warehouse.active } : null;
        },
      },
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
      masterData: masterDataChecks,
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
        ...historicalImportGate,
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
      // P-5 — the three steps that make a real go-live possible: the chart, the
      // opening trial balance, and the open AR/AP the shop is actually owed.
      accounts,
      fiscalPeriods,
      partyControlAccounts: resolvePartyControlAccounts,
      postOpeningEntry: async (entry) => {
        try {
          await postJournalEntry(
            {
              id: entry.id,
              date: entry.date,
              memo: entry.memo,
              source: "manual",
              sourceDocType: "INITIAL_BALANCE",
              lines: entry.lines.map((l) => ({ accountId: l.accountId, debit: l.debit, credit: l.credit })),
            },
            // A trial-balance row names no party, so a debtors or creditors
            // total would sit on 1105/2100 with no customer behind it (D212).
            { ...salesInvoiceGl, partyControlAccounts: await resolvePartyControlAccounts() },
          );
        } catch (err) {
          if (!(err instanceof PartyRequiredOnControlAccountError)) throw err;
          throw new Error(
            `${err.message} أدخل أرصدة العملاء والموردين الافتتاحية على بطاقة كل عميل ومورد، أو باستيراد الفواتير المفتوحة. / ${err.messageEn} Enter customer and supplier opening balances on each customer's or supplier's record, or by importing their open invoices.`,
          );
        }
      },
      // Both reuse the historical-import path, so a migrated invoice lands in
      // the same archive and posts the same 1105/2100 balance a hand-run
      // import would.
      openCustomerInvoices: {
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
      openSupplierInvoices: {
        archives: historicalImportArchives,
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
        ...historicalImportGate,
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
          // The tax the line was ACTUALLY charged — after line, promotion and
          // header discounts, and zero when the customer is tax-exempt. Handing
          // the return a zero here credited no VAT at all and left it no rate
          // to group the posting by (D76).
          const chargedTax = new Map<string, { tax: Money; rate: number }>();
          const invoiceTotals = salesInvoiceTotals(invoice);
          for (const [i, line] of invoice.lines.entries()) {
            chargedTax.set(line.lineId, {
              tax: invoiceTotals.lines[i]?.tax ?? Money.zero(),
              rate: line.taxRatePercent,
            });
          }
          return {
            id: invoice.id,
            number: invoice.docNo ?? invoice.id,
            customerId: invoice.customerId,
            warehouseId: invoice.warehouseId,
            projectId: invoice.projectId,
            currency: invoice.currency,
            fxRate: invoice.fxRate ?? null,
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
              // The line's captured moving-average COST, not its price. This
              // read `l.unitPrice` — the same expression as the line above —
              // so «مرتجع من فاتورة», the route the screen uses, restocked
              // every return at the SELLING price: inventory overstated and
              // the COGS reversal wrong by the whole margin (D145).
              unitCost:
                l.unitCost === null
                  ? Money.zero()
                  : unitCostOf(extendQtyByPrice(l.qty, l.unitCost), l.baseQty),
              taxAmount: chargedTax.get(l.lineId)?.tax ?? Money.zero(),
              taxRatePercent: chargedTax.get(l.lineId)?.rate ?? null,
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
            projects,
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
            // A return inherits the invoice's project and each line's cost
            // category (D-01); leaving them off here dropped both (D215).
            projectId: invoice.projectId ?? null,
            currency: invoice.currency,
            fxRate: invoice.fxRate ?? null,
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
                // The input VAT the line actually carried, and the rate that
                // produced it — a return with neither credits no VAT back and
                // gives the VAT return nothing to group by (D76).
                taxAmount: purchaseInvoiceLineTax(l),
                taxRatePercent: l.taxRatePercent,
                costCategory: l.costCategory ?? null,
              })),
          };
        },
      },
    },
    landedCosts: { documents: landedCostDocuments, service: landedCosts },
    installments: {
      masterData: masterDataChecks,
      plans: installmentPlanDocuments,
      plansRepo: installmentPlans,
      followUps,
      collect: collectFromCustomer,
    },
    reports: {
      allocatable: vouchers.invoices,
      // The customer aging ladder has to net every credit the GL already
      // posted against 1105, or it and the dashboard tile report two
      // different receivables (D37).
      salesReturnDocs: salesReturns,
      purchaseReturnDocs: purchaseReturns,
      cheques,
      voucherDocuments: vouchers.documents,
      allocations: vouchers.allocations,
      salesInvoices,
      purchaseInvoices,
      historicalArchives: {
        sales: () => salesHistoricalImportArchives.list(),
        purchases: () => historicalImportArchives.list(),
      },
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
      // The HR reports read the SAME payroll runs, attendance and leave
      // balances the HR screens write — no second source behind the returns.
      hrPayroll: { runs: hrPayrollRuns, payslips: hrPayslips },
      hrContracts,
      hrAttendance,
      hrLeave: { balances: hrLeaveBalances, policies: hrLeavePolicies },
      // تقرير العروض reads the same promotion master /promotions writes, for a
      // campaign's type; every figure comes off the invoices themselves.
      promotions,
      // إقرار الخصم والتحصيل covers both halves: tax withheld on a payment
      // voucher and tax withheld on a subcontractor's certified bill.
      subCertificates: subcontracts,
      progressCertificates,
    },
    financialReports: {
      ledger,
      accounts,
      vatAccounts: { outputVatAccountId: "2200", inputVatAccountId: "1400" },
      cashAccountIds: ["1300-1", "1310", "1315", "1320", "1330"],
      otherIncomeExpenseAccountIds,
      branchOfEntry: resolveEntryBranches,
    },
    notificationRuleRepo: notificationRules,
    emittedEventCodes: [
      ...emittedEventCodesOf(returnsEventMapping, salesInvoiceEventMapping, purchasesEventMapping, voucherEventMapping),
      ...ENH_EMITTED_EVENT_CODES,
    ],
    notificationRepo: notifications,
    /**
     * Drains the outbound queue on an operator's request (ROADMAP §3.3).
     *
     * The transport is the SAME SMTP session the settings test-send uses, so
     * it inherits the refusal to put a password on a plain wire (D133). Being
     * offline leaves a message queued rather than failing it: a shop with no
     * internet is this product's normal state, not an error.
     */
    notificationDrain: async () => {
      const tenant = (await settings.get()) ?? createDefaultSettings();
      const dispatcher = new NotificationDispatcher({
        notifications,
        recipientEmail: async (userId) => (await uow.users.findById(userId))?.email ?? null,
        transports: [
          {
            channel: "email",
            async send(notification, recipientEmail) {
              if (!tenant.smtpEnabled) {
                return { kind: "rejected", reason: "البريد الإلكتروني غير مُفعَّل في الإعدادات." };
              }
              if (!recipientEmail) {
                // No address on the user. Terminal: the next drain would find
                // the same missing address and try forever.
                return { kind: "rejected", reason: "لا يوجد بريد إلكتروني مسجَّل لهذا المستخدم." };
              }
              const sent = await sendNotificationEmail(tenant, recipientEmail, {
                subject: notification.title,
                body: notification.body,
              });
              return sent.outcome === "sent"
                ? { kind: "sent" }
                : { kind: sent.outcome === "offline" ? "offline" : "rejected", reason: sent.detail };
            },
          },
        ],
      });
      return dispatcher.drain();
    },
    workflow: { configs: workflowConfigs, requests: approvalRequests },
  });

  /**
   * The one route a till can call before it trusts anything else, and the ONLY
   * place host/client version skew is detectable.
   *
   * It used to answer `{ok:true}`, and the client compared nothing — so a till
   * left on an old build after the host was updated kept talking to a schema it
   * did not match, and the first symptom was wrong data rather than a refusal.
   * EXTERNAL CONTRACT: main/lan-client.ts reads both fields at startup and
   * blocks the client on a mismatch. Do not rename them.
   */
  app.get("/health", (c) =>
    c.json({
      ok: true,
      version: process.env["MEZAN_APP_VERSION"] ?? "0.0.0",
      schemaVersion: CURRENT_SCHEMA_VERSION,
    }),
  );
  app.route("/", createAuthRoutes({ uow, hasher, settings, seedStores, sessions, loginThrottle, audit: auditSink, resolveEntitlements: options.resolveEntitlements }));
  app.route(
    "/",
    createDashboardRoutes({
      accounts,
      ledger,
      countCustomers: async () => (await customers.findAll()).length,
      countSuppliers: async () => (await suppliers.findAll()).length,
      countItems: async () => (await items.list()).length,
      uow,
      otherIncomeExpenseAccountIds,
    }, resolveAuthContext),
  );
  // Unconditional: a route mounted only when an optional dep happens to be
  // supplied is how four inventory-ops routes 404'd live while their files
  // existed. The store is created above, always.
  app.route("/preferences", createPreferencesRoutes({ store: userPreferences, uow }, resolveAuthContext));
  // النظام الضريبي المبسط (قانون 6 لسنة 2025). Mounted unconditionally beside
  // the settings bag it belongs with: the record of what the taxpayer filed on
  // Form 1/10, the estimated liability, and the regime comparison.
  app.route(
    "/tax/simplified-regime",
    createSimplifiedRegimeRoutes(
      { regime: simplifiedRegime, salesInvoices, customers, accounts, ledger },
      resolveAuthContext,
    ),
  );

  const areaClosers: { close(): void }[] = [];
  const areaContext: BackendModuleContext = {
    app,
    sqlite,
    uow,
    resolveAuthContext,
    sessions,
    hasher,
    audit: auditSink,
    eventBus,
    etaReceipts,
    stores: {
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
      stockLedger,
      salesInvoices,
      vouchers,
      priceLists,
      promotions,
      eta: etaStore,
      employees: hrEmployees,
      sequenceConfig,
      sequenceCounters,
    },
    reconciliationControls: resolveReconciliationControls,
    payrollBindings: { attendanceBound: Boolean(hrAttendance), exchangeRatesBound: Boolean(exchangeRates) },
    periodCloseGuard,
    addCloser: (closer) => areaClosers.push(closer),
  };
  await mountPos(areaContext);
  await mountEnhancements(areaContext);

  const closers = [
    ...areaClosers,
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
    worksContracts,
    guarantees,
    recognitionRuns,
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
    barcodeConfig,
    userPreferences,
    labelLayouts,
  ];

  if (options.seedDemoData) {
    await seedDemoTenant(app, {
      token: sessions.issue({
        userId: SEED_ADMIN_USER_ID,
        permissions: ["*"],
        roleCode: null,
        branchScope: ALL_SCOPE,
        warehouseScope: ALL_SCOPE,
      }),
      mint: ({ userId, permissions, roleCode }) =>
        sessions.issue({ userId, permissions, roleCode, branchScope: ALL_SCOPE, warehouseScope: ALL_SCOPE }),
      audit: auditSink,
    });
  }

  return {
    app,
    sessions,
    etaReceipts,
    backupTo: (destination) => sqlite.backup(destination).then(() => undefined),
    async drain() {
      // The bridge's tasks call `scheduleSubmission()`, and a submission run
      // can queue more work, so neither one alone is "nothing left" — loop
      // until both are idle.
      let settled = false;
      while (!settled) {
        await etaEnqueueBridge.drain();
        await etaReceipts.settle();
        settled = true;
        await etaEnqueueBridge.drain();
        if (etaReceipts.pending()) settled = false;
      }
    },
    close() {
      // ORDER MATTERS: both stops must land before `sqlite.close()`, or a
      // parked e-receipt task resumes against a closed connection. `drain()`
      // is the caller's chance to let that work FINISH first — `close()`
      // alone only makes it stop quietly.
      etaEnqueueBridge.stop();
      etaReceipts.stop();
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
