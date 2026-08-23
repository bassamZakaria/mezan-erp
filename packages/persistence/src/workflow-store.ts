import Database from "better-sqlite3";
import {
  Money,
  computeInvoiceTotals,
  extend,
  type ApprovalRequest,
  type ApprovalRequestStore,
  type GateStep,
} from "@mezan/domain";
import { createSqliteSalesInvoiceStore } from "./sales-invoice-store.js";
import { createSqliteSalesReturnStore } from "./sales-return-store.js";
import { createSqlitePurchaseReturnStore } from "./purchase-return-store.js";
import { createSqliteLandedCostStore } from "./landed-cost-store.js";
import { createSqliteVoucherStore } from "./voucher-store.js";
import type { SqliteConnectionInput } from "./sqlite-connection.js";
import { openSqliteConnection } from "./sqlite-connection.js";

/**
 * Workflow/approvals persistence (docs/catalog/09 §الموافقات — the SQLite
 * adapter behind `/workflow`):
 *
 *   - `workflow_gate_config` — the tenant's per-action-type approval chain
 *     (`/settings/workflow`): ordered steps (approver role + description) and
 *     an optional minimum-amount threshold, stored as an exact decimal string
 *     (never a float — same convention as every other money column).
 *   - `workflow_approval_request` — the durable {@link ApprovalRequest} the
 *     gate produces on submit (see `../domain/workflow/persisted-gate.ts`),
 *     so a later approve/reject has state to act on and the approvals inbox
 *     has something to list.
 *
 * Neither table exists anywhere else in the codebase today: `DocumentService`
 * calls the gate on confirm but (via `createDocumentWorkflowGate`) only ever
 * keeps `{granted, requestId}` — nothing durable survives past that one call
 * until this store is wired in.
 */

const CREATE_TABLES = `
CREATE TABLE IF NOT EXISTS workflow_gate_config (
  action_type  TEXT PRIMARY KEY,
  steps_json   TEXT NOT NULL,
  min_amount   TEXT,
  updated_at   TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS workflow_approval_request (
  id              TEXT PRIMARY KEY,
  action_type     TEXT NOT NULL,
  submitted_by    TEXT NOT NULL,
  steps_json      TEXT NOT NULL,
  current_step    INTEGER NOT NULL,
  status          TEXT NOT NULL,
  decisions_json  TEXT NOT NULL,
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_workflow_approval_request_status ON workflow_approval_request(status);
CREATE INDEX IF NOT EXISTS idx_workflow_approval_request_submitted_by ON workflow_approval_request(submitted_by);
`;

export function ensureWorkflowTables(sqlite: Database.Database): void {
  sqlite.exec(CREATE_TABLES);
}

/* --- Gate config (workflow/approvals configuration) ----------------------- */

export interface StoredGateConfig {
  readonly actionType: string;
  readonly steps: readonly GateStep[];
  /** Exact decimal string (major units), or null when the gate applies regardless of amount. */
  readonly minAmount: string | null;
  readonly updatedAt: string;
}

export interface GateConfigInput {
  readonly steps: readonly GateStep[];
  readonly minAmount: string | null;
}

export interface GateConfigStore {
  get(actionType: string): Promise<StoredGateConfig | null>;
  list(): Promise<readonly StoredGateConfig[]>;
  set(actionType: string, input: GateConfigInput): Promise<StoredGateConfig>;
}

interface GateConfigRow {
  action_type: string;
  steps_json: string;
  min_amount: string | null;
  updated_at: string;
}

function gateConfigFromRow(row: GateConfigRow): StoredGateConfig {
  return {
    actionType: row.action_type,
    steps: JSON.parse(row.steps_json) as GateStep[],
    minAmount: row.min_amount,
    updatedAt: row.updated_at,
  };
}

export function createSqliteGateConfigStore(input: SqliteConnectionInput): GateConfigStore {
  const { sqlite } = openSqliteConnection(input);
  ensureWorkflowTables(sqlite);

  const upsert = sqlite.prepare(`
    INSERT INTO workflow_gate_config (action_type, steps_json, min_amount, updated_at)
    VALUES (@action_type, @steps_json, @min_amount, @updated_at)
    ON CONFLICT(action_type) DO UPDATE SET
      steps_json = excluded.steps_json,
      min_amount = excluded.min_amount,
      updated_at = excluded.updated_at
  `);
  const selectOne = sqlite.prepare(`SELECT * FROM workflow_gate_config WHERE action_type = ?`);
  const selectAll = sqlite.prepare(`SELECT * FROM workflow_gate_config ORDER BY action_type`);

  return {
    async get(actionType) {
      const row = selectOne.get(actionType) as GateConfigRow | undefined;
      return row ? gateConfigFromRow(row) : null;
    },
    async list() {
      return (selectAll.all() as GateConfigRow[]).map(gateConfigFromRow);
    },
    async set(actionType, input) {
      const row: GateConfigRow = {
        action_type: actionType,
        steps_json: JSON.stringify(input.steps),
        min_amount: input.minAmount,
        updated_at: new Date().toISOString(),
      };
      upsert.run(row);
      return gateConfigFromRow(row);
    },
  };
}

/* --- Approval requests (the approvals inbox's backing state) -------------- */

export interface StoredApprovalRequest extends ApprovalRequest {
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface WorkflowRequestStore extends ApprovalRequestStore {
  findById(id: string): Promise<StoredApprovalRequest | null>;
  list(): Promise<readonly StoredApprovalRequest[]>;
}

interface ApprovalRequestRow {
  id: string;
  action_type: string;
  submitted_by: string;
  steps_json: string;
  current_step: number;
  status: string;
  decisions_json: string;
  created_at: string;
  updated_at: string;
}

function approvalRequestFromRow(row: ApprovalRequestRow): StoredApprovalRequest {
  return {
    id: row.id,
    actionType: row.action_type as ApprovalRequest["actionType"],
    submittedBy: row.submitted_by,
    steps: JSON.parse(row.steps_json),
    currentStep: row.current_step,
    status: row.status as ApprovalRequest["status"],
    decisions: JSON.parse(row.decisions_json),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function createSqliteWorkflowRequestStore(input: SqliteConnectionInput): WorkflowRequestStore {
  const { sqlite } = openSqliteConnection(input);
  ensureWorkflowTables(sqlite);

  const upsert = sqlite.prepare(`
    INSERT INTO workflow_approval_request
      (id, action_type, submitted_by, steps_json, current_step, status, decisions_json, created_at, updated_at)
    VALUES
      (@id, @action_type, @submitted_by, @steps_json, @current_step, @status, @decisions_json, @created_at, @updated_at)
    ON CONFLICT(id) DO UPDATE SET
      action_type = excluded.action_type,
      submitted_by = excluded.submitted_by,
      steps_json = excluded.steps_json,
      current_step = excluded.current_step,
      status = excluded.status,
      decisions_json = excluded.decisions_json,
      updated_at = excluded.updated_at
  `);
  const selectCreatedAt = sqlite.prepare(`SELECT created_at FROM workflow_approval_request WHERE id = ?`);
  const selectOne = sqlite.prepare(`SELECT * FROM workflow_approval_request WHERE id = ?`);
  const selectAll = sqlite.prepare(`SELECT * FROM workflow_approval_request ORDER BY created_at DESC`);

  async function save(request: ApprovalRequest): Promise<void> {
    const existing = selectCreatedAt.get(request.id) as { created_at: string } | undefined;
    const now = new Date().toISOString();
    upsert.run({
      id: request.id,
      action_type: request.actionType,
      submitted_by: request.submittedBy,
      steps_json: JSON.stringify(request.steps),
      current_step: request.currentStep,
      status: request.status,
      decisions_json: JSON.stringify(request.decisions),
      created_at: existing?.created_at ?? now,
      updated_at: now,
    });
  }

  return {
    save,
    async findById(id) {
      const row = selectOne.get(id) as ApprovalRequestRow | undefined;
      return row ? approvalRequestFromRow(row) : null;
    },
    async list() {
      return (selectAll.all() as ApprovalRequestRow[]).map(approvalRequestFromRow);
    },
  };
}

/* --- Subject resolution (which document a request is gating) -------------- */

/**
 * What the inbox shows about the document behind a request: type, number,
 * date and — where the shape makes it unambiguous to compute — amount.
 * `amount`/`currency` are null when the underlying document type doesn't
 * carry enough to compute one honestly (never a fabricated figure).
 */
export interface WorkflowSubject {
  readonly docType: string;
  readonly docId: string;
  readonly docNo: string | null;
  readonly date: string | null;
  readonly amount: string | null;
  readonly currency: string | null;
}

const DOC_TYPE_LABELS_AR: Record<string, string> = {
  SALES_INVOICE: "فاتورة مبيعات",
  SALES_RETURN: "مرتجع مبيعات",
  PURCHASE_RETURN: "مرتجع مشتريات",
  LANDED_COST: "سند تكاليف إضافية",
  TREASURY_VOUCHER: "سند صرف/قبض",
  JOURNAL_ENTRY: "قيد محاسبي",
};

/** Arabic label for a document type code; falls back to the code itself for one this resolver doesn't know. */
export function workflowDocTypeLabelAr(docType: string): string {
  return DOC_TYPE_LABELS_AR[docType] ?? docType;
}

/**
 * Every document type built on `DocumentService` defaults its confirm
 * `requestId` to `${docId}:confirm` (see `documents/service.ts`'s `confirm()`
 * and `sales-invoices/service.ts`) — the one thread tying a workflow request
 * back to the document it gates, since neither `ApprovalRequest` nor the
 * gate's `DocumentWorkflowInput` carries the document id/type/amount
 * themselves.
 */
function extractDocId(requestId: string): string {
  const suffix = ":confirm";
  return requestId.endsWith(suffix) ? requestId.slice(0, -suffix.length) : requestId;
}

interface FrameworkHeaderRow {
  doc_type: string;
  doc_no: string | null;
  date: string;
}

/**
 * Builds a `requestId -> WorkflowSubject` resolver against the shared SQLite
 * connection. Checks, in order: the dedicated `voucher` table, the dedicated
 * `sales_invoice` table, then the generic `framework_document` table (sales
 * returns, purchase returns, landed costs) — the three places a document's id
 * can live today. Returns null when no document matches (e.g. a request
 * pre-dating this resolver, or an action type with no live document wiring).
 */
export function createWorkflowSubjectResolver(
  input: SqliteConnectionInput,
): (requestId: string) => Promise<WorkflowSubject | null> {
  const { sqlite } = openSqliteConnection(input);
  const vouchers = createSqliteVoucherStore(sqlite).documents;
  const salesInvoices = createSqliteSalesInvoiceStore(sqlite);
  const salesReturns = createSqliteSalesReturnStore(sqlite);
  const purchaseReturns = createSqlitePurchaseReturnStore(sqlite);
  const landedCosts = createSqliteLandedCostStore(sqlite);

  const frameworkHeader = sqlite.prepare(
    `SELECT doc_type, doc_no, date FROM framework_document WHERE id = ?`,
  );

  return async function resolveWorkflowSubject(requestId: string): Promise<WorkflowSubject | null> {
    const docId = extractDocId(requestId);

    const voucherDoc = await vouchers.findById(docId);
    if (voucherDoc) {
      return {
        docType: voucherDoc.docType,
        docId,
        docNo: voucherDoc.docNo,
        date: voucherDoc.date,
        amount: Money.sum(voucherDoc.lines.map((l) => l.amount)).toString(),
        currency: voucherDoc.lines[0]?.currency ?? null,
      };
    }

    const invoice = await salesInvoices.findById(docId);
    if (invoice) {
      const totals = computeInvoiceTotals(invoice.lines, invoice.discount, { taxExempt: invoice.customerTaxExempt });
      return {
        docType: invoice.docType,
        docId,
        docNo: invoice.docNo,
        date: invoice.date,
        amount: totals.grandTotal.toString(),
        currency: invoice.currency,
      };
    }

    const fwRow = frameworkHeader.get(docId) as FrameworkHeaderRow | undefined;
    if (fwRow) {
      let amount: string | null = null;
      if (fwRow.doc_type === "SALES_RETURN") {
        const doc = await salesReturns.findById(docId);
        if (doc) amount = Money.sum(doc.lines.map((l) => extend(l.qty, l.unitPrice).add(l.taxAmount))).toString();
      } else if (fwRow.doc_type === "PURCHASE_RETURN") {
        const doc = await purchaseReturns.findById(docId);
        if (doc) amount = Money.sum(doc.lines.map((l) => extend(l.qty, l.unitCost).add(l.taxAmount))).toString();
      } else if (fwRow.doc_type === "LANDED_COST") {
        const doc = await landedCosts.findById(docId);
        if (doc) amount = Money.sum(doc.lines.map((l) => l.allocatedAmount)).toString();
      }
      return { docType: fwRow.doc_type, docId, docNo: fwRow.doc_no, date: fwRow.date, amount, currency: null };
    }

    return null;
  };
}
