import type Database from "better-sqlite3";
import { BranchAccess, BranchRecordKind, type BranchDirectory } from "@mezan/api";

type Branches = readonly (string | null)[] | null;
type Resolver = (id: string, access: BranchAccess) => Branches;

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
  [K.WritedownRun]: { table: "writedown_run", branch: OF_WAREHOUSE },
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

const FRAMEWORK_DOC_TYPE: Partial<Record<BranchRecordKind, string>> = {
  [K.SalesReturn]: "SALES_RETURN",
  [K.PurchaseReturn]: "PURCHASE_RETURN",
  [K.LandedCost]: "LANDED_COST",
  [K.InstallmentPlan]: "INSTALLMENT_PLAN",
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
  type Query = (id: string, docType?: string) => Record<string, unknown>[];
  const query = (sql: string): Query => {
    const statement = sqlite.prepare(sql);
    return (id, docType) => statement.all(docType === undefined ? { id } : { id, docType }) as Record<string, unknown>[];
  };
  const found = (rows: Record<string, unknown>[]): Branches => (rows.length === 0 ? null : rows.map((row) => text(row["b"])));

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
    depreciationRun: query("SELECT branch_id, lines FROM depreciation_run WHERE id = @id"),
    configInstance: query("SELECT work_order_id FROM config_instance WHERE id = @id"),
    voucherAllocation: query("SELECT voucher_id, invoice_id FROM voucher_allocation WHERE id = @id"),
    followUp: query("SELECT installment_plan_id FROM collection_follow_up WHERE id = @id"),
    approvalRequest: query("SELECT id FROM approval_request WHERE id = @id"),
    etaSubmission: query("SELECT internal_id FROM eta_submission WHERE id = @id"),
    etaSubmissionOf: query("SELECT internal_id FROM eta_submission WHERE internal_id = @id"),
    etaReceiptGap: query("SELECT internal_id FROM eta_receipt_gap WHERE internal_id = @id"),
  };

  const warehouseBranch = (warehouseId: unknown): string | null => {
    const id = text(warehouseId);
    return id ? text(sql.warehouse(id)[0]?.["b"]) : null;
  };

  const firstOf = (kinds: readonly BranchRecordKind[], id: string, access: BranchAccess): Branches => {
    for (const kind of kinds) {
      const branches = resolve(kind, id, access);
      if (branches !== null) return branches;
    }
    return null;
  };

  const frameworkDocument = (id: string, docType: string | undefined, access: BranchAccess): Branches => {
    const row = docType ? sql.frameworkTyped(id, docType)[0] : sql.frameworkAny(id)[0];
    if (!row) return null;
    return parseLines(row["lines_json"]).map((line) => {
      const own = text(line["branchId"]) ?? warehouseBranch(line["warehouseId"]);
      if (own) return own;
      const source = text(line["sourceInvoiceId"]);
      return source ? (firstOf(SOURCE_DOCUMENT_KINDS, source, access)?.find((branch) => branch !== null) ?? null) : null;
    });
  };

  const stockDocument = (table: StockDocumentTable, id: string, warehouseKeys: readonly string[]): Branches => {
    const row = stockDocumentQueries[table](id)[0];
    if (!row) return null;
    return parseLines(row["lines_json"]).flatMap((line) => warehouseKeys.map((key) => warehouseBranch(line[key])));
  };

  const special: Partial<Record<BranchRecordKind, Resolver>> = {
    [K.Branch]: (id) => [id],
    [K.JournalEntry]: (id) => found(sql.journalEntry(id)),
    [K.RecurringTemplate]: (id) => {
      const row = sql.recurringTemplate(id)[0];
      return row ? parseLines(row["lines"]).map((line) => text(line["branchId"])) : null;
    },
    [K.RecurringRun]: (id, access) => {
      const row = sql.recurringRun(id)[0];
      const templateId = text(row?.["template_id"]);
      return row ? (templateId ? (resolve(K.RecurringTemplate, templateId, access) ?? []) : []) : null;
    },
    [K.StockAdjustment]: (id) => stockDocument("stock_adjustment_document", id, ["warehouseId"]),
    [K.StockTransfer]: (id, access) =>
      stockDocument("stock_transfer_document", id, access === BranchAccess.Read ? ["fromWarehouseId", "toWarehouseId"] : ["fromWarehouseId"]),
    [K.PostedStockDocument]: (id) => found(sql.postedStock(id)),
    [K.DepreciationRun]: (id, access) => {
      const row = sql.depreciationRun(id)[0];
      if (!row) return null;
      const own = text(row["branch_id"]);
      if (own) return [own];
      return parseLines(row["lines"]).flatMap((line) => {
        const assetId = text(line["assetId"]);
        return assetId ? (resolve(K.Asset, assetId, access) ?? []) : [];
      });
    },
    [K.ConfigInstance]: (id, access) => {
      const row = sql.configInstance(id)[0];
      const workOrderId = text(row?.["work_order_id"]);
      return row ? (workOrderId ? (resolve(K.WorkOrder, workOrderId, access) ?? []) : []) : null;
    },
    [K.VoucherAllocation]: (id, access) => {
      const row = sql.voucherAllocation(id)[0];
      if (!row) return null;
      const voucherId = text(row["voucher_id"]);
      const invoiceId = text(row["invoice_id"]);
      return [
        ...(voucherId ? (resolve(K.Voucher, voucherId, access) ?? []) : []),
        ...(invoiceId ? (resolve(K.AnyInvoice, invoiceId, access) ?? []) : []),
      ];
    },
    [K.CollectionFollowUp]: (id, access) => {
      const row = sql.followUp(id)[0];
      const planId = text(row?.["installment_plan_id"]);
      return row ? (planId ? (resolve(K.InstallmentPlan, planId, access) ?? []) : []) : null;
    },
    [K.ApprovalRequest]: (id, access) => {
      if (sql.approvalRequest(id).length === 0) return null;
      for (const [heldBy, kind] of workflowHeldQueries) {
        const held = text(heldBy(id)[0]?.["id"]);
        if (held) return resolve(kind, held, access) ?? [];
      }
      // A purchase invoice keeps no back-reference to its request; like every
      // request, its id is `<document id>:<action>`.
      const separator = id.lastIndexOf(":");
      return separator > 0 ? (firstOf(ANY_DOCUMENT_KINDS, id.slice(0, separator), access) ?? []) : [];
    },
    [K.EtaSubmission]: (id, access) => {
      const row = sql.etaSubmission(id)[0];
      const internalId = text(row?.["internal_id"]);
      return row ? (internalId ? (firstOf(ANY_DOCUMENT_KINDS, internalId, access) ?? []) : []) : null;
    },
    [K.EtaReceipt]: (id, access) => {
      const known = sql.etaSubmissionOf(id).length > 0 || sql.etaReceiptGap(id).length > 0;
      return known ? (firstOf(ANY_DOCUMENT_KINDS, id, access) ?? []) : null;
    },
    [K.AnyInvoice]: (id, access) => firstOf([K.SalesInvoice, K.PurchaseInvoice], id, access),
    [K.SourceDocument]: (id, access) => firstOf(SOURCE_DOCUMENT_KINDS, id, access),
    [K.AnyDocument]: (id, access) => firstOf(ANY_DOCUMENT_KINDS, id, access),
  };

  function resolve(kind: BranchRecordKind, id: string, access: BranchAccess): Branches {
    const fromColumns = columnQueries.get(kind);
    if (fromColumns) return found(fromColumns(id));
    const docType = FRAMEWORK_DOC_TYPE[kind];
    if (docType) return frameworkDocument(id, docType, access);
    return special[kind]?.(id, access) ?? null;
  }

  return { branchesOf: resolve };
}
