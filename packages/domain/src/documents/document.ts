/**
 * The generic document + the plug-in contract a concrete type declares.
 *
 * A `FrameworkDocument<Line>` is the shared envelope every module reuses: an id,
 * a lifecycle status, a date, a memo, a number stamped on confirm, and a list of
 * type-specific lines. A `DocumentTypeDefinition<Line>` is how a concrete type
 * (journal entry, sales invoice, voucher…) plugs in: it names its numbering
 * sequence + workflow action, declares which hooks it uses, validates its own
 * lines, and — crucially — builds the GL posting / stock plan / effects
 * descriptor from a document instance. The `DocumentService` reads the
 * definition to drive the lifecycle uniformly.
 */

import type { SequenceCode } from "../numbering/index.js";
import type { GateableActionType } from "../workflow/index.js";
import type { DocumentStatus } from "./status.js";
import type { DocumentEffects } from "./effects.js";
import type { DocumentGlPosting, DocumentStockPlan, DocumentStockResult } from "./hooks.js";

/** The shared document envelope. `Line` is the type-specific line shape. */
export interface FrameworkDocument<Line> {
  readonly id: string;
  readonly docType: string;
  /** Sequential number, stamped on confirm (null while draft/pending). */
  readonly docNo: string | null;
  /** ISO date (YYYY-MM-DD) the document is dated into (drives the period gate for GL docs). */
  readonly date: string;
  readonly memo: string;
  readonly status: DocumentStatus;
  readonly lines: readonly Line[];
  readonly createdAt: string;
  readonly confirmedAt: string | null;
  /** On a reversing document: the id of the document it reverses. */
  readonly reversesDocId: string | null;
  /** On a reversed document: the id of the reversing document. */
  readonly reversedByDocId: string | null;
  /** The workflow request id when held بانتظار الموافقة (pending). */
  readonly workflowRequestId: string | null;
  /** Id of the journal entry this document posted, once confirmed (null if the type has no GL hook). */
  readonly journalEntryId: string | null;
}

/**
 * The plug-in contract. A concrete document type implements this once; the
 * `DocumentService` does the rest.
 */
export interface DocumentTypeDefinition<Line> {
  /** Stable type code, e.g. "JOURNAL_ENTRY". Stamped onto `FrameworkDocument.docType`. */
  readonly code: string;
  readonly labelAr: string;
  /**
   * Which lifecycle state this type reaches on confirm: "posted" for GL-native
   * documents (journal entries), "confirmed" for sub-ledger documents (invoices,
   * vouchers). Both are {@link ACTIVE_STATUSES}.
   */
  readonly confirmedStatus: "confirmed" | "posted";
  /** Numbering sequence for the document's OWN number, or null if it takes its number from the GL entry. */
  readonly numberingSequence: SequenceCode | null;
  /**
   * When true the document has no separate number — it adopts the journal-entry
   * number returned by the GL hook as its `docNo`. Used by manual journal
   * entries, where the document IS the journal entry (numberingSequence is null).
   */
  readonly numberFromGl?: boolean;
  /** Workflow action type gated on confirm, or null if this type is never gated. */
  readonly gateActionType: GateableActionType | null;

  /** Structural validation of a draft's lines. Throw {@link InvalidDocumentError} on failure. */
  validate?(doc: FrameworkDocument<Line>): void;
  /** Build the balanced GL posting to hand the GL hook, or null if this document posts nothing. */
  /**
   * `stock` carries what `buildStockPlan`'s plan actually moved — the
   * framework applies the plan first precisely so this is available. A
   * document that removes stock must credit inventory by that figure, not by
   * anything it holds itself (D47).
   */
  buildGlPosting?(doc: FrameworkDocument<Line>, stock?: DocumentStockResult): DocumentGlPosting | null;
  /**
   * The branch the DOCUMENT belongs to, for the audit trail. Without it the
   * sink falls back to the caller's `x-branch-scope`, and the default scope is
   * all-branches, so a voucher naming BR-MAIN produced audit rows with
   * `branchId: null` that the audit viewer's branch filter could never find
   * again (D30).
   */
  branchOf?(doc: FrameworkDocument<Line>): string | null;
  /** Build the stock plan to hand the stock hook, or null if this document moves no stock. */
  buildStockPlan?(doc: FrameworkDocument<Line>): DocumentStockPlan | null;
  /**
   * The lines a CANCELLED document should hold. Return null (or omit the
   * hook) to leave them untouched.
   *
   * Cancelling used to flip the document status and nothing else, so a plan
   * whose header read ملغاة still carried lines reading قيد الاستحقاق and
   * every total that walked the lines kept counting them as live money
   * (D120). A line status a type declares must have a writer.
   */
  onCancel?(doc: FrameworkDocument<Line>): readonly Line[] | null;
  /** Compute the "تأثيرات هذا المستند" descriptor for the panel + confirm gate. Pure. */
  describeEffects(doc: FrameworkDocument<Line>): DocumentEffects;
}

/** Persistence port for framework documents (one store per concrete type, keyed by id). */
export interface DocumentRepository<Line> {
  save(doc: FrameworkDocument<Line>): Promise<void>;
  update(doc: FrameworkDocument<Line>): Promise<void>;
  findById(id: string): Promise<FrameworkDocument<Line> | null>;
  list(filter?: DocumentListFilter): Promise<readonly FrameworkDocument<Line>[]>;
  /**
   * The documents whose LINES cite one of `ids` in the field named `field` —
   * one query, rather than reading the whole type's history and filtering it
   * in JS. Optional: a repository that cannot express it leaves the caller to
   * fall back to `list()`, which is what {@link DocumentService.listByLineRef}
   * does.
   */
  listByLineRef?(
    field: string,
    ids: readonly string[],
    filter?: DocumentListFilter,
  ): Promise<readonly FrameworkDocument<Line>[]>;
  /** Run `fn` in one atomic transaction. In-memory implementations may just call `fn`. */
  transaction<T>(fn: () => Promise<T>): Promise<T>;
}

export interface DocumentListFilter {
  readonly status?: DocumentStatus;
  readonly fromDate?: string;
  readonly toDate?: string;
}
