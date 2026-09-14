import type { CostCategory } from "../contracting/cost-category.js";
/**
 * The hook ports a document type may plug into (docs/archive/plan.md §3: numbering,
 * GL-posting, stock-movement, workflow-gate). Each is OPTIONAL per document
 * type — a treasury voucher uses GL + workflow but no stock; a journal uses GL +
 * workflow + numbering; a stock transfer uses stock but no GL.
 *
 * The framework depends on these interfaces only, never on the concrete
 * engines. Adapters (in api/persistence/web) bind the GL posting engine, the
 * stock-ledger engine, the numbering engine and the workflow gate behind them —
 * so the document layer stays pure and the engines stay decoupled from each
 * other (the same layering the inventory engine uses for its GL port).
 */

import type { Money, Qty } from "../money/index.js";
import type { GateableActionType } from "../workflow/index.js";

/* --- Numbering hook (via the numbering engine) ---------------------------- */

/**
 * Allocates the document's own sequential number on confirm. This is exactly
 * the shape of `NextNumberService.next(code)` bound to the type's sequence, so
 * the SQLite `NextNumberService` slots straight in.
 */
export interface DocumentNumberingHook {
  /**
   * `branchId` lets a branch-scoped sequence keep its own counter (D33). A hook
   * bound to a tenant-global sequence ignores it, so passing it always is safe.
   */
  next(opts?: { readonly branchId?: string | null }): Promise<{ readonly value: number; readonly formatted: string }>;
}

/* --- GL-posting hook (via the GL posting engine) ------------------------- */

export interface DocumentGlPostingLine {
  readonly accountId: string;
  readonly debit: Money;
  readonly credit: Money;
  readonly memo?: string | null;
  /**
   * Cost-centre dimension. A posting that drops it is invisible to the
   * cost-centre P&L forever, and the report cannot recover it later (D26).
   */
  readonly costCenterId?: string | null;
  /**
   * Transaction currency of a foreign-currency line. `debit`/`credit` are
   * ALWAYS base-currency; these two say what produced them, and without them
   * the balance is invisible to the FX revaluation forever (D24).
   */
  readonly currency?: string | null;
  /** Foreign→base rate applied at confirm, as an exact decimal string. */
  readonly fxRate?: string | null;
  /**
   * The VAT rate this line was charged at, as a percentage (14, 5, 0…).
   *
   * Carried on BOTH the taxable base line and the VAT line it produced, because
   * the VAT return needs to report the rates actually charged. Without it the
   * report could only divide tax by base per ENTRY, which blends a 14% / 5% /
   * zero-rated invoice into one meaningless ~6.3% bucket (D28). Null on lines
   * that carry no tax dimension at all, and on entries posted before the field
   * existed — the report falls back to the old derivation for those.
   */
  readonly taxRatePercent?: number | null;
  /** بُعد المشروع — the contracting project the line belongs to (D-01). Dropped here, it is gone for good. */
  readonly projectId?: string | null;
  /** فئة التكلفة — only meaningful with `projectId`. */
  readonly costCategory?: CostCategory | null;
  /**
   * بُعد الفرع (DEC-20) — the branch the document belongs to. Dropped here it
   * is gone for good, the same way the cost centre and the project are. Null on
   * every path that has no document branch (manual journals, payroll,
   * depreciation, year-end close); those land in the statements' «غير مخصص»
   * bucket rather than being derived from a join that would silently drop them.
   */
  readonly branchId?: string | null;
}

/**
 * A balanced posting the document hands to whoever posts to the GL. The
 * accounting module turns it into a real journal entry; the document layer never
 * imports accounting. Σ debit always equals Σ credit.
 */
export interface DocumentGlPosting {
  readonly sourceDocType: string;
  readonly sourceDocId: string;
  readonly sourceDocNumber: string | null;
  readonly date: string;
  readonly memo: string;
  readonly lines: readonly DocumentGlPostingLine[];
}

/**
 * The result of posting. `journalEntryNo` lets a document whose number IS its
 * journal-entry number (a manual journal entry) adopt it as its own docNo — see
 * {@link DocumentTypeDefinition.numberFromGl}.
 */
export interface DocumentGlPostingResult {
  readonly journalEntryId: string;
  readonly journalEntryNo: string | null;
}

export interface DocumentGlHook {
  post(posting: DocumentGlPosting): Promise<DocumentGlPostingResult>;
  /** Reverse a previously posted entry (drives document reversal). */
  reverse(journalEntryId: string, opts: { reversalId: string; date?: string; memo?: string }): Promise<DocumentGlPostingResult>;
}

/* --- Stock-movement hook (via the stock-ledger engine) ------------------- */

export interface DocumentStockLine {
  readonly itemId: string;
  readonly direction: "IN" | "OUT";
  readonly qty: Qty;
  /** Required for an IN line (receipt cost); ignored for OUT (moving average used). */
  readonly unitCost?: Money;
}

export interface DocumentStockPlan {
  readonly sourceDocType: string;
  readonly sourceDocId: string;
  readonly sourceDocNumber: string | null;
  /** Source warehouse for a single-warehouse plan (adjustment); source leg of a transfer plan. */
  readonly warehouseId: string;
  readonly lines: readonly DocumentStockLine[];
  /**
   * Present only on a two-warehouse (transfer) plan: the destination warehouse.
   * `warehouseId` above is the source leg. Absent for a single-warehouse
   * (adjustment) plan — the stock hook dispatches on its presence.
   */
  readonly toWarehouseId?: string;
  /**
   * Present only on an adjustment plan: the {@link AdjustmentReason} code
   * (kept as a plain string here so the document framework stays decoupled
   * from the inventory module — see docs/archive/catalog/03). Drives reason-aware
   * direction validation and GL account routing at the stock-hook adapter.
   */
  readonly reason?: string;
  /** بُعد المشروع — carried onto the GL entry the stock hook posts (D-01). */
  readonly projectId?: string | null;
  /** فئة التكلفة — only with `projectId`; goes on the cost-side line of that entry. */
  readonly costCategory?: CostCategory | null;
  /**
   * The document's own date (`FrameworkDocument.date`), so the stock hook can
   * date the resulting ledger movements (and any GL entry they post) into the
   * document's period instead of defaulting to wall-clock "now" — the same
   * date `buildGlPosting` already threads through for GL-native documents.
   */
  readonly date?: string;
}

/**
 * What applying a stock plan actually moved, in money.
 *
 * The framework hands this to `buildGlPosting` because a document that removes
 * stock cannot post an honest entry without it — the value removed is decided
 * by the position's live moving average, not by anything on the document
 * (D47). Stock leaves at that average, so the two differ whenever the position
 * has been re-costed since (after a landed cost, for instance), and a posting
 * that ignores it puts the sub-ledger out of step with GL 1200 by exactly that
 * difference.
 */
export interface DocumentStockResult {
  /** Signed: positive when value entered stock, negative when it left. */
  readonly valueMoved: Money;
}

export interface DocumentStockHook {
  // Deliberately NOT `| void`: a hook that returns nothing puts the caller back
  // to guessing the value from the document, which is the defect above.
  apply(plan: DocumentStockPlan): Promise<DocumentStockResult>;
}

/* --- Workflow-gate hook (via the workflow engine) ------------------------ */

export interface DocumentWorkflowInput {
  readonly actionType: GateableActionType;
  readonly requestId: string;
  readonly submittedBy: string;
  readonly submitterRoles?: readonly string[];
  /** Human-readable identifier shown in the approvals inbox — usually the document number. */
  readonly entityLabel?: string | null;
}

/**
 * The outcome of applying the gate on confirm: `granted` means confirmation may
 * proceed now (no steps configured, or the submitter is an admin); otherwise the
 * document is held بانتظار الموافقة (pending) under `requestId`.
 */
export interface DocumentWorkflowDecision {
  readonly granted: boolean;
  readonly requestId: string;
}

export interface DocumentWorkflowGate {
  evaluate(input: DocumentWorkflowInput): Promise<DocumentWorkflowDecision>;
}

/* --- Domain events (decoupled from the notification catalog) ------------- */

export type DocumentEventType =
  | "DOCUMENT_DRAFTED"
  | "DOCUMENT_SUBMITTED"
  | "DOCUMENT_CONFIRMED"
  | "DOCUMENT_CANCELLED"
  | "DOCUMENT_REVERSED";

export interface DocumentDomainEvent {
  readonly type: DocumentEventType;
  readonly docType: string;
  readonly docId: string;
  readonly docNo: string | null;
  readonly occurredAt: string;
  /** For a reversal: id of the new reversing document. */
  readonly reversedByDocId?: string | null;
}

export interface DocumentEventPublisher {
  publish(event: DocumentDomainEvent): void;
}
