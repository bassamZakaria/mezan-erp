import { createHash } from "node:crypto";
import { mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as contracts from "@mezan/contracts";
import { ALL_SCOPE, createEntitlements, LAN_MULTI_TILL_FEATURE, MODULE_CATALOG, RecordErrorCode } from "@mezan/domain";
import { openSqliteConnection } from "@mezan/persistence";
import { createBackend, type BackendHandle } from "./create-backend.js";
import { sampleOf } from "./test-helpers/zod-sample.js";

const BOOT_TIMEOUT_MS = 240_000;
const ARABIC = /[؀-ۿ]/;
const TODAY = new Date().toISOString().slice(0, 10);
const SAME_CALLER_OTHER_CONTENTS = contracts.IdempotencyRefusal.KeyReused;

interface Res {
  readonly status: number;
  readonly body: any;
}

interface CreateRoute {
  readonly route: string;
  readonly table: string;
  readonly idColumn?: string;
  readonly refusedAs?: string;
  readonly existingIdSql?: string;
  readonly pathFor?: (sqlite: Sqlite) => string;
  readonly arrange?: (sqlite: Sqlite) => void;
  readonly body?: (sampled: any, id: string, sqlite: Sqlite) => Record<string, unknown>;
}

type Sqlite = ReturnType<typeof openSqliteConnection>["sqlite"];

const firstId = (sqlite: Sqlite, table: string): string => (sqlite.prepare(`SELECT id FROM "${table}" ORDER BY id LIMIT 1`).get() as { id: string }).id;

const serviceLine = (id: string) => ({
  lineId: `${id}-L1`,
  itemId: "ITEM-DEMO-1",
  itemNameAr: "خدمة اختبار",
  isStock: false,
  qty: "1",
  unitPrice: "100",
  taxRatePercent: 14,
  revenueAccountId: "4100",
  cogsAccountId: "5100",
  inventoryAccountId: "1200",
});

const salesDocument = (id: string) => ({
  id,
  date: TODAY,
  dueDate: TODAY,
  expiryDate: TODAY,
  customerId: "CUST-DEMO-2",
  customerNameAr: "مؤسسة النور للمقاولات",
  warehouseId: "WH-MAIN",
  branchId: "BR-MAIN",
  currency: "EGP",
  arAccountId: "1105",
  taxAccountId: "2200",
  lines: [serviceLine(id)],
});

const purchaseDocument = (id: string) => ({
  id,
  supplierId: "SUPP-DEMO-1",
  date: TODAY,
  branchId: "BR-MAIN",
  warehouseId: "WH-MAIN",
  currency: "EGP",
  lines: [{ itemId: "ITEM-DEMO-1", qty: "1", unitCost: "140", kind: "inventory", taxRatePercent: 14 }],
});

const journal = (id: string) => ({
  id,
  date: TODAY,
  memo: "قيد اختبار المعرّف المكرر",
  source: "manual",
  lines: [
    { accountId: "5200", debit: "10.00", credit: "0" },
    { accountId: "2190", debit: "0", credit: "10.00" },
  ],
});

const SITE_WAREHOUSE = "WH-SITE-TOWER";
const CONFIRMED_SALES_INVOICE = "INV-H-202411-12";
const ofxStatementFor = (accountNumber: string) =>
  `<OFX><BANKMSGSRSV1><STMTTRNRS><STMTRS><CURDEF>EGP</CURDEF><BANKACCTFROM><ACCTID>${accountNumber}</ACCTID></BANKACCTFROM><BANKTRANLIST><DTSTART>20990101</DTSTART><DTEND>20990131</DTEND><STMTTRN><TRNTYPE>CREDIT</TRNTYPE><DTPOSTED>20990105</DTPOSTED><TRNAMT>100.00</TRNAMT><FITID>DUP-F1</FITID><NAME>WIRE IN</NAME></STMTTRN></BANKTRANLIST><LEDGERBAL><BALAMT>100.00</BALAMT></LEDGERBAL></STMTRS></STMTTRNRS></BANKMSGSRSV1></OFX>`;

const SEEDED_REFERENCES: Record<string, unknown> = {
  customerId: "CUST-DEMO-2",
  supplierId: "SUPP-DEMO-1",
  warehouseId: "WH-MAIN",
  sourceWarehouseId: "WH-MAIN",
  branchId: "BR-MAIN",
  itemId: "ITEM-DEMO-1",
  employeeId: "EMP-DEMO-1",
  projectId: "PRJ-DEMO-1",
  contractId: "CTR-DEMO-1",
  subcontractId: "SUB-DEMO-1",
  assetId: "ASSET-DEMO-PLANT-1",
  issueId: "ISS-DEMO-1",
  currency: "EGP",
  date: TODAY,
};

/*
 * Every schema a route parses that carries an identifier the CALLER chooses —
 * `id`, a `code` that is the row's key, any `…requestId` — mapped to the route
 * that parses it and the table its row lands in. The list of schemas is read
 * from the route sources, not from their names: one added later, whatever it is
 * called, fails the suite until it is mapped here or explained below.
 */
const UPDATE_BY_PATH = "an update of the record its path names; the code is an attribute of that record, not the key a row is created under";

const CREATE_ROUTES: Record<string, CreateRoute> = {
  createAccountSchema: { route: "/accounts", table: "account" },
  createAssetCategorySchema: { route: "/assets/categories", table: "asset_category" },
  createAssetSchema: { route: "/assets", table: "asset", body: (sampled, _id, sqlite) => ({ ...sampled, code: "AST-DUP-ID", nameAr: "أصل اختبار", categoryId: firstId(sqlite, "asset_category"), acquisitionCost: "1000.00" }) },
  createAttachmentSchema: { route: "/attachments", table: "attachment" },
  createBomSchema: { route: "/manufacturing/boms", table: "bom" },
  createBranchSchema: { route: "/branches", table: "branch" },
  createChequeSchema: {
    refusedAs: SAME_CALLER_OTHER_CONTENTS,
    route: "/cheques",
    table: "cheque",
    body: (sampled) => ({ ...sampled, issueDate: TODAY, dueDate: TODAY, chequeNumber: "DUP-0099", bankName: "بنك مصر", branchId: "BR-MAIN", partyId: "CUST-DEMO-2", counterpartyGlAccountId: "1105", controlAccounts: { underCollectionAccountId: "1320", bouncedAccountId: "1360" } }),
  },
  createCollectionSchema: { route: "/vouchers/collections", table: "voucher", body: (sampled) => ({ ...sampled, customerId: "CUST-DEMO-2", branchId: "BR-MAIN", treasuryAccountId: "TR-DEMO-CASH" }) },
  createConfigInstanceSchema: {
    route: "/manufacturing/config-instances",
    table: "config_instance",
    body: (sampled) => ({ ...sampled, configurableProductId: "CFGP-DEMO-1", spec: { teaKg: "3", sugarKg: "5" }, qty: "1", sourceWarehouseId: "WH-MAIN", wipWarehouseId: "WH-WIP", destinationWarehouseId: "WH-MAIN", scheduledStartDate: TODAY }),
  },
  createContractSchema: { route: "/hr/contracts", table: "hr_contract", body: (sampled) => ({ ...sampled, monthlySalary: "5000.00", allowances: [], deductions: [] }) },
  createCostCenterSchema: { route: "/cost-centers", table: "cost_center" },
  createCustomerSchema: { route: "/customers", table: "customer", body: (sampled) => ({ ...sampled, openingBalance: "500.00", openingBalanceDate: TODAY }) },
  createDepartmentSchema: { route: "/hr/departments", table: "hr_department" },
  createEmployeeAdvanceSchema: { route: "/hr/advances", table: "hr_employee_advance" },
  createEmployeeSchema: { route: "/hr/employees", table: "hr_employee" },
  createEquipmentLogSchema: { route: "/contracting/site/equipment-logs", table: "equipment_log", body: (sampled) => ({ ...sampled, date: TODAY, hours: "1" }) },
  createExchangeRateSchema: { route: "/exchange-rates", table: "exchange_rate" },
  createFollowUpSchema: { route: "/installments/follow-ups", table: "collection_follow_up" },
  createGarnishmentSchema: { route: "/hr/payroll/garnishments", table: "hr_garnishment" },
  createGlJournalEntrySchema: { route: "/gl/journal-entries", table: "journal_entry", body: (_e, id) => journal(id) },
  createGoodsReceiptSchema: {
    route: "/purchases/receipts",
    table: "goods_receipt",
    body: (sampled) => ({ ...sampled, date: TODAY, supplierId: "SUPP-DEMO-1", branchId: "BR-MAIN", warehouseId: "WH-MAIN", lines: [{ itemId: "ITEM-DEMO-1", qty: "1", unitCost: "140" }] }),
  },
  createGuaranteeSchema: {
    route: "/contracting/guarantees",
    table: "contracting_guarantee",
    body: (sampled) => ({ ...sampled, beneficiaryNameAr: "جهة مستفيدة", bankTreasuryAccountId: "TR-DEMO-BANK", projectId: "PRJ-DEMO-1", issueDate: "2026-01-15", expiryDate: "2027-01-15" }),
  },
  createHolidaySchema: { route: "/hr/holidays", table: "hr_holiday" },
  createInstallmentPlanSchema: { route: "/installments/plans", table: "framework_document", existingIdSql: "SELECT * FROM framework_document WHERE doc_type = 'INSTALLMENT_PLAN' ORDER BY id LIMIT 1" },
  createItemCategorySchema: { route: "/item-categories", table: "item_category" },
  createItemSchema: { route: "/items", table: "item" },
  createJobTitleSchema: { route: "/hr/job-titles", table: "hr_job_title" },
  createLabelLayoutSchema: { route: "/label-layouts", table: "label_layout", body: (sampled) => ({ ...sampled, pageSize: "A4", columns: 3, rows: 8, labelWidthMm: 50, labelHeightMm: 25, columnGapMm: 2, rowGapMm: 2, marginBlockMm: 5, marginInlineMm: 5, barcodeHeightMm: 10 }) },
  createLandedCostSchema: { route: "/landed-costs", table: "framework_document", existingIdSql: "SELECT * FROM framework_document WHERE doc_type = 'LANDED_COST' ORDER BY id LIMIT 1", refusedAs: SAME_CALLER_OTHER_CONTENTS },
  createLeadSchema: { route: "/crm/leads", table: "crm_lead" },
  createLeavePolicySchema: {
    route: "/hr/leave-policies",
    table: "hr_leave_policy",
    arrange: (sqlite) => sqlite.prepare("DELETE FROM hr_leave_policy WHERE id = (SELECT id FROM hr_leave_policy ORDER BY id DESC LIMIT 1)").run(),
    body: (sampled, _id, sqlite) => {
      const held = new Set((sqlite.prepare("SELECT leave_type AS type FROM hr_leave_policy").all() as { type: string }[]).map((row) => row.type));
      return { ...sampled, leaveType: contracts.leaveTypeSchema.options.find((type) => !held.has(type)) };
    },
  },
  createLeaveRequestSchema: { route: "/hr/leave-requests", table: "hr_leave_request" },
  createMaterialConsumptionSchema: {
    route: "/contracting/site/consumptions",
    table: "material_consumption",
    body: (sampled) => ({ ...sampled, date: TODAY, warehouseId: SITE_WAREHOUSE, boqLineId: "CTR-DEMO-1-B2", lines: [{ itemId: "ITEM-DEMO-3", qty: "1" }] }),
  },
  createNotificationRuleSchema: { route: "/notification-rules", table: "notification_rule", body: (sampled) => ({ ...sampled, name: "قاعدة اختبار", eventCode: "SALES_INVOICE_CONFIRMED", recipientValue: "sales.invoice.view" }) },
  createOpportunitySchema: { route: "/crm/opportunities", table: "crm_opportunity" },
  createActivitySchema: { route: "/crm/activities", table: "crm_activity" },
  createPayrollComponentSchema: { route: "/hr/payroll/components", table: "hr_payroll_component" },
  createPayrollRunSchema: { route: "/hr/payroll/runs", table: "hr_payroll_run", body: (sampled) => ({ ...sampled, year: 2099, month: 1 }) },
  createPipelineStageSchema: { route: "/crm/pipeline-stages", table: "crm_pipeline_stage" },
  createPriceListSchema: { route: "/price-lists", table: "price_list" },
  createProgressCertificateSchema: { route: "/contracting/certificates", table: "contracting_certificate", body: (sampled) => ({ ...sampled, periodFrom: "2026-11-01", periodTo: "2026-11-30" }) },
  createProjectSchema: { route: "/projects", table: "project", body: (sampled) => ({ ...sampled, costCenterId: "CC-NO-SUCH-CENTER" }) },
  createPromotionSchema: { route: "/promotions", table: "promotion", body: (sampled) => ({ ...sampled, code: "DUP-ID-PROMO", nameAr: "عرض اختبار", percentValue: 10 }) },
  createPurchaseInvoiceSchema: { route: "/purchases/invoices", table: "purchase_invoice", body: (_e, id) => purchaseDocument(id), refusedAs: SAME_CALLER_OTHER_CONTENTS },
  createPurchaseOrderSchema: { route: "/purchases/orders", table: "purchase_order" },
  createPurchaseReturnSchema: {
    refusedAs: SAME_CALLER_OTHER_CONTENTS,
    route: "/purchase-returns",
    table: "framework_document",
    existingIdSql: "SELECT * FROM framework_document WHERE doc_type = 'PURCHASE_RETURN' ORDER BY id LIMIT 1",
    body: (sampled) => ({
      ...sampled,
      date: TODAY,
      branchId: "BR-MAIN",
      lines: [
        { itemId: "ITEM-H-01", warehouseId: "WH-MAIN", supplierId: "SUPP-H-01", sourceInvoiceId: "PI-H-202401-01", sourceInvoiceNumber: "PI-000001", reason: "DEFECTIVE", availableQty: "600", qty: "1", unitCost: "23.76", taxAmount: "0" },
      ],
    }),
  },
  createPurchaseRfqSchema: { route: "/rfqs", table: "purchase_rfq" },
  createRecurringJournalTemplateSchema: {
    route: "/gl/recurring/templates",
    table: "recurring_journal_template",
    body: (sampled) => ({
      ...sampled,
      yearlyMonth: null,
      endDate: null,
      nameAr: "قالب اختبار",
      memo: "قيد دوري للاختبار",
      lines: [
        { accountId: "5200", debit: "10.00", credit: "0" },
        { accountId: "2190", debit: "0", credit: "10.00" },
      ],
    }),
  },
  createRetentionReleaseSchema: { route: "/contracting/retention/releases", table: "contracting_retention_release", body: (sampled) => ({ ...sampled, contractId: "CTR-DEMO-1", date: TODAY, amount: "1.00" }) },
  createSalesInvoiceSchema: { route: "/sales-invoices", table: "sales_invoice", body: (_e, id) => salesDocument(id), refusedAs: SAME_CALLER_OTHER_CONTENTS },
  createSalesQuoteSchema: { route: "/sales-quotes", table: "sales_quote", body: (_e, id) => salesDocument(id) },
  createSalesReturnSchema: {
    refusedAs: SAME_CALLER_OTHER_CONTENTS,
    route: "/sales-returns",
    table: "framework_document",
    existingIdSql: "SELECT * FROM framework_document WHERE doc_type = 'SALES_RETURN' ORDER BY id LIMIT 1",
    body: (sampled, _id, sqlite) => ({
      ...sampled,
      date: TODAY,
      branchId: "BR-MAIN",
      lines: [
        {
          itemId: "ITEM-H-13",
          warehouseId: "WH-MAIN",
          customerId: "CUST-H-22",
          sourceInvoiceId: CONFIRMED_SALES_INVOICE,
          sourceInvoiceNumber: (sqlite.prepare("SELECT doc_no AS no FROM sales_invoice WHERE id = ?").get(CONFIRMED_SALES_INVOICE) as { no: string }).no,
          reason: "DEFECTIVE",
          availableQty: "51",
          qty: "1",
          unitPrice: "151.78",
          unitCost: "115.657359",
          taxAmount: "0",
        },
      ],
    }),
  },
  createSiteIssueSchema: {
    route: "/contracting/site/issues",
    table: "site_issue",
    body: (sampled) => ({ ...sampled, date: TODAY, fromWarehouseId: "WH-MAIN", toWarehouseId: SITE_WAREHOUSE, lines: [{ itemId: "ITEM-DEMO-3", qty: "1" }] }),
  },
  createSiteReceiptSchema: { route: "/contracting/site/receipts", table: "site_receipt", body: (sampled) => ({ ...sampled, date: TODAY, lines: [{ itemId: "ITEM-DEMO-3", qtyReceived: "1" }] }) },
  createStockAdjustmentSchema: {
    route: "/inventory/stock-adjustments/draft",
    table: "stock_adjustment_document",
    body: (sampled) => ({ ...sampled, date: TODAY, branchId: "BR-MAIN", lines: [{ itemId: "ITEM-DEMO-1", warehouseId: "WH-MAIN", reason: "INITIAL_STOCK", direction: "IN", qty: "1", unitCost: "140" }] }),
  },
  createStockTransferSchema: {
    refusedAs: SAME_CALLER_OTHER_CONTENTS,
    route: "/inventory/stock-transfers/draft",
    table: "stock_transfer_document",
    body: (sampled) => ({ ...sampled, date: TODAY, branchId: "BR-MAIN", lines: [{ itemId: "ITEM-DEMO-1", fromWarehouseId: "WH-MAIN", toWarehouseId: "WH-DEMO-2", qty: "1" }] }),
  },
  createSubCertificateSchema: { route: "/contracting/subcontract-certificates", table: "subcontract_certificate", body: (sampled) => ({ ...sampled, periodFrom: "2026-11-01", periodTo: "2026-11-30" }) },
  createSubcontractSchema: {
    route: "/contracting/subcontracts",
    table: "subcontract",
    body: (sampled) => ({ ...sampled, titleAr: "عقد باطن للاختبار", signedDate: "2026-01-15", startDate: "2026-02-01", plannedEndDate: "2026-12-31" }),
  },
  createSupplierSchema: { route: "/suppliers", table: "supplier", body: (sampled) => ({ ...sampled, openingBalance: "500.00" }) },
  createTaxRateSchema: { route: "/tax-rates", table: "tax_rate", body: (sampled) => ({ ...sampled, isDefault: true }) },
  createTreasuryAccountSchema: { route: "/treasury-accounts", table: "treasury_account" },
  createVanSchema: { route: "/field/vans", table: "van" },
  createVariationOrderSchema: {
    route: "/contracting/variation-orders",
    table: "contract_variation_order",
    body: (sampled) => ({
      ...sampled,
      date: TODAY,
      titleAr: "أمر تغيير للاختبار",
      reason: "بند إضافي",
      requestedBy: "المالك",
      lines: [{ kind: "add", newLine: { code: "VO-DUP-1", descriptionAr: "بند إضافي للاختبار", unit: contracts.boqUnitSchema.options[0], qty: "1", unitRate: "100" } }],
    }),
  },
  createVoucherSchema: { route: "/vouchers", table: "voucher", body: (sampled) => ({ ...sampled, date: TODAY, branchId: "BR-MAIN", treasuryAccountId: "TR-DEMO-CASH", partyId: "CUST-DEMO-2", counterpartyGlAccountId: "1105" }) },
  createWarehouseSchema: { route: "/warehouses", table: "warehouse", body: ({ projectId: _siteOnly, ...sampled }) => sampled },
  createWorkOrderSchema: {
    route: "/manufacturing/work-orders",
    table: "work_order",
    body: (sampled) => ({ ...sampled, bomId: "BOM-DEMO-1", plannedQty: "1", sourceWarehouseId: "WH-MAIN", wipWarehouseId: "WH-WIP", destinationWarehouseId: "WH-MAIN", scheduledStartDate: TODAY }),
  },
  createWorkStationSchema: { route: "/manufacturing/work-stations", table: "work_station" },
  createWorksContractSchema: {
    route: "/contracting/contracts",
    table: "works_contract",
    body: (sampled) => ({ ...sampled, titleAr: "عقد مقاولة للاختبار", signedDate: "2026-01-15", startDate: "2026-02-01", plannedEndDate: "2026-12-31" }),
  },
  importBankStatementSchema: {
    route: "/bank-statements/import",
    table: "bank_statement",
    body: (sampled) => ({
      ...sampled,
      treasuryAccountId: "TR-DEMO-BANK",
      rawCsv: "date,description,amount\n2099-01-05,رسوم اختبار,100.00",
      mapping: { dateColumn: "date", descriptionColumn: "description", amountColumn: "amount" },
      periodStart: "2099-01-01",
      periodEnd: "2099-01-31",
      openingBalance: "0.00",
      closingBalance: "100.00",
    }),
  },
  importStatementFileSchema: { route: "/bank-statements/import-file", table: "bank_statement", body: (sampled, _id, sqlite) => ({
      ...sampled,
      treasuryAccountId: "TR-DEMO-BANK",
      content: ofxStatementFor((sqlite.prepare("SELECT bank_account_number AS no FROM treasury_account WHERE id = 'TR-DEMO-BANK'").get() as { no: string }).no),
    }),
  },
  issueCustodySchema: { route: "/contracting/site/custody", table: "site_custody", body: (sampled) => ({ ...sampled, warehouseId: SITE_WAREHOUSE, descriptionAr: "عهدة للاختبار", qtyOut: "1", issuedDate: TODAY }) },
  openVanTripSchema: {
    route: "/field/van-trips",
    table: "van_trip",
    body: (sampled) => ({ ...sampled, date: TODAY, vanId: "VAN-DEMO-1", sourceWarehouseId: "WH-MAIN", sourceTreasuryAccountId: "TR-DEMO-CASH", crew: [{ employeeId: "EMP-DEMO-1", role: "driver" }] }),
  },
  postRecognitionRunSchema: { route: "/contracting/recognition/runs", table: "contracting_recognition_run", body: (sampled) => ({ ...sampled, contractId: "CTR-DEMO-1", periodEnd: "2026-09-30" }) },
  recordAttendanceSchema: { route: "/hr/attendance", table: "hr_attendance", body: (sampled) => ({ ...sampled, date: "2099-01-05" }) },
  recordVatFilingSchema: { route: "/gl/vat-filings", table: "vat_filing" },
  selfCreateLeaveRequestSchema: { route: "/hr/self/leave-requests", table: "hr_leave_request" },
  startPhysicalCountSchema: { route: "/inventory/physical-counts", table: "physical_count" },
  upsertItemBrandSchema: { route: "/item-brands", table: "item_brand" },
  upsertItemSeasonSchema: { route: "/item-seasons", table: "item_season" },
  upsertTaxGroupSchema: {
    route: "/tax-groups",
    table: "tax_group",
    body: (sampled, _id, sqlite) => ({ ...sampled, members: (sampled.members as Record<string, unknown>[]).map((member) => ({ ...member, taxRateId: firstId(sqlite, "tax_rate") })) }),
  },
  upsertConfigurableProductSchema: {
    route: "/manufacturing/configurable-products",
    table: "configurable_product",
    body: (sampled) => ({
      ...sampled,
      code: "CFG-DUP-ID",
      nameAr: "منتج اختبار",
      outputItemId: "ITEM-DEMO-9",
      unit: "PCS",
      inputs: [{ id: "teaKg", labelAr: "وزن الشاي", type: "number", min: 1, max: 20 }],
      materials: [{ itemId: "ITEM-DEMO-4", qtyFormula: "teaKg*2" }],
    }),
  },
  addManualLineSchema: {
    route: "/bank-statements/:id/lines",
    table: "statement_line",
    pathFor: (sqlite) => `/bank-statements/${firstId(sqlite, "bank_statement")}/lines`,
  },
  createBomVersionSchema: {
    route: "/manufacturing/boms/:id/version",
    table: "bom",
    pathFor: (sqlite) => `/manufacturing/boms/${firstId(sqlite, "bom")}/version`,
  },
  createRfqQuoteSchema: {
    route: "/rfqs/:id/quotes",
    table: "rfq_quote",
    pathFor: () => "/rfqs/RFQ-DEMO-2/quotes",
    body: (sampled) => ({ ...sampled, supplierId: "SUPP-DEMO-2", lines: [{ itemId: "ITEM-DEMO-1", unitPrice: "10.00" }] }),
  },
  saveJournalEntryAsTemplateSchema: {
    route: "/gl/recurring/templates/from-entry/:entryId",
    table: "recurring_journal_template",
    pathFor: (sqlite) =>
      `/gl/recurring/templates/from-entry/${(sqlite.prepare("SELECT id FROM journal_entry WHERE id NOT IN (SELECT entry_id FROM journal_line WHERE account_id IN ('1105', '2100')) ORDER BY id LIMIT 1").get() as { id: string }).id}`,
    body: (sampled) => ({ ...sampled, yearlyMonth: null, endDate: null, nameAr: "قالب من قيد" }),
  },
  convertSalesQuoteToInvoiceSchema: {
    route: "/sales-quotes/:id/convert-to-invoice",
    table: "sales_invoice",
    arrange: (sqlite) => sqlite.prepare("UPDATE sales_quote SET status = 'accepted' WHERE id = 'SQ-DEMO-3'").run(),
    pathFor: () => "/sales-quotes/SQ-DEMO-3/convert-to-invoice",
    body: (sampled) => ({ ...sampled, dueDate: TODAY, warehouseId: "WH-MAIN", arAccountId: "1105", taxAccountId: "2200", lines: [{ lineId: "SQ-DEMO-3-L1", isStock: false, revenueAccountId: "4100" }] }),
  },
  buildSalesReturnFromInvoiceSchema: {
    route: "/sales-returns/from-invoice",
    table: "framework_document",
    existingIdSql: "SELECT * FROM framework_document WHERE doc_type = 'SALES_RETURN' ORDER BY id LIMIT 1",
    body: (sampled) => ({ ...sampled, date: TODAY, sourceInvoiceId: CONFIRMED_SALES_INVOICE, warehouseId: "WH-MAIN", requested: [{ itemId: "ITEM-H-13", qty: "1" }] }),
  },
  createItemUnitSchema: { route: "/item-units", table: "item_unit", idColumn: "code", refusedAs: "DUPLICATE_ITEM_UNIT_CODE" },
  createItemSpecificationSchema: {
    route: "/item-specifications",
    table: "item_specification",
    idColumn: "code",
    refusedAs: "DUPLICATE_ITEM_SPECIFICATION_CODE",
    body: (_sampled, code) => ({ code, nameAr: "مواصفة مكررة", type: "text" }),
  },
};

/* Route-parsed schemas that carry such a key and create nothing under it, each with the reason. */
const NOT_A_CREATE: Record<string, string> = {
  recordVanCashMovementSchema: "the handler mints the movement id itself; the body id is never stored",
  salesInvoiceSchema: "shapes the response of a create; no request is parsed with it",
  salesQuoteSchema: "shapes the response of a create; no request is parsed with it",
  periodCloseSummarySchema: "shapes the response of a read; no request is parsed with it",
  parseBarcodeRequestSchema: "the code is a scanned barcode to decode; nothing is stored",
  createProductTemplateSchema: "the row's key is an id the server mints; the code is a unique attribute with its own refusal",
  createRoleSchema: "the row's key is an id the server mints; the code is a unique attribute with its own refusal",
  updateBranchSchema: UPDATE_BY_PATH,
  updateCustomerSchema: UPDATE_BY_PATH,
  updatePriceListSchema: UPDATE_BY_PATH,
  updatePromotionSchema: UPDATE_BY_PATH,
  updateRoleSchema: UPDATE_BY_PATH,
  updateSupplierSchema: UPDATE_BY_PATH,
  updateWarehouseSchema: UPDATE_BY_PATH,
};

const ROUTE_SOURCES = join(dirname(fileURLToPath(import.meta.url)), "../../api/src");
const PARSED_BY_A_ROUTE = /\b([A-Za-z0-9_]+Schema)\b\s*\.\s*(?:safeParse|parse)\(/g;
const CALLER_CHOSEN_IDENTIFIER = /^(id|code|.*[rR]equestId)$/;

const unwrapped = (schema: any): any => {
  let current = schema;
  for (let depth = 0; depth < 10; depth++) {
    const def = current?._def;
    if (def?.innerType) current = def.innerType;
    else if (def?.schema) current = def.schema;
    else if (def?.in) current = def.in;
    else break;
  }
  return current;
};

const routeSource = readdirSync(ROUTE_SOURCES)
  .filter((file) => file.endsWith(".ts") && !file.includes(".test."))
  .map((file) => readFileSync(join(ROUTE_SOURCES, file), "utf8"))
  .join("\n");
const parsedByARoute = [...new Set([...routeSource.matchAll(PARSED_BY_A_ROUTE)].map((match) => match[1]!))];

const identifierKeysOf = (name: string): string[] => {
  const keys = Object.keys(unwrapped((contracts as Record<string, unknown>)[name])?.shape ?? {});
  const chosen = keys.filter((key) => CALLER_CHOSEN_IDENTIFIER.test(key));
  return chosen.includes("id") ? chosen.filter((key) => key !== "code") : chosen;
};

const createSchemasWithId = parsedByARoute.filter((name) => identifierKeysOf(name).length > 0).sort();

let handle: BackendHandle;
let sqlite: Sqlite;
let admin: (method: string, path: string, body?: unknown) => Promise<Res>;

beforeAll(async () => {
  const dbPath = join(mkdtempSync(join(tmpdir(), "mezan-dup-id-")), "books.db");
  const resolveEntitlements = () =>
    createEntitlements({ plan: "DEMO", activeModules: MODULE_CATALOG, features: { [LAN_MULTI_TILL_FEATURE]: true }, seats: 50, expiresAt: null });
  handle = await createBackend({ dbPath, seedDemoData: true, lan: { resolveEntitlements }, resolveEntitlements });
  sqlite = openSqliteConnection(dbPath).sqlite;
  const token = handle.sessions.issue({ userId: "USER-ADMIN", permissions: ["*"], roleCode: null, branchScope: ALL_SCOPE, warehouseScope: ALL_SCOPE });
  admin = async (method, path, body) => {
    const res = await handle.app.fetch(
      new Request(`http://local${path}`, {
        method,
        headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
        body: body === undefined ? undefined : JSON.stringify(body),
      }),
    );
    const text = await res.text();
    try {
      return { status: res.status, body: text ? JSON.parse(text) : null };
    } catch {
      return { status: res.status, body: text };
    }
  };
}, BOOT_TIMEOUT_MS);

afterAll(() => {
  sqlite?.close();
  handle?.close();
});

function tableFingerprints(): Record<string, string> {
  const tables = sqlite.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").all() as { name: string }[];
  return Object.fromEntries(
    tables.map(({ name }) => {
      const rows = (sqlite.prepare(`SELECT * FROM "${name}"`).all() as unknown[]).map((row) => JSON.stringify(row)).sort();
      return [name, `${rows.length}:${createHash("sha1").update(rows.join("\n")).digest("hex")}`];
    }),
  );
}

const DOMAIN_SOURCES = join(dirname(fileURLToPath(import.meta.url)), "../../domain/src");
const ID_PRE_CHECK = /\b(refuseExistingId|refuseTakenId|assertRecordIdIsNew|new DuplicateRecordIdError)\s*\(/g;

function sourceFilesUnder(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFilesUnder(path);
    return name.endsWith(".ts") && !name.includes(".test.") && !path.includes("/test-helpers/") ? [path] : [];
  });
}

describe("a duplicate id is refused by the store's insert-only write alone", () => {
  it("only the persistence layer raises the refusal", () => {
    const raisedIn = sourceFilesUnder(join(DOMAIN_SOURCES, "../../persistence/src")).filter((path) => readFileSync(path, "utf8").includes("new DuplicateRecordIdError("));
    expect(raisedIn.map((path) => path.split("/packages/")[1])).toEqual(["persistence/src/insert-new.ts"]);
  });

  it("no route or domain service looks the id up first", () => {
    const preChecks = [...sourceFilesUnder(ROUTE_SOURCES), ...sourceFilesUnder(DOMAIN_SOURCES)].flatMap((path) =>
      [...readFileSync(path, "utf8").matchAll(ID_PRE_CHECK)].map((match) => `${path.split("/packages/")[1]}: ${match[1]}`),
    );
    expect(preChecks).toEqual([]);
  });
});

describe("every create schema with a caller-supplied id is covered", () => {
  it("maps each one to a route, or says why it creates nothing", () => {
    const unmapped = createSchemasWithId.filter((name) => !CREATE_ROUTES[name] && !NOT_A_CREATE[name]);
    expect(unmapped).toEqual([]);
  });

  it("reads the request schemas from the route sources", () => {
    expect(parsedByARoute.length).toBeGreaterThan(200);
    expect(parsedByARoute).toContain("submitApprovalRequestSchema");
    expect(parsedByARoute).toContain("decideApprovalRequestSchema");
  });

  it("the approval routes take no identifier from the caller", () => {
    expect(identifierKeysOf("submitApprovalRequestSchema")).toEqual([]);
    expect(identifierKeysOf("decideApprovalRequestSchema")).toEqual([]);
    expect(identifierKeysOf("confirmSalesInvoiceSchema")).toEqual([]);
    expect(identifierKeysOf("confirmVoucherSchema")).toEqual([]);
  });

  it("names no schema that no longer exists or no longer takes an id", () => {
    const stale = [...Object.keys(CREATE_ROUTES), ...Object.keys(NOT_A_CREATE)].filter((name) => !createSchemasWithId.includes(name));
    expect(stale).toEqual([]);
  });

  it("names only routes the application mounts", () => {
    const mounted = new Set(handle.app.routes.filter((route) => route.method === "POST").map((route) => route.path));
    const unmounted = Object.values(CREATE_ROUTES).filter((entry) => !mounted.has(entry.route)).map((entry) => entry.route);
    expect(unmounted).toEqual([]);
  });
});

describe("a create that names an existing record's id is refused and writes nothing", () => {
  const outcomes: string[] = [];

  afterAll(() => {
    if (process.env.MEZAN_DUP_ID_REPORT) writeFileSync(process.env.MEZAN_DUP_ID_REPORT, outcomes.join("\n"));
  });

  it.each(Object.entries(CREATE_ROUTES))("%s", async (schemaName, entry) => {
    const idColumn = entry.idColumn ?? "id";
    entry.arrange?.(sqlite);
    const existing = sqlite.prepare(entry.existingIdSql ?? `SELECT * FROM "${entry.table}" ORDER BY "${idColumn}" LIMIT 1`).get() as Record<string, unknown> | undefined;
    expect(existing, `${entry.table} has no seeded row to collide with`).toBeDefined();
    const id = String(existing![idColumn]);
    const path = entry.pathFor ? entry.pathFor(sqlite) : entry.route;
    const sampled = sampleOf((contracts as Record<string, any>)[schemaName], { ...SEEDED_REFERENCES, [idColumn]: id }) as Record<string, unknown>;
    const body = entry.body ? entry.body(sampled, id, sqlite) : sampled;
    expect((contracts as Record<string, any>)[schemaName].safeParse(body).success, `the body the test sends is not a valid ${schemaName}: ${JSON.stringify(body).slice(0, 300)}`).toBe(true);

    const rowBefore = JSON.stringify(sqlite.prepare(`SELECT * FROM "${entry.table}" WHERE "${idColumn}" = ?`).get(id));
    const before = tableFingerprints();
    const res = await admin("POST", path, body);
    const rowAfter = JSON.stringify(sqlite.prepare(`SELECT * FROM "${entry.table}" WHERE "${idColumn}" = ?`).get(id));
    const after = tableFingerprints();
    outcomes.push(`${schemaName}\t${path}\t${res.status}\t${res.body?.error ?? ""}\t${rowBefore === rowAfter ? "row-same" : "ROW-CHANGED"}\t${JSON.stringify(res.body).slice(0, 160)}`);

    expect(res.status, JSON.stringify(res.body).slice(0, 300)).toBe(409);
    expect(res.body?.error).toBe(entry.refusedAs ?? RecordErrorCode.DuplicateId);
    expect(res.body?.message).toMatch(ARABIC);
    expect(rowAfter).toBe(rowBefore);
    expect(after).toEqual(before);
  });
});

describe("a refused create spends no document number", () => {
  const counters = () => JSON.stringify(sqlite.prepare("SELECT code, period, value FROM sequence_counter ORDER BY code, period").all());
  const NOBODY_HOLDS = "DUP-ID-NO-SUCH-RECORD";
  const unknownReferences = Object.fromEntries(Object.keys(SEEDED_REFERENCES).map((key) => [key, NOBODY_HOLDS]));
  const refusals: string[] = [];

  async function as(permissions: readonly string[], path: string, body: unknown): Promise<Res> {
    const token = handle.sessions.issue({ userId: "USER-DUP-ID-NOBODY", permissions: [...permissions], roleCode: null, branchScope: ALL_SCOPE, warehouseScope: ALL_SCOPE });
    const res = await handle.app.fetch(new Request(`http://local${path}`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${token}` }, body: JSON.stringify(body) }));
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : null };
  }

  it.each(Object.entries(CREATE_ROUTES))("%s — refused for a taken id, for a reference nobody holds and for a missing permission, the counters stand where they stood", async (schemaName, entry) => {
    const idColumn = entry.idColumn ?? "id";
    entry.arrange?.(sqlite);
    const existing = sqlite.prepare(entry.existingIdSql ?? `SELECT * FROM "${entry.table}" ORDER BY "${idColumn}" LIMIT 1`).get() as Record<string, unknown>;
    const path = entry.pathFor ? entry.pathFor(sqlite) : entry.route;
    const schema = (contracts as Record<string, any>)[schemaName];
    const bodyFor = (references: Record<string, unknown>, id: string) => {
      const sampled = sampleOf(schema, { ...references, [idColumn]: id }) as Record<string, unknown>;
      return entry.body ? entry.body(sampled, id, sqlite) : sampled;
    };
    const taken = bodyFor(SEEDED_REFERENCES, String(existing[idColumn]));
    const fresh = `DUP-ID-FRESH-${schemaName}`;
    const attempts: readonly (readonly [string, () => Promise<Res>])[] = [
      ["a taken id", () => admin("POST", path, taken)],
      ["a reference nobody holds", () => admin("POST", path, { ...bodyFor(SEEDED_REFERENCES, fresh), ...unknownReferences, [idColumn]: fresh })],
      ["no permission", () => as([], path, bodyFor(SEEDED_REFERENCES, fresh))],
    ];
    for (const [label, attempt] of attempts) {
      const before = counters();
      const res = await attempt();
      if (res.status < 400) continue;
      refusals.push(`${schemaName}\t${label}\t${res.status}`);
      expect(counters(), `${schemaName} · ${label} · ${res.status} ${JSON.stringify(res.body).slice(0, 200)}`).toBe(before);
    }
  });

  it.each([
    ["more cash than the source drawer holds", { openingCashFloat: "999999999.00" }],
    ["more stock than the source warehouse holds", { loadedStock: [{ itemId: "ITEM-DEMO-1", qty: "99999999" }] }],
    ["more cash than the drawer holds, after its stock was loaded", { loadedStock: [{ itemId: "ITEM-DEMO-1", qty: "1" }], openingCashFloat: "999999999.00" }],
  ])("a van trip refused for %s — after its number was drawn — gives the number back", async (_label, excess) => {
    const body = { ...CREATE_ROUTES["openVanTripSchema"]!.body!(sampleOf(contracts.openVanTripSchema, { ...SEEDED_REFERENCES, id: `DUP-ID-TRIP-${Object.keys(excess)[0]}` }), "", sqlite), ...excess };
    expect(contracts.openVanTripSchema.safeParse(body).success, JSON.stringify(body).slice(0, 300)).toBe(true);
    const before = counters();
    const trips = sqlite.prepare("SELECT count(*) AS n FROM van_trip").get();
    const movements = sqlite.prepare("SELECT count(*) AS n FROM stock_movement").get();
    const res = await admin("POST", "/field/van-trips", body);
    expect(res.status, JSON.stringify(res.body).slice(0, 300)).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
    expect(res.body?.message).toMatch(ARABIC);
    expect(counters()).toBe(before);
    expect(sqlite.prepare("SELECT count(*) AS n FROM van_trip").get()).toEqual(trips);
    expect(sqlite.prepare("SELECT count(*) AS n FROM stock_movement").get()).toEqual(movements);
  });

  it("was refused in each of the three ways on most routes, so the table above measured something", () => {
    const count = (label: string) => refusals.filter((line) => line.includes(`\t${label}\t`)).length;
    const routes = Object.keys(CREATE_ROUTES).length;
    expect(count("a taken id")).toBe(routes);
    expect(count("no permission")).toBe(routes);
    expect(count("a reference nobody holds")).toBeGreaterThan(routes / 2);
    expect(new Set(refusals.map((line) => line.split("\t")[2]))).toEqual(expect.objectContaining(new Set(["409", "403"])));
  });
});

