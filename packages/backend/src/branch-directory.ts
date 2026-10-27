import type Database from "better-sqlite3";
import { BranchAccess, BranchRecordKind, type BranchDirectory } from "@mezan/api";
import { documentIdOfConfirmRequest } from "@mezan/domain";
import type { SqlDb } from "@mezan/persistence";
import { WAREHOUSE_FAMILIES, columnsOfTable, lineWarehousesOf, linesColumnIn, linesColumnOf, warehouseColumnsIn, warehouseColumnsOf } from "./warehouse-families.js";

type Branches = readonly (string | null)[] | null;
type Resolver = (id: string, access: BranchAccess) => Promise<Branches>;

const K = BranchRecordKind;

const OWN_OR_WAREHOUSE = "COALESCE(NULLIF(d.branch_id, ''), (SELECT w.branch_id FROM warehouse w WHERE w.id = d.warehouse_id))";
const OF_WAREHOUSE = "(SELECT w.branch_id FROM warehouse w WHERE w.id = d.warehouse_id)";
const OF_EMPLOYEE = "(SELECT e.branch_id FROM hr_employee e WHERE e.id = d.employee_id)";

interface ColumnSource {
  readonly table: string;
  readonly branch: string;
  readonly numberColumn?: string;
}

const COLUMN_SOURCES: Partial<Record<BranchRecordKind, ColumnSource>> = {
  [K.Warehouse]: { table: "warehouse", branch: "d.branch_id" },
  [K.TreasuryAccount]: { table: "treasury_account", branch: "d.branch_id" },
  [K.SalesInvoice]: { table: "sales_invoice", branch: OWN_OR_WAREHOUSE, numberColumn: "doc_no" },
  [K.SalesQuote]: { table: "sales_quote", branch: "d.branch_id", numberColumn: "doc_no" },
  [K.PurchaseOrder]: { table: "purchase_order", branch: OWN_OR_WAREHOUSE, numberColumn: "number" },
  [K.PurchaseInvoice]: { table: "purchase_invoice", branch: OWN_OR_WAREHOUSE, numberColumn: "number" },
  [K.GoodsReceipt]: { table: "goods_receipt", branch: OF_WAREHOUSE, numberColumn: "number" },
  [K.Rfq]: { table: "purchase_rfq", branch: OWN_OR_WAREHOUSE, numberColumn: "number" },
  [K.Voucher]: { table: "voucher", branch: "d.branch_id", numberColumn: "doc_no" },
  [K.Cheque]: { table: "cheque", branch: "d.branch_id" },
  [K.BankStatement]: {
    table: "bank_statement",
    branch: "COALESCE(NULLIF(d.branch_id, ''), (SELECT t.branch_id FROM treasury_account t WHERE t.id = d.treasury_account_id))",
  },
  [K.PhysicalCount]: { table: "physical_count", branch: OF_WAREHOUSE, numberColumn: "count_no" },
  [K.MaterialConsumption]: { table: "material_consumption", branch: OF_WAREHOUSE, numberColumn: "doc_no" },
  [K.SiteCustody]: { table: "site_custody", branch: OF_WAREHOUSE },
  [K.SiteIssue]: { table: "site_issue", branch: "(SELECT w.branch_id FROM warehouse w WHERE w.id = d.from_warehouse_id)", numberColumn: "doc_no" },
  [K.SiteReceipt]: {
    table: "site_receipt",
    branch: "(SELECT w.branch_id FROM warehouse w JOIN site_issue i ON i.to_warehouse_id = w.id WHERE i.id = d.issue_id)",
    numberColumn: "doc_no",
  },
  [K.WorkOrder]: { table: "work_order", branch: "(SELECT w.branch_id FROM warehouse w WHERE w.id = d.source_warehouse_id)", numberColumn: "number" },
  [K.Asset]: { table: "asset", branch: OWN_OR_WAREHOUSE },
  [K.Van]: { table: "van", branch: OWN_OR_WAREHOUSE },
  [K.VanTrip]: { table: "van_trip", branch: "d.branch_id" },
  [K.Employee]: { table: "hr_employee", branch: "d.branch_id" },
  [K.EmployeeContract]: { table: "hr_contract", branch: OF_EMPLOYEE },
  [K.Attendance]: { table: "hr_attendance", branch: OF_EMPLOYEE },
  [K.LeaveRequest]: { table: "hr_leave_request", branch: OF_EMPLOYEE },
  [K.LeaveBalance]: { table: "hr_leave_balance", branch: OF_EMPLOYEE },
  [K.EmployeeAdvance]: { table: "hr_employee_advance", branch: OF_EMPLOYEE },
  [K.Garnishment]: { table: "hr_garnishment", branch: OF_EMPLOYEE },
  [K.PayrollRun]: { table: "hr_payroll_run", branch: "d.branch_id" },
  [K.Payslip]: {
    table: "hr_payslip",
    branch: `COALESCE((SELECT NULLIF(r.branch_id, '') FROM hr_payroll_run r WHERE r.id = d.run_id), ${OF_EMPLOYEE})`,
  },
  [K.PosTerminal]: { table: "pos_terminal", branch: OWN_OR_WAREHOUSE },
  [K.ShiftTemplate]: { table: "shift_template", branch: "d.branch_id" },
  [K.CostCenter]: { table: "cost_center", branch: "d.branch_id" },
  [K.Customer]: { table: "customer", branch: "d.branch_id" },
  [K.Supplier]: { table: "supplier", branch: "d.branch_id" },
  [K.CrmOpportunity]: { table: "crm_opportunity", branch: "d.branch_id" },
  [K.CrmActivity]: {
    table: "crm_activity",
    branch: "(SELECT o.branch_id FROM crm_opportunity o WHERE o.id = d.related_opportunity_id)",
  },
};

const FRAMEWORK_DOC_TYPE: Partial<Record<BranchRecordKind, string>> = Object.fromEntries(
  WAREHOUSE_FAMILIES.filter((family) => family.docType !== undefined).map((family) => [family.kind, family.docType]),
);

/** The warehouse columns a write on a stored record draws on, where that is not every warehouse the record names. */
const ACTING_WAREHOUSE_COLUMNS: Partial<Record<BranchRecordKind, readonly string[]>> = {
  [K.SiteIssue]: ["from_warehouse_id"],
  [K.VanTrip]: ["van_warehouse_id"],
};

const SOURCE_DOCUMENT_KINDS = [K.SalesInvoice, K.PurchaseInvoice, K.GoodsReceipt, K.PurchaseOrder, K.SalesQuote] as const;
const ANY_DOCUMENT_KINDS = [
  ...SOURCE_DOCUMENT_KINDS,
  K.Voucher,
  K.SalesReturn,
  K.PurchaseReturn,
  K.LandedCost,
  K.InstallmentPlan,
  K.StockAdjustment,
  K.StockTransfer,
  K.JournalEntry,
  K.Cheque,
  K.WorkOrder,
  K.PayrollRun,
  K.Rfq,
] as const;
const WORKFLOW_HELD_TABLES: readonly (readonly [string, BranchRecordKind])[] = [
  ["sales_invoice", K.SalesInvoice],
  ["voucher", K.Voucher],
  ["framework_document", K.AnyDocument],
  ["stock_adjustment_document", K.StockAdjustment],
  ["stock_transfer_document", K.StockTransfer],
];
const STOCK_DOCUMENT_TABLES = ["stock_adjustment_document", "stock_transfer_document"] as const;
type StockDocumentTable = (typeof STOCK_DOCUMENT_TABLES)[number];

function parseLines(json: unknown): Record<string, unknown>[] {
  if (typeof json !== "string") return [];
  try {
    const parsed: unknown = JSON.parse(json);
    return Array.isArray(parsed) ? parsed.filter((line): line is Record<string, unknown> => line !== null && typeof line === "object") : [];
  } catch {
    return [];
  }
}

function text(value: unknown): string | null {
  return typeof value === "string" && value !== "" ? value : null;
}

type Rows = Record<string, unknown>[];
type Query = (id: string, docType?: string) => Promise<Rows>;
type QueryFactory = (sql: string) => Query;

/**
 * SECURITY: the one place a record's branch is read for the branch boundary.
 * It reads the STORED row — never a request body — so the answer cannot be
 * steered by the caller, and the by-id check, the body-reference check and
 * list narrowing agree by construction.
 *
 * Every statement is prepared here, at construction: one that cannot be
 * prepared throws and the backend does not start. A statement that failed
 * quietly used to answer "no such record", which the boundary reads as
 * nothing to refuse.
 */
export function createSqliteBranchDirectory(sqlite: Database.Database): BranchDirectory {
  const query: QueryFactory = (sql) => {
    const statement = sqlite.prepare(sql);
    return async (id, docType) => statement.all(docType === undefined ? { id } : { id, docType }) as Rows;
  };
  return buildBranchDirectory(query, (table) => warehouseColumnsOf(sqlite, table), (table) => linesColumnOf(sqlite, table));
}

export async function createBranchDirectory(db: SqlDb): Promise<BranchDirectory> {
  const query: QueryFactory = (sql) => {
    const order: string[] = [];
    const positional = sql.replace(/@(id|docType)\b/g, (_match, name: string) => {
      order.push(name);
      return "?";
    });
    return (id, docType) => db.all<Record<string, unknown>>(positional, order.map((name) => (name === "id" ? id : docType ?? null)));
  };
  const columns = new Map<string, readonly string[]>();
  for (const family of WAREHOUSE_FAMILIES) columns.set(family.table, await columnsOfTable(db, family.table));
  const columnsOf = (table: string): readonly string[] => columns.get(table) ?? [];
  return buildBranchDirectory(query, (table) => warehouseColumnsIn(columnsOf(table)), (table) => linesColumnIn(columnsOf(table)));
}

function buildBranchDirectory(query: QueryFactory, warehouseColumns: (table: string) => readonly string[], linesColumn: (table: string) => string | null): BranchDirectory {
  const found = (rows: Rows): Branches => (rows.length === 0 ? null : rows.map((row) => text(row["b"])));

  const columnQueries = new Map<BranchRecordKind, Query>(
    (Object.entries(COLUMN_SOURCES) as [BranchRecordKind, ColumnSource][]).map(([kind, source]) => [
      kind,
      query(`SELECT ${source.branch} AS b FROM ${source.table} d WHERE d.id = @id${source.numberColumn ? ` OR d.${source.numberColumn} = @id` : ""}`),
    ]),
  );
  const workflowHeldQueries = WORKFLOW_HELD_TABLES.map(([table, kind]) => [query(`SELECT id FROM ${table} WHERE workflow_request_id = @id`), kind] as const);
  const stockDocumentQueries: Record<StockDocumentTable, Query> = {
    stock_adjustment_document: query("SELECT lines_json FROM stock_adjustment_document WHERE id = @id OR doc_no = @id"),
    stock_transfer_document: query("SELECT lines_json FROM stock_transfer_document WHERE id = @id OR doc_no = @id"),
  };
  const sql = {
    warehouse: query("SELECT branch_id AS b FROM warehouse WHERE id = @id"),
    frameworkAny: query("SELECT lines_json FROM framework_document WHERE (id = @id OR doc_no = @id)"),
    frameworkTyped: query("SELECT lines_json FROM framework_document WHERE (id = @id OR doc_no = @id) AND doc_type = @docType"),
    journalEntry: query("SELECT l.branch_id AS b FROM journal_entry e LEFT JOIN journal_line l ON l.entry_id = e.id WHERE e.id = @id OR e.entry_no = @id"),
    recurringTemplate: query("SELECT lines FROM recurring_journal_template WHERE id = @id"),
    recurringRun: query("SELECT template_id FROM recurring_journal_run WHERE id = @id"),
    postedStock: query(
      "SELECT DISTINCT (SELECT w.branch_id FROM warehouse w WHERE w.id = m.warehouse_id) AS b FROM stock_movement m WHERE m.source_doc_id = @id OR m.source_doc_number = @id",
    ),
    writedownRun: query("SELECT warehouse_id, lines FROM writedown_run WHERE id = @id"),
    depreciationRun: query("SELECT branch_id, lines FROM depreciation_run WHERE id = @id"),
    configInstance: query("SELECT work_order_id FROM config_instance WHERE id = @id"),
    voucherAllocation: query("SELECT voucher_id, invoice_id FROM voucher_allocation WHERE id = @id"),
    followUp: query("SELECT installment_plan_id FROM collection_follow_up WHERE id = @id"),
    approvalRequest: query("SELECT id, document_id FROM approval_request WHERE id = @id"),
    etaSubmission: query("SELECT internal_id FROM eta_submission WHERE id = @id"),
    etaSubmissionOf: query("SELECT internal_id FROM eta_submission WHERE internal_id = @id"),
    etaReceiptGap: query("SELECT internal_id FROM eta_receipt_gap WHERE internal_id = @id"),
  };

  const warehouseBranch = async (warehouseId: unknown): Promise<string | null> => {
    const id = text(warehouseId);
    return id ? text((await sql.warehouse(id))[0]?.["b"]) : null;
  };

  const firstOf = async (kinds: readonly BranchRecordKind[], id: string, access: BranchAccess): Promise<Branches> => {
    for (const kind of kinds) {
      const branches = await resolve(kind, id, access);
      if (branches !== null) return branches;
    }
    return null;
  };

  const frameworkDocument = async (id: string, docType: string | undefined, access: BranchAccess): Promise<Branches> => {
    const row = docType ? (await sql.frameworkTyped(id, docType))[0] : (await sql.frameworkAny(id))[0];
    if (!row) return null;
    const branches: (string | null)[] = [];
    for (const line of parseLines(row["lines_json"])) {
      const own = text(line["branchId"]) ?? (await warehouseBranch(line["warehouseId"]));
      if (own) {
        branches.push(own);
        continue;
      }
      const source = text(line["sourceInvoiceId"]);
      branches.push(source ? ((await firstOf(SOURCE_DOCUMENT_KINDS, source, access))?.find((branch) => branch !== null) ?? null) : null);
    }
    return branches;
  };

  const warehouseBranches = async (warehouseIds: readonly unknown[]): Promise<(string | null)[]> => {
    const branches: (string | null)[] = [];
    for (const warehouseId of warehouseIds) branches.push(await warehouseBranch(warehouseId));
    return branches;
  };

  const stockDocument = async (table: StockDocumentTable, id: string, warehouseKeys: readonly string[]): Promise<Branches> => {
    const row = (await stockDocumentQueries[table](id))[0];
    if (!row) return null;
    return warehouseBranches(parseLines(row["lines_json"]).flatMap((line) => warehouseKeys.map((key) => line[key])));
  };

  const special: Partial<Record<BranchRecordKind, Resolver>> = {
    [K.Branch]: async (id) => [id],
    [K.JournalEntry]: async (id) => found(await sql.journalEntry(id)),
    [K.RecurringTemplate]: async (id) => {
      const row = (await sql.recurringTemplate(id))[0];
      return row ? parseLines(row["lines"]).map((line) => text(line["branchId"])) : null;
    },
    [K.RecurringRun]: async (id, access) => {
      const row = (await sql.recurringRun(id))[0];
      const templateId = text(row?.["template_id"]);
      return row ? (templateId ? ((await resolve(K.RecurringTemplate, templateId, access)) ?? []) : []) : null;
    },
    [K.StockAdjustment]: (id) => stockDocument("stock_adjustment_document", id, ["warehouseId"]),
    [K.StockTransfer]: (id) => stockDocument("stock_transfer_document", id, ["fromWarehouseId", "toWarehouseId"]),
    [K.PostedStockDocument]: async (id) => found(await sql.postedStock(id)),
    [K.WritedownRun]: async (id) => {
      const row = (await sql.writedownRun(id))[0];
      if (!row) return null;
      const own = await warehouseBranch(row["warehouse_id"]);
      return own ? [own] : warehouseBranches(parseLines(row["lines"]).map((line) => line["warehouseId"]));
    },
    [K.DepreciationRun]: async (id, access) => {
      const row = (await sql.depreciationRun(id))[0];
      if (!row) return null;
      const own = text(row["branch_id"]);
      if (own) return [own];
      const branches: (string | null)[] = [];
      for (const line of parseLines(row["lines"])) {
        const assetId = text(line["assetId"]);
        if (assetId) branches.push(...((await resolve(K.Asset, assetId, access)) ?? []));
      }
      return branches;
    },
    [K.ConfigInstance]: async (id, access) => {
      const row = (await sql.configInstance(id))[0];
      const workOrderId = text(row?.["work_order_id"]);
      return row ? (workOrderId ? ((await resolve(K.WorkOrder, workOrderId, access)) ?? []) : []) : null;
    },
    [K.VoucherAllocation]: async (id, access) => {
      const row = (await sql.voucherAllocation(id))[0];
      if (!row) return null;
      const voucherId = text(row["voucher_id"]);
      const invoiceId = text(row["invoice_id"]);
      return [
        ...(voucherId ? ((await resolve(K.Voucher, voucherId, access)) ?? []) : []),
        ...(invoiceId ? ((await resolve(K.AnyInvoice, invoiceId, access)) ?? []) : []),
      ];
    },
    [K.CollectionFollowUp]: async (id, access) => {
      const row = (await sql.followUp(id))[0];
      const planId = text(row?.["installment_plan_id"]);
      return row ? (planId ? ((await resolve(K.InstallmentPlan, planId, access)) ?? []) : []) : null;
    },
    [K.ApprovalRequest]: async (id, access) => {
      const request = (await sql.approvalRequest(id))[0];
      if (!request) return null;
      for (const [heldBy, kind] of workflowHeldQueries) {
        const held = text((await heldBy(id))[0]?.["id"]);
        if (held) return (await resolve(kind, held, access)) ?? [];
      }
      const documentId = text(request["document_id"]) ?? documentIdOfConfirmRequest(id);
      return documentId ? ((await firstOf(ANY_DOCUMENT_KINDS, documentId, access)) ?? []) : [];
    },
    [K.EtaSubmission]: async (id, access) => {
      const row = (await sql.etaSubmission(id))[0];
      const internalId = text(row?.["internal_id"]);
      return row ? (internalId ? ((await firstOf(ANY_DOCUMENT_KINDS, internalId, access)) ?? []) : []) : null;
    },
    [K.EtaReceipt]: async (id, access) => {
      const known = (await sql.etaSubmissionOf(id)).length > 0 || (await sql.etaReceiptGap(id)).length > 0;
      return known ? ((await firstOf(ANY_DOCUMENT_KINDS, id, access)) ?? []) : null;
    },
    [K.AnyInvoice]: (id, access) => firstOf([K.SalesInvoice, K.PurchaseInvoice], id, access),
    [K.SourceDocument]: (id, access) => firstOf(SOURCE_DOCUMENT_KINDS, id, access),
    [K.AnyDocument]: (id, access) => firstOf(ANY_DOCUMENT_KINDS, id, access),
  };

  async function resolve(kind: BranchRecordKind, id: string, access: BranchAccess): Promise<Branches> {
    const fromColumns = columnQueries.get(kind);
    if (fromColumns) return found(await fromColumns(id));
    const docType = FRAMEWORK_DOC_TYPE[kind];
    if (docType) return frameworkDocument(id, docType, access);
    return (await special[kind]?.(id, access)) ?? null;
  }

  interface FamilyRead {
    readonly rows: Query;
    readonly columns: readonly string[];
    readonly lines: string | null;
  }
  const familyReads = new Map<BranchRecordKind, FamilyRead>(
    WAREHOUSE_FAMILIES.map((family) => {
      const columns = warehouseColumns(family.table);
      const lines = linesColumn(family.table);
      const selected = [...columns, ...(lines ? [lines] : [])];
      if (selected.length === 0) throw new Error(`warehouse family "${family.table}" names no warehouse column and carries no lines`);
      const byNumber = family.numberColumn ? ` OR d.${family.numberColumn} = @id` : "";
      const ofType = family.docType ? ` AND d.doc_type = '${family.docType}'` : "";
      return [family.kind, { rows: query(`SELECT ${selected.join(", ")} FROM ${family.table} d WHERE (d.id = @id${byNumber})${ofType}`), columns, lines }];
    }),
  );
  const postedStockWarehouses = query("SELECT DISTINCT m.warehouse_id AS w FROM stock_movement m WHERE m.source_doc_id = @id OR m.source_doc_number = @id");
  const siteReceiptWarehouses = query(
    "SELECT i.to_warehouse_id AS destination, i.transit_warehouse_id AS transit FROM site_receipt r JOIN site_issue i ON i.id = r.issue_id WHERE r.id = @id OR r.doc_no = @id",
  );
  const WAREHOUSE_COMPOSITES: Partial<Record<BranchRecordKind, readonly BranchRecordKind[]>> = {
    [K.AnyInvoice]: [K.SalesInvoice, K.PurchaseInvoice],
    [K.SourceDocument]: SOURCE_DOCUMENT_KINDS,
    [K.AnyDocument]: ANY_DOCUMENT_KINDS,
  };
  const present = (values: readonly unknown[]): string[] => [...new Set(values.map(text).filter((value): value is string => value !== null))];

  async function warehousesOf(kind: BranchRecordKind, id: string): Promise<readonly string[] | null> {
    if (kind === K.Warehouse) return (await sql.warehouse(id)).length === 0 ? null : [id];
    const family = familyReads.get(kind);
    if (family) {
      const rows = await family.rows(id);
      if (rows.length === 0) return null;
      return present(rows.flatMap((row) => [...family.columns.map((column) => row[column]), ...(family.lines ? lineWarehousesOf(row[family.lines]) : [])]));
    }
    if (kind === K.SiteReceipt) {
      const rows = await siteReceiptWarehouses(id);
      return rows.length === 0 ? null : present(rows.flatMap((row) => [row["destination"], row["transit"]]));
    }
    if (kind === K.PostedStockDocument) {
      const rows = await postedStockWarehouses(id);
      return rows.length === 0 ? null : present(rows.map((row) => row["w"]));
    }
    for (const member of WAREHOUSE_COMPOSITES[kind] ?? []) {
      const warehouses = await warehousesOf(member, id);
      if (warehouses !== null) return warehouses;
    }
    return (await resolve(kind, id, BranchAccess.Read)) === null ? null : [];
  }

  async function actingWarehousesOf(kind: BranchRecordKind, id: string): Promise<readonly string[] | null> {
    if (kind === K.SiteReceipt) {
      const row = (await siteReceiptWarehouses(id))[0];
      return row ? present([row["destination"]]) : null;
    }
    const columns = ACTING_WAREHOUSE_COLUMNS[kind];
    const row = columns ? (await familyReads.get(kind)?.rows(id))?.[0] : undefined;
    return row && columns ? present(columns.map((column) => row[column])) : null;
  }

  return { branchesOf: resolve, warehousesOf, actingWarehousesOf };
}
