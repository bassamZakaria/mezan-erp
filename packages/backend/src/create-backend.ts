import { OWNER_DIGEST_EVENT, ReversalDocumentType, reversalPermissionSuccessors } from "@mezan/contracts";
import { attachmentPermissionSuccessors, type User } from "@mezan/domain";
import { createHash, randomUUID } from "node:crypto";
import { OwnerPasswordResetOutcome } from "./owner-password-reset-outcome.js";
import { createLeaveAccrualJob, startScheduledJobs, type ScheduledJobResult, type ScheduledJobStatus } from "./scheduled-jobs.js";
import {
  createApp,
  ACCOUNT_LOCK_FAILURES,
  ACCOUNT_LOCK_WINDOW_MS,
  UNLOCK_CODE_TTL_MS,
  createAccountLocks,
  createPeriodCloseGuardSlot,
  createLoginThrottle,
  createSourceThrottle,
  type LoginThrottle,
  type SmtpConfig,
  createSessionAuthContextResolver,
  createSessionRegistry,
  createMemorySessionStore,
  DEFAULT_SESSION_LIMITS,
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
  SmtpDestinationPolicy,
  type SmtpSendOptions,
  createPrecomputingHasher,
  reportTurnYield,
  customerTaxProfileFrom,
  salesTaxRerating,
  type SalesItemTaxSource,
  type ReportsRoutesDeps,
  AUDITED_ACCOUNT_FIELDS,
} from "@mezan/api";
import {
  withDerivedTreasuryFx,
  deriveOpenFxBalances,
  type ForeignTreasuryBalance,
  chequeBounceOntoPartyEntryId,
  chequeLedgerDays,
  ALL_SCOPE,
  SiteService,
  StockLedgerService,
  type InventoryDomainEvent,
  VanTripCashMovementKind,
  applyAllocatedSettlement,
  EtaSubmissionStatusCode,
  EtaReceiptSourceKind,
  SalesQuoteService,
  SalesPricingMode,
  SalesInvoiceField,
  DocumentChangedError,
  InvalidSalesInvoicePaymentError,
  InvalidPurchaseDocumentError,
  assertPeriodOpen,
  assertVatNotFiled,
  NoFiscalPeriodForDateError,
  postJournalEntry,
  reverseJournalEntry,
  resolvePrice,
  createSalesInvoiceGlHook,
  createJournalTaxTagPort,
  returnedQtyBySourceLine,
  createReturnConfirmGuard,
  stockPositionFaults,
  ensureSystemTaxRates,
  SALES_RETURN_DOC_TYPE,
  PURCHASE_RETURN_DOC_TYPE,
  type SalesInvoiceLookupPort,
  type PurchaseInvoiceLookupPort,
  type PurchaseReturnLine,
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
  createReturnTaxCarry,
  expectedReturnTaxJournalLines,
  nameReturnJournalLineTax,
  salesTaxPolicySource,
  InvoiceDocumentKind,
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
  COMPANY_LEVEL_VOUCHER_BRANCH,
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
  type LandedCostGlPosting,
  installmentPlanDocumentType,
  stockAdjustmentDocumentType,
  stockTransferDocumentType,
  createInventoryOpsStockHook,
  createInventoryGlPostingHook,
  PAYROLL_GL_ACCOUNTS,
  PhysicalCountService,
  SalesInvoiceStatusCode,
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
  DocumentStatusCode,
  type DocumentStatus,
  purchaseInvoiceCancelEntryId,
  goodsReceiptCancelEntryId,
  goodsReceiptTotalCost,
  goodsReceiptUninvoicedCost,
  salesInvoiceVoidEntryId,
  PartyRequiredOnControlAccountError,
  CUSTOMER_OPENING_BALANCE_DOC_TYPE,
  SUPPLIER_OPENING_BALANCE_DOC_TYPE,
  fxRevaluationNet,
  isFxRestatementLine,
  openFxItemsKey,
  unconsumedRevaluationShare,
  FxOpenItemType,
  FxItemEventKind,
  fxItemOpenOn,
  fxItemTimeline,
  walkRunShare,
  type FxItemEvent,
  type FxItemTimeline,
  type FxShareRelief,
  type FxOpenItemRef,
  sumActive,
  getVoucherTypeDefinition,
  REFUNDED_MONEY,
  type VoucherLine,
  invoiceOpenBalance,
  returnedByInvoice,
  convertFromBase,
  type OpenFxItem,
  type AllocationInvoiceKind,
  FX_REALISED_DOC_TYPE,
  FX_REVALUATION_DOC_TYPE,
  realisedFxReversalId,
  EquipmentLogStatus,
  MaterialConsumptionStatus,
  FX_SHARE_RELEASE_ENTRY_PREFIX,
  fxLateReleaseEntryId,
  fxLateReleaseEntryIds,
  isBaseCurrency,
  allocationInvoiceAmount,
  type VoucherAllocation,
  type VoucherDocument,
  FX_REALISED_LINE_MEMO,
  type ForeignResidue,
  ForeignResidueKind,
  accountForeignResidues,
  shareOfBase,
  buildRevaluationReleaseLines,
  replay,
  type StockMovement,
  Qty,
  approvalLabel,
  purchaseReturnGrandTotal,
  salesReturnGrandTotal,
  SalesReturnNotRefundableError,
  SalesReturnRefundTreasuryBranchError,
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
  recordSecurityEventOrFallback,
  type AuditSink,
  unwindAdvanceVoucher,
  unwindPayrollDisbursementVoucher,
  type VoucherAdvanceUnwindPort,
  type Entitlements,
  type RealisedFxPort,
  type FxDifferenceAccounts,
  type InvoiceReturnCreditPort,
  SettlementRateMissingError,
  salesReturnCreditByInvoice,
  salesReturnLineCredit,
  purchaseReturnCreditByInvoice,
  purchaseReturnLineCredit,
  type OpeningBalanceDuplicatesContext,
  type OpeningBalanceEntryRef,
  tenantTodayIso,
  hasModule,
  DEFAULT_TIME_ZONE,
  BASE_CURRENCY,
  EVENT_BRANCH_IDS_KEY,
  correctedSeededRolePermissions,
  costOfSalesLedgerAccountIds,
  inventoryLedgerAccountIds,
  SeededRoleSplit,
  seededRoleDutyChange,
  seededRoleDutyNotice,
  SEEDED_ROLE_DUTIES_SEPARATED_EVENT,
  type SeededRoleDutyChange,
  CASH_AND_BANK_ROUTING_KEY,
  RESTRICTED_CASH_ROUTING_KEY,
  cashAndBankLedgerAccountIds,
  openTreasuryLedgerAccount,
  diffAuditFields,
  AuditChangeAction,
  recordSensitiveEvent,
  disposalProceedsAccounts,
  UserStatusCode,
  isErasedUser,
  AuditSeverityCode,
  type OwnerRecordDue,
  type SettingsRepository,
} from "@mezan/domain";
import {
  bindTenantDatabase,
  TenantBindingMismatchError,
  openSqliteConnection,
  withSqliteTransaction,
  createSqliteUpgradeLedger,
  markApprovalsNeedingReapproval,
  UpgradeStepId,
  type SqliteOpenOptions,
  createSqliteUnitOfWork,
  grantSuccessorPermissionsOnce,
  sqliteDb,
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
  createSqliteBatchTrailStore,
  createSqliteSalesInvoiceStore,
  createSqlitePriceListStore,
  createSqlitePromotionStore,
  createSqliteSalesQuoteStore,
  createSqliteTaxRateUsage,
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
  createSqliteActivityReminderLog,
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
  createSqliteOwnerDigestStore,
  createSqliteCollectionsStore,
  removeNotificationLinesMatching,
  createSqliteWorkflowConfigStore,
  createSqliteApprovalRequestStore,
  createAuditSink,
  createSettingsStore,
  ensureTenantSchema,
  type AuditSinkHandle,
  type DataMigrationTransactor,
  TransactionMode,
  type SqlDb,
  createSqliteBarcodeConfigStore,
  createSqliteUserPreferencesStore,
  createSqliteOwnerPinFence,
  createSqliteCredentialResetMarks,
  createSqlitePasswordResetTokens,
  createSqliteAuditSink,
  createSqliteIdempotentRequestStore,
  createSqliteAccountLockStore,
  createSqliteAttemptStore,
  createSqliteSessionStore,
  createSqliteLeaseStore,
  SignInAttemptScope,
  createSqlitePeriodCloseStore,
  deriveAuditChainKey,
  createSqliteLabelLayoutStore,
  createSqliteSequenceConfigStore,
  createSqliteSequenceStore,
  CURRENT_SCHEMA_VERSION,
  SchemaUpgradeFailedError,
  holdsExistingBooks,
  readSchemaVersion,
  stampSchemaVersion,
  securityFallbackFor,
  type SecretBox,
  createAccountLockStore,
  createAccountRepository,
  createAccountRoutingStore,
  createActivityReminderLog,
  createActivityRepository,
  createApprovalRequestStore,
  createAssetCategoryRepository,
  createAssetInternalRateHistoryRepository,
  createAssetRepository,
  createAttachmentRepository,
  createAttemptStore,
  createAttendanceRepository,
  createBankReconciliationStore,
  createBarcodeConfigStore,
  createBatchTrailStore,
  createBranchStore,
  createChequeRepository,
  createClockCredentialRepository,
  createCollectionsStore,
  createContractRepository,
  createContractingControlsStore,
  createContractingRecognitionStore,
  createContractingSiteStore,
  createCostCenterRepository,
  createCredentialResetMarks,
  createPasswordResetTokens,
  createCustomerRepository,
  createDepartmentRepository,
  createDepreciationRunRepository,
  createEmployeeAdvanceRepository,
  createEmployeeRepository,
  createEtaStore,
  createExchangeRateRepository,
  createFiscalPeriodRepository,
  createFollowUpStore,
  createGarnishmentRepository,
  createGoodsReceiptStore,
  createGuaranteeStore,
  createHistoricalPurchaseArchiveStore,
  createHistoricalSalesArchiveStore,
  createHolidayRepository,
  createIdempotentRequestStore,
  createInstallmentPlanStore,
  createInventoryOpsStore,
  createItemCatalogStores,
  createItemSpecificationRepository,
  createItemStore,
  createJobTitleRepository,
  createLabelLayoutStore,
  createLandedCostStore,
  createLeadRepository,
  createLeaseStore,
  createLeaveAccrualBatchRepository,
  createLeaveBalanceRepository,
  createLeavePolicyRepository,
  createLeaveRequestRepository,
  createLedgerStore,
  createManufacturingStores,
  createNotificationRuleStore,
  createNotificationStore,
  createOpportunityRepository,
  createOwnerDigestStore,
  createOwnerPinFence,
  createPayrollComponentRepository,
  createPayrollRunRepository,
  createPayrollStatutoryFlagRepository,
  createPayslipRepository,
  createPeriodCloseStore,
  createPipelineStageRepository,
  createPriceListStore,
  createPrintTemplateConfigStore,
  createProductTemplateStore,
  createProgressCertificateStore,
  createProjectRepository,
  createPromotionStore,
  createPurchaseInvoiceStore,
  createPurchaseOrderStore,
  createPurchaseReturnStore,
  createRfqStores,
  createSalesInvoiceStore,
  createSalesQuoteStore,
  createSalesReturnStore,
  createSequenceConfigStore,
  createSequenceStore,
  createSessionStore,
  createSimplifiedRegimeStore,
  createStatutoryOverrideRepository,
  createStockLedgerStore,
  createSubcontractStore,
  createSupplierRepository,
  createTaxGroupStore,
  createTaxRateRepository,
  createTaxRateUsage,
  createTreasuryAccountRepository,
  createUnitOfWork,
  createUpgradeLedger,
  createUserPreferencesStore,
  createVanTripRepository,
  createVatFilingStore,
  createVoucherStore,
  createWarehouseStore,
  createWebauthnChallengeRepository,
  createWorkflowConfigStore,
  createWorksContractStore,
  createWritedownRunRepository,
} from "@mezan/persistence";
import {
  EtaService,
  createEtaHttpTransmitPort,
  createExternalCommandSigner,
  fetchEtaHttpClient,
  convertToBase,
  createDefaultSettings,
  NotificationDispatcher,
  NotificationChannelState,
  NotificationChannelCode,
  NotificationPriorityCode,
  NotificationReadStatusCode,
  ConnectionTurnLostError,
  CustomerMessageStatus,
  type DrainResult,
  SETTLED_AS,
  type DispatchOutcome,
  type NotificationTransport,
  type EtaCommandResult,
  type EtaCommandRunner,
  type EtaHttpClient,
  type DocumentRepository,
  type DocumentGlHook,
  laterDay,
  type FrameworkDocument,
  extend as extendQtyByPrice,
  unitCostOf,
} from "@mezan/domain";
import { runExternalSigningCommand } from "./eta-signing-command.js";
import { createEtaVoidPort, createSalesReturnVoidGuards } from "./eta-void.js";
import {
  createEtaEnqueueBridge,
  createSalesInvoiceTaxFiling,
  createSalesReturnTaxFiling,
  createEtaReturnCreditNoteRebuilder,
  createEtaInvoiceRequeueRebuilder,
  createEtaReceiptIssuer,
  createReturnEtaEnqueueBridge,
  createAfterTaxClassified,
  type EtaReceiptIssuer,
} from "./eta-receipts.js";
import { createAuth, type AccountLockedEvent } from "./auth-routes.js";
import { OutsideWork, OutsideWorkDeadlineError, withinDeadline } from "./outside-work.js";
import { BranchAccess, BranchRecordKind, type BranchDirectory, type OwnerDigestBackupReading, type ScheduledDigestResult } from "@mezan/api";
import { createBranchDirectory, createSqliteBranchDirectory } from "./branch-directory.js";
import { createPostgresWarehouseUse, createWarehouseUse } from "./warehouse-use.js";
import { createDashboardRoutes } from "./dashboard-routes.js";
import { createPreferencesRoutes } from "./preferences-routes.js";
import { isEmptyTenant, SEED_ADMIN_PASSWORD, SEED_ADMIN_USER_ID, seedIfEmpty, type SeedStores } from "./seed.js";
import type { BackendModuleContext, CollectionsScheduleSlot, IntegrationsSlot, IntegrationsSurface, OwnerDigestSlot, ScheduledCollectionsResult } from "./module-context.js";
import type { IntegrationsGateway } from "./integrations/gateway.js";
import { mountPos } from "./pos/index.js";
import { ENH_EMITTED_EVENT_CODES, mountEnhancements } from "./enh/index.js";
import { createCrmOwnerDirectory, createCrmReminderJob, createCrmReminderService } from "./enh/e3-06.js";
import { pricingGuardPortFor } from "./enh/e2-08.js";
import { readStockLedgerDateMismatches } from "./enh/e1-04.js";
import { countModeCompletionGate, registerCountModeCounts } from "./enh/e2-03.js";
import { lotRequirementFromItems } from "./enh/e2-04.js";
import { seedDemoTenant } from "./demo-seed.js";
import { ensureStandardRoles } from "./standard-roles.js";
import { createHrTreasuryDisbursementPort } from "./hr-treasury-disbursement.js";
import { createVanReconciliationPostingPort, createVanTripActivityPort } from "./van-reconciliation-ports.js";
import { createLogger } from "@mezan/api";

const backendLog = createLogger("backend");

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
  backOrderCostAccountId: "5100",
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
  backOrderCostAccountId: "5100",
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
  clearingAccountId: "1240",
};

const STOCK_VARIANCE_ACCOUNTS = {
  inventoryAccountId: LANDED_COST_GL_ACCOUNTS.inventoryAccountId,
  costVarianceAccountId: LANDED_COST_GL_ACCOUNTS.unabsorbedCostAccountId,
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

const BRIDGED_DOCUMENT_KINDS: Readonly<Record<string, BranchRecordKind>> = {
  SALES_INVOICE: BranchRecordKind.SalesInvoice,
  SALES_RETURN: BranchRecordKind.SalesReturn,
  PURCHASE_RETURN: BranchRecordKind.PurchaseReturn,
  PURCHASE_ORDER: BranchRecordKind.PurchaseOrder,
  GOODS_RECEIPT: BranchRecordKind.GoodsReceipt,
  PURCHASE_INVOICE: BranchRecordKind.PurchaseInvoice,
  [VOUCHER_DOC_TYPE]: BranchRecordKind.Voucher,
};

/**
 * SECURITY: the branches a bridged document belongs to, read from its stored
 * row. A document type with no declared kind states none, which the engine
 * reads as company-level — it reaches fewer people, never more.
 */
async function bridgedDocumentBranchIds(directory: BranchDirectory, docType: string, docId: string): Promise<string[]> {
  const kind = BRIDGED_DOCUMENT_KINDS[docType];
  if (!kind) return [];
  const branches = (await directory.branchesOf(kind, docId, BranchAccess.Read)) ?? [];
  return [...new Set(branches.filter((id): id is string => typeof id === "string" && id !== ""))];
}

function createDocumentEventBridge(
  eventBus: EventBus,
  afterCommit: (fn: () => void) => void,
  directory: BranchDirectory,
  mapping: DocumentEventMapping,
  enrich?: (docId: string) => Promise<Record<string, unknown>>,
): DocumentEventPublisher {
  return {
    publish(event) {
      const code = mapping[event.docType]?.[event.type];
      if (!code) return;
      const basePayload: Record<string, unknown> = { documentNumber: event.docNo ?? event.docId };
      // DocumentEventPublisher.publish is synchronous; the notification
      // engine's own dispatch is independently async, so a fire-and-forget
      // lookup here just widens the payload before that dispatch runs — a
      // failed lookup logs and drops the event rather than ever throwing back
      // into the document's own confirm/cancel transaction.
      afterCommit(() => {
        void Promise.all([bridgedDocumentBranchIds(directory, event.docType, event.docId), enrich ? enrich(event.docId) : {}])
          .then(([branchIds, extra]) => eventBus.publish(code, { ...basePayload, ...extra, [EVENT_BRANCH_IDS_KEY]: branchIds }, event.occurredAt))
          .catch((error: unknown) => {
            backendLog.error({ area: "notifications", err: error }, `event bridge lookup failed for ${event.docType}/${event.type}`);
          });
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

export enum SecurityEventOrigin {
  Platform = "platform",
}

export { OwnerPasswordResetOutcome };

export const COMPANY_OWNER_ASSIGNED_AUDIT = "COMPANY_OWNER_ASSIGNED";

export type OwnerAssignedRecord = OwnerRecordDue;
const OWNER_ASSIGNED_LOOKBACK = 500;

export interface ResetOwnerPasswordCommand {
  readonly userId?: string | null;
  readonly email: string;
  readonly password: string;
  readonly onlyIfNeverSignedIn: boolean;
  readonly actor: string;
  readonly fence?: number;
}

export interface OwnerAccount {
  readonly id: string;
  readonly email: string;
  readonly canAdminister: boolean;
}

export type OwnerAccountQuery = { readonly userId: string } | { readonly email: string };

export interface SignedInUser {
  readonly userId: string;
  readonly email: string;
  readonly canAdminister: boolean;
  readonly credentialIsOwn: boolean;
}

export interface CompanyAdminAccount {
  readonly id: string;
  readonly nameAr: string;
  readonly email: string;
}

export interface BackendHandle {
  readonly app: App;
  readonly audit: AuditSink;
  ownerAccount(query: OwnerAccountQuery): Promise<OwnerAccount | null>;
  companyAdmins(): Promise<CompanyAdminAccount[]>;
  recordOwnerAssigned(input: OwnerAssignedRecord): Promise<void>;
  /**
   * SECURITY: deliberately NOT an HTTP route. A route would be reachable through
   * the tenant router and the desktop LAN mount; this is callable only by code
   * that already holds the handle (platform provisioning and the platform console).
   */
  resetOwnerPassword(cmd: ResetOwnerPasswordCommand): Promise<OwnerPasswordResetOutcome>;
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
   * SECURITY: every path on which an administrator sets, resets or reopens an
   * account's credentials calls this ONE function: the Users screen, a password
   * reset, an email change, the platform console's owner password reset and its
   * account unlock. It clears the persisted account lock and the sign-in
   * backoff together; a reset that skips it hands out a password the account
   * still refuses.
   */
  credentialsResetByAdministrator(account: string): Promise<void>;
  lockedAccounts(): Promise<readonly string[]>;
  // SECURITY: not an HTTP route. Only code that holds the handle (the platform
  // console) can call it; it records the unlock in this tenant's own audit
  // trail in the transaction that clears the lock, and answers false for an
  // account that is not locked.
  unlockAccount(account: string, actor: string): Promise<boolean>;
  /**
   * Copies the live database to `destination` via better-sqlite3's online
   * backup API — safe to call while the app keeps serving writes, since the
   * backup reads through SQLite's own consistent snapshot rather than
   * pausing the connection.
   */
  backupTo?(destination: string): Promise<void>;
  // SECURITY: not an HTTP route. Null unless the host built this backend with `integrations`.
  readonly integrations?: IntegrationsGateway | null;
  /** Runs one scheduler tick now; null when this backend was built with scheduled jobs off. */
  runScheduledJobs(): Promise<readonly ScheduledJobResult[]> | null;
  /** Queues this tenant's scheduled owner digest for the day (idempotent per period and recipient); null when the tenant has not switched it on or this edition does not schedule it. */
  runOwnerDigest(): Promise<ScheduledDigestResult | null>;
  /** Runs this tenant's scheduled dunning for the day and sends the customer mail it queued; null when the tenant's policy has not switched automatic sending on. Only the cloud host calls it (DEC-28). */
  runScheduledCollections(): Promise<ScheduledCollectionsResult | null>;
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

const ACCOUNT_LOCKED_NOTICE = "SECURITY_ACCOUNT_LOCKED";

const LOCK_NOTICE_UNLOCK_ON_USERS = "لفكّ القفل: افتح شاشة المستخدمين واضغط «فكّ القفل» أمام الحساب.";
const LOCK_NOTICE_CHANGE_PASSWORD = "إن لم تكن هذه المحاولات من صاحب الحساب فغيّر كلمة المرور الخاصة به.";

function accountLockedHeadline(event: AccountLockedEvent): string {
  const locked = `قُفل حساب «${event.user.nameAr}» (${event.user.email}) بعد ${ACCOUNT_LOCK_FAILURES} محاولة دخول فاشلة خلال ٢٤ ساعة. آخر مصدر: ${event.source}.`;
  return event.reissued ? `${locked} انتهت صلاحية رمز فكّ القفل السابق والحساب ما زال مقفلًا.` : locked;
}

// SECURITY: this text is STORED (the notification row, and so every backup).
// It says that a code and a link were mailed and carries neither.
function accountLockedNotice(event: AccountLockedEvent, mailed: boolean, linkMailed: boolean): string {
  const lines = [accountLockedHeadline(event), LOCK_NOTICE_UNLOCK_ON_USERS];
  if (mailed) lines.push(`أُرسل إلى بريد مديري النظام رمز لفكّ القفل${linkMailed ? " ورابط يعمل مرة واحدة" : ""}، صالح لساعة واحدة.`);
  lines.push(LOCK_NOTICE_CHANGE_PASSWORD);
  return lines.join("\n");
}

// SECURITY: this text carries the secrets. It is handed to the mail transport
// and kept in memory until it is sent; it is never written to the database.
function accountLockedMail(event: AccountLockedEvent, unlockUrl: string | null): string {
  const lines = [accountLockedHeadline(event), LOCK_NOTICE_UNLOCK_ON_USERS];
  if (event.unlockCode) lines.push(`أو أدخل هذا الرمز في شاشة الدخول خلال ساعة واحدة: ${event.unlockCode}`);
  if (unlockUrl) lines.push(`أو افتح هذا الرابط خلال ساعة واحدة، وهو يعمل مرة واحدة فقط: ${unlockUrl}`);
  lines.push(LOCK_NOTICE_CHANGE_PASSWORD);
  return lines.join("\n");
}

function passwordResetMail(link: string): string {
  return [
    "طُلب تعيين كلمة مرور جديدة لحسابك في ميزان.",
    `افتح هذا الرابط خلال ساعة واحدة، وهو يعمل مرة واحدة فقط: ${link}`,
    "إن لم تطلب ذلك فتجاهل هذه الرسالة؛ تبقى كلمة مرورك كما هي.",
    "",
    "A new password was requested for your Mezan account.",
    `Open this link within one hour; it works once: ${link}`,
    "If you did not ask for this, ignore this email; your password stays as it is.",
  ].join("\n");
}

function invitationMail(email: string, temporaryPassword: string, signInLink: string | null, companyCode: string | null): string {
  return [
    "أُنشئ لك حساب في ميزان.",
    ...(signInLink ? [`رابط الدخول: ${signInLink}`] : []),
    ...(companyCode ? [`رمز المنشأة: ${companyCode}`] : []),
    `البريد الإلكتروني: ${email}`,
    `كلمة المرور المؤقتة: ${temporaryPassword}`,
    "ستُطلب منك كلمة مرور جديدة عند أول دخول.",
    "",
    "An account was created for you in Mezan.",
    ...(signInLink ? [`Sign in at: ${signInLink}`] : []),
    ...(companyCode ? [`Company code: ${companyCode}`] : []),
    `Email: ${email}`,
    `Temporary password: ${temporaryPassword}`,
    "You will be asked to choose a new password at your first sign-in.",
  ].join("\n");
}

const STORED_UNLOCK_SECRET = /[A-Z2-7]{16}|https?:\/\//;

export interface CreateBackendOptions {
  readonly connectionTurn?: CreateAppOptions["connectionTurn"];
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
   * Fixes the password of the fallback admin AND of every demo persona for THIS
   * database only. For the demo and reviewer tenants alone: the demo re-seeds
   * from scratch on every wake, so a generated password would change each
   * time. Refused without `seedDemoData: true` so a real tenant can never be
   * opened with a known admin password.
   */
  readonly seedAdminPassword?: string;
  /** Outbound HTTP for the ETA gateway. Tests inject a fake server; nothing else should. */
  readonly etaHttpClient?: EtaHttpClient;
  readonly securityMail?: SmtpConfig;
  // SECURITY: the address a mailed unlock link opens. It is built here from an
  // origin the DEPLOYMENT configured and never from anything a request carried
  // (Host, X-Forwarded-Host): the request that locks an account is the
  // attacker's own, and a link built from it would mail the administrators a
  // working token pointed at the attacker's server.
  readonly unlockLink?: (token: string) => string;
  // SECURITY: built like `unlockLink`, from the deployment's origin only.
  readonly passwordResetLink?: (token: string) => string;
  /** Where an invited user signs in, and the company code they type there, quoted in the invitation email. */
  readonly signInLink?: string;
  readonly signInCompanyCode?: string;
  // CONTRACT: true where a platform operator can unlock this tenant's accounts
  // from the console (the cloud edition). It changes what a locked account is told.
  readonly platformOperatorUnlocks?: boolean;
  // SECURITY: true where more than one server process serves this database (the
  // cloud edition). Sessions are then held in it, so a token minted or revoked
  // on one instance is minted or revoked on all; otherwise they stay in memory.
  readonly sessionsInDatabase?: boolean;
  // TEST HOOK: the clock the account lock and its unlock code's expiry read.
  readonly signInClock?: () => number;
  readonly sendMail?: typeof sendNotificationEmail;
  // SECURITY: PublicOnly on the cloud — a tenant SMTP host must not reach the platform network.
  readonly tenantMailDestinations?: SmtpDestinationPolicy;
  // SECURITY: seals stored outbound credentials (webhook signing secrets, the SMTP password) under the
  // platform key, which lives outside every tenant directory. Supplied by the cloud; omitted elsewhere.
  readonly secrets?: SecretBox;
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
  readonly onUserEmailChanged?: CreateAppOptions["onUserEmailChanged"];
  readonly companyOwner?: CreateAppOptions["companyOwner"];
  readonly onUserSignedIn?: (user: SignedInUser) => Promise<void>;
  readonly claimedElsewhere?: () => Promise<boolean>;
  // SECURITY: the cloud tenant this database belongs to. Written into it once
  // and compared on every open; a database bound to another tenant is refused
  // before anything else is written. Omitted by the desktop, which has no tenants.
  readonly tenantBinding?: string;
  // SECURITY (DEC-17 / DEC-27): the cloud edition's integration surface — `/integrations`, the
  // API-key verifier its `/api/v1` gateway calls and the webhook dispatcher. Omitted by the
  // desktop, whose backend must expose none of it.
  readonly integrations?: IntegrationsSurface;
  // SECURITY: false for a tenant that already has books. A database with no
  // chart of accounts is then left with no row added to it: seeding it would
  // create the fallback admin account, and topping it up would leave four
  // accounts that make it look seeded.
  readonly seedWhenEmpty?: boolean;
  /**
   * The on-premises editions ask for the standard role set; the cloud and the
   * demo do not. `resolveEntitlements` answers with the VERIFIED licence or
   * null — the roles are offered once, the first time a licence is known.
   */
  readonly standardRoles?: { readonly resolveEntitlements: () => Entitlements | null };
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
  /**
   * Runs the shared scheduled jobs (`scheduled-jobs.ts`) — today the leave
   * accrual catch-up. Defaults to on for a file-backed database and off for
   * `:memory:`, so dev, e2e and unit-test backends never write on a timer.
   */
  readonly scheduledJobs?: boolean;
  /** What the host knows about its own backups; the backend cannot see them from inside the database. Absent, the owner digest says backup status is not reported. */
  readonly backupStatus?: () => Promise<OwnerDigestBackupReading | null>;
  // The cloud edition: the tenant's own schema on Postgres. Exclusive with dbPath, connection and tenantBinding — the schema is the binding, and the caller owns the pool.
  readonly db?: SqlDb;
  // SECURITY: the audit chain head's MAC key on `db`. Absent, MEZAN_AUDIT_CHAIN_KEY; with neither the backend refuses to start.
  readonly auditChainKey?: string;
  readonly evidenceKey?: string;
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

const REVERSAL_PERMISSIONS_GRANT = "reversal_permissions";
const ATTACHMENT_PERMISSIONS_GRANT = "attachment_permissions";
const VOUCHER_REVERSAL_PERMISSION_GRANT = "voucher_reversal_permission";

enum BackendPass {
  Upgrade = "upgrade",
  Serve = "serve",
}

export async function createBackend(options: CreateBackendOptions = {}): Promise<BackendHandle> {
  if (options.seedAdminPassword !== undefined && options.seedDemoData !== true) {
    throw new Error("createBackend: seedAdminPassword is only accepted together with seedDemoData: true");
  }
  if (options.db) {
    if (options.dbPath !== undefined || options.connection !== undefined || options.tenantBinding !== undefined) {
      throw new Error("createBackend: db is exclusive with dbPath, connection and tenantBinding");
    }
    return composeBackend(options, options.db, undefined, BackendPass.Serve);
  }
  const { sqlite } = openSqliteConnection(options.dbPath ?? ":memory:", options.connection);
  const db = sqliteDb(sqlite);
  try {
    // REQUIRED ORDERING: before the upgrade transaction — SQLite ignores this pragma inside one, and every store's own copy of it would then be a no-op.
    sqlite.pragma("foreign_keys = ON");
    // REQUIRED ORDERING: the binding is the first write to the file. A database bound to another tenant is refused before this build writes anything to it, and a binding written ahead of a failed upgrade is rolled back with it.
    const bindToTenant = (): void => {
      if (options.tenantBinding !== undefined) bindTenantDatabase(sqlite, options.tenantBinding);
    };
    const fileVersion = readSchemaVersion(sqlite);
    const upgrading = fileVersion < CURRENT_SCHEMA_VERSION && holdsExistingBooks(sqlite);
    if (!upgrading) bindToTenant();
    if (upgrading) {
      try {
        // INVARIANT: an older file is brought to this build's shape in ONE transaction whose last write is the version stamp, so a failure at any step leaves the file exactly as the previous build wrote it (upgrade-matrix.test.ts). The pass is thrown away: everything it composed believes it is inside this transaction.
        await withSqliteTransaction(
          sqlite,
          async () => {
            bindToTenant();
            (await composeBackend(options, db, sqlite, BackendPass.Upgrade)).close();
            stampSchemaVersion(sqlite);
          },
          "BEGIN IMMEDIATE",
        );
      } catch (cause) {
        if (cause instanceof TenantBindingMismatchError) throw cause;
        throw new SchemaUpgradeFailedError(fileVersion, CURRENT_SCHEMA_VERSION, cause);
      }
    }
    const handle = await composeBackend(options, db, sqlite, BackendPass.Serve);
    if (readSchemaVersion(sqlite) < CURRENT_SCHEMA_VERSION) stampSchemaVersion(sqlite);
    return handle;
  } catch (err) {
    sqlite.close();
    throw err;
  }
}

async function composeBackend(options: CreateBackendOptions, db: SqlDb, sqlite: ReturnType<typeof openSqliteConnection>["sqlite"] | undefined, pass: BackendPass): Promise<BackendHandle> {
  const dbPath = options.dbPath ?? ":memory:";
  const seedWhenEmpty = options.seedWhenEmpty !== false;
  const store = <T>(viaSqlite: (s: NonNullable<typeof sqlite>) => T, viaDb: (d: SqlDb) => T): T => (sqlite ? viaSqlite(sqlite) : viaDb(db));
  if (!sqlite) await ensureTenantSchema(db);

  /*
   * DEC-17 removed the API-key and webhook back end. Their stores are gone, so
   * a new database never creates these tables — but an existing one still
   * carries them, holding hashed keys and signing secrets for a surface that no
   * longer exists. Dropping them here is the only migration step this repo has:
   * every store builds its own schema on open, so there is no central runner to
   * put it in. Safe to remove once no deployed database predates this commit.
   */
  if (sqlite) {
    for (const table of ["webhook_delivery", "webhook", "api_key"]) {
      sqlite.exec(`DROP TABLE IF EXISTS ${table}`);
    }
  }

  const sequenceConfig = store((s) => createSqliteSequenceConfigStore(s), (d) => createSequenceConfigStore(d));
  const sequenceCounters = store((s) => createSqliteSequenceStore(s), (d) => createSequenceStore(d));
  // The ONE audit sink for the whole backend. Without it the `audit_event`
  // table is never written and `/audit` reports an empty log.
  // The chain head is MAC'd under a key derived from the DATABASE key, which
  // lives in the OS keychain and not in the file an attacker is holding. With
  // no encryption key (dev, apps/server) it falls back to a per-install 0600
  // file beside the database — see audit-sink.ts's resolveChainKey.
  const auditSink: AuditSinkHandle = sqlite
    ? createSqliteAuditSink(sqlite, {
        ...(options.connection?.key ? { chainKey: deriveAuditChainKey(options.connection.key) } : {}),
      })
    : createAuditSink(db, { ...(options.auditChainKey !== undefined ? { chainKey: options.auditChainKey } : {}) });
  auditSink.unrecorded = securityFallbackFor(dbPath);
  const barcodeConfig = store((s) => createSqliteBarcodeConfigStore(s), (d) => createBarcodeConfigStore(d));
  const userPreferences = store((s) => createSqliteUserPreferencesStore(s), (d) => createUserPreferencesStore(d));
  const ownerPinFence = store((s) => createSqliteOwnerPinFence(s), (d) => createOwnerPinFence(d));
  const credentialResets = store((s) => createSqliteCredentialResetMarks(s), (d) => createCredentialResetMarks(d));
  const passwordResetTokens = store((s) => createSqlitePasswordResetTokens(s), (d) => createPasswordResetTokens(d));
  const dataMigrationTransactor: DataMigrationTransactor = { run: (fn) => db.transaction(fn) };
  // The boundary a route-level config write shares with its audit row (D298).
  // Same shared connection the audit sink writes on, so the append nests as a
  // SAVEPOINT rather than opening a second transaction.
  const configTransactor: ConfigTransactor = { run: (fn) => db.transaction(fn) };
  const labelLayouts = store((s) => createSqliteLabelLayoutStore(s), (d) => createLabelLayoutStore(d));

  const uow = store((s) => createSqliteUnitOfWork(s), (d) => createUnitOfWork(d));
  await grantSuccessorPermissionsOnce(db, REVERSAL_PERMISSIONS_GRANT, reversalPermissionSuccessors());
  // INVARIANT: a marker of its own — books that already hold the marker above were upgraded before the voucher route joined the registry and would never be given its permission.
  await grantSuccessorPermissionsOnce(db, VOUCHER_REVERSAL_PERMISSION_GRANT, reversalPermissionSuccessors([ReversalDocumentType.Voucher]));
  await grantSuccessorPermissionsOnce(db, ATTACHMENT_PERMISSIONS_GRANT, attachmentPermissionSuccessors());
  const settings: SettingsRepository = sqlite ? createSqliteSettingsStore(sqlite, options.secrets) : await createSettingsStore(db, options.secrets);
  const vatFilings = store((s) => createSqliteVatFilingStore(s), (d) => createVatFilingStore(d));
  const simplifiedRegime = store((s) => createSqliteSimplifiedRegimeStore(s), (d) => createSimplifiedRegimeStore(d));
  const branches = store((s) => createSqliteBranchStore(s), (d) => createBranchStore(d));
  const warehouses = store((s) => createSqliteWarehouseStore(s), (d) => createWarehouseStore(d));
  const accounts = store((s) => createSqliteAccountRepository(s), (d) => createAccountRepository(d));
  const customers = store((s) => createSqliteCustomerRepository(s), (d) => createCustomerRepository(d));
  const suppliers = store((s) => createSqliteSupplierRepository(s), (d) => createSupplierRepository(d));
  const items = store((s) => createSqliteItemStore(s), (d) => createItemStore(d));
  const salesItemTax: SalesItemTaxSource = async (itemId) => {
    const item = await items.findById(itemId);
    return item ? { taxRatePercent: item.taxRatePercent } : null;
  };
  const salesInvoiceTaxRerating = salesTaxRerating(customerTaxProfileFrom(customers), salesItemTax);
  const itemCatalog = store((s) => createSqliteItemCatalogStores(s), (d) => createItemCatalogStores(d));
  const accountRouting = store((s) => createSqliteAccountRoutingStore(s), (d) => createAccountRoutingStore(d));
  const taxGroups = store((s) => createSqliteTaxGroupStore(s), (d) => createTaxGroupStore(d));
  const itemSpecifications = store((s) => createSqliteItemSpecificationRepository(s), (d) => createItemSpecificationRepository(d));
  const attachments = store((s) => createSqliteAttachmentRepository(s), (d) => createAttachmentRepository(d));
  const taxRates = store((s) => createSqliteTaxRateRepository(s), (d) => createTaxRateRepository(d));
  // SECURITY: a served company's database that holds no books is left with no
  // row added, the system tax rate included: see `seedWhenEmpty`.
  if (options.seedWhenEmpty !== false || !(await isEmptyTenant({ accounts }))) await ensureSystemTaxRates(taxRates);
  const costCenters = store((s) => createSqliteCostCenterRepository(s), (d) => createCostCenterRepository(d));
  const masterDataChecks: MasterDataChecks = {
    [MasterDataKind.Customer]: customers,
    [MasterDataKind.Supplier]: suppliers,
    [MasterDataKind.Warehouse]: warehouses,
    [MasterDataKind.Branch]: branches,
    [MasterDataKind.CostCenter]: costCenters,
  };
  const treasuryAccounts = store((s) => createSqliteTreasuryAccountRepository(s), (d) => createTreasuryAccountRepository(d));
  const fiscalPeriods = store((s) => createSqliteFiscalPeriodRepository(s), (d) => createFiscalPeriodRepository(d));
  const periodCloseGuard = createPeriodCloseGuardSlot();
  const fxRevaluationRuns = store((s) => createSqlitePeriodCloseStore(s), (d) => createPeriodCloseStore(d)).fxRuns;
  const ledger = store((s) => createSqliteLedgerStore(s, sequenceConfig), (d) => createLedgerStore(d, sequenceConfig));
  const priceLists = store((s) => createSqlitePriceListStore(s), (d) => createPriceListStore(d));
  const promotions = store((s) => createSqlitePromotionStore(s), (d) => createPromotionStore(d));
  const salesQuotes = store((s) => createSqliteSalesQuoteStore(s), (d) => createSalesQuoteStore(d));
  const exchangeRates = store((s) => createSqliteExchangeRateRepository(s), (d) => createExchangeRateRepository(d));
  const etaStore = store((s) => createSqliteEtaStore(s, options.secrets), (d) => createEtaStore(d, options.secrets));
  /**
   * The real ETA leg (P-1). Offline-safe by construction: the transmit port
   * refuses with `EtaOfflineError` until a client id AND a stored secret exist,
   * so an unconfigured install never opens a socket. The signer shells out to
   * the operator's own program because a CAdES-BES signature is made on the
   * taxpayer's hardware token and cannot be produced in-process.
   */
  // EVERY PORT THAT LEAVES THE PROCESS HANDS THE CONNECTION BACK FIRST. A request
  // holds the tenant's turn for its database work only (audit-boundary.ts): the
  // hash, the signing program, the authority's socket and the mail server are
  // awaited with the turn released, and the request takes it again to record
  // what they answered.
  const outsideTheTurn = <T>(work: () => Promise<T>): Promise<T> => (auditSink.outsideTurn ? auditSink.outsideTurn(work) : work());
  // WORK NO REQUEST IS WAITING ON TAKES THE TURN FOR ITS DATABASE WORK TOO: a
  // timer, an event subscriber, a task a confirm leaves running. Started inside
  // a request it shares that request's turn, which is then kept until it is
  // done; started on its own it queues like any write. Either way it is never
  // writing while another holder has a BEGIN open, and its ports hand the turn
  // back around the outside world exactly as a request's do.
  const inTheTurn =
    (label: string) =>
    <T>(work: () => Promise<T>): Promise<T> =>
      auditSink.turn ? auditSink.turn(work, { onYield: () => reportTurnYield(`background ${label}`) }) : work();
  const etaHttp = options.etaHttpClient ?? fetchEtaHttpClient();
  const etaSigningRunner = options.etaSigningRunner ?? runExternalSigningCommand;
  const etaTransmit = createEtaHttpTransmitPort({
    http: (request) => outsideTheTurn(() => withinDeadline(OutsideWork.EtaHttp, () => etaHttp(request))),
    sleep: (ms) => outsideTheTurn(() => new Promise<void>((resolve) => setTimeout(resolve, ms))),
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
    run: (command, args, stdin) => outsideTheTurn(() => withinDeadline(OutsideWork.EtaSigning, () => etaSigningRunner(command, args, stdin))),
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
  const scrypt = createScryptHasher();
  const secrets = createPrecomputingHasher({
    hash: (secret) => outsideTheTurn(() => scrypt.hash(secret)),
    verify: (secret, hash) => outsideTheTurn(() => scrypt.verify(secret, hash)),
  });
  const hasher = secrets.hasher;

  // --- phase9/operational-reports — read-only repositories the /reports routes aggregate over,
  // shared with phase5/full-sales's sales-invoice GL/stock hooks below (same tables, one connection each). ---
  const salesInvoices = store((s) => createSqliteSalesInvoiceStore(s), (d) => createSalesInvoiceStore(d));
  const purchaseInvoices = store((s) => createSqlitePurchaseInvoiceStore(s), (d) => createPurchaseInvoiceStore(d));
  const stockLedger = store((s) => createSqliteStockLedgerStore(s), (d) => createStockLedgerStore(d));
  const installmentPlans = store((s) => createStandaloneSqliteInstallmentPlanStore(s), (d) => createInstallmentPlanStore(d));

  // --- sweep/real-data-screens — the purchase chain's order/receipt stores and the
  // treasury-voucher store; `purchaseInvoices` above is shared with the /reports wiring
  // so both routes see the same confirmed invoices. ---
  const purchaseOrders = store((s) => createSqlitePurchaseOrderStore(s), (d) => createPurchaseOrderStore(d));
  const goodsReceipts = store((s) => createSqliteGoodsReceiptStore(s), (d) => createGoodsReceiptStore(d));
  const vouchers = store((s) => createSqliteVoucherStore(s), (d) => createVoucherStore(d));

  // --- phase7/treasury-completion — سجل الشيكات + تسوية كشوف البنك. The reconciliation
  // ledger reader resolves a treasury account's GL account and reads its posted movements,
  // so statement lines only ever link to entries the voucher/cheque engines already posted. ---
  const cheques = store((s) => createSqliteChequeRepository(s), (d) => createChequeRepository(d));
  const invoiceSettlement = {
    applySettled: async ({ invoiceId, kind, settled }: { invoiceId: string; kind: string; settled: Money }) => {
      if (kind !== "sales") return;
      await applyAllocatedSettlement(salesInvoices, invoiceId, settled);
    },
  };
  const bankStatements = store((s) => createSqliteBankReconciliationStore(s), (d) => createBankReconciliationStore(d));

  // --- phase11/crm-projects-assets-field — CRM, Projects, Fixed Assets, Field/Van Sales. ---
  const leads = store((s) => createSqliteLeadRepository(s), (d) => createLeadRepository(d));
  const opportunities = store((s) => createSqliteOpportunityRepository(s), (d) => createOpportunityRepository(d));
  const pipelineStages = store((s) => createSqlitePipelineStageRepository(s), (d) => createPipelineStageRepository(d));
  const activities = store((s) => createSqliteActivityRepository(s), (d) => createActivityRepository(d));
  const projects = store((s) => createSqliteProjectRepository(s), (d) => createProjectRepository(d));
  const worksContracts = store((s) => createSqliteWorksContractStore(s), (d) => createWorksContractStore(d));
  const contractingSiteStore = store((s) => createSqliteContractingSiteStore(s), (d) => createContractingSiteStore(d));
  const guarantees = store((s) => createSqliteGuaranteeStore(s), (d) => createGuaranteeStore(d));
  const progressCertificates = store((s) => createSqliteProgressCertificateStore(s), (d) => createProgressCertificateStore(d));
  const subcontracts = store((s) => createSqliteSubcontractStore(s), (d) => createSubcontractStore(d));
  const recognitionRuns = store((s) => createSqliteContractingRecognitionStore(s), (d) => createContractingRecognitionStore(d));
  const retentionReleases = store((s) => createSqliteContractingControlsStore(s), (d) => createContractingControlsStore(d));
  const assetCategories = store((s) => createSqliteAssetCategoryRepository(s), (d) => createAssetCategoryRepository(d));
  const assets = store((s) => createSqliteAssetRepository(s), (d) => createAssetRepository(d));
  const assetRateHistory = store((s) => createSqliteAssetInternalRateHistoryRepository(s), (d) => createAssetInternalRateHistoryRepository(d));
  const depreciationRuns = store((s) => createSqliteDepreciationRunRepository(s), (d) => createDepreciationRunRepository(d));
  const vanTrips = store((s) => createSqliteVanTripRepository(s), (d) => createVanTripRepository(d));

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
  const writedownRuns = store((s) => createSqliteWritedownRunRepository(s), (d) => createWritedownRunRepository(d));

  // --- inv/labels-templates-writedown — Product Templates (attribute CRUD + variant generator). ---
  const productTemplateStore = store((s) => createSqliteProductTemplateStore(s), (d) => createProductTemplateStore(d));

  // --- sweep/finish-and-mount — manufacturing (docs/archive/catalog/07: BOMs, work
  // orders, configurable products, custom manufacturing) and RFQ + historical
  // purchase import (docs/archive/catalog/02). ---
  const manufacturing = store((s) => createSqliteManufacturingStores(s), (d) => createManufacturingStores(d));
  const rfqStores = store((s) => createSqliteRfqStores(s), (d) => createRfqStores(d));
  const historicalImportArchives = store((s) => createSqliteHistoricalPurchaseArchiveStore(s), (d) => createHistoricalPurchaseArchiveStore(d));
  const salesHistoricalImportArchives = store((s) => createSqliteHistoricalSalesArchiveStore(s), (d) => createHistoricalSalesArchiveStore(d));

  // --- w8/print-migration — Print Template designer config (docs/archive/catalog/09
  // §"قوالب الطباعة"). The Data Migration wizard's department/employee steps
  // reuse hr/master-data's own `hrDepartments`/`hrEmployees` stores below. ---
  const printTemplateConfig = store((s) => createSqlitePrintTemplateConfigStore(s), (d) => createPrintTemplateConfigStore(d));

  // --- sweep/finish-and-mount — مرتجعات المبيعات/المشتريات, التكاليف
  // الإضافية, خطط الأقساط + متابعة التحصيل (docs/archive/catalog/01, 02, 05). ---
  const salesReturnStore = store((s) => createStandaloneSqliteSalesReturnStore(s), (d) => createSalesReturnStore(d));
  const purchaseReturnStore = store((s) => createStandaloneSqlitePurchaseReturnStore(s), (d) => createPurchaseReturnStore(d));
  const landedCostStore = store((s) => createStandaloneSqliteLandedCostStore(s), (d) => createLandedCostStore(d));
  const followUps = store((s) => createStandaloneSqliteFollowUpStore(s), (d) => createFollowUpStore(d));
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
  // Counts document layer (docs/archive/catalog/03), on the SAME shared database
  // every other store here uses. ---
  const inventoryOps = store((s) => createSqliteInventoryOpsStore(s), (d) => createInventoryOpsStore(d));

  // --- hr/master-data — departments, job titles, employees, contracts, holidays, leave requests (docs/archive/catalog/06 §"الموارد البشرية"). ---
  const hrDepartments = store((s) => createSqliteDepartmentRepository(s), (d) => createDepartmentRepository(d));
  const hrJobTitles = store((s) => createSqliteJobTitleRepository(s), (d) => createJobTitleRepository(d));
  const hrEmployees = store((s) => createSqliteEmployeeRepository(s), (d) => createEmployeeRepository(d));
  const hrContracts = store((s) => createSqliteContractRepository(s), (d) => createContractRepository(d));
  const hrHolidays = store((s) => createSqliteHolidayRepository(s), (d) => createHolidayRepository(d));
  const hrLeaveRequests = store((s) => createSqliteLeaveRequestRepository(s), (d) => createLeaveRequestRepository(d));
  const hrAttendance = store((s) => createSqliteAttendanceRepository(s), (d) => createAttendanceRepository(d));
  const hrLeavePolicies = store((s) => createSqliteLeavePolicyRepository(s), (d) => createLeavePolicyRepository(d));
  const hrLeaveBalances = store((s) => createSqliteLeaveBalanceRepository(s), (d) => createLeaveBalanceRepository(d));
  const hrLeaveAccrualBatches = store((s) => createSqliteLeaveAccrualBatchRepository(s), (d) => createLeaveAccrualBatchRepository(d));
  const hrAdvances = store((s) => createSqliteEmployeeAdvanceRepository(s), (d) => createEmployeeAdvanceRepository(d));
  const advanceVoucherUnwind: VoucherAdvanceUnwindPort = {
    onVoucherReversed: async (voucherId) =>
      (await unwindAdvanceVoucher(voucherId, { advances: hrAdvances })) || (await unwindPayrollDisbursementVoucher(voucherId, { runs: hrPayrollRuns })),
  };
  const hrClockCredentials = store((s) => createSqliteClockCredentialRepository(s), (d) => createClockCredentialRepository(d));
  const hrChallenges = store((s) => createSqliteWebauthnChallengeRepository(s), (d) => createWebauthnChallengeRepository(d));
  const hrLeases = store((s) => createSqliteLeaseStore(s), (d) => createLeaseStore(d));
  const hrPayrollRuns = store((s) => createSqlitePayrollRunRepository(s), (d) => createPayrollRunRepository(d));
  const hrPayslips = store((s) => createSqlitePayslipRepository(s), (d) => createPayslipRepository(d));
  const hrPayrollComponents = store((s) => createSqlitePayrollComponentRepository(s), (d) => createPayrollComponentRepository(d));
  const hrGarnishments = store((s) => createSqliteGarnishmentRepository(s), (d) => createGarnishmentRepository(d));
  const hrStatutoryOverrides = store((s) => createSqliteStatutoryOverrideRepository(s), (d) => createStatutoryOverrideRepository(d));
  const hrStatutoryFlag = store((s) => createSqlitePayrollStatutoryFlagRepository(s), (d) => createPayrollStatutoryFlagRepository(d));

  // --- w8/notifications — قواعد الإشعارات rules engine. ONE EventBus for the
  // whole backend; the engine subscribes to every event and (per rule) writes
  // real, persisted in-app notifications. Document-confirm flows publish onto
  // it via `createDocumentEventBridge` below (see that function's docstring
  // for why a translation step is needed at all). ---
  const notificationRules = store((s) => createSqliteNotificationRuleStore(s), (d) => createNotificationRuleStore(d));
  const notifications = store((s) => createSqliteNotificationStore(s), (d) => createNotificationStore(d));
  const customerMail = store((s) => createSqliteCollectionsStore(s), (d) => createCollectionsStore(d));
  await removeNotificationLinesMatching(db, ACCOUNT_LOCKED_NOTICE, STORED_UNLOCK_SECRET);
  const eventBus = new EventBus({
    onError: (error, event) => {
      backendLog.error({ area: "notifications", err: error }, `a subscriber failed handling "${event.code}"`);
    },
  });
  // The directory reads tables that stores mounted further down create, so it
  // is built once they all exist — and BEFORE the first request, so a
  // statement that cannot be prepared stops the boot instead of a refusal.
  let branchDirectory: BranchDirectory | undefined;
  const startedDirectory = (): BranchDirectory => {
    if (!branchDirectory) throw new Error("createBackend: the branch directory was read before the backend finished starting");
    return branchDirectory;
  };
  const deferredBranchDirectory: BranchDirectory = {
    branchesOf: (kind, id, access) => startedDirectory().branchesOf(kind, id, access),
    warehousesOf: (kind, id) => startedDirectory().warehousesOf(kind, id),
    actingWarehousesOf: (kind, id) => startedDirectory().actingWarehousesOf(kind, id),
  };
  const notificationEngine = new NotificationRulesEngine({
    rules: notificationRules,
    notifications,
    users: uow.users,
    roles: uow.roles,
    generateId: () => randomUUID(),
  });
  const notifyInTheTurn = inTheTurn("notification rules");
  eventBus.subscribeAll((event) => {
    db.afterCommit(() => {
      void notifyInTheTurn(() => notificationEngine.handle(event)).catch((error: unknown) => {
        backendLog.error({ area: "notifications", err: error }, `engine failed handling "${event.code}"`);
      });
    });
  });

  // DEC-17 / DEC-27: the webhook dispatcher subscribes to this bus only in the
  // cloud edition's integrations area (enh/e3-09.ts), mounted when the host
  // passes `integrations`. The desktop never does.
  // --- w8/workflow-ui — إعدادات الموافقات chain-builder + الموافقات inbox
  // (docs/archive/catalog/09 §سير العمل). `workflowConfigs` is also the REAL
  // `resolveConfig` behind `createDocumentWorkflowGate` below — a tenant that
  // configures a chain for e.g. SALES_RETURN_CONFIRM has that document type
  // actually held بانتظار الموافقة on confirm, not just a config the /workflow
  // screen has no effect on. ---
  const workflowConfigs = store((s) => createSqliteWorkflowConfigStore(s), (d) => createWorkflowConfigStore(d));
  const approvalRequests = store((s) => createSqliteApprovalRequestStore(s), (d) => createApprovalRequestStore(d));

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
  const inventoryEventHandlers = new Set<(event: InventoryDomainEvent) => Promise<void>>();
  const stockService = new StockLedgerService({
    events: {
      publish: async (event) => {
        for (const handler of inventoryEventHandlers) {
          try {
            await stockLedger.transaction(() => handler(event));
          } catch (error) {
            backendLog.error({ area: "inventory", err: error }, "a stock-event subscriber failed");
          }
        }
      },
    },
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
    gl: createInventoryGlPostingHook(salesInvoiceGl, warehouses),
    transferCoverAccounts: { inventoryAccountId: STOCK_VARIANCE_ACCOUNTS.inventoryAccountId, costAccountId: STOCK_VARIANCE_ACCOUNTS.costVarianceAccountId },
    // The last-resort cost for an issue out of a position that holds nothing
    // and was never received anywhere. Without it such an issue was written at
    // zero and COGS was understated by the whole deficit (D101).
    fallbackUnitCost: async (itemId) => (await items.findById(itemId))?.costPrice ?? null,
    lotRequirement: lotRequirementFromItems(items),
    batchTrail: store((s) => createSqliteBatchTrailStore(s), (d) => createBatchTrailStore(d)),
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
    stockVariance: STOCK_VARIANCE_ACCOUNTS,
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
  const salesInvoiceEventBridge = createDocumentEventBridge(eventBus, (fn) => db.afterCommit(fn),
    deferredBranchDirectory,
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
    turn: inTheTurn("e-receipt submission"),
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
    turn: inTheTurn("e-invoice queueing"),
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
  const rebuildEtaInvoiceSubmission = createEtaInvoiceRequeueRebuilder({
    eta: etaService,
    items,
    taxRates,
    branchCodes: etaStore.branchCodes,
    unitMappings: etaStore.unitMappings,
    invoices: salesInvoices,
    customers,
  });

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
        gl: createSalesInvoiceGlHook(salesInvoiceGl, STOCK_VARIANCE_ACCOUNTS),
        stock: createSalesInvoiceStockHook(stockService),
        taxRates,
        taxRerating: salesInvoiceTaxRerating,
        allocatable: vouchers.invoices,
        audit: auditSink,
        // INVARIANT: the SAME publisher the /sales/invoices routes use. A
        // derived invoice confirmed without it is a live invoice the ETA queue
        // never hears about (D5) — the authority sees the tenant's certificate
        // billing simply missing.
        events: salesInvoiceEvents,
        taxPolicy: salesTaxPolicySource(settings),
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
        sourcePricing: SalesPricingMode.TaxExclusive,
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
        }, { mintedBySystem: true });
      }
      const written = await salesInvoices.writeFields({ ...invoice, status: "reversed" }, [SalesInvoiceField.Status], { status: [invoice.status] });
      if (!written) throw new DocumentChangedError("SALES_INVOICE", invoice.id);
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
        gl: createSalesInvoiceGlHook(salesInvoiceGl, STOCK_VARIANCE_ACCOUNTS),
        stock: createSalesInvoiceStockHook(stockService),
        taxRates,
        taxRerating: salesInvoiceTaxRerating,
        allocatable: vouchers.invoices,
        audit: auditSink,
        // INVARIANT: NOT `salesInvoiceEvents`. A retention release is a
        // receivable reclass (Dr AR / Cr retention), not a supply: it must
        // never reach the ETA queue or the e-receipt issuer.
        events: salesInvoiceEventBridge,
        taxPolicy: salesTaxPolicySource(settings),
        // The REAL actor, not "system": this invoice is a live receivable, and
        // its audit row named nobody.
        actor: cmd.actor ?? "system",
      });
      await service.createDraft({
        id: invoiceId,
        documentKind: InvoiceDocumentKind.RetentionRelease,
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
        sourcePricing: SalesPricingMode.TaxExclusive,
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
            taxRateId: null,
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
          id: `PI-JE:${posting.sourceDocId}${posting.entrySuffix ?? ""}`,
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
            taxRateId: l.taxRateId ?? null,
            projectId: l.projectId ?? null,
            costCategory: l.costCategory ?? null,
            branchId: l.branchId ?? null,
          })),
        },
        salesInvoiceGl,
        { mintedBySystem: true },
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
        { invoices: purchaseInvoices, numbering: ledger.numbering, taxRates },
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
          documentKind: InvoiceDocumentKind.RetentionRelease,
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
              taxRateId: null,
            },
          ],
        },
        { invoices: purchaseInvoices, numbering: ledger.numbering, taxRates },
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
      const rows = await contractingSiteStore.consumptions.list({ subcontractId, status: MaterialConsumptionStatus.Confirmed });
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


  const documentGl = createJournalGlHook(salesInvoiceGl, STOCK_VARIANCE_ACCOUNTS);
  const documentWorkflowGate = createDocumentWorkflowGate(
    (actionType) => workflowConfigs.resolve(actionType),
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
  const returnsEventBridge = createDocumentEventBridge(eventBus, (fn) => db.afterCommit(fn), deferredBranchDirectory, returnsEventMapping);

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
  const purchasesEventBridge = createDocumentEventBridge(eventBus, (fn) => db.afterCommit(fn), deferredBranchDirectory, purchasesEventMapping);

  /*
   * `VoucherService` has declared an `events` port since it was written and
   * nothing ever passed one, so `CASH_VOUCHER_CONFIRMED` was a sixth silent
   * code — catalogued, selectable in a notification rule, and unreachable.
   */
  const voucherEventMapping = {
    [VOUCHER_DOC_TYPE]: { DOCUMENT_CONFIRMED: "CASH_VOUCHER_CONFIRMED" },
  } satisfies DocumentEventMapping;
  const voucherEventBridge = createDocumentEventBridge(eventBus, (fn) => db.afterCommit(fn), deferredBranchDirectory, voucherEventMapping);

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
  const salesReturnTaxFiling = createSalesReturnTaxFiling({
    eta: etaService,
    taxRates,
    rebuildCreditNote: createEtaReturnCreditNoteRebuilder({
      eta: etaService,
      customers,
      items,
      taxRates,
      branchCodes: etaStore.branchCodes,
      unitMappings: etaStore.unitMappings,
    }),
  });
  const standingSalesReturnRefunds = async (returnId: string) => {
    const prefix = `REFUND:${returnId}:`;
    return (await vouchers.documents.list())
      .filter((doc) => doc.id.startsWith(prefix) && doc.status === DocumentStatusCode.Confirmed && doc.reversesDocId === null)
      .map((doc) => ({
        voucherId: doc.id,
        voucherNo: doc.docNo,
        date: doc.date,
        amount: doc.lines[0]?.amount ?? Money.zero(),
      }));
  };
  const etaVoid = createEtaVoidPort(etaService);
  const salesReturnVoid = createSalesReturnVoidGuards({ refundsOf: standingSalesReturnRefunds, eta: etaVoid });
  const customerNameOf = async (id: string | null | undefined) => (id ? ((await customers.findById(id))?.nameAr ?? null) : null);
  const supplierNameOf = async (id: string | null | undefined) => (id ? ((await suppliers.findById(id))?.nameAr ?? null) : null);
  const warehouseNameOf = async (id: string | null | undefined) => (id ? ((await warehouses.findById(id))?.name ?? null) : null);
  const salesInvoiceNoOf = async (line: { sourceInvoiceId: string; sourceInvoiceNumber: string | null } | undefined) =>
    line ? (line.sourceInvoiceNumber ?? (await salesInvoices.findById(line.sourceInvoiceId))?.docNo ?? null) : null;
  const purchaseInvoiceNoOf = async (line: { sourceInvoiceId: string; sourceInvoiceNumber: string | null } | undefined) =>
    line ? (line.sourceInvoiceNumber ?? (await purchaseInvoices.findById(line.sourceInvoiceId))?.number ?? null) : null;
  const voucherPartyNameOf = async (line: VoucherLine) => (await customerNameOf(line.customerId)) ?? (await supplierNameOf(line.supplierId));
  const salesReturns = new DocumentService(createSalesReturnDocumentType(SALES_RETURN_GL_ACCOUNTS), {
    repo: salesReturnStore,
    approvalLabel: async (doc) => approvalLabel({ type: "مرتجع مبيعات", reference: await salesInvoiceNoOf(doc.lines[0]), amount: salesReturnGrandTotal(doc), party: await customerNameOf(doc.lines[0]?.customerId) }),
    numbering: { next: (opts) => ledger.numbering.next("SALES_RETURN", { branchId: opts?.branchId }) },
    gl: returnReliefGl("sales", salesReturnStore, salesReturnLineCredit),
    stock: createInventoryStockHook(stockService),
    workflow: documentWorkflowGate,
    events: salesReturnEvents,
    confirmGuard: createReturnConfirmGuard(SALES_RETURN_DOC_TYPE, (id) => salesReturnInvoices.findConfirmedInvoice(id)),
    reverseGuard: salesReturnVoid.guard,
    afterReverse: salesReturnVoid.withdraw,
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
    approvalLabel: async (doc) => approvalLabel({ type: "مرتجع مشتريات", reference: await purchaseInvoiceNoOf(doc.lines[0]), amount: purchaseReturnGrandTotal(doc), party: await supplierNameOf(doc.lines[0]?.supplierId) }),
    numbering: { next: (opts) => ledger.numbering.next("PURCHASE_RETURN", { branchId: opts?.branchId }) },
    gl: returnReliefGl("purchase", purchaseReturnStore, purchaseReturnLineCredit),
    stock: createInventoryStockHook(stockService),
    workflow: documentWorkflowGate,
    events: returnsEventBridge,
    confirmGuard: createReturnConfirmGuard(PURCHASE_RETURN_DOC_TYPE, (id) => purchaseReturnInvoices.findConfirmedInvoice(id)),
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
  /**
   * Derives the returnable quantity from the invoice minus what confirmed
   * returns have already taken. Before this the server validated against a
   * figure the CLIENT supplied, so the same goods could be returned
   * repeatedly by claiming the full invoiced quantity each time.
   */
  const salesReturnInvoices: SalesInvoiceLookupPort = {
    async findConfirmedInvoice(id: string) {
      const invoice = await salesInvoices.findById(id);
      if (!invoice || !SALES_INVOICE_ACTIVE_STATUSES.has(invoice.status)) return null;
      const priorReturns = await salesReturns.list();
      const returned = priorReturns
        .filter((doc) => doc.status === "confirmed" && !doc.reversesDocId)
        .flatMap((doc) => doc.lines.filter((line) => line.sourceInvoiceId === id));
      const alreadyReturned = returnedQtyBySourceLine(
        invoice.lines.map((l) => ({ sourceLineId: l.lineId, itemId: l.itemId, qty: l.baseQty })),
        returned,
      );
      // The tax the line was ACTUALLY charged — after line, promotion and
      // header discounts, and zero when the customer is tax-exempt. Handing
      // the return a zero here credited no VAT at all and left it no rate
      // to group the posting by (D76).
      const chargedTax = new Map<string, { tax: Money; rate: number; taxRateId: string | null }>();
      const invoiceTotals = salesInvoiceTotals(invoice);
      for (const [i, line] of invoice.lines.entries()) {
        chargedTax.set(line.lineId, {
          tax: invoiceTotals.lines[i]?.tax ?? Money.zero(),
          rate: line.taxRatePercent,
          taxRateId: line.taxRateId,
        });
      }
      return {
        id: invoice.id,
        number: invoice.docNo ?? invoice.id,
        salespersonId: invoice.salespersonId,
        customerId: invoice.customerId,
        warehouseId: invoice.warehouseId,
        branchId: invoice.branchId,
        projectId: invoice.projectId,
        currency: invoice.currency,
        fxRate: invoice.fxRate ?? null,
        date: invoice.date,
        status: "confirmed" as const,
        // A return is quoted in BASE units, because that is what it puts
        // back into the stock ledger. A line sold as 5 cartons of 12 is
        // returnable as up to 60 pieces at the per-piece price, so the
        // credit still reconciles to the line and the ledger to the count.
        lines: invoice.lines.map((l, lineIndex) => ({
          sourceLineId: l.lineId,
          itemId: l.itemId,
          itemName: l.itemNameAr,
          qty: l.baseQty,
          alreadyReturnedQty: alreadyReturned[lineIndex] ?? Qty.zero(),
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
          taxRateId: chargedTax.get(l.lineId)?.taxRateId ?? null,
        })),
      };
    },
  };
  const purchaseReturnInvoices: PurchaseInvoiceLookupPort = {
    async findConfirmedInvoice(id: string) {
      const invoice = await purchaseInvoices.findById(id);
      if (!invoice || invoice.status !== "confirmed") return null;
      const priorReturns = await purchaseReturns.list();
      const returned = priorReturns
        .filter((doc) => doc.status === "confirmed" && !doc.reversesDocId)
        .flatMap((doc) => doc.lines.filter((line) => line.sourceInvoiceId === id));
      const returnable = invoice.lines
        .map((l, index) => ({ ...l, sourceLineId: String(index) }))
        .flatMap((l) => (l.itemId === null ? [] : [{ ...l, itemId: l.itemId }]));
      const alreadyReturned = returnedQtyBySourceLine(returnable, returned);
      return {
        id: invoice.id,
        number: invoice.number ?? invoice.id,
        createdBy: invoice.createdBy,
        supplierId: invoice.supplierId,
        warehouseId: invoice.warehouseId,
        branchId: invoice.branchId,
        // A return inherits the invoice's project and each line's cost
        // category (D-01); leaving them off here dropped both (D215).
        projectId: invoice.projectId ?? null,
        currency: invoice.currency,
        fxRate: invoice.fxRate ?? null,
        date: invoice.date,
        status: "confirmed" as const,
        lines: returnable.map((l, lineIndex) => ({
            sourceLineId: l.sourceLineId,
            itemId: l.itemId,
            itemName: l.description ?? l.itemId,
            qty: l.qty,
            alreadyReturnedQty: alreadyReturned[lineIndex] ?? Qty.zero(),
            unitCost: l.unitCost,
            // The input VAT the line actually carried, and the rate that
            // produced it — a return with neither credits no VAT back and
            // gives the VAT return nothing to group by (D76).
            taxAmount: purchaseInvoiceLineTax(l),
            taxRatePercent: l.taxRatePercent,
            taxRateId: l.taxRateId ?? null,
            costCategory: l.costCategory ?? null,
          })),
      };
    },
  };
  const landedCostGlAccounts = { ...LANDED_COST_GL_ACCOUNTS };
  const landedCostDocuments = new DocumentService(createLandedCostDocumentType(landedCostGlAccounts), {
    repo: landedCostStore,
    approvalLabel: async (doc) => {
      const costItems = doc.lines[0]?.costItems ?? [];
      const supplierId = costItems.find((item) => item.supplierId)?.supplierId;
      return approvalLabel({ type: "تكلفة إضافية", amount: Money.sum(costItems.map((item) => item.amount)), party: (await supplierNameOf(supplierId)) ?? (await warehouseNameOf(doc.lines[0]?.warehouseId)) });
    },
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
  const postLandedCostSideEntry = async (posting: LandedCostGlPosting, debitAccountId: string, creditAccountId: string): Promise<void> => {
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
          { accountId: debitAccountId, debit: posting.amount, credit: Money.zero(), branchId: posting.branchId },
          { accountId: creditAccountId, debit: Money.zero(), credit: posting.amount, branchId: posting.branchId },
        ],
      },
      salesInvoiceGl,
      { mintedBySystem: true },
    );
  };
  const landedCosts = new LandedCostService(landedCostDocuments, stockService, {
    postUnabsorbed: (posting) => postLandedCostSideEntry(posting, LANDED_COST_GL_ACCOUNTS.unabsorbedCostAccountId, LANDED_COST_GL_ACCOUNTS.inventoryAccountId),
    postAbsorbed: (posting) => postLandedCostSideEntry(posting, LANDED_COST_GL_ACCOUNTS.inventoryAccountId, LANDED_COST_GL_ACCOUNTS.unabsorbedCostAccountId),
    postAbsorbedFromClearing: (posting) => postLandedCostSideEntry(posting, landedCostGlAccounts.inventoryAccountId, landedCostGlAccounts.clearingAccountId),
    postIssuedFromClearing: async (posting) => {
      if (landedCostGlAccounts.clearingAccountId === landedCostGlAccounts.unabsorbedCostAccountId) return;
      await postLandedCostSideEntry(posting, landedCostGlAccounts.unabsorbedCostAccountId, landedCostGlAccounts.clearingAccountId);
    },
    reverseSideEntry: async (entryId, opts) => {
      const entry = await ledger.findById(entryId);
      if (!entry || entry.status !== "posted") return null;
      await reverseJournalEntry(entryId, salesInvoiceGl, { reversalId: opts.reversalId, date: opts.date }, { mintedBySystem: true });
      return Money.sum(entry.lines.map((line) => line.debit));
    },
  }, {
    transaction: (fn) => ledger.transaction(fn),
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
    // SECURITY: the inbox label is read without inventory.cost.view, so it never carries the adjustment's value at item cost (#119).
    approvalLabel: async (doc) => approvalLabel({ type: "تسوية مخزون", party: await warehouseNameOf(doc.lines[0]?.warehouseId) }),
    numbering: { next: (opts) => ledger.numbering.next("STOCK_ADJUSTMENT", { branchId: opts?.branchId }) },
    stock: inventoryOpsStockHook,
    workflow: documentWorkflowGate,
    audit: auditSink,
    auditModule: "inventory",
  });
  const stockTransfers = new DocumentService<StockTransferDocLine>(stockTransferDocumentType, {
    repo: inventoryOps.stockTransfers,
    approvalLabel: async (doc) => {
      const line = doc.lines[0];
      const from = (await warehouseNameOf(line?.fromWarehouseId)) ?? line?.fromWarehouseId ?? "";
      const to = (await warehouseNameOf(line?.toWarehouseId)) ?? line?.toWarehouseId ?? "";
      return `تحويل مخزون من ${from} إلى ${to}`;
    },
    numbering: { next: (opts) => ledger.numbering.next("STOCK_TRANSFER", { branchId: opts?.branchId }) },
    stock: inventoryOpsStockHook,
    workflow: documentWorkflowGate,
    audit: auditSink,
    auditModule: "inventory",
  });
  const physicalCounts = new PhysicalCountService({
    repo: inventoryOps.physicalCounts,
    stockLedger: stockService,
    adjustments: stockAdjustments,
    numbering: { next: () => ledger.numbering.next("PHYSICAL_COUNT") },
    completionGate: countModeCompletionGate(db),
  });
  registerCountModeCounts(db, physicalCounts);

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

    const salesReturned = await invoiceReturnCredits.returnedByIds(activeInvoices.map((inv) => inv.id), "sales");
    const purchaseReturned = await invoiceReturnCredits.returnedByIds(confirmedPurchases.map((inv) => inv.id), "purchase");
    const restatement = async (invoiceId: string, fxRate: string | null | undefined) => (fxRate ? { revaluationShare: await standingRevaluationShare(invoiceItem(invoiceId)) } : {});

    for (const inv of activeInvoices) {
      const allocated = allocatedById.get(inv.id) ?? Money.zero();
      out.push({
        returnedBase: salesReturned.get(inv.id) ?? Money.zero(),
        ...(await restatement(inv.id, inv.fxRate)),
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
        returnedBase: purchaseReturned.get(inv.id) ?? Money.zero(),
        ...(await restatement(inv.id, inv.fxRate)),
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
      }, { mintedBySystem: true });
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
      { mintedBySystem: true },
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

  async function foreignTreasuryCurrencies(): Promise<ReadonlyMap<string, string>> {
    const base = ((await settings.get()) ?? createDefaultSettings()).currency;
    const byGlAccount = new Map<string, string>();
    for (const account of await treasuryAccounts.list()) {
      if (account.glAccountId && account.currency && account.currency !== base) byGlAccount.set(account.glAccountId, account.currency);
    }
    return byGlAccount;
  }

  async function foreignTreasuryBalances(asOfDate?: string): Promise<ForeignTreasuryBalance[]> {
    const byGlAccount = await foreignTreasuryCurrencies();
    if (byGlAccount.size === 0) return [];
    const posted = (await ledger.listLines?.({ accountIds: [...byGlAccount.keys()], ...(asOfDate ? { toDate: asOfDate } : {}) })) ?? [];
    const { lines, derived } = await withDerivedTreasuryFx(posted, byGlAccount, async (currency, on) => (await exchangeRates.findRate(currency, on))?.rate ?? null);
    const open = deriveOpenFxBalances(lines, await accounts.list());
    const rows: ForeignTreasuryBalance[] = [];
    for (const account of await treasuryAccounts.list()) {
      const currency = account.glAccountId ? byGlAccount.get(account.glAccountId) : undefined;
      if (!account.glAccountId || !currency) continue;
      const balance = open.find((b) => b.accountId === account.glAccountId && b.currency === currency);
      rows.push({
        treasuryAccountId: account.id,
        name: account.name,
        glAccountId: account.glAccountId,
        currency,
        foreignBalance: balance?.foreignAmount ?? Money.zero(),
        baseBalance: balance?.bookedBase ?? Money.zero(),
        derivedLines: derived.filter((line) => line.accountId === account.glAccountId).length,
      });
    }
    return rows;
  }

  async function foreignResidues(asOfDate?: string): Promise<ForeignResidue[]> {
    const posted = (await ledger.listLines?.(asOfDate ? { toDate: asOfDate } : {})) ?? [];
    const { lines } = await withDerivedTreasuryFx(posted, await foreignTreasuryCurrencies(), async (currency, on) => (await exchangeRates.findRate(currency, on))?.rate ?? null);
    const chart = await accounts.list();
    const held = accountForeignResidues(deriveOpenFxBalances(lines, chart));
    const openItems = held.length > 0 ? await openFxItems(asOfDate ?? FX_OPEN_TODAY) : new Map<string, OpenFxItem[]>();
    const residues: ForeignResidue[] = [];
    const leftOnClosedItems = new Map<string, bigint>();
    for (const item of await vouchers.revaluationShares.listItems()) {
      if (await fxItemStandsOpen(item)) continue;
      const standing = await standingRevaluationShare(item);
      const share = (await vouchers.revaluationShares.listByItem(item))[0];
      if (standing.scaled === 0n || !share) continue;
      const key = openFxItemsKey(share.accountId, share.currency);
      leftOnClosedItems.set(key, (leftOnClosedItems.get(key) ?? 0n) + standing.scaled);
      residues.push({ kind: ForeignResidueKind.Item, ref: item.id, itemType: item.type, currency: share.currency, base: standing });
    }
    for (const residue of held) {
      const key = openFxItemsKey(residue.ref, residue.currency);
      const carried = (openItems.get(key) ?? []).reduce((sum, item) => sum + item.carryingBase.scaled, leftOnClosedItems.get(key) ?? 0n);
      const debitNatured = chart.find((account) => account.id === residue.ref)?.naturalBalance === "debit";
      const unexplained = residue.base.scaled - (debitNatured ? carried : -carried);
      if (unexplained !== 0n) residues.push({ ...residue, base: Money.fromScaled(unexplained) });
    }
    return residues;
  }

  async function resolveReconciliationControls(asOfDate?: string) {
    const upTo = (date: string | null | undefined): boolean => asOfDate === undefined || (date ?? "").slice(0, 10) <= asOfDate;
    const standingCertificate = (certificate: { status: string; approvedAt: string | null; executionDate: string; voidedAt: string | null }): boolean =>
      upTo(certificate.approvedAt ?? certificate.executionDate) && (certificate.status !== "voided" || !upTo(certificate.voidedAt));
    type ChainLink = { id: string; status: DocumentStatus; date: string; reversesDocId: string | null; reversedByDocId: string | null };
    const linksById = <T extends ChainLink>(docs: readonly T[]): ReadonlyMap<string, T> => new Map(docs.map((d) => [d.id, d]));
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
    const chequeEntryDates = await entryDatesOf(allCheques.flatMap((cheque) => [cheque.creationJournalEntryId, cheque.bounceJournalEntryId, chequeBounceOntoPartyEntryId(cheque.id)]));
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

    const receiptRows = await goodsReceipts.list();
    let grniScaled = 0n;
    if (asOfDate === undefined) {
      for (const receipt of receiptRows) if (receipt.status === "confirmed") grniScaled += goodsReceiptUninvoicedCost(receipt).scaled;
    } else {
      const receiptCancelDates = await entryDatesOf(receiptRows.filter((r) => r.status === "cancelled").map((r) => goodsReceiptCancelEntryId(r.id)));
      const receiptsById = new Map(receiptRows.map((r) => [r.id, r]));
      for (const receipt of receiptRows) {
        if (receipt.status === "draft") continue;
        const ended = receiptCancelDates.get(goodsReceiptCancelEntryId(receipt.id)) ?? null;
        if (receipt.status === "cancelled" && ended === null) continue;
        grniScaled += invoicePresence(receipt.date, receipt.status === "confirmed", ended) * goodsReceiptTotalCost(receipt).scaled;
      }
      for (const inv of purchInvoices) {
        const receipt = inv.receiptId ? receiptsById.get(inv.receiptId) : undefined;
        if (!receipt || inv.status === "draft") continue;
        const ended = undoneEntryDates.get(purchaseInvoiceCancelEntryId(inv.id)) ?? null;
        if (inv.status === "cancelled" && ended === null) continue;
        const presence = invoicePresence(inv.date, inv.status === "confirmed", ended);
        if (presence === 0n) continue;
        const tracked = inv.lines.some((line) => line.receiptBillings !== undefined);
        const relieved = tracked
          ? inv.lines.flatMap((line) => line.receiptBillings ?? []).reduce((sum, billing) => sum + extendQtyByPrice(billing.qty, receipt.lines[billing.lineIndex]?.unitCost ?? Money.zero()).scaled, 0n)
          : goodsReceiptTotalCost(receipt).scaled;
        grniScaled -= presence * relieved;
      }
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
        contractingSiteStore.consumptions.list({ status: MaterialConsumptionStatus.Confirmed }),
        contractingSiteStore.equipmentLogs.list({ status: EquipmentLogStatus.Confirmed }),
        recognitionRuns.list(),
      ]);
    const account = (key: string, fallback: string): string => routedAccountId(routing, key) ?? fallback;

    /** Only a certificate whose deductions entry is actually on the ledger, and was not reversed. */
    const postedCertificates = certificates.filter((c) => c.journalEntryId !== null && standingCertificate(c));
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
      { key: "grni", label: "بضاعة واردة لم تُفوتر مقابل دفتر الأستاذ", controlAccountId: PURCHASE_GL_ACCOUNTS.goodsReceivedNotInvoicedAccountId as string, naturalBalance: "credit" as const, subLedgerBalance: Money.fromScaled(grniScaled) },
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
  if (seedWhenEmpty) await seedIfEmpty(seedStores, undefined, { adminPassword: options.seedAdminPassword });
  const leftEmpty = !seedWhenEmpty && (await isEmptyTenant(seedStores));

  const upgradeLedger = store((s) => createSqliteUpgradeLedger(s), (d) => createUpgradeLedger(d));
  const offerStandardRoles = async (): Promise<void> => {
    const licensed = options.standardRoles?.resolveEntitlements() ?? null;
    if (!licensed || licensed.activeModules.length === 0) return;
    await upgradeLedger.runOnce(UpgradeStepId.StandardRoles, async () => {
      const created = await ensureStandardRoles(uow, licensed);
      if (created.length > 0) backendLog.info({ area: "roles" }, `added the standard role(s) ${created.join(", ")}`);
    });
  };
  // REQUIRED ORDERING: runs after `grantSuccessorPermissionsOnce` above, so a reversal right granted for an older one is moved with the duty it belongs to.
  const separateSeededDuties = async (split: SeededRoleSplit): Promise<void> => {
    const reversalSuccessors = reversalPermissionSuccessors();
    const corrected: string[] = [];
    const dutyChanges: SeededRoleDutyChange[] = [];
    for (const role of await uow.roles.list()) {
      const permissions = correctedSeededRolePermissions(role.code, role.permissions, reversalSuccessors, split);
      if (!permissions) continue;
      const change = seededRoleDutyChange(role, reversalSuccessors, split);
      if (change) dutyChanges.push(change);
      await uow.roles.save({ ...role, permissions });
      corrected.push(role.code);
    }
    if (corrected.length > 0) backendLog.info({ area: "roles" }, `separated duties (${split}) on seeded role(s) ${corrected.join(", ")}`);
    if (dutyChanges.length > 0) {
      const { title, body } = seededRoleDutyNotice(dutyChanges, split);
      const roles = await uow.roles.list();
      const holdsEverything = new Set(roles.filter((role) => role.permissions.includes("*")).map((role) => role.id));
      const createdAt = new Date().toISOString();
      for (const user of await uow.users.list()) {
        if (user.status !== "active" || !(user.isCompanyAdmin || (user.roleId !== null && holdsEverything.has(user.roleId)))) continue;
        await notifications.save({
          id: randomUUID(),
          ruleId: null,
          recipientUserId: user.id,
          eventCode: SEEDED_ROLE_DUTIES_SEPARATED_EVENT,
          title,
          body,
          priority: "high",
          channels: ["in_app"],
          channelStatus: { in_app: "delivered" },
          status: "unread",
          payload: { roles: dutyChanges.map((change) => ({ code: change.roleCode, revoked: change.revoked, granted: change.granted })), link: "/settings/roles" },
          createdAt,
          readAt: null,
        });
      }
    }
  };
  await upgradeLedger.runOnce(UpgradeStepId.SeededRoleDutySplit, () => separateSeededDuties(SeededRoleSplit.Duties));
  await upgradeLedger.runOnce(UpgradeStepId.SeededRoleReconciliationSplit, () => separateSeededDuties(SeededRoleSplit.BankReconciliation));
  await upgradeLedger.runOnce(UpgradeStepId.SeededRoleGoodsReceiving, () => separateSeededDuties(SeededRoleSplit.GoodsReceiving));
  await upgradeLedger.runOnce(UpgradeStepId.SeededRolePriceFloor, () => separateSeededDuties(SeededRoleSplit.PriceFloor));
  await upgradeLedger.runOnce(UpgradeStepId.ApprovalFingerprint, async () => {
    const marked = sqlite ? markApprovalsNeedingReapproval(sqlite) : [];
    if (marked.length > 0) backendLog.info({ area: "workflow" }, `${marked.length} approval(s) given before this version need re-approval: ${marked.join(", ")}`);
  });

  /**
   * Books seeded before a template account existed get it now (D229: the
   * exchange-difference accounts). Idempotent; it adds, and never renames or
   * repurposes an account — posted history stays where it was posted.
   */
  if (!leftEmpty) {
    const { added, skipped } = await addMissingStandardAccounts(accounts);
    if (added.length > 0) backendLog.info({ area: "chart-of-accounts" }, `added standard account(s) ${added.join(", ")}`);
    const fxSkipped = skipped.filter((id) => id !== LANDED_COST_GL_ACCOUNTS.clearingAccountId);
    if (fxSkipped.length > 0) {
      backendLog.warn({ area: "chart-of-accounts" }, `${fxSkipped.join(", ")} already used by another account; map the fx.* slots in account routing`);
    }
    if (skipped.includes(LANDED_COST_GL_ACCOUNTS.clearingAccountId)) {
      // INVARIANT: a landed cost never posts into an account the tenant keeps for something else — it waits in cost of sales as it did before the clearing account existed (landed-cost-clearing-backfill.test.ts).
      landedCostGlAccounts.clearingAccountId = landedCostGlAccounts.unabsorbedCostAccountId;
      backendLog.warn({ area: "chart-of-accounts" }, `${LANDED_COST_GL_ACCOUNTS.clearingAccountId} is used by another account; a landed cost dated before its confirm day waits in ${landedCostGlAccounts.unabsorbedCostAccountId}`);
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
        backendLog.info({ area: "opening-balances" }, `posted ${posted} previously-unposted party opening balance(s) to the ledger`);
      }
    } catch (error) {
      // A refused posting (no fiscal period yet, a closed one) must not stop
      // the server: the same backfill runs again on the next start.
      backendLog.error({ area: "opening-balances", err: error }, "backfill could not complete");
    }
  }

  // --- Field/Van Sales' openVanTrip/settleVanTrip reuse the REAL treasury
  // voucher engine for the opening cash float / cash-handed-in transfer: a
  // confirmed "inter_treasury_transfer" voucher between the two treasury
  // accounts, posted through the same GL engine every other voucher uses. ---
  const vanTripVoucherService = new VoucherService({
    documentIdsMintedBySystem: true,
    documents: vouchers.documents,
    vatFilings,
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
    vatFilings,
    ledger,
    accounts,
    periods: fiscalPeriods,
    numbering: ledger.numbering,
    projects,
    treasuryAccounts,
    allocations: vouchers.allocations,
    invoices: vouchers.invoices,
    settings,
    resolveGateConfig: (actionType) => workflowConfigs.resolve(actionType),
    partyName: voucherPartyNameOf,
    audit: auditSink,
  });

  async function vanTripTreasuryTransfer(input: TreasuryTransferInput & { readonly voucherId?: string }): Promise<void> {
    const [from, to] = await Promise.all([
      treasuryAccounts.findById(input.fromTreasuryAccountId),
      treasuryAccounts.findById(input.toTreasuryAccountId),
    ]);
    const id = input.voucherId ?? randomUUID();
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
    kind: VanTripCashMovementKind;
    amount: Money;
    date: string;
    branchId: string;
    vanTreasuryAccountId: string;
  }): Promise<void> {
    if (input.amount.scaled <= 0n) return;
    const van = await treasuryAccounts.findById(input.vanTreasuryAccountId);
    const id = `VAN-CASH:${input.movementId}`;
    const sale = input.kind === VanTripCashMovementKind.Sale;
    await vanTripVoucherService.createVoucher({
      id,
      date: input.date,
      memo: `${sale ? "بيع" : "تحصيل"} ميداني — رحلة ${input.tripId}`,
      voucherType: "other_income",
      amount: input.amount,
      branchId: input.branchId,
      paymentMethod: "cash",
      treasuryAccountId: input.vanTreasuryAccountId,
      treasuryGlAccountId: van?.glAccountId ?? "1010",
      counterpartyGlAccountId: sale ? "4100" : "2160",
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
    voucherId: string;
    tripId: string;
    date: string;
    branchId: string;
    vanTreasuryAccountId: string;
    variance: Money;
  }): Promise<void> {
    if (input.variance.scaled === 0n) return;
    const shortage = input.variance.scaled < 0n;
    const van = await treasuryAccounts.findById(input.vanTreasuryAccountId);
    const id = input.voucherId;
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

  // --- E3-04 van reconciliation: what the books hold for a van, and the approval's postings. ---
  const vanTripActivity = createVanTripActivityPort({
    stock: stockService,
    movementsOfWarehouse: (warehouseId) => stockLedger.ledger.listByWarehouse(warehouseId),
    itemCostPrice: async (itemId) => (await items.findById(itemId))?.costPrice ?? null,
    treasuryAccounts,
    ledger,
    listVouchers: (filter) => vanTripVoucherService.list(filter),
    listInvoices: (filter) => salesInvoices.list(filter),
    listReturns: (filter) => salesReturns.list(filter),
  });
  const vanReconciliationPostings = createVanReconciliationPostingPort({
    adjustments: stockAdjustments,
    transfers: stockTransfers,
    movementsOfDocument: (documentId) => stockService.getMovementsOfDocument(documentId),
    voucherExists: async (voucherId) => (await vanTripVoucherService.findById(voucherId)) !== null,
    recordCashVariance: recordVanCashVariance,
    treasuryTransfer: vanTripTreasuryTransfer,
  });

  /**
   * Sessions live here, and the resolver below is what every gated route on
   * this app reads its caller from. Before this the routes fell back to the
   * header resolver, so a request declared its own permissions.
   */
  const sessions = createSessionRegistry(Date.now, DEFAULT_SESSION_LIMITS, options.sessionsInDatabase ? store((s) => createSqliteSessionStore(s), (d) => createSessionStore(d)) : createMemorySessionStore());
  const resolveAuthContext = createSessionAuthContextResolver(sessions);
  /**
   * ONE throttle for the whole backend. `/auth/login` counts against it and
   * `POST /users/:id/unlock` clears it, and those only agree if it is the same
   * object: a per-router throttle would let an admin "unlock" an account that
   * stays locked at the login route.
   */
  const signInLadder = createLoginThrottle(options.signInClock, store((s) => createSqliteAttemptStore(s, SignInAttemptScope.Ladder), (d) => createAttemptStore(d, SignInAttemptScope.Ladder)));
  const signInSources = createSourceThrottle(options.signInClock, undefined, store((s) => createSqliteAttemptStore(s, SignInAttemptScope.Source), (d) => createAttemptStore(d, SignInAttemptScope.Source)));
  const accountLockStore = store((s) => createSqliteAccountLockStore(s, { now: options.signInClock, failureWindowMs: ACCOUNT_LOCK_WINDOW_MS }), (d) => createAccountLockStore(d, { now: options.signInClock, failureWindowMs: ACCOUNT_LOCK_WINDOW_MS }));
  const accountLocks = createAccountLocks({ known: accountLockStore, unknown: accountLockStore.unknownNames, now: options.signInClock });
  // REQUIRED: every unlock in the product — the Users screen, a password reset, an
  // email change — goes through this one object, and it must clear the
  // account lock as well as the backoff or the button unlocks nothing.
  const credentialsResetByAdministrator = async (account: string): Promise<void> => {
    await accountLocks.clear(account);
    await signInLadder.unlock(account);
  };
  const loginThrottle: LoginThrottle = { ...signInLadder, unlock: credentialsResetByAdministrator };
  const ownerDigestStore = store((s) => createSqliteOwnerDigestStore(s), (d) => createOwnerDigestStore(d));
  const sendMail = options.sendMail ?? sendNotificationEmail;
  // SECURITY: a tenant-typed SMTP host is held to the edition policy; the platform relay from the deployment env is not.
  const tenantMail: SmtpSendOptions = { destinations: options.tenantMailDestinations ?? SmtpDestinationPolicy.AnyHost };
  const platformMail: SmtpSendOptions = { destinations: SmtpDestinationPolicy.AnyHost };
  const securitySmtp = async (): Promise<{ readonly config: SmtpConfig; readonly sendOptions: SmtpSendOptions } | null> => {
    const tenant = (await settings.get()) ?? createDefaultSettings();
    if (tenant.smtpEnabled) return { config: tenant, sendOptions: tenantMail };
    return options.securityMail ? { config: options.securityMail, sendOptions: platformMail } : null;
  };
  const lockMailInTheTurn = inTheTurn("account lock notice");
  // SECURITY: the body carries a temporary password or a reset link; it goes to the mail transport only, never to a store or a log.
  const mailUserOutsideTheTurn = (to: string, subject: string, body: string): void => {
    void outsideTheTurn(async () => {
      const smtp = await securitySmtp();
      if (smtp === null) return;
      const sent = await sendMail(smtp.config, to, { subject, body }, smtp.sendOptions);
      if (sent.outcome !== "sent") backendLog.warn({ area: "auth", outcome: sent.outcome }, "a credential email was not delivered");
    }).catch((err: unknown) => backendLog.error({ area: "auth", err }, "a credential email could not be sent"));
  };
  const mailPasswordResetLink = async ({ user, token }: { readonly user: User; readonly token: string }): Promise<void> => {
    if (!options.passwordResetLink) return;
    mailUserOutsideTheTurn(user.email, "ميزان — إعادة تعيين كلمة المرور / Mezan password reset", passwordResetMail(options.passwordResetLink(token)));
  };
  const mailInvitation = async ({ user, temporaryPassword }: { readonly user: User; readonly temporaryPassword: string }): Promise<void> => {
    mailUserOutsideTheTurn(user.email, "ميزان — دعوة للدخول / Your Mezan account", invitationMail(user.email, temporaryPassword, options.signInLink ?? null, options.signInCompanyCode ?? null));
  };
  const recordLateInTheTurn = inTheTurn("late notification record");
  type MailResult = Awaited<ReturnType<typeof sendNotificationEmail>>;
  const dispatchOutcomeOf = (sent: MailResult): DispatchOutcome =>
    sent.outcome === "sent" ? { kind: "sent" } : { kind: sent.outcome === "offline" ? "offline" : "rejected", reason: sent.detail };
  // SECURITY: the only place an unlock code or link token lives after it is
  // issued, besides the mail itself. Keyed by notification id, dropped when the
  // mail is sent or refused, and never older than the code it carries.
  const lockMailBodies = new Map<string, { readonly body: string; readonly expiresAt: number }>();
  const signInNow = options.signInClock ?? Date.now;
  const keepLockMail = (id: string, body: string): void => {
    const at = signInNow();
    for (const [stale, kept] of lockMailBodies) if (kept.expiresAt <= at) lockMailBodies.delete(stale);
    lockMailBodies.set(id, { body, expiresAt: at + UNLOCK_CODE_TTL_MS });
  };
  const emailTransport = (smtp: SmtpConfig | null, sendOptions: SmtpSendOptions = tenantMail): NotificationTransport => ({
    channel: "email",
    async send(notification, recipientEmail, claim) {
      if (smtp === null) return { kind: "rejected", reason: "البريد الإلكتروني غير مُفعَّل في الإعدادات." };
      if (!recipientEmail) return { kind: "rejected", reason: "لا يوجد بريد إلكتروني مسجَّل لهذا المستخدم." };
      const body = notification.eventCode === ACCOUNT_LOCKED_NOTICE ? lockMailBodies.get(notification.id)?.body : notification.body;
      if (body === undefined) return { kind: "rejected", reason: "انتهت صلاحية رمز فكّ القفل قبل إرساله؛ يُرسل رمز جديد عند المحاولة التالية." };
      const html = notification.eventCode === OWNER_DIGEST_EVENT ? await ownerDigestStore.mailHtml(notification.id) : null;
      try {
        const sent = await outsideTheTurn(() => withinDeadline(OutsideWork.Mail, () => sendMail(smtp, recipientEmail, { subject: notification.title, body, ...(html ? { html } : {}) }, sendOptions)));
        const outcome = dispatchOutcomeOf(sent);
        if (outcome.kind !== "offline") lockMailBodies.delete(notification.id);
        return outcome;
      } catch (err) {
        if (err instanceof OutsideWorkDeadlineError) return { kind: "offline", reason: err.message };
        // The mail server answered and this drain can no longer write. What it
        // answered is recorded under a turn of its own, against the same claim,
        // so a message that was sent is not queued to be sent again.
        if (err instanceof ConnectionTurnLostError && err.completed) {
          const late = SETTLED_AS[dispatchOutcomeOf(err.completed.value as MailResult).kind];
          void recordLateInTheTurn(() => notifications.settleChannel(notification.id, "email", late, claim)).catch((error: unknown) => {
            backendLog.error({ area: "notifications", err: error }, `could not record what the mail server answered for ${notification.id}`);
          });
        }
        throw err;
      }
    },
    async sendTo(address, message, claim, messageId) {
      if (smtp === null) return { kind: "rejected", reason: "البريد الإلكتروني غير مُفعَّل في الإعدادات." };
      try {
        const sent = await outsideTheTurn(() => withinDeadline(OutsideWork.Mail, () => sendMail(smtp, address, { subject: message.subject, body: message.body }, sendOptions)));
        return dispatchOutcomeOf(sent);
      } catch (err) {
        if (err instanceof OutsideWorkDeadlineError) return { kind: "offline", reason: err.message };
        if (err instanceof ConnectionTurnLostError && err.completed) {
          const late = dispatchOutcomeOf(err.completed.value as MailResult);
          const settled = late.kind === "sent" ? CustomerMessageStatus.Sent : late.kind === "rejected" ? CustomerMessageStatus.Failed : CustomerMessageStatus.Queued;
          void recordLateInTheTurn(() =>
            customerMail.outbox.settle(messageId, settled, claim, {
              sentAt: late.kind === "sent" ? new Date().toISOString() : null,
              failureReason: late.kind === "sent" ? null : late.reason,
            }),
          ).catch((error: unknown) => {
            backendLog.error({ area: "collections", err: error }, `could not record what the mail server answered for customer message ${messageId}`);
          });
        }
        throw err;
      }
    },
  });
  const drainNotificationsOnly = async (ids: ReadonlySet<string>): Promise<DrainResult> => {
    const tenant = (await settings.get()) ?? createDefaultSettings();
    return new NotificationDispatcher({
      notifications,
      recipientEmail: async (userId) => (await uow.users.findById(userId))?.email ?? null,
      transports: [emailTransport(tenant.smtpEnabled ? tenant : null)],
    }).drain({ only: ids });
  };
  const notifyAccountLocked = async (event: AccountLockedEvent): Promise<void> => {
    const smtp = await securitySmtp();
    const admins = (await uow.users.list()).filter((u) => u.isCompanyAdmin && u.status === UserStatusCode.Active);
    const createdAt = new Date().toISOString();
    const mailed = smtp !== null && event.unlockCode !== null;
    const unlockUrl = options.unlockLink && event.unlockLinkToken ? options.unlockLink(event.unlockLinkToken) : null;
    const mailBody = mailed ? accountLockedMail(event, unlockUrl) : null;
    const ids = new Set<string>();
    for (const admin of admins) {
      const id = randomUUID();
      ids.add(id);
      if (mailBody !== null) keepLockMail(id, mailBody);
      await notifications.save({
        id,
        ruleId: null,
        recipientUserId: admin.id,
        eventCode: ACCOUNT_LOCKED_NOTICE,
        title: "تم قفل حساب بعد محاولات دخول فاشلة",
        body: accountLockedNotice(event, mailed, unlockUrl !== null),
        priority: NotificationPriorityCode.Urgent,
        channels: mailed ? [NotificationChannelCode.InApp, NotificationChannelCode.Email] : [NotificationChannelCode.InApp],
        channelStatus: mailed
          ? { in_app: NotificationChannelState.Delivered, email: NotificationChannelState.Queued }
          : { in_app: NotificationChannelState.Delivered },
        status: NotificationReadStatusCode.Unread,
        payload: { userId: event.user.id, source: event.source },
        createdAt,
        readAt: null,
      });
    }
    if (!mailed || smtp === null || ids.size === 0) return;
    const dispatcher = new NotificationDispatcher({
      notifications,
      recipientEmail: async (userId) => (await uow.users.findById(userId))?.email ?? null,
      transports: [emailTransport(smtp.config, smtp.sendOptions)],
    });
    void lockMailInTheTurn(() => dispatcher.drain({ only: ids })).catch((error: unknown) => {
      backendLog.error({ area: "auth", err: error }, "the account-lock notice could not be mailed; it stays queued");
    });
  };

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
    void recordSecurityEventOrFallback(auditSink, {
      module: "admin",
      entityType: "PERMISSION",
      entityId: refusal.permission,
      action: "PERMISSION_DENIED",
      actor: refusal.userId,
      severity: "WARNING",
      details: { permission: refusal.permission, method: refusal.method, path: refusal.path },
    });
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
  const revaluationEntryStands = async (entryId: string) => {
    const entry = await ledger.findById(entryId);
    return entry?.status === "posted" && !entry.reversedByEntryId;
  };
  const standingRevaluationShare = (item: FxOpenItemRef) =>
    unconsumedRevaluationShare(item, { shares: vouchers.revaluationShares, allocations: vouchers.allocations, entryStands: revaluationEntryStands });
  const invoiceItem = (id: string): FxOpenItemRef => ({ id, type: FxOpenItemType.Invoice });
  const moneyItem = (id: string): FxOpenItemRef => ({ id, type: FxOpenItemType.Money });
  async function foreignMoneyOnAccount(voucherId: string): Promise<{ date: string; line: VoucherLine; fxRate: string; kind: AllocationInvoiceKind; unallocated: Money } | null> {
    const doc = await vouchers.documents.findById(voucherId);
    if (!doc || doc.status !== "confirmed") return null;
    const line = voucherLine(doc);
    const kind = getVoucherTypeDefinition(line.voucherType).allocationKind;
    if (!kind || !line.fxRate) return null;
    const unallocated = voucherBaseAmount(line).scaled - sumActive(await vouchers.allocations.listByVoucher(doc.id)).scaled;
    return { date: doc.date.slice(0, 10), line, fxRate: line.fxRate, kind, unallocated: Money.fromScaled(unallocated > 0n ? unallocated : 0n) };
  }
  async function fxItemStandsOpen(item: FxOpenItemRef): Promise<boolean> {
    if (item.type === FxOpenItemType.Money) return ((await foreignMoneyOnAccount(item.id))?.unallocated.scaled ?? 0n) !== 0n;
    const invoice = await vouchers.invoices.findById(item.id);
    if (!invoice || !(await invoiceStands(invoice.id, invoice.kind))) return false;
    const returned = (await returnedByInvoice(invoiceReturnCredits, [invoice])).get(invoice.id) ?? Money.zero();
    return invoiceOpenBalance(invoice, returned).scaled !== 0n;
  }
  interface FxItemBook {
    readonly ref: FxOpenItemRef;
    readonly key: string;
    readonly kind: AllocationInvoiceKind;
    readonly partyId: string;
    readonly fxRate: string;
    readonly openedOn: string;
    readonly endedOn: string | null;
    readonly timeline: FxItemTimeline;
    readonly allocationIds: ReadonlySet<string>;
  }
  const FX_OPEN_TODAY = "9999-12-31";
  const FX_CLOSE_REF = "close";
  const fxReturnRef = (returnId: string): string => `return:${returnId}`;
  const allocationDay = (allocation: VoucherAllocation): string => allocation.date ?? allocation.createdAt.slice(0, 10);
  function allocationEvents(allocations: readonly VoucherAllocation[], money: boolean): FxItemEvent[] {
    const events: FxItemEvent[] = [];
    for (const allocation of allocations) {
      const undoneOn = allocation.status === "active" ? null : (allocation.reversedOn ?? allocation.reversedAt?.slice(0, 10) ?? null);
      if (allocation.status !== "active" && !undoneOn) continue;
      const amount = money ? allocation.amount : allocationInvoiceAmount(allocation);
      const by = money ? allocation.invoiceId : allocation.voucherId;
      events.push({ kind: FxItemEventKind.Relief, ref: allocation.id, day: allocationDay(allocation), at: allocation.createdAt, amount, by });
      if (undoneOn) events.push({ kind: FxItemEventKind.Reopening, ref: allocation.id, day: undoneOn, at: allocation.reversedAt ?? undoneOn, amount, by });
    }
    return events;
  }
  async function invoiceBook(invoiceId: string, kind: AllocationInvoiceKind, control: string): Promise<FxItemBook | null> {
    const booked = await realisedFx.invoiceFx(invoiceId, kind);
    const sub = await vouchers.invoices.findById(invoiceId);
    if (!booked || !sub) return null;
    const live = await invoiceStands(invoiceId, kind);
    const ended = live ? null : await ledger.findById(kind === "sales" ? salesInvoiceVoidEntryId(invoiceId) : purchaseInvoiceCancelEntryId(invoiceId));
    if (!live && !ended) return null;
    const allocations = await vouchers.allocations.listByInvoice(invoiceId);
    const returns = kind === "sales"
      ? (await listReturnsCiting(salesReturnStore, [invoiceId])).map((doc) => ({ doc, credit: salesReturnCreditByInvoice([doc]).get(invoiceId) ?? Money.zero() }))
      : (await listReturnsCiting(purchaseReturnStore, [invoiceId])).map((doc) => ({ doc, credit: purchaseReturnCreditByInvoice([doc]).get(invoiceId) ?? Money.zero() }));
    const events = allocationEvents(allocations, false);
    for (const { doc, credit } of returns) {
      if (credit.scaled !== 0n) events.push({ kind: FxItemEventKind.Relief, ref: fxReturnRef(doc.id), day: doc.date.slice(0, 10), at: doc.confirmedAt ?? doc.date, amount: credit, by: doc.docNo ?? doc.id });
    }
    if (ended) events.push({ kind: FxItemEventKind.Close, ref: FX_CLOSE_REF, day: ended.date.slice(0, 10), at: ended.postedAt ?? ended.date, amount: Money.zero(), by: sub.invoiceNo });
    const opened = live
      ? sub.total
      : Money.fromScaled(kind === "sales" ? await salesInvoices.findById(invoiceId).then((doc) => (doc ? salesInvoiceBaseGrandTotal(salesInvoiceTotals(doc), doc.fxRate).scaled : 0n)) : await purchaseInvoices.findById(invoiceId).then((doc) => (doc ? purchaseInvoiceBaseTotal(doc).scaled : 0n)));
    return { ref: invoiceItem(invoiceId), key: openFxItemsKey(control, booked.currency), kind, partyId: sub.partyId, fxRate: booked.fxRate, openedOn: sub.date.slice(0, 10), endedOn: ended?.date.slice(0, 10) ?? null, timeline: fxItemTimeline(opened, events), allocationIds: new Set(allocations.map((allocation) => allocation.id)) };
  }
  async function moneyBook(doc: VoucherDocument): Promise<FxItemBook | null> {
    if (doc.reversesDocId || (doc.status !== "confirmed" && doc.status !== "reversed")) return null;
    const line = voucherLine(doc);
    const kind = getVoucherTypeDefinition(line.voucherType).allocationKind;
    const partyId = line.customerId ?? line.supplierId;
    if (!kind || !line.fxRate || !partyId || !line.counterpartyGlAccountId) return null;
    const mirror = doc.status === "reversed" && doc.reversedByDocId ? await vouchers.documents.findById(doc.reversedByDocId) : null;
    if (doc.status === "reversed" && !mirror) return null;
    const allocations = await vouchers.allocations.listByVoucher(doc.id);
    const events = allocationEvents(allocations, true);
    if (mirror) events.push({ kind: FxItemEventKind.Close, ref: FX_CLOSE_REF, day: mirror.date.slice(0, 10), at: mirror.confirmedAt ?? mirror.date, amount: Money.zero(), by: doc.docNo ?? doc.id });
    return { ref: moneyItem(doc.id), key: openFxItemsKey(line.counterpartyGlAccountId, line.currency), kind, partyId, fxRate: line.fxRate, openedOn: doc.date.slice(0, 10), endedOn: mirror?.date.slice(0, 10) ?? null, timeline: fxItemTimeline(voucherBaseAmount(line), events), allocationIds: new Set(allocations.map((allocation) => allocation.id)) };
  }
  async function fxControlAccounts(): Promise<Record<AllocationInvoiceKind, string>> {
    const routing = await accountRouting.get();
    return { sales: routedAccountId(routing, "control.receivable") ?? "1105", purchase: routedAccountId(routing, "control.payable") ?? "2100" };
  }
  async function fxItemBook(item: FxOpenItemRef): Promise<FxItemBook | null> {
    if (item.type === FxOpenItemType.Money) {
      const doc = await vouchers.documents.findById(item.id);
      return doc ? moneyBook(doc) : null;
    }
    const sub = await vouchers.invoices.findById(item.id);
    return sub ? invoiceBook(item.id, sub.kind, (await fxControlAccounts())[sub.kind]) : null;
  }
  async function standingRunShares(item: FxOpenItemRef): Promise<{ day: string; share: Money }[]> {
    const byRun = new Map<string, { day: string; share: bigint }>();
    for (const record of await vouchers.revaluationShares.listByItem(item)) {
      const entry = await ledger.findById(record.entryId);
      if (!entry || entry.sourceDocType !== FX_REVALUATION_DOC_TYPE || entry.status !== "posted" || entry.reversedByEntryId || entry.reversesEntryId) continue;
      const run = byRun.get(entry.id) ?? { day: entry.date.slice(0, 10), share: 0n };
      run.share += record.amount.scaled;
      byRun.set(entry.id, run);
    }
    return [...byRun.values()].map((run) => ({ day: run.day, share: Money.fromScaled(run.share) }));
  }
  async function revaluationShareAsOf(book: FxItemBook, day: string): Promise<bigint> {
    if (day >= FX_OPEN_TODAY) return (await standingRevaluationShare(book.ref)).scaled;
    let share = 0n;
    for (const run of await standingRunShares(book.ref)) if (run.day <= day) share += walkRunShare(book.timeline, run, day).remaining.scaled;
    return share;
  }
  // INVARIANT: what a relief about to be recorded takes of the item's standing shares — the sum, run by run, of the same walk a run posted after it would make. A relief that closes the item takes whatever the ledger still holds on it, so nothing is left behind.
  async function revaluationShareTaken(item: FxOpenItemRef, relief: FxShareRelief): Promise<Money> {
    if (relief.closes) return standingRevaluationShare(item);
    const book = await fxItemBook(item);
    if (!book) return Money.zero();
    const timeline = fxItemTimeline(book.timeline.opened, [...book.timeline.events, { kind: FxItemEventKind.Relief, ref: relief.ref, day: relief.day, at: relief.at, amount: relief.amount }]);
    let taken = 0n;
    for (const run of await standingRunShares(item)) taken += walkRunShare(timeline, run).takenBy(relief.ref).scaled;
    return Money.fromScaled(taken);
  }
  async function fxItemAsOf(book: FxItemBook, day: string): Promise<{ key: string; open: OpenFxItem } | null> {
    if (book.openedOn > day || (book.endedOn !== null && book.endedOn <= day)) return null;
    const open = fxItemOpenOn(book.timeline, day);
    if (open.scaled <= 0n) return null;
    const side = book.ref.type === FxOpenItemType.Money ? -1n : 1n;
    return {
      key: book.key,
      open: { itemId: book.ref.id, itemType: book.ref.type, kind: book.kind, partyId: book.partyId, foreignOutstanding: Money.fromScaled(side * convertFromBase(open, book.fxRate).scaled), carryingBase: Money.fromScaled(side * open.scaled + (await revaluationShareAsOf(book, day))) },
    };
  }
  async function fxItemBooks(asOfDate: string): Promise<FxItemBook[]> {
    const controlOf = await fxControlAccounts();
    const out: FxItemBook[] = [];
    const foreign = (doc: { currency?: string | null; fxRate?: string | null }) => Boolean(doc.fxRate && doc.currency && !isBaseCurrency(doc.currency));
    for (const invoice of (await salesInvoices.list()).filter(foreign)) {
      const book = await invoiceBook(invoice.id, "sales", controlOf.sales);
      if (book) out.push(book);
    }
    for (const invoice of (await purchaseInvoices.list()).filter(foreign)) {
      const book = await invoiceBook(invoice.id, "purchase", controlOf.purchase);
      if (book) out.push(book);
    }
    for (const doc of await vouchers.documents.list({ toDate: asOfDate })) {
      const book = await moneyBook(doc);
      if (book) out.push(book);
    }
    return out;
  }
  async function openFxItems(asOfDate: string): Promise<ReadonlyMap<string, OpenFxItem[]>> {
    const out = new Map<string, OpenFxItem[]>();
    for (const book of await fxItemBooks(asOfDate)) {
      const item = await fxItemAsOf(book, asOfDate);
      if (item) out.set(item.key, [...(out.get(item.key) ?? []), item.open]);
    }
    return out;
  }
  // INVARIANT: runs in the run's own transaction, after its shares are saved — a relief dated in a closed period throws here and takes the run with it. Each release and each give-back is dated the day of the event that caused it, or the day of a standing run on the item if that is later, so the ledger read at a month end is the one the date order would have left, to the rounding of a share split; a day inside a month can still read differently (fx-order-independence.test.ts).
  async function releaseSharesRelievedSince(asOfDate: string, shared: readonly { readonly itemId: string; readonly itemType: FxOpenItemType; readonly amount: Money }[]): Promise<void> {
    const ownShare = new Map<string, { ref: FxOpenItemRef; share: bigint }>();
    for (const share of shared) {
      const key = `${share.itemType} ${share.itemId}`;
      ownShare.set(key, { ref: { id: share.itemId, type: share.itemType }, share: (ownShare.get(key)?.share ?? 0n) + share.amount.scaled });
    }
    for (const { ref, share } of ownShare.values()) {
      const book = await fxItemBook(ref);
      if (!book) continue;
      const released = new Map<string, { entryId: string; amount: bigint }>();
      for (const step of walkRunShare(book.timeline, { day: asOfDate, share: Money.fromScaled(share) }).steps) {
        if (step.kind === FxItemEventKind.Reopening) {
          const release = released.get(step.ref);
          const entry = release && release.amount === step.amount.scaled ? await ledger.findById(release.entryId) : null;
          if (entry) await reverseJournalEntry(entry.id, salesInvoiceGl, { reversalId: realisedFxReversalId(entry.id), date: laterDay(step.day, entry.date.slice(0, 10)), memo: `عكس فروق عملة محققة (${entry.entryNo ?? entry.id})` }, { mintedBySystem: true });
          else await postShareRelease(ref, step.day, Money.fromScaled(-step.amount.scaled), step.by ? await fxDocumentNumber(step.by) : undefined);
          continue;
        }
        const releaseEntryId = book.allocationIds.has(step.ref) ? fxLateReleaseEntryId(ref.id, step.ref, (await fxLateReleaseEntryIds(ref.id, step.ref, ledger)).length) : undefined;
        const releasedBy = step.by && step.kind === FxItemEventKind.Relief && book.allocationIds.has(step.ref) ? await fxDocumentNumber(step.by) : step.by;
        const entryId = await postShareRelease(ref, step.day, step.amount, releasedBy, releaseEntryId);
        if (entryId) released.set(step.ref, { entryId, amount: step.amount.scaled });
      }
    }
  }
  async function allocationsOnReversedVouchers() {
    const out: { allocationId: string; voucherId: string; voucherNo: string; invoiceId: string }[] = [];
    for (const doc of await vouchers.documents.list()) {
      if (!doc.reversesDocId && doc.status !== "reversed") continue;
      for (const allocation of [...(await vouchers.allocations.listByVoucher(doc.id)), ...(await vouchers.allocations.listByInvoice(doc.id))]) {
        if (allocation.status === "active") out.push({ allocationId: allocation.id, voucherId: doc.id, voucherNo: doc.docNo ?? doc.id, invoiceId: allocation.invoiceId });
      }
    }
    return out;
  }
  async function invoiceStands(invoiceId: string, kind: AllocationInvoiceKind): Promise<boolean> {
    if (kind === "sales") {
      const invoice = await salesInvoices.findById(invoiceId);
      return invoice !== null && SALES_INVOICE_ACTIVE_STATUSES.has(invoice.status);
    }
    return (await purchaseInvoices.findById(invoiceId))?.status === "confirmed";
  }
  async function fxDocumentNumber(id: string): Promise<string> {
    const voucher = await vouchers.documents.findById(id);
    if (voucher?.docNo) return voucher.docNo;
    const cheque = await cheques.findById(id);
    if (cheque) return cheque.chequeNumber;
    return (await salesInvoices.findById(id))?.docNo ?? (await purchaseInvoices.findById(id))?.number ?? id;
  }
  const releaseRevaluationShare = (invoiceId: string, date: string) => releaseItemShare(invoiceItem(invoiceId), date);
  async function releaseItemShare(item: FxOpenItemRef, date: string): Promise<void> {
    await postShareRelease(item, date, await standingRevaluationShare(item));
  }
  async function postShareRelease(item: FxOpenItemRef, date: string, taken: Money, releasedBy?: string, releaseEntryId?: string): Promise<string | null> {
    const records = await vouchers.revaluationShares.listByItem(item);
    const share = records[0];
    if (taken.scaled === 0n || !share) return null;
    const booked = item.type === FxOpenItemType.Money ? (await vouchers.documents.findById(item.id).then((doc) => (doc ? voucherLine(doc).fxRate : null))) : (await realisedFx.invoiceFx(item.id, share.kind))?.fxRate;
    const fxRate = booked ?? "1";
    const lines = buildRevaluationReleaseLines({ kind: share.kind, controlAccountId: share.accountId, partyId: share.partyId, currency: share.currency, fxRate, share: taken }, await fxDifferenceAccounts("realised"));
    if (lines.length === 0) return null;
    let restatedOn = date;
    for (const record of records) {
      const run = await ledger.findById(record.entryId);
      if (run?.sourceDocType === FX_REVALUATION_DOC_TYPE && run.status === "posted" && !run.reversedByEntryId) restatedOn = laterDay(restatedOn, run.date.slice(0, 10));
    }
    const entryId = releaseEntryId ?? `${FX_SHARE_RELEASE_ENTRY_PREFIX}${item.id}:${records.length}`;
    const itemNo = await fxDocumentNumber(item.id);
    await postJournalEntry(
      { id: entryId, date: restatedOn, memo: `إقفال إعادة تقييم قائمة على مستند أُقفل (${itemNo})`, source: "system", sourceDocType: FX_REALISED_DOC_TYPE, sourceDocId: item.id, sourceDocNumber: releasedBy ?? itemNo, lines },
      salesInvoiceGl,
      { mintedBySystem: true },
    );
    await vouchers.revaluationShares.saveAll([{ ...share, entryId, amount: Money.fromScaled(-taken.scaled) }]);
    return entryId;
  }
  function returnReliefGl<L extends { readonly sourceInvoiceId: string }>(kind: AllocationInvoiceKind, returns: Pick<DocumentRepository<L>, "findById">, lineCredit: (line: L) => Money): DocumentGlHook {
    return {
      async post(posting) {
        const credits = new Map<string, Money>();
        for (const line of (await returns.findById(posting.sourceDocId))?.lines ?? []) {
          credits.set(line.sourceInvoiceId, (credits.get(line.sourceInvoiceId) ?? Money.zero()).add(lineCredit(line)));
        }
        // INVARIANT: this runs inside the confirm's own posting, while the return is still unconfirmed; once it is confirmed the sub-ledger nets it and the part it took can no longer be measured.
        const openBefore = new Map<string, Money>();
        for (const invoiceId of credits.keys()) {
          const invoice = await vouchers.invoices.findById(invoiceId);
          if (!invoice || invoice.kind !== kind) continue;
          openBefore.set(invoiceId, invoiceOpenBalance(invoice, (await returnedByInvoice(invoiceReturnCredits, [invoice])).get(invoiceId) ?? Money.zero()));
        }
        const posted = await documentGl.post(posting);
        for (const [invoiceId, outstanding] of openBefore) {
          if (outstanding.scaled <= 0n) continue;
          const credit = credits.get(invoiceId) ?? Money.zero();
          const day = posting.date.slice(0, 10);
          const taken = await revaluationShareTaken(invoiceItem(invoiceId), { ref: fxReturnRef(posting.sourceDocId), day, at: new Date().toISOString(), amount: credit, closes: credit.scaled >= outstanding.scaled });
          await postShareRelease(invoiceItem(invoiceId), day, taken, posting.sourceDocNumber ?? undefined);
        }
        return posted;
      },
      reverse: (journalEntryId, opts) => documentGl.reverse(journalEntryId, opts),
    };
  }
  async function revaluationShareConsumer(entryId: string): Promise<string | null> {
    for (const share of await vouchers.revaluationShares.listByEntry(entryId)) {
      const item: FxOpenItemRef = { id: share.itemId, type: share.itemType };
      const money = share.itemType === FxOpenItemType.Money;
      const taking = money ? await vouchers.allocations.listByVoucher(share.itemId) : await vouchers.allocations.listByInvoice(share.itemId);
      const settled = taking.find((allocation) => allocation.status === "active" && ((money ? allocation.moneyRevaluationShare : allocation.revaluationShare)?.scaled ?? 0n) !== 0n);
      if (settled) return fxDocumentNumber(money ? settled.invoiceId : settled.voucherId);
      for (const record of await vouchers.revaluationShares.listByItem(item)) {
        if (!record.entryId.startsWith(FX_SHARE_RELEASE_ENTRY_PREFIX)) continue;
        const release = await ledger.findById(record.entryId);
        if (release?.status === "posted" && !release.reversedByEntryId) return release.sourceDocNumber ?? (await fxDocumentNumber(share.itemId));
      }
    }
    return null;
  }
  async function refundFx(voucherId: string): Promise<{ currency: string; fxRate: string } | null> {
    const refund = await vouchers.documents.findById(voucherId);
    const line = refund ? voucherLine(refund) : null;
    return line?.fxRate && line.voucherType in REFUNDED_MONEY ? { currency: line.currency, fxRate: line.fxRate } : null;
  }
  /** The rates a settlement of a foreign invoice is measured with, and where the realised difference goes (D221, D229). */
  const realisedFx: RealisedFxPort = {
    async invoiceFx(invoiceId, kind) {
      if (kind === "sales") {
        const invoice = await salesInvoices.findById(invoiceId);
        if (invoice) return invoice.fxRate && invoice.currency ? { currency: invoice.currency, fxRate: invoice.fxRate } : null;
        return refundFx(invoiceId);
      }
      const invoice = await purchaseInvoices.findById(invoiceId);
      if (invoice) return invoice.fxRate && invoice.currency ? { currency: invoice.currency, fxRate: invoice.fxRate } : null;
      return refundFx(invoiceId);
    },
    async rateOn(currency, date) {
      return (await exchangeRates.findRate(currency, date))?.rate ?? null;
    },
    differenceAccounts: () => fxDifferenceAccounts("realised"),
    revaluationShareTaken,
    releaseMoneyShare: (voucherId, date) => releaseItemShare(moneyItem(voucherId), date),
    async treasuryRevaluationShare(treasuryAccountId, foreign, fromDate, toDate) {
      const account = (await treasuryAccounts.list()).find((row) => row.id === treasuryAccountId);
      if (!account?.glAccountId) return Money.zero();
      const restated = ((await ledger.listLines?.({ accountIds: [account.glAccountId], fromDate, toDate })) ?? []).filter(isFxRestatementLine);
      let share = 0n;
      for (const entryId of new Set(restated.map((line) => line.entryId))) {
        const entry = await ledger.findById(entryId);
        if (!entry || entry.reversedByEntryId || entry.reversesEntryId) continue;
        const held = (await foreignTreasuryBalances(entry.date.slice(0, 10))).find((row) => row.treasuryAccountId === treasuryAccountId);
        if (!held || held.foreignBalance.scaled <= 0n) continue;
        const net = restated.filter((line) => line.entryId === entryId).reduce((sum, line) => sum + line.debit.scaled - line.credit.scaled, 0n);
        share += foreign.scaled >= held.foreignBalance.scaled ? net : shareOfBase(Money.fromScaled(net), foreign, held.foreignBalance).scaled;
      }
      return Money.fromScaled(share);
    },
    async treasuryPosition(treasuryAccountId, asOfDate) {
      const held = (await foreignTreasuryBalances(asOfDate)).find((row) => row.treasuryAccountId === treasuryAccountId);
      if (!held) return null;
      // INVARIANT: a revaluation that reverses itself is not cost. Both halves are left out, on whichever day each is dated, so the carrying amount is the same before and after the reversal lands.
      const restated = ((await ledger.listLines?.({ accountIds: [held.glAccountId], toDate: asOfDate })) ?? []).filter(isFxRestatementLine);
      let selfReversing = 0n;
      for (const entryId of new Set(restated.map((line) => line.entryId))) {
        const entry = await ledger.findById(entryId);
        if (!entry?.reversedByEntryId && !entry?.reversesEntryId) continue;
        for (const line of restated) if (line.entryId === entryId) selfReversing += line.debit.scaled - line.credit.scaled;
      }
      return { foreign: held.foreignBalance, base: Money.fromScaled(held.baseBalance.scaled - selfReversing) };
    },
  };
  const settlementPreviewer = new VoucherService({
    documents: vouchers.documents,
    vatFilings,
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
        vatFilings,
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
        realisedFx,
      }).reverseVoucher(doc.id, {
        reversalId: `${doc.id}:BOUNCED`,
        mintedBySystem: true,
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
  const chequeBankLegFx = async (bankGlAccountId: string, date: string): Promise<{ currency: string; fxRate: string | null } | null> => {
    const currency = (await foreignTreasuryCurrencies()).get(bankGlAccountId);
    if (!currency) return null;
    return { currency, fxRate: (await exchangeRates.findRate(currency, date))?.rate ?? null };
  };
  const voucherChequeRegister = new ChequeService({
    cheques,
    gl: salesInvoiceGl,
    allocation: { allocations: vouchers.allocations, invoices: vouchers.invoices, settlement: invoiceSettlement, returns: invoiceReturnCredits },
    raisedBy: chequeRaisedByVoucher,
    bankLegFx: chequeBankLegFx,
    realisedFx,
  });
  // INVARIANT: until 2026-09-18 an incoming cheque's bounce parked the debt on «شيكات مرتجعة» and left the customer's control account credited; everything since reads a bounce as back on the customer, and a replacement credits the customer again. A file holding such a bounce is brought to that shape by an entry of its own — never by editing the posted one.
  // REQUIRED: not a once-only step. A bounce whose reclassification no open period would take is tried again on every start, and one already made is found by its own entry id.
  {
    for (const cheque of await cheques.list({ direction: "incoming", status: "bounced" })) {
      const entryId = chequeBounceOntoPartyEntryId(cheque.id);
      if (!cheque.bounceJournalEntryId || (await ledger.findById(entryId))) continue;
      const bounce = await ledger.findById(cheque.bounceJournalEntryId);
      if (!bounce || bounce.lines.some((line) => line.accountId === cheque.counterpartyGlAccountId)) continue;
      const parkedOn = bounce.lines.find((line) => line.debit.equals(cheque.amount) && line.accountId !== cheque.controlAccounts.underCollectionAccountId);
      if (!parkedOn) continue;
      const post = (date: string) =>
        postJournalEntry(
          {
            id: entryId,
            date,
            memo: `إعادة قيد شيك مرتد رقم ${cheque.chequeNumber} على حساب العميل`,
            source: "system",
            sourceDocType: "CHEQUE",
            sourceDocId: cheque.id,
            sourceDocNumber: cheque.chequeNumber,
            lines: [
              { accountId: cheque.counterpartyGlAccountId, debit: cheque.amount, credit: Money.zero() },
              { accountId: parkedOn.accountId, debit: Money.zero(), credit: cheque.amount },
            ],
          },
          salesInvoiceGl,
          { mintedBySystem: true },
        );
      try {
        await post(bounce.date.slice(0, 10)).catch(() => post(tenantTodayIso()));
        backendLog.info({ area: "cheques" }, `bounced cheque ${cheque.chequeNumber} moved from ${parkedOn.accountId} back onto ${cheque.counterpartyGlAccountId}`);
      } catch (err) {
        backendLog.warn({ area: "cheques" }, `bounced cheque ${cheque.chequeNumber} stays on ${parkedOn.accountId}: no open period takes its reclassification (${err instanceof Error ? err.message : String(err)})`);
      }
    }
  }

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
        journalEntryIdMintedBySystem: true,
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
      documentIdsMintedBySystem: true,
      documents: vouchers.documents,
      vatFilings,
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
        commissionAmount: input.commissionAmount ?? null,
        commissionGlAccountId: input.commissionGlAccountId ?? null,
      },
      [{ allocationId: `${voucherId}:A1`, invoiceId: input.invoiceId, amount: input.amount }],
    );
    return { voucherId };
  };

  // REQUIRED: every hook below reaches the platform's database, which is not
  // this tenant's connection, so each is called with the turn handed back.
  const announceSignIn = options.onUserSignedIn
    ? async ({ userId, email }: { readonly userId: string; readonly email: string }): Promise<void> => {
        const user = await uow.users.findById(userId);
        const signedIn = {
          userId,
          email,
          canAdminister: user !== null && user.isCompanyAdmin && user.status === UserStatusCode.Active,
          credentialIsOwn: !(await credentialResets.has(userId)),
        };
        await outsideTheTurn(() => options.onUserSignedIn!(signedIn));
      }
    : undefined;
  const claimedElsewhere = options.claimedElsewhere ? () => outsideTheTurn(() => options.claimedElsewhere!()) : undefined;

  const auth = createAuth({
    uow,
    atomic: (fn) => db.transaction(fn, TransactionMode.Immediate),
    hasher,
    secrets,
    settings,
    seedStores,
    sessions,
    loginThrottle: signInLadder,
    sourceThrottle: signInSources,
    accountLocks,
    platformOperatorUnlocks: options.platformOperatorUnlocks === true,
    onAccountLocked: notifyAccountLocked,
    passwordResetTokens,
    onPasswordResetRequested: mailPasswordResetLink,
    canMailUnlockCode: async () => (await securitySmtp()) !== null,
    audit: auditSink,
    resolveEntitlements: options.resolveEntitlements,
    onSignedIn: announceSignIn,
    demoSeeded: options.seedDemoData === true,
    claimedElsewhere,
    seedWhenEmpty,
    onTenantClaimed: offerStandardRoles,
  });

  const resolveCashAndBankParentAccountId = async () => routedAccountId(await accountRouting.get(), CASH_AND_BANK_ROUTING_KEY);

  /**
   * Treasury accounts created before #120 were saved with no ledger account,
   * and every voucher, cheque and opening balance on them is refused. Each gets
   * its own leaf now, account and link in one transaction; a linked account is
   * never touched, so a second start does nothing.
   */
  for (const { id } of (await treasuryAccounts.list()).filter((treasury) => treasury.glAccountId === null)) {
    try {
      const glAccountId = await db.transaction(async () => {
        const treasury = await treasuryAccounts.findById(id);
        if (!treasury || treasury.glAccountId !== null) return null;
        const leafId = await openTreasuryLedgerAccount(treasury, {
          accounts,
          cashAndBankParentAccountId: resolveCashAndBankParentAccountId,
          onOpened: (leaf) =>
            recordSensitiveEvent(auditSink, {
              module: "accounting",
              entityType: "ACCOUNT",
              entityId: leaf.id,
              action: AuditChangeAction.Create,
              actor: "system",
              severity: "INFO",
              details: { treasuryAccountId: treasury.id, changes: diffAuditFields(null, leaf, AUDITED_ACCOUNT_FIELDS) },
            }),
        });
        await treasuryAccounts.update({ ...treasury, glAccountId: leafId });
        await recordSensitiveEvent(auditSink, {
          module: "treasury",
          entityType: "TREASURY_ACCOUNT",
          entityId: treasury.id,
          action: AuditChangeAction.Update,
          actor: "system",
          severity: "WARNING",
          details: { code: treasury.code, name: treasury.name, changes: [{ field: "glAccountId", from: null, to: leafId }] },
        });
        return leafId;
      });
      if (glAccountId) backendLog.info({ area: "treasury-accounts", treasuryAccountId: id, glAccountId }, "linked a treasury account to a ledger account of its own");
    } catch (error) {
      backendLog.error({ area: "treasury-accounts", treasuryAccountId: id, err: error }, "linking a treasury account to the ledger could not complete");
    }
  }
  const resolveCashAndBankAccountIds = async (): Promise<readonly string[]> => {
    const [routing, chart, treasury] = await Promise.all([accountRouting.get(), accounts.list(), treasuryAccounts.list()]);
    return cashAndBankLedgerAccountIds(chart, {
      parentAccountId: routedAccountId(routing, CASH_AND_BANK_ROUTING_KEY),
      restrictedAccountIds: [routedAccountId(routing, RESTRICTED_CASH_ROUTING_KEY)],
      treasuryLedgerAccountIds: treasury.map((account) => account.glAccountId),
    });
  };

  const reportsDeps = {
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
  } satisfies ReportsRoutesDeps;

  const app = createApp(uow, {
    cashAndBankParentAccountId: resolveCashAndBankParentAccountId,
    connectionTurn: options.connectionTurn,
    idempotentRequests: store((s) => createSqliteIdempotentRequestStore(s), (d) => createIdempotentRequestStore(d)),
    secrets,
    beforeTheTurn: auth.beforeTheTurn,
    hrLeases,
    // EXTERNAL CONTRACT: main/lan-client.ts reads both fields at startup and
    // blocks the client on a mismatch. Do not rename them.
    health: () => ({
      ok: true,
      version: process.env["MEZAN_APP_VERSION"] ?? "0.0.0",
      schemaVersion: CURRENT_SCHEMA_VERSION,
    }),
    resolveAuthContext,
    security: { sessions, loginThrottle },
    ...(options.onUserEmailChanged
      ? {
          onUserEmailChanged: async (change) => {
            const announced = { ...change, actorCredentialIsOwn: !(await credentialResets.has(change.actorId)) };
            return outsideTheTurn(() => options.onUserEmailChanged!(announced));
          },
        }
      : {}),
    ...(options.companyOwner
      ? {
          companyOwner: {
            currentOwnerUserId: () => outsideTheTurn(() => options.companyOwner!.currentOwnerUserId()),
            handOver: async (input) => {
              const handed = { ...input, actorCredentialIsOwn: !(await credentialResets.has(input.actorId)) };
              return outsideTheTurn(() => options.companyOwner!.handOver(handed));
            },
          },
        }
      : {}),
    onUserCreated: mailInvitation,
    onUserCredentialSetByOther: (userId, actorId) => credentialResets.mark(userId, new Date().toISOString(), actorId),
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
    tenantMailDestinations: options.tenantMailDestinations,
    branchStore: branches,
    userPreferences,
    branchDirectory: deferredBranchDirectory,
    warehouseStore: warehouses,
    warehouseUse: sqlite ? createWarehouseUse(sqlite) : createPostgresWarehouseUse(db),
    customerStore: customers,
    supplierStore: suppliers,
    customerOpeningBalances,
    supplierOpeningBalances,
    createTransactor: { run: (fn) => auditSink.securityEventsOutlive(() => configTransactor.run(fn)) },
    numbersDrawn: async () => JSON.stringify(await db.all("SELECT code, period, value FROM sequence_counter ORDER BY code, period"), (_key, value: unknown) => (typeof value === "bigint" ? value.toString() : value)),
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
    audit: { store: auditSink, unrecorded: auditSink.unrecorded },
    auditSink,
    barcodeConfigStore: barcodeConfig,
    taxRateRepo: taxRates,
    taxRateUsage: store((s) => createSqliteTaxRateUsage(s), (d) => createTaxRateUsage(d)),
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
              lines.push({ itemId: line.itemId, warehouseId: invoice.warehouseId, qty: line.baseQty });
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
      masterData: masterDataChecks,
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
      treasuryCurrencyBalances: () => foreignTreasuryBalances(),
      baseCurrency: async () => ((await settings.get()) ?? createDefaultSettings()).currency,
    },
    vouchers: {
      receivableAccountId: CERTIFICATE_AR_ACCOUNT_ID,
      masterData: masterDataChecks,
      audit: auditSink,
      // A configured TREASURY_VOUCHER_CONFIRM chain used to be ignored
      // outright: without these two the gate resolved every config to null and
      // held requests were never persisted for the inbox.
      resolveGateConfig: (actionType) => workflowConfigs.resolve(actionType),
    partyName: voucherPartyNameOf,
      approvalRequests,
      documents: vouchers.documents,
      vatFilings,
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
      taxDependents: createReturnTaxCarry({
        returns: purchaseReturnStore,
        tags: createJournalTaxTagPort({ ledger, vatFilings }),
        expected: expectedReturnTaxJournalLines(createPurchaseReturnDocumentType(PURCHASE_RETURN_GL_ACCOUNTS)),
      }),
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
          documentIdsMintedBySystem: true,
          documents: vouchers.documents,
          vatFilings,
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
      releaseRevaluationShare,
    },
    salesInvoices: {
      releaseRevaluationShare,
      repo: salesInvoices,
      versionGuard: { versions: salesInvoices.versions, displayNameOf },
      itemCheck: items,
      masterData: masterDataChecks,
      numbering: { next: (opts) => ledger.numbering.next("SALES_INVOICE", { branchId: opts?.branchId }) },
      gl: createSalesInvoiceGlHook(salesInvoiceGl, STOCK_VARIANCE_ACCOUNTS),
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
      pricingGuard: pricingGuardPortFor(db),
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
      stockRestore: createInventoryStockHook(stockService),
      printContext: async (invoice) => {
        const docNo = invoice.docNo ?? invoice.id;
        const [branch, warehouse, customer, submission, receipt] = await Promise.all([
          branches.findById(invoice.branchId),
          warehouses.findById(invoice.warehouseId),
          customers.findById(invoice.customerId),
          etaService.findByInternalId(docNo),
          etaService.receiptForPrint(docNo),
        ]);
        return {
          branchName: branch?.name ?? null,
          warehouseName: warehouse?.name ?? null,
          customer: customer ? { code: customer.code, taxNumber: customer.taxNumber ?? null, address: customer.address ?? null, phone: customer.phone ?? null } : null,
          etaUuid: (submission?.status === EtaSubmissionStatusCode.Accepted ? submission.etaUuid : null) ?? receipt?.uuid ?? null,
          etaQrValue: receipt?.qrValue ?? null,
        };
      },
      itemTax: salesItemTax,
      sourceDocumentOf: async (invoiceId) => {
        const quote = (await salesQuotes.list({ status: "converted" })).find((candidate) => candidate.convertedInvoiceId === invoiceId);
        return quote
          ? { id: quote.id, number: quote.docNo ?? quote.id, lines: quote.lines.map((line) => ({ lineId: line.lineId, qty: line.qty, unitPrice: line.unitPrice, taxRateId: line.taxRateId ?? null, taxRatePercent: line.taxRatePercent })) }
          : null;
      },
      onDraftCancelled: async (invoice) => {
        await new SalesQuoteService({
          repo: salesQuotes,
          numbering: { next: (opts) => ledger.numbering.next("SALES_QUOTE", { branchId: opts?.branchId }) },
          taxRates,
          taxPolicy: salesTaxPolicySource(settings),
        }).reopenConvertedBy(invoice.id, async (quoteId) =>
          (await salesInvoices.list({ sourceQuoteId: quoteId })).filter((other) => other.status !== SalesInvoiceStatusCode.Cancelled).map((other) => other.id),
        );
      },
      etaDocumentOf: (invoice) => etaVoid.documentOf(invoice.docNo ?? invoice.id),
      withdrawUnsentEtaSubmission: (invoice) =>
        etaVoid.withdraw(invoice.docNo ?? invoice.id, `أُلغيت الفاتورة ${invoice.docNo ?? invoice.id} قبل إرسالها إلى المصلحة.`),
      taxTags: createJournalTaxTagPort({ ledger, vatFilings }),
      taxDependents: createReturnTaxCarry({
        returns: salesReturnStore,
        tags: createJournalTaxTagPort({ ledger, vatFilings }),
        expected: expectedReturnTaxJournalLines(createSalesReturnDocumentType(SALES_RETURN_GL_ACCOUNTS)),
        filing: salesReturnTaxFiling,
      }),
      taxFiling: createSalesInvoiceTaxFiling({ eta: etaService, taxRates, rebuild: rebuildEtaInvoiceSubmission }),
      afterTaxClassified: createAfterTaxClassified({
        receipts: etaReceipts,
        returnsOf: async (invoiceId) => (await salesReturnStore.listByLineRef?.("sourceInvoiceId", [invoiceId], { status: "confirmed" })) ?? [],
      }),
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
      treasuryAccounts,
      cheques,
      gl: salesInvoiceGl,
      // A cheque applied against an invoice lives in the same allocation
      // sub-ledger as a voucher, so a bounce can reopen what it settled (D192).
      allocation: { allocations: vouchers.allocations, invoices: vouchers.invoices, settlement: invoiceSettlement, returns: invoiceReturnCredits },
      raisedBy: chequeRaisedByVoucher,
      bankLegFx: chequeBankLegFx,
      realisedFx,
      audit: auditSink,
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
        vatFilings,
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
        resolveGateConfig: (actionType) => workflowConfigs.resolve(actionType),
    partyName: voucherPartyNameOf,
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
      pricingGuard: pricingGuardPortFor(db),
      opportunities,
      events: eventBus,
    },
    // --- phase9/accounting-depth ---
    exchangeRateRepo: exchangeRates,
    costCenterPl: { ledger, accounts, costCenters },
    fxRevaluation: {
      recordRun: (run) => fxRevaluationRuns.record(run),
      audit: auditSink,
      vatFilings,
      ledger,
      accounts,
      periods: fiscalPeriods,
      numbering: ledger.numbering,
      projects,
      exchangeRates,
      differenceAccounts: () => fxDifferenceAccounts("unrealised"),
      foreignTreasuryCurrencies,
      openFxItems,
      saveShares: (entryId, shares) => vouchers.revaluationShares.saveAll(shares.map((share) => ({ ...share, entryId }))),
      shareConsumer: revaluationShareConsumer,
      releaseSharesRelievedSince,
      foreignResidues,
      realisedDifferenceAccounts: () => fxDifferenceAccounts("realised"),
      releaseItemShare,
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
      rebuildSubmission: rebuildEtaInvoiceSubmission,
      issueDocumentReceipt: async (kind, docId) => {
        const issued =
          kind === EtaReceiptSourceKind.Invoice ? await etaReceipts.issueInvoiceReceipt(docId) : await etaReceipts.issueReturnReceipt(docId);
        if (issued) etaReceipts.scheduleSubmission();
        return issued;
      },
      // D-B4 — corrects and re-issues a REJECTED receipt inside the authority's
      // 96-hour window, referencing the rejected one via header.referenceOldUUID.
      reissueDocumentReceipt: async (kind, docId) => {
        const issued =
          kind === EtaReceiptSourceKind.Invoice
            ? await etaReceipts.reissueInvoiceReceipt(docId)
            : await etaReceipts.reissueReturnReceipt(docId);
        if (issued) etaReceipts.scheduleSubmission();
        return issued;
      },
    },
    reconciliation: { ledger, resolveControls: () => resolveReconciliationControls(), foreignResidues: () => foreignResidues(), stockLedgerDates: () => readStockLedgerDateMismatches(db), stockPositionFaults: async () => stockPositionFaults((await stockService.getValuation()).positions) , allocationsOnReversedVouchers },
    openingBalanceDuplicates: {
      resolveContext: resolveOpeningBalanceDuplicatesContext,
      repair: repairOpeningBalanceDuplicate,
      audit: auditSink,
      transactor: configTransactor,
    },
    // --- phase4/inventory-ops ---
    stockAdjustments: { service: stockAdjustments, audit: auditSink },
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
      owners: createCrmOwnerDirectory(uow.users, uow.roles),
    },
    // --- hr/master-data ---
    hr: {
      transactor: configTransactor,
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
        treasuryAccounts,
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
      disposalProceedsAccounts: async () => {
        const [routing, chart, cashAccountIds, partyControls] = await Promise.all([accountRouting.get(), accounts.list(), resolveCashAndBankAccountIds(), resolvePartyControlAccounts()]);
        return disposalProceedsAccounts(chart, { cashAccountIds, receivableControlAccountId: routedAccountId(routing, "control.receivable"), partyControlAccountIds: [...partyControls.keys()] });
      },
      masterData: masterDataChecks,
      categories: assetCategories,
      assets,
      rateHistory: assetRateHistory,
      runs: depreciationRuns,
      periods: fiscalPeriods,
      gl: salesInvoiceGl,
      warehouses,
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
      warehouses,
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
      activity: vanTripActivity,
      postings: vanReconciliationPostings,
      audit: auditSink,
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
            { mintedBySystem: true },
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
      cashAndBankParentAccountId: resolveCashAndBankParentAccountId,
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
            { mintedBySystem: true },
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
              { mintedBySystem: true },
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
              { mintedBySystem: true },
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
            { mintedBySystem: true },
          );
        },
        ...historicalImportGate,
      },
      accounts: { openingBalanceAccountId: "3210", receivableAccountId: "1105" },
    },
    salesReturns: {
      service: salesReturns,
      invoices: salesReturnInvoices,
      journalTax: (id, request) =>
        nameReturnJournalLineTax(id, request, {
          returns: salesReturnStore,
          tags: createJournalTaxTagPort({ ledger, vatFilings }),
          taxRates,
          expected: expectedReturnTaxJournalLines(createSalesReturnDocumentType(SALES_RETURN_GL_ACCOUNTS)),
          sourceRateOf: async (line) => {
            const invoice = await salesInvoices.findById(line.sourceInvoiceId);
            const source = invoice?.lines.find((candidate) => candidate.lineId === line.sourceLineId);
            return source ? (source.taxRateId ?? null) : undefined;
          },
          filing: salesReturnTaxFiling,
          audit: auditSink,
          auditModule: "sales",
        }),
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
        list: standingSalesReturnRefunds,
        async post(command) {
          const treasury = await treasuryAccounts.findById(command.treasuryAccountId);
          if (!treasury?.glAccountId) {
            throw new SalesReturnNotRefundableError("حساب الخزينة غير موجود أو بلا حساب دفتري.");
          }
          // A return's lines land in one branch's stores, so its branch is a
          // single one: the header's.
          const returnBranchId = (await bridgedDocumentBranchIds(deferredBranchDirectory, "SALES_RETURN", command.returnId))[0] ?? null;
          if (returnBranchId !== null && treasury.branchId !== null && treasury.branchId !== returnBranchId) throw new SalesReturnRefundTreasuryBranchError();
          const customer = await customers.findById(command.customerId);
          const voucherId = `REFUND:${command.returnId}:${randomUUID()}`;
          const service = new VoucherService({
            documentIdsMintedBySystem: true,
            documents: vouchers.documents,
            vatFilings,
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
            // LEDGER INVARIANT: the refund settles the return, so it is booked
            // to the return's branch — the account's own only when the return
            // has none. Booking it to a company-level account's "no branch"
            // left a branch's refund outside that branch's books.
            branchId: returnBranchId ?? treasury.branchId ?? COMPANY_LEVEL_VOUCHER_BRANCH,
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
      invoices: purchaseReturnInvoices,
      journalTax: (id, request) =>
        nameReturnJournalLineTax(id, request, {
          returns: purchaseReturnStore,
          tags: createJournalTaxTagPort({ ledger, vatFilings }),
          taxRates,
          // INVARIANT: inventory left at the moving average, so the entry —
          // not the return's lines — says what its inventory lines carry.
          expected: async (doc, taxRatePercent, sourceInvoiceId, taxRateId) => {
            const entry = doc.journalEntryId ? await ledger.findById(doc.journalEntryId) : null;
            const removed = Money.sum(
              (entry?.lines ?? []).filter((line) => line.accountId === PURCHASE_RETURN_GL_ACCOUNTS.inventoryAccountId).map((line) => line.credit),
            );
            const definition = createPurchaseReturnDocumentType(PURCHASE_RETURN_GL_ACCOUNTS);
            return expectedReturnTaxJournalLines<PurchaseReturnLine>({
              buildGlPosting: (scoped) => definition.buildGlPosting?.(scoped, { valueMoved: removed.negate() }) ?? null,
            })(doc, taxRatePercent, sourceInvoiceId, taxRateId);
          },
          sourceRateOf: async (line) => {
            const invoice = await purchaseInvoices.findById(line.sourceInvoiceId);
            return invoice && line.sourceLineId ? (invoice.lines[Number(line.sourceLineId)]?.taxRateId ?? null) : undefined;
          },
          audit: auditSink,
          auditModule: "purchases",
        }),
    },
    landedCosts: { documents: landedCostDocuments, service: landedCosts },
    installments: {
      masterData: masterDataChecks,
      plans: installmentPlanDocuments,
      plansRepo: installmentPlans,
      followUps,
      collect: collectFromCustomer,
    },
    reports: reportsDeps,
    financialReports: {
      ledger,
      accounts,
      vatAccounts: {
        outputVatAccountId: "2200",
        inputVatAccountId: "1400",
        inputBaseAccountIds: PURCHASE_GL_ACCOUNTS.goodsReceivedNotInvoicedAccountId
          ? [PURCHASE_GL_ACCOUNTS.goodsReceivedNotInvoicedAccountId]
          : [],
        outputBaseAccountIds: async () => [routedAccountId(await accountRouting.get(), "contracting.billings") ?? "2165"],
      },
      taxRates,
      cashAccountIds: resolveCashAndBankAccountIds,
      costOfSalesAccountIds: async () => {
        const [routing, chart, catalogue] = await Promise.all([accountRouting.get(), accounts.list(), items.list()]);
        return costOfSalesLedgerAccountIds(chart, routing, catalogue);
      },
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
        transports: [emailTransport(tenant.smtpEnabled ? tenant : null)],
        customerMessages: customerMail.outbox,
        customerEmail: async (customerId) => (await customers.findById(customerId))?.email ?? null,
      });
      return dispatcher.drain();
    },
    notificationMailConfigured: async () => ((await settings.get()) ?? createDefaultSettings()).smtpEnabled,
    workflow: { configs: workflowConfigs, requests: approvalRequests },
  });

  app.route("/", auth.routes);
  await offerStandardRoles();
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
      cashAccountIds: resolveCashAndBankAccountIds,
      inventoryAccountIds: async () => {
        const [routing, chart, catalogue] = await Promise.all([accountRouting.get(), accounts.list(), items.list()]);
        return { held: inventoryLedgerAccountIds(chart, routing, catalogue), allowance: [INVENTORY_WRITEDOWN_GL_ACCOUNTS.provisionAccountId] };
      },
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

  const areaClosers: object[] = [];
  const ownerDigestSlot: OwnerDigestSlot = {};
  const collectionsScheduleSlot: CollectionsScheduleSlot = {};
  const integrationsSlot: IntegrationsSlot = {};
  const scheduledJobsStatus: { read: () => readonly ScheduledJobStatus[] } = { read: () => [] };
  const areaContext: BackendModuleContext = {
    app,
    db,
    ...(sqlite ? { sqlite } : {}),
    store,
    uow,
    resolveAuthContext,
    sessions,
    hasher,
    audit: auditSink,
    eventBus,
    etaReceipts,
    cashAndBankAccountIds: resolveCashAndBankAccountIds,
    inventoryEvents: {
      subscribe: (handler) => {
        inventoryEventHandlers.add(handler);
        return () => {
          inventoryEventHandlers.delete(handler);
        };
      },
    },
    customerMail: {
      store: customerMail,
      drain: async () => {
        const tenant = (await settings.get()) ?? createDefaultSettings();
        return new NotificationDispatcher({
          notifications,
          recipientEmail: async () => null,
          transports: [emailTransport(tenant.smtpEnabled ? tenant : null)],
          customerMessages: customerMail.outbox,
          customerEmail: async (customerId) => (await customers.findById(customerId))?.email ?? null,
        }).drainCustomerMessages();
      },
      configured: async () => ((await settings.get()) ?? createDefaultSettings()).smtpEnabled,
    },
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
    treasuryFx: { foreignCurrencyByGlAccount: foreignTreasuryCurrencies, rateOn: async (currency, date) => (await exchangeRates.findRate(currency, date))?.rate ?? null },
    periodCloseGuard,
    cloud: options.sessionsInDatabase === true,
    auditQuery: auditSink,
    approvalRequests,
    notificationOutbox: {
      drainOnly: drainNotificationsOnly,
      configured: async () => ((await settings.get()) ?? createDefaultSettings()).smtpEnabled,
    },
    backupStatus: options.backupStatus,
    ownerDigestSlot,
    collectionsScheduleSlot,
    auditChain: auditSink,
    scheduledJobStatus: () => scheduledJobsStatus.read(),
    ...(options.resolveLicenseState ? { resolveLicenseState: options.resolveLicenseState } : {}),
    cloudTenant: options.tenantBinding !== undefined,
    integrations: options.integrations ?? null,
    integrationsSlot,
    addCloser: (closer) => areaClosers.push(closer),
    reports: reportsDeps,
    ...(options.connection?.key ? { databaseKey: options.connection.key } : options.evidenceKey ? { databaseKey: options.evidenceKey } : {}),
    ...(options.secrets ? { secrets: options.secrets } : {}),
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

  branchDirectory = sqlite ? createSqliteBranchDirectory(sqlite) : await createBranchDirectory(db);

  if (options.seedDemoData) {
    const seeded = await seedDemoTenant(app, {
      token: await sessions.issue({
        userId: SEED_ADMIN_USER_ID,
        permissions: ["*"],
        roleCode: null,
        branchScope: ALL_SCOPE,
        warehouseScope: ALL_SCOPE,
      }),
      mint: ({ userId, permissions, roleCode, branchScope }) =>
        sessions.issue({ userId, permissions, roleCode, branchScope: branchScope ? [...branchScope] : ALL_SCOPE, warehouseScope: ALL_SCOPE }),
      audit: auditSink,
      password: options.seedAdminPassword ?? SEED_ADMIN_PASSWORD,
    });
    // The personas were created through POST /users, which marks an admin-set password temporary; a demo login must not be forced to change it.
    if (seeded) for (const user of await uow.users.list()) if (user.mustChangePassword) await uow.users.save({ ...user, mustChangePassword: false });
  }

  async function companyAdmins(): Promise<CompanyAdminAccount[]> {
    return (await uow.users.list())
      .filter((user) => user.isCompanyAdmin && user.status === UserStatusCode.Active && !isErasedUser(user))
      .map((user) => ({ id: user.id, nameAr: user.nameAr, email: user.email }));
  }

  // CONTRACT: idempotent on `eventId`. The platform asks again after a crash
  // until it has seen this succeed, so the same event must leave one row.
  async function recordOwnerAssigned(input: OwnerAssignedRecord): Promise<void> {
    await credentialResets.clear(input.userId);
    const { events } = await auditSink.queryEvents({ stream: "security", action: COMPANY_OWNER_ASSIGNED_AUDIT, entityId: input.userId, limit: OWNER_ASSIGNED_LOOKBACK });
    if (events.some((row) => (row.details as Record<string, unknown> | undefined)?.["eventId"] === input.eventId)) return;
    await recordSecurityEvent(auditSink, {
      module: "admin",
      entityType: "USER",
      entityId: input.userId,
      action: COMPANY_OWNER_ASSIGNED_AUDIT,
      actor: input.actor,
      severity: AuditSeverityCode.Critical,
      details: { previousUserId: input.previousUserId, confirmedBy: input.confirmedBy, eventId: input.eventId, origin: SecurityEventOrigin.Platform },
    });
  }

  async function ownerAccount(query: OwnerAccountQuery): Promise<OwnerAccount | null> {
    const user = "userId" in query ? await uow.users.findById(query.userId) : await uow.users.findByEmail(query.email.trim().toLowerCase());
    if (!user || isErasedUser(user)) return null;
    return { id: user.id, email: user.email, canAdminister: user.isCompanyAdmin && user.status === UserStatusCode.Active };
  }

  async function resetOwnerPassword(cmd: ResetOwnerPasswordCommand): Promise<OwnerPasswordResetOutcome> {
    const owner = cmd.userId ? await uow.users.findById(cmd.userId) : await uow.users.findByEmail(cmd.email.trim().toLowerCase());
    if (!owner || !owner.isCompanyAdmin || owner.status !== UserStatusCode.Active) return OwnerPasswordResetOutcome.OwnerNotFound;
    if (cmd.onlyIfNeverSignedIn && owner.lastLoginAt !== null) return OwnerPasswordResetOutcome.AlreadySignedIn;
    const passwordHash = await hasher.hash(cmd.password);
    // SECURITY: the fence is compared and raised in the same transaction as the
    // password write. A holder that lost its claim while it was paused arrives here
    // with an older generation and writes nothing, so the password the newer holder
    // handed out is the one that still signs in.
    const written = await uow.transaction(async (tx) => {
      if (cmd.fence !== undefined) {
        if (cmd.fence < (await ownerPinFence.current())) return false;
        await ownerPinFence.raiseTo(cmd.fence);
      }
      const current = await tx.users.findById(owner.id);
      if (!current) return OwnerPasswordResetOutcome.OwnerVanished;
      await tx.users.save({ ...current, passwordHash, mustChangePassword: true });
      return true;
    });
    if (written === OwnerPasswordResetOutcome.OwnerVanished) return written;
    if (!written) return OwnerPasswordResetOutcome.Superseded;
    if (!cmd.onlyIfNeverSignedIn) await credentialResets.mark(owner.id, new Date().toISOString(), cmd.actor);
    await sessions.revokeUser(owner.id);
    await credentialsResetByAdministrator(owner.email);
    await recordSecurityEvent(auditSink, {
      module: "auth",
      entityType: "USER",
      entityId: owner.id,
      action: "OWNER_PIN_RESET",
      actor: cmd.actor,
      severity: "CRITICAL",
      details: { email: owner.email, onlyIfNeverSignedIn: cmd.onlyIfNeverSignedIn, origin: SecurityEventOrigin.Platform },
    });
    return OwnerPasswordResetOutcome.Reset;
  }

  const platformUnlockInTheTurn = inTheTurn("platform account unlock");
  const unlockAccount = (account: string, actor: string): Promise<boolean> => {
    const key = account.trim().toLowerCase();
    return platformUnlockInTheTurn(() =>
      auditSink.atomic(async () => {
        if (!(await accountLockStore.lockedAccounts()).includes(key)) return false;
        const user = await uow.users.findByEmail(key);
        await credentialsResetByAdministrator(key);
        await recordSecurityEvent(auditSink, {
          module: "auth",
          entityType: "AUTH_USER",
          entityId: user?.id ?? null,
          action: "ACCOUNT_UNLOCKED_BY_PLATFORM",
          actor,
          severity: "CRITICAL",
          details: { username: key, userId: user?.id ?? null, origin: SecurityEventOrigin.Platform },
        });
        return true;
      }),
    );
  };

  const scheduledJobsEnabled = pass === BackendPass.Serve && (options.scheduledJobs ?? (sqlite ? dbPath !== ":memory:" : true));
  const scheduledJobs = scheduledJobsEnabled
    ? startScheduledJobs({
        jobs: [
          createLeaveAccrualJob({
            batches: hrLeaveAccrualBatches,
            balances: hrLeaveBalances,
            policies: hrLeavePolicies,
            employees: hrEmployees,
            numbering: ledger.numbering,
            transactor: configTransactor,
            generateId: () => randomUUID(),
            allowed: () => (options.entitlements ? hasModule(options.entitlements, "hr") : true),
          }),
          createCrmReminderJob(
            createCrmReminderService({
              activities,
              opportunities,
              log: store((s) => createSqliteActivityReminderLog(s), (d) => createActivityReminderLog(d)),
              notifications,
              users: uow.users,
              eventBus,
              today: async () => tenantTodayIso((await settings.get())?.timezone || DEFAULT_TIME_ZONE),
            }),
            () => (options.entitlements ? hasModule(options.entitlements, "crm") : true),
          ),
        ],
        today: async () => tenantTodayIso((await settings.get())?.timezone || DEFAULT_TIME_ZONE),
        turn: inTheTurn("scheduled jobs"),
      })
    : null;
  if (scheduledJobs) scheduledJobsStatus.read = () => scheduledJobs.status();

  return {
    app,
    audit: auditSink,
    sessions,
    credentialsResetByAdministrator,
    lockedAccounts: () => accountLockStore.lockedAccounts(),
    unlockAccount,
    ownerAccount,
    companyAdmins,
    recordOwnerAssigned,
    resetOwnerPassword,
    etaReceipts,
    ...(sqlite ? { backupTo: (destination: string) => sqlite.backup(destination).then(() => undefined) } : {}),
    runScheduledJobs: () => scheduledJobs?.runNow() ?? null,
    runOwnerDigest: () => (ownerDigestSlot.run ? ownerDigestSlot.run() : Promise.resolve(null)),
    runScheduledCollections: () => (collectionsScheduleSlot.run ? collectionsScheduleSlot.run() : Promise.resolve(null)),
    integrations: integrationsSlot.gateway ?? null,
    async drain() {
      // The bridge's tasks call `scheduleSubmission()`, and a submission run
      // can queue more work, so neither one alone is "nothing left" — loop
      // until both are idle.
      await scheduledJobs?.settle();
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
      scheduledJobs?.stop();
      etaEnqueueBridge.stop();
      etaReceipts.stop();
      // Every store above shares the ONE `sqlite` connection opened at the
      // top of this function, so each store's own close() is a no-op (it
      // doesn't own the connection) — this loop is harmless belt-and-braces,
      // and the real close is the shared connection itself, once.
      for (const h of closers) {
        (h as { close?: () => void }).close?.();
      }
      if (pass === BackendPass.Serve) sqlite?.close();
    },
  };
}
