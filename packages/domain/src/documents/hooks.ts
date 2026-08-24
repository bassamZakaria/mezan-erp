/**
 * The hook ports a document type may plug into (docs/plan.md §3: numbering,
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
  next(): Promise<{ readonly value: number; readonly formatted: string }>;
}

/* --- GL-posting hook (via the GL posting engine) ------------------------- */

export interface DocumentGlPostingLine {
  readonly accountId: string;
  readonly debit: Money;
  readonly credit: Money;
  readonly memo?: string | null;
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
   * from the inventory module — see docs/catalog/03). Drives reason-aware
   * direction validation and GL account routing at the stock-hook adapter.
   */
  readonly reason?: string;
  /**
   * The document's own date (`FrameworkDocument.date`), so the stock hook can
   * date the resulting ledger movements (and any GL entry they post) into the
   * document's period instead of defaulting to wall-clock "now" — the same
   * date `buildGlPosting` already threads through for GL-native documents.
   */
  readonly date?: string;
}

export interface DocumentStockHook {
  apply(plan: DocumentStockPlan): Promise<void>;
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
