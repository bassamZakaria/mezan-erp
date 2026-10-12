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
  createAssetSchema: { route: "/assets", table: "asset" },
  createAttachmentSchema: { route: "/attachments", table: "attachment" },
  createBomSchema: { route: "/manufacturing/boms", table: "bom" },
  createBranchSchema: { route: "/branches", table: "branch" },
  createChequeSchema: { route: "/cheques", table: "cheque" },
  createCollectionSchema: { route: "/vouchers/collections", table: "voucher" },
  createConfigInstanceSchema: { route: "/manufacturing/config-instances", table: "config_instance" },
  createContractSchema: { route: "/hr/contracts", table: "hr_contract" },
  createCostCenterSchema: { route: "/cost-centers", table: "cost_center" },
  createCustomerSchema: { route: "/customers", table: "customer", body: (sampled) => ({ ...sampled, openingBalance: "500.00", openingBalanceDate: TODAY }) },
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
  createLabelLayoutSchema: { route: "/label-layouts", table: "label_layout", body: (sampled) => ({ ...sampled, pageSize: "A4", columns: 3, rows: 8, labelWidthMm: 50, labelHeightMm: 25, columnGapMm: 2, rowGapMm: 2, marginBlockMm: 5, marginInlineMm: 5, barcodeHeightMm: 10 }) },
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
  createProjectSchema: { route: "/projects", table: "project", body: (sampled) => ({ ...sampled, costCenterId: "CC-NO-SUCH-CENTER" }) },
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
  createSupplierSchema: { route: "/suppliers", table: "supplier", body: (sampled) => ({ ...sampled, openingBalance: "500.00" }) },
  createTaxRateSchema: { route: "/tax-rates", table: "tax_rate", body: (sampled) => ({ ...sampled, isDefault: true }) },
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
  upsertTaxGroupSchema: {
    route: "/tax-groups",
    table: "tax_group",
    body: (sampled, _id, sqlite) => ({ ...sampled, members: (sampled.members as Record<string, unknown>[]).map((member) => ({ ...member, taxRateId: firstId(sqlite, "tax_rate") })) }),
  },
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
const ID_PRE_CHECK = /\b(refuseExistingId|refuseTakenId|assertRecordIdIsNew)\s*\(/g;

function sourceFilesUnder(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFilesUnder(path);
    return name.endsWith(".ts") && !name.includes(".test.") ? [path] : [];
  });
}

describe("a duplicate id is refused by the store's insert-only write alone", () => {
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
