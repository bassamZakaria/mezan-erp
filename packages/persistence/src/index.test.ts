import { describe, it, expect } from "vitest";
import * as persistence from "./index.js";

describe("package index", () => {
  it("re-exports every store factory as a callable function", () => {
    const factoryNames = [
      "createSqliteUnitOfWork",
      "openSqliteConnection",
      "createSqliteSequenceStore",
      "createSqliteSequenceConfigStore",
      "createSqliteAuditSink",
      "createSqliteAccountRepository",
      "createSqliteSettingsStore",
      "createSqliteBarcodeConfigStore",
      "createSqliteUserPreferencesStore",
      "createSqliteBranchStore",
      "createSqliteWarehouseStore",
      "createSqliteCustomerRepository",
      "createSqliteSupplierRepository",
      "createSqliteItemStore",
      "createSqliteNotificationRuleStore",
      "createSqliteNotificationStore",
      "createScryptHasher",
      "createSqliteTaxRateRepository",
      "createSqliteCostCenterRepository",
      "createSqliteTreasuryAccountRepository",
      "createSqliteFiscalPeriodRepository",
      "createSqliteStockLedgerStore",
      "createSqliteLedgerStore",
      "createSqliteVoucherStore",
      "createSqlitePurchaseOrderStore",
      "createSqliteGoodsReceiptStore",
      "createSqlitePurchaseInvoiceStore",
      "createSqlitePurchasingStores",
      "createSqliteSalesInvoiceStore",
      "createSqliteManufacturingStores",
      "createSqliteRfqStores",
      "createSqliteHistoricalPurchaseArchiveStore",
      "createDataMigrationTransactor",
      "createSqliteHistoricalSalesArchiveStore",
      "createSqliteDocumentStore",
      "createStandaloneSqliteDocumentStore",
      "ensureDocumentTable",
      "createSqliteSalesReturnStore",
      "createStandaloneSqliteSalesReturnStore",
      "createSqlitePurchaseReturnStore",
      "createStandaloneSqlitePurchaseReturnStore",
      "createSqliteLandedCostStore",
      "createStandaloneSqliteLandedCostStore",
      "createSqliteInstallmentPlanStore",
      "createStandaloneSqliteInstallmentPlanStore",
      "createSqliteFollowUpStore",
      "createStandaloneSqliteFollowUpStore",
      "createSqlitePriceListStore",
      "createSqliteSalesQuoteStore",
      "createSqlitePromotionStore",
      "createSqliteExchangeRateRepository",
      "createSqliteWorkflowConfigStore",
      "createSqliteApprovalRequestStore",
      "createSqliteEtaStore",
      "createSqliteChequeRepository",
      "createSqliteBankReconciliationStore",
      "createSqliteLeadRepository",
      "createSqliteOpportunityRepository",
      "createSqlitePipelineStageRepository",
      "createSqliteActivityRepository",
      "createSqliteProjectRepository",
      "createSqliteAssetCategoryRepository",
      "createSqliteAssetRepository",
      "createSqliteDepreciationRunRepository",
      "createSqliteVanTripRepository",
      "createSqliteFrameworkDocumentStore",
      "createSqlitePhysicalCountStore",
      "createSqliteInventoryOpsStore",
      "createSqlitePrintTemplateConfigStore",
      "createSqliteDepartmentRepository",
      "createSqliteJobTitleRepository",
      "createSqliteEmployeeRepository",
      "createSqliteContractRepository",
      "createSqliteHolidayRepository",
      "createSqliteLeaveRequestRepository",
      "createSqliteEmployeeAdvanceRepository",
      "createSqlitePayrollRunRepository",
      "createSqlitePayslipRepository",
      "createSqlitePayrollComponentRepository",
      "createSqliteWritedownRunRepository",
      "createSqliteProductTemplateStore",
      "createSqliteApiKeyStore",
      "createSqliteWebhookStores",
      "createSqliteLabelLayoutStore",
      "createSqliteItemCatalogStore",
      "createSqliteItemCatalogStores",
      "createSqliteItemSpecificationRepository",
      "createSqliteItemSpecificationStore",
      "createSqliteAttendanceRepository",
      "createSqliteLeavePolicyRepository",
      "createSqliteLeaveBalanceRepository",
      "createSqliteLeaveAccrualBatchRepository",
      "createSqliteAccountRoutingStore",
      "createSqliteTaxGroupStore",
      "createSqliteVatFilingStore",
      "createSqliteAttachmentRepository",
      "createSqliteAttachmentStore",
    ] as const;

    for (const name of factoryNames) {
      expect(typeof (persistence as Record<string, unknown>)[name], `${name} should be a function`).toBe("function");
    }
  });

  it("re-exports the drizzle schema objects", () => {
    expect(persistence.schema).toBeDefined();
    expect(persistence.journalEntry).toBeDefined();
    expect(persistence.journalLine).toBeDefined();
    expect(persistence.sequenceCounter).toBeDefined();
    expect(persistence.auditEvent).toBeDefined();
    expect(persistence.role).toBeDefined();
    expect(persistence.user).toBeDefined();
  });

  it("a sampled factory (sequence store) is actually wired end to end through the barrel", async () => {
    const store = persistence.createSqliteSequenceStore();
    try {
      expect(await store.increment("BARREL_TEST", null)).toBe(1);
    } finally {
      store.close();
    }
  });
});
