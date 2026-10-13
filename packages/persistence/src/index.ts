export {
  createSqliteUnitOfWork,
  type SqliteUnitOfWorkHandle,
} from "./unit-of-work.js";
export {
  CURRENT_SCHEMA_VERSION,
  SchemaTooNewError,
  readSchemaVersion,
  stampSchemaVersion,
} from "./schema-sync.js";
export {
  openSqliteConnection,
  withSqliteRead,
  withSqliteTransaction,
  type SqliteConnectionInput,
  type OpenedSqliteConnection,
  type SqliteDriver,
  type SqliteOpenOptions,
} from "./sqlite-connection.js";
export { holdSqliteFile, SqliteFileBusyError, type HeldSqliteFile } from "./sqlite-file-hold.js";
export {
  schema,
  journalEntry,
  journalLine,
  sequenceCounter,
  auditEvent,
  role,
  user,
} from "./schema.js";
export {
  createSqliteSequenceStore,
  type SqliteSequenceStoreHandle,
} from "./sequence-store.js";
export {
  createSqliteSequenceConfigStore,
  type SqliteSequenceConfigStoreHandle,
} from "./sequence-config-store.js";
export {
  createSqliteAuditSink,
  deriveAuditChainKey,
  type SqliteAuditSinkHandle,
  type SqliteAuditSinkOptions,
  type AuditChainVerification,
  type AuditChainVerifyPort,
} from "./audit-sink.js";
export {
  createSqliteAccountRepository,
  type SqliteAccountRepositoryHandle,
} from "./account-repository.js";
export {
  createSqliteSettingsStore,
  type SqliteSettingsStoreHandle,
} from "./settings-store.js";
export {
  createSqliteBarcodeConfigStore,
  type SqliteBarcodeConfigStoreHandle,
} from "./barcode-config-store.js";
export {
  createSqliteUserPreferencesStore,
  type SqliteUserPreferencesStoreHandle,
} from "./user-preferences-store.js";
export {
  createSqliteBranchStore,
  type SqliteBranchStoreHandle,
} from "./branch-store.js";
export {
  createSqliteWarehouseStore,
  type SqliteWarehouseStoreHandle,
} from "./warehouse-store.js";
export {
  createSqliteCustomerRepository,
  type SqliteCustomerRepositoryHandle,
} from "./customer-repository.js";
export {
  createSqliteSupplierRepository,
  type SqliteSupplierRepositoryHandle,
} from "./supplier-repository.js";
export {
  createSqliteItemStore,
  type SqliteItemStoreHandle,
} from "./item-store.js";
export {
  createSqliteNotificationRuleStore,
  type SqliteNotificationRuleStoreHandle,
} from "./notification-rule-store.js";
export {
  createSqliteNotificationStore,
  type SqliteNotificationStoreHandle,
} from "./notification-store.js";
export { createScryptHasher } from "./secret-hasher.js";
export {
  createSqliteTaxRateRepository,
  type SqliteTaxRateRepositoryHandle,
} from "./tax-rate-repository.js";
export { createSqliteTaxRateUsage } from "./tax-rate-usage.js";
export {
  createSqliteCostCenterRepository,
  type SqliteCostCenterRepositoryHandle,
} from "./cost-center-repository.js";
export {
  createSqliteTreasuryAccountRepository,
  type SqliteTreasuryAccountRepositoryHandle,
} from "./treasury-account-repository.js";
export {
  createSqliteFiscalPeriodRepository,
  type SqliteFiscalPeriodRepositoryHandle,
} from "./fiscal-period-repository.js";
export {
  createSqliteStockLedgerStore,
  type SqliteStockLedgerHandle,
} from "./stock-ledger-store.js";
export {
  createSqliteLedgerStore,
  type SqliteLedgerStoreHandle,
} from "./ledger-store.js";
export {
  createSqliteVoucherStore,
  type SqliteVoucherStoreHandle,
} from "./voucher-store.js";
export {
  createSqlitePurchaseOrderStore,
  createSqliteGoodsReceiptStore,
  createSqlitePurchaseInvoiceStore,
  createSqlitePurchasingStores,
  type SqlitePurchaseOrderStoreHandle,
  type SqliteGoodsReceiptStoreHandle,
  type SqlitePurchaseInvoiceStoreHandle,
  type SqlitePurchasingStores,
} from "./purchasing-stores.js";
export { createSqliteSalesInvoiceStore, type SqliteSalesInvoiceStoreHandle } from "./sales-invoice-store.js";
export {
  createSqliteManufacturingStores,
  type SqliteManufacturingStores,
} from "./manufacturing-stores.js";
export { createSqliteRfqStores, type SqliteRfqStores } from "./rfq-store.js";
export {
  createSqliteHistoricalPurchaseArchiveStore,
  type SqliteHistoricalPurchaseArchiveStoreHandle,
} from "./historical-import-store.js";
export {
  createDataMigrationTransactor,
  type DataMigrationTransactor,
  type DataMigrationTransactorHandle,
} from "./data-migration-transactor.js";
export {
  createSqliteHistoricalSalesArchiveStore,
  type SqliteHistoricalSalesArchiveStoreHandle,
} from "./sales-historical-import-store.js";
export {
  createSqliteDocumentStore,
  createStandaloneSqliteDocumentStore,
  ensureDocumentTable,
  type SqliteDocumentStoreHandle,
} from "./document-store.js";
export {
  createSqliteSalesReturnStore,
  createStandaloneSqliteSalesReturnStore,
} from "./sales-return-store.js";
export {
  createSqlitePurchaseReturnStore,
  createStandaloneSqlitePurchaseReturnStore,
} from "./purchase-return-store.js";
export {
  createSqliteLandedCostStore,
  createStandaloneSqliteLandedCostStore,
} from "./landed-cost-store.js";
export {
  createSqliteInstallmentPlanStore,
  createStandaloneSqliteInstallmentPlanStore,
} from "./installment-plan-store.js";
export {
  createSqliteFollowUpStore,
  createStandaloneSqliteFollowUpStore,
  type SqliteFollowUpStoreHandle,
} from "./follow-up-store.js";
export { createSqlitePriceListStore, type SqlitePriceListStoreHandle } from "./price-list-store.js";
export { createSqliteSalesQuoteStore, type SqliteSalesQuoteStoreHandle } from "./sales-quote-store.js";
export { createSqlitePromotionStore, type SqlitePromotionStoreHandle } from "./promotion-store.js";
export {
  createSqliteExchangeRateRepository,
  type SqliteExchangeRateRepositoryHandle,
} from "./exchange-rate-repository.js";
export {
  createSqliteWorkflowConfigStore,
  type SqliteWorkflowConfigStoreHandle,
} from "./workflow-config-store.js";
export {
  createSqliteApprovalRequestStore,
  type SqliteApprovalRequestStoreHandle,
} from "./approval-request-store.js";
export {
  createSqliteEtaStore,
  type SqliteEtaStoreHandle,
  type EtaConfigStore,
} from "./eta-store.js";
export { createSqliteChequeRepository, type SqliteChequeRepositoryHandle } from "./cheque-repository.js";
export {
  createSqliteBankReconciliationStore,
  type SqliteBankReconciliationStoreHandle,
} from "./bank-reconciliation-repository.js";

// --- phase11/crm-projects-assets-field ---
export {
  createSqliteLeadRepository,
  createSqliteOpportunityRepository,
  createSqlitePipelineStageRepository,
  createSqliteActivityRepository,
  type SqliteLeadRepositoryHandle,
  type SqliteOpportunityRepositoryHandle,
  type SqlitePipelineStageRepositoryHandle,
  type SqliteActivityRepositoryHandle,
} from "./crm-store.js";
export { createSqliteProjectRepository, type SqliteProjectRepositoryHandle } from "./project-repository.js";
export { createSqliteGuaranteeStore, type SqliteGuaranteeStoreHandle } from "./contracting-guarantees-store.js";
export {
  createSqliteContractingControlsStore,
  type SqliteContractingControlsStoreHandle,
} from "./contracting-controls-store.js";
export {
  createSqliteContractingRecognitionStore,
  type SqliteRecognitionStoreHandle,
} from "./contracting-recognition-store.js";
export {
  createSqliteWorksContractStore,
  type SqliteWorksContractStoreHandle,
} from "./contracting-contracts-store.js";
export {
  createSqliteProgressCertificateStore,
  type SqliteProgressCertificateStoreHandle,
} from "./contracting-certificates-store.js";
export {
  createSqliteSubcontractStore,
  type SqliteSubcontractStoreHandle,
} from "./contracting-subcontracts-store.js";
export {
  createSqliteAssetCategoryRepository,
  createSqliteAssetInternalRateHistoryRepository,
  createSqliteAssetRepository,
  createSqliteDepreciationRunRepository,
  type SqliteAssetCategoryRepositoryHandle,
  type SqliteAssetInternalRateHistoryRepositoryHandle,
  type SqliteAssetRepositoryHandle,
  type SqliteDepreciationRunRepositoryHandle,
} from "./fixed-assets-store.js";
export { createSqliteVanTripRepository, type SqliteVanTripRepositoryHandle } from "./van-trip-store.js";
export {
  createSqliteFrameworkDocumentStore,
  type FrameworkDocumentStoreOptions,
  type SqliteFrameworkDocumentStoreHandle,
} from "./framework-document-store.js";
export {
  createSqlitePhysicalCountStore,
  type SqlitePhysicalCountStoreHandle,
} from "./physical-count-store.js";
export {
  createSqliteInventoryOpsStore,
  type SqliteInventoryOpsStoreHandle,
} from "./inventory-ops-store.js";
export {
  createSqlitePrintTemplateConfigStore,
  type SqlitePrintTemplateConfigStoreHandle,
} from "./print-template-config-store.js";

// --- hr-store.ts — HR master data (hr/master-data) ---
export {
  createSqliteDepartmentRepository,
  createSqliteJobTitleRepository,
  createSqliteEmployeeRepository,
  createSqliteContractRepository,
  createSqliteHolidayRepository,
  createSqliteLeaveRequestRepository,
  type SqliteDepartmentRepositoryHandle,
  type SqliteJobTitleRepositoryHandle,
  type SqliteEmployeeRepositoryHandle,
  type SqliteContractRepositoryHandle,
  type SqliteHolidayRepositoryHandle,
  type SqliteLeaveRequestRepositoryHandle,
} from "./hr-store.js";

// --- hr-payroll-store.ts — HR payroll runs, payslips and employee advances ---
export {
  createSqliteEmployeeAdvanceRepository,
  createSqlitePayrollRunRepository,
  createSqlitePayslipRepository,
  createSqlitePayrollComponentRepository,
  createSqliteGarnishmentRepository,
  createSqlitePayrollStatutoryFlagRepository,
  type SqlitePayrollStatutoryFlagRepositoryHandle,
  createSqliteStatutoryOverrideRepository,
  type SqliteGarnishmentRepositoryHandle,
  type SqliteStatutoryOverrideRepositoryHandle,
  type SqliteEmployeeAdvanceRepositoryHandle,
  type SqlitePayrollRunRepositoryHandle,
  type SqlitePayslipRepositoryHandle,
  type SqlitePayrollComponentRepositoryHandle,
} from "./hr-payroll-store.js";
export { createSqliteClockCredentialRepository, type SqliteClockCredentialRepositoryHandle } from "./hr-self-store.js";
export { grantSuccessorPermissionsOnce } from "./permission-successors.js";
export { createSqliteWebauthnChallengeRepository, type SqliteWebauthnChallengeRepositoryHandle } from "./webauthn-challenge-store.js";
export {
  createSqliteWritedownRunRepository,
  type SqliteWritedownRunRepositoryHandle,
} from "./writedown-run-store.js";
export {
  createSqliteProductTemplateStore,
  type SqliteProductTemplateStoreHandle,
} from "./product-template-store.js";


export {
  createSqliteLabelLayoutStore,
  type SqliteLabelLayoutStoreHandle,
} from "./label-layout-store.js";

export {
  createSqliteItemCatalogStore,
  createSqliteItemCatalogStores,
  type SqliteItemCatalogStoreHandle,
  type SqliteItemCatalogStores,
} from "./item-catalog-store.js";

export {
  createSqliteItemSpecificationRepository,
  createSqliteItemSpecificationStore,
  type SqliteItemSpecificationStoreHandle,
} from "./item-specification-store.js";

// --- hr-time-leave-store.ts — HR attendance, leave policies, balances, accrual batches ---
export {
  createSqliteAttendanceRepository,
  createSqliteLeavePolicyRepository,
  createSqliteLeaveBalanceRepository,
  createSqliteLeaveAccrualBatchRepository,
  type SqliteAttendanceRepositoryHandle,
  type SqliteLeavePolicyRepositoryHandle,
  type SqliteLeaveBalanceRepositoryHandle,
  type SqliteLeaveAccrualBatchRepositoryHandle,
} from "./hr-time-leave-store.js";

export { createSqliteAccountRoutingStore } from "./account-routing-store.js";

export { createSqliteTaxGroupStore } from "./tax-group-store.js";

export { createSqliteVatFilingStore } from "./vat-filing-store.js";

export {
  createSqliteAttachmentRepository,
  createSqliteAttachmentStore,
  type SqliteAttachmentStoreHandle,
} from "./attachment-store.js";

export {
  createSqliteContractingSiteStore,
  type SqliteContractingSiteStoreHandle,
} from "./contracting-site-store.js";
export { createSqlitePlatformStores, type SqlitePlatformStoresHandle } from "./platform-store.js";

export {
  createSqliteSimplifiedRegimeStore,
  createStandaloneSqliteSimplifiedRegimeStore,
  readSimplifiedRegime,
  type SqliteSimplifiedRegimeStoreHandle,
} from "./simplified-regime-store.js";

export {
  addVersionColumns,
  createDocumentVersionStore,
  StaleDocumentError,
  type DocumentVersionRow,
  type DocumentVersionStore,
} from "./document-version.js";

export * from "./pos/index.js";
export * from "./enh/index.js";
export { createSqliteOwnerPinFence, type OwnerPinFence } from "./owner-pin-fence.js";
export { createSqliteCredentialResetMarks, type CredentialResetMarks } from "./credential-reset-marks.js";
