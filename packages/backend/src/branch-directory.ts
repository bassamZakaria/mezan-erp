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
  ["purchase_invoice", K.PurchaseInvoice],
  ["voucher", K.Voucher],
  ["framework_document", K.AnyDocument],
  ["stock_adjustment_document", K.StockAdjustment],
  ["stock_transfer_document", K.StockTransfer],
];

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
 */
export function createSqliteBranchDirectory(sqlite: Database.Database): BranchDirectory {
  const statements = new Map<string, Database.Statement | null>();
  const prepared = (sql: string): Database.Statement | null => {
    if (!statements.has(sql)) {
      try {
        statements.set(sql, sqlite.prepare(sql));
      } catch {
        statements.set(sql, null);
      }
    }
    return statements.get(sql) ?? null;
  };
  const all = (sql: string, id: string, docType?: string): Record<string, unknown>[] =>
    (prepared(sql)?.all(docType === undefined ? { id } : { id, docType }) as Record<string, unknown>[] | undefined) ?? [];
  const found = (rows: Record<string, unknown>[]): Branches => (rows.length === 0 ? null : rows.map((row) => text(row["b"])));

  const warehouseBranch = (warehouseId: unknown): string | null => {
    const id = text(warehouseId);
    return id ? text(all("SELECT branch_id AS b FROM warehouse WHERE id = @id", id)[0]?.["b"]) : null;
  };

  const fromColumns = (source: ColumnSource, id: string): Branches =>
    found(
      all(
        `SELECT ${source.branch} AS b FROM ${source.table} d WHERE d.id = @id${source.numberColumn ? ` OR d.${source.numberColumn} = @id` : ""}`,
        id,
      ),
    );

  const firstOf = (kinds: readonly BranchRecordKind[], id: string, access: BranchAccess): Branches => {
    for (const kind of kinds) {
      const branches = resolve(kind, id, access);
      if (branches !== null) return branches;
    }
    return null;
  };

  const frameworkDocument = (id: string, docType: string | undefined, access: BranchAccess): Branches => {
    const row = all(
      `SELECT lines_json FROM framework_document WHERE (id = @id OR doc_no = @id)${docType ? " AND doc_type = @docType" : ""}`,
      id,
      docType,
    )[0];
    if (!row) return null;
    return parseLines(row["lines_json"]).map((line) => {
      const own = text(line["branchId"]) ?? warehouseBranch(line["warehouseId"]);
      if (own) return own;
      const source = text(line["sourceInvoiceId"]);
      return source ? (firstOf(SOURCE_DOCUMENT_KINDS, source, access)?.find((branch) => branch !== null) ?? null) : null;
    });
  };

  const stockDocument = (table: string, id: string, warehouseKeys: readonly string[]): Branches => {
    const row = all(`SELECT lines_json FROM ${table} WHERE id = @id OR doc_no = @id`, id)[0];
    if (!row) return null;
    return parseLines(row["lines_json"]).flatMap((line) => warehouseKeys.map((key) => warehouseBranch(line[key])));
  };

  const special: Partial<Record<BranchRecordKind, Resolver>> = {
    [K.Branch]: (id) => [id],
    [K.JournalEntry]: (id) =>
      found(all("SELECT l.branch_id AS b FROM journal_entry e LEFT JOIN journal_line l ON l.entry_id = e.id WHERE e.id = @id OR e.entry_no = @id", id)),
    [K.RecurringTemplate]: (id) => {
      const row = all("SELECT lines FROM recurring_journal_template WHERE id = @id", id)[0];
      return row ? parseLines(row["lines"]).map((line) => text(line["branchId"])) : null;
    },
    [K.RecurringRun]: (id, access) => {
      const row = all("SELECT template_id FROM recurring_journal_run WHERE id = @id", id)[0];
      const templateId = text(row?.["template_id"]);
      return row ? (templateId ? (resolve(K.RecurringTemplate, templateId, access) ?? []) : []) : null;
    },
    [K.StockAdjustment]: (id) => stockDocument("stock_adjustment_document", id, ["warehouseId"]),
    [K.StockTransfer]: (id, access) =>
      stockDocument("stock_transfer_document", id, access === BranchAccess.Read ? ["fromWarehouseId", "toWarehouseId"] : ["fromWarehouseId"]),
    [K.PostedStockDocument]: (id) =>
      found(
        all(
          "SELECT DISTINCT (SELECT w.branch_id FROM warehouse w WHERE w.id = m.warehouse_id) AS b FROM stock_movement m WHERE m.source_doc_id = @id OR m.source_doc_number = @id",
          id,
        ),
      ),
    [K.DepreciationRun]: (id, access) => {
      const row = all("SELECT branch_id, lines FROM depreciation_run WHERE id = @id", id)[0];
      if (!row) return null;
      const own = text(row["branch_id"]);
      if (own) return [own];
      return parseLines(row["lines"]).flatMap((line) => {
        const assetId = text(line["assetId"]);
        return assetId ? (resolve(K.Asset, assetId, access) ?? []) : [];
      });
    },
    [K.ConfigInstance]: (id, access) => {
      const row = all("SELECT work_order_id FROM config_instance WHERE id = @id", id)[0];
      const workOrderId = text(row?.["work_order_id"]);
      return row ? (workOrderId ? (resolve(K.WorkOrder, workOrderId, access) ?? []) : []) : null;
    },
    [K.VoucherAllocation]: (id, access) => {
      const row = all("SELECT voucher_id, invoice_id FROM voucher_allocation WHERE id = @id", id)[0];
      if (!row) return null;
      const voucherId = text(row["voucher_id"]);
      const invoiceId = text(row["invoice_id"]);
      return [
        ...(voucherId ? (resolve(K.Voucher, voucherId, access) ?? []) : []),
        ...(invoiceId ? (resolve(K.AnyInvoice, invoiceId, access) ?? []) : []),
      ];
    },
    [K.CollectionFollowUp]: (id, access) => {
      const row = all("SELECT installment_plan_id FROM collection_follow_up WHERE id = @id", id)[0];
      const planId = text(row?.["installment_plan_id"]);
      return row ? (planId ? (resolve(K.InstallmentPlan, planId, access) ?? []) : []) : null;
    },
    [K.ApprovalRequest]: (id, access) => {
      if (all("SELECT id FROM approval_request WHERE id = @id", id).length === 0) return null;
      for (const [table, kind] of WORKFLOW_HELD_TABLES) {
        const held = text(all(`SELECT id FROM ${table} WHERE workflow_request_id = @id`, id)[0]?.["id"]);
        if (held) return resolve(kind, held, access) ?? [];
      }
      const separator = id.lastIndexOf(":");
      return separator > 0 ? (firstOf(ANY_DOCUMENT_KINDS, id.slice(0, separator), access) ?? []) : [];
    },
    [K.EtaSubmission]: (id, access) => {
      const row = all("SELECT internal_id FROM eta_submission WHERE id = @id", id)[0];
      const internalId = text(row?.["internal_id"]);
      return row ? (internalId ? (firstOf(ANY_DOCUMENT_KINDS, internalId, access) ?? []) : []) : null;
    },
    [K.EtaReceipt]: (id, access) => {
      const known =
        all("SELECT internal_id FROM eta_submission WHERE internal_id = @id", id).length > 0 ||
        all("SELECT internal_id FROM eta_receipt_gap WHERE internal_id = @id", id).length > 0;
      return known ? (firstOf(ANY_DOCUMENT_KINDS, id, access) ?? []) : null;
    },
    [K.AnyInvoice]: (id, access) => firstOf([K.SalesInvoice, K.PurchaseInvoice], id, access),
    [K.SourceDocument]: (id, access) => firstOf(SOURCE_DOCUMENT_KINDS, id, access),
    [K.AnyDocument]: (id, access) => firstOf(ANY_DOCUMENT_KINDS, id, access),
  };

  function resolve(kind: BranchRecordKind, id: string, access: BranchAccess): Branches {
    const source = COLUMN_SOURCES[kind];
    if (source) return fromColumns(source, id);
    const docType = FRAMEWORK_DOC_TYPE[kind];
    if (docType) return frameworkDocument(id, docType, access);
    return special[kind]?.(id, access) ?? null;
  }

  return { branchesOf: resolve };
}
