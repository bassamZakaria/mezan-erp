import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as contracts from "@mezan/contracts";
import { ALL_SCOPE, createEntitlements, LAN_MULTI_TILL_FEATURE, MODULE_CATALOG, RecordErrorCode } from "@mezan/domain";
import { openSqliteConnection } from "@mezan/persistence";
import { createBackend, type BackendHandle } from "./create-backend.js";
import { sampleOf } from "./test-helpers/zod-sample.js";

const BOOT_TIMEOUT_MS = 240_000;
const ARABIC = /[؀-ۿ]/;
const TODAY = new Date().toISOString().slice(0, 10);

interface Res {
  readonly status: number;
  readonly body: any;
}

interface CreateRoute {
  readonly route: string;
  readonly table: string;
  readonly idColumn?: string;
  readonly existingIdSql?: string;
  readonly pathFor?: (sqlite: Sqlite) => string;
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

const SEEDED_REFERENCES: Record<string, unknown> = {
  customerId: "CUST-DEMO-2",
  supplierId: "SUPP-DEMO-1",
  warehouseId: "WH-MAIN",
  sourceWarehouseId: "WH-MAIN",
  branchId: "BR-MAIN",
  itemId: "ITEM-DEMO-1",
  employeeId: "EMP-DEMO-1",
  currency: "EGP",
  date: TODAY,
};

/*
 * Every create schema in @mezan/contracts that accepts a caller-supplied `id`,
 * mapped to the route that parses it and the table its row lands in. A schema
 * added later with an `id` and no entry here fails the suite.
 */
const CREATE_ROUTES: Record<string, CreateRoute> = {
  createAccountSchema: { route: "/accounts", table: "account" },
  createAssetCategorySchema: { route: "/assets/categories", table: "asset_category" },
  createAssetSchema: { route: "/assets", table: "asset" },
  createAttachmentSchema: { route: "/attachments", table: "attachment" },
  createBomSchema: { route: "/manufacturing/boms", table: "bom" },
  createBranchSchema: { route: "/branches", table: "branch" },
  createChequeSchema: { route: "/cheques", table: "cheque" },
  createCollectionSchema: { route: "/vouchers/collections", table: "voucher" },
  createConfigInstanceSchema: { route: "/manufacturing/config-instances", table: "config_instance" },
  createContractSchema: { route: "/hr/contracts", table: "hr_contract" },
  createCostCenterSchema: { route: "/cost-centers", table: "cost_center" },
  createCustomerSchema: { route: "/customers", table: "customer" },
  createDepartmentSchema: { route: "/hr/departments", table: "hr_department" },
  createEmployeeAdvanceSchema: { route: "/hr/advances", table: "hr_employee_advance" },
  createEmployeeSchema: { route: "/hr/employees", table: "hr_employee" },
  createEquipmentLogSchema: { route: "/contracting/site/equipment-logs", table: "equipment_log" },
  createExchangeRateSchema: { route: "/exchange-rates", table: "exchange_rate" },
  createFollowUpSchema: { route: "/installments/follow-ups", table: "collection_follow_up" },
  createGarnishmentSchema: { route: "/hr/payroll/garnishments", table: "hr_garnishment" },
  createGlJournalEntrySchema: { route: "/gl/journal-entries", table: "journal_entry", body: (_e, id) => journal(id) },
  createGoodsReceiptSchema: { route: "/purchases/receipts", table: "goods_receipt" },
  createGuaranteeSchema: { route: "/contracting/guarantees", table: "contracting_guarantee" },
  createHolidaySchema: { route: "/hr/holidays", table: "hr_holiday" },
  createInstallmentPlanSchema: { route: "/installments/plans", table: "framework_document", existingIdSql: "SELECT * FROM framework_document WHERE doc_type = 'INSTALLMENT_PLAN' ORDER BY id LIMIT 1" },
  createItemCategorySchema: { route: "/item-categories", table: "item_category" },
  createItemSchema: { route: "/items", table: "item" },
  createJobTitleSchema: { route: "/hr/job-titles", table: "hr_job_title" },
  createLabelLayoutSchema: { route: "/label-layouts", table: "label_layout" },
  createLandedCostSchema: { route: "/landed-costs", table: "framework_document", existingIdSql: "SELECT * FROM framework_document WHERE doc_type = 'LANDED_COST' ORDER BY id LIMIT 1" },
  createLeadSchema: { route: "/crm/leads", table: "crm_lead" },
  createLeavePolicySchema: { route: "/hr/leave-policies", table: "hr_leave_policy" },
  createLeaveRequestSchema: { route: "/hr/leave-requests", table: "hr_leave_request" },
  createMaterialConsumptionSchema: { route: "/contracting/site/consumptions", table: "material_consumption" },
  createNotificationRuleSchema: { route: "/notification-rules", table: "notification_rule" },
  createOpportunitySchema: { route: "/crm/opportunities", table: "crm_opportunity" },
  createActivitySchema: { route: "/crm/activities", table: "crm_activity" },
  createPayrollComponentSchema: { route: "/hr/payroll/components", table: "hr_payroll_component" },
  createPayrollRunSchema: { route: "/hr/payroll/runs", table: "hr_payroll_run" },
  createPipelineStageSchema: { route: "/crm/pipeline-stages", table: "crm_pipeline_stage" },
  createPriceListSchema: { route: "/price-lists", table: "price_list" },
  createProgressCertificateSchema: { route: "/contracting/certificates", table: "contracting_certificate" },
  createProjectSchema: { route: "/projects", table: "project" },
  createPromotionSchema: { route: "/promotions", table: "promotion" },
  createPurchaseInvoiceSchema: { route: "/purchases/invoices", table: "purchase_invoice", body: (_e, id) => purchaseDocument(id) },
  createPurchaseOrderSchema: { route: "/purchases/orders", table: "purchase_order" },
  createPurchaseReturnSchema: { route: "/purchase-returns", table: "framework_document", existingIdSql: "SELECT * FROM framework_document WHERE doc_type = 'PURCHASE_RETURN' ORDER BY id LIMIT 1" },
  createPurchaseRfqSchema: { route: "/rfqs", table: "purchase_rfq" },
  createRecurringJournalTemplateSchema: { route: "/gl/recurring/templates", table: "recurring_journal_template" },
  createRetentionReleaseSchema: { route: "/contracting/retention/releases", table: "contracting_retention_release" },
  createSalesInvoiceSchema: { route: "/sales-invoices", table: "sales_invoice", body: (_e, id) => salesDocument(id) },
  createSalesQuoteSchema: { route: "/sales-quotes", table: "sales_quote", body: (_e, id) => salesDocument(id) },
  createSalesReturnSchema: { route: "/sales-returns", table: "framework_document", existingIdSql: "SELECT * FROM framework_document WHERE doc_type = 'SALES_RETURN' ORDER BY id LIMIT 1" },
  createSiteIssueSchema: { route: "/contracting/site/issues", table: "site_issue" },
  createSiteReceiptSchema: { route: "/contracting/site/receipts", table: "site_receipt" },
  createStockAdjustmentSchema: { route: "/inventory/stock-adjustments/draft", table: "stock_adjustment_document" },
  createStockTransferSchema: { route: "/inventory/stock-transfers/draft", table: "stock_transfer_document" },
  createSubCertificateSchema: { route: "/contracting/subcontract-certificates", table: "subcontract_certificate" },
  createSubcontractSchema: { route: "/contracting/subcontracts", table: "subcontract" },
  createSupplierSchema: { route: "/suppliers", table: "supplier" },
  createTaxRateSchema: { route: "/tax-rates", table: "tax_rate" },
  createTreasuryAccountSchema: { route: "/treasury-accounts", table: "treasury_account" },
  createVanSchema: { route: "/field/vans", table: "van" },
  createVariationOrderSchema: { route: "/contracting/variation-orders", table: "contract_variation_order" },
  createVoucherSchema: { route: "/vouchers", table: "voucher" },
  createWarehouseSchema: { route: "/warehouses", table: "warehouse" },
  createWorkOrderSchema: { route: "/manufacturing/work-orders", table: "work_order" },
  createWorkStationSchema: { route: "/manufacturing/work-stations", table: "work_station" },
  createWorksContractSchema: { route: "/contracting/contracts", table: "works_contract" },
  importBankStatementSchema: { route: "/bank-statements/import", table: "bank_statement" },
  importStatementFileSchema: { route: "/bank-statements/import-file", table: "bank_statement" },
  issueCustodySchema: { route: "/contracting/site/custody", table: "site_custody" },
  openVanTripSchema: { route: "/field/van-trips", table: "van_trip" },
  postRecognitionRunSchema: { route: "/contracting/recognition/runs", table: "contracting_recognition_run" },
  recordAttendanceSchema: { route: "/hr/attendance", table: "hr_attendance" },
  recordVatFilingSchema: { route: "/gl/vat-filings", table: "vat_filing" },
  selfCreateLeaveRequestSchema: { route: "/hr/self/leave-requests", table: "hr_leave_request" },
  startPhysicalCountSchema: { route: "/inventory/physical-counts", table: "physical_count" },
  upsertItemBrandSchema: { route: "/item-brands", table: "item_brand" },
  upsertItemSeasonSchema: { route: "/item-seasons", table: "item_season" },
  upsertTaxGroupSchema: { route: "/tax-groups", table: "tax_group" },
  upsertConfigurableProductSchema: { route: "/manufacturing/configurable-products", table: "configurable_product" },
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
    pathFor: (sqlite) => `/rfqs/${(sqlite.prepare("SELECT rfq_id AS id FROM rfq_quote ORDER BY id LIMIT 1").get() as { id: string }).id}/quotes`,
  },
  saveJournalEntryAsTemplateSchema: {
    route: "/gl/recurring/templates/from-entry/:entryId",
    table: "recurring_journal_template",
    pathFor: (sqlite) => `/gl/recurring/templates/from-entry/${firstId(sqlite, "journal_entry")}`,
  },
  convertSalesQuoteToInvoiceSchema: {
    route: "/sales-quotes/:id/convert-to-invoice",
    table: "sales_invoice",
    pathFor: (sqlite) => `/sales-quotes/${firstId(sqlite, "sales_quote")}/convert-to-invoice`,
  },
  buildSalesReturnFromInvoiceSchema: { route: "/sales-returns/from-invoice", table: "framework_document", existingIdSql: "SELECT * FROM framework_document WHERE doc_type = 'SALES_RETURN' ORDER BY id LIMIT 1" },
};

/* Schemas that carry an `id` and create nothing under it, each with the reason. */
const NOT_A_CREATE: Record<string, string> = {
  recordVanCashMovementSchema: "the handler mints the movement id itself; the body id is never stored",
  recordRecentSchema: "the id names the record the user just opened; the store keys by user and record",
  buildPurchaseReturnFromInvoiceSchema: "no route parses it",
  createContractLineItemSchema: "a nested line of createContractSchema, never a request body",
  createJournalDocumentSchema: "no route parses it",
  cardCheckoutSchema: "platform checkout: the id is the tenant's own, resolved from the session",
  configInputSchema: "a nested input of the configurator preview, which stores nothing",
  importableDepartmentSchema: "a response shape; no route parses it",
  openInvoiceSchema: "an open invoice as the allocation screen reads it, a response",
  postPostingChangesReportSchema: "a response shape; no route parses it",
  postedAdjustmentSchema: "a response shape; no route parses it",
  postedTransferSchema: "a response shape; no route parses it",
};

const CREATE_NAME = /^(create|upsert|open|record|issue|start|post|import|save|add|build|convert|selfCreate|cardCheckout|configInput)/;

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

const createSchemasWithId = Object.entries(contracts)
  .filter(([name, value]) => CREATE_NAME.test(name) && value && typeof value === "object" && "_def" in (value as object))
  .filter(([, value]) => Object.prototype.hasOwnProperty.call(unwrapped(value)?.shape ?? {}, "id"))
  .map(([name]) => name)
  .sort();

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

function tableCounts(): Record<string, number> {
  const tables = sqlite.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").all() as { name: string }[];
  return Object.fromEntries(tables.map(({ name }) => [name, (sqlite.prepare(`SELECT count(*) AS n FROM "${name}"`).get() as { n: number }).n]));
}

describe("every create schema with a caller-supplied id is covered", () => {
  it("maps each one to a route, or says why it creates nothing", () => {
    const unmapped = createSchemasWithId.filter((name) => !CREATE_ROUTES[name] && !NOT_A_CREATE[name]);
    expect(unmapped).toEqual([]);
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
    const existing = sqlite.prepare(entry.existingIdSql ?? `SELECT * FROM "${entry.table}" ORDER BY "${idColumn}" LIMIT 1`).get() as Record<string, unknown> | undefined;
    expect(existing, `${entry.table} has no seeded row to collide with`).toBeDefined();
    const id = String(existing![idColumn]);
    const path = entry.pathFor ? entry.pathFor(sqlite) : entry.route;
    const sampled = sampleOf((contracts as Record<string, any>)[schemaName], { ...SEEDED_REFERENCES, id }) as Record<string, unknown>;
    const body = entry.body ? entry.body(sampled, id, sqlite) : sampled;
    expect((contracts as Record<string, any>)[schemaName].safeParse(body).success, `the body the test sends is not a valid ${schemaName}: ${JSON.stringify(body).slice(0, 300)}`).toBe(true);

    const rowBefore = JSON.stringify(sqlite.prepare(`SELECT * FROM "${entry.table}" WHERE "${idColumn}" = ?`).get(id));
    const countsBefore = tableCounts();
    const res = await admin("POST", path, body);
    const rowAfter = JSON.stringify(sqlite.prepare(`SELECT * FROM "${entry.table}" WHERE "${idColumn}" = ?`).get(id));
    const countsAfter = tableCounts();
    outcomes.push(`${schemaName}\t${path}\t${res.status}\t${res.body?.error ?? ""}\t${rowBefore === rowAfter ? "row-same" : "ROW-CHANGED"}\t${JSON.stringify(res.body).slice(0, 160)}`);

    expect(res.status, JSON.stringify(res.body).slice(0, 300)).toBe(409);
    expect(res.body?.error).toBe(RecordErrorCode.DuplicateId);
    expect(res.body?.message).toMatch(ARABIC);
    expect(rowAfter).toBe(rowBefore);
    expect(countsAfter).toEqual(countsBefore);
  });
});
