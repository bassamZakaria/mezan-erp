/**
 * DocumentService — the generic lifecycle orchestrator every document module
 * reuses (docs/archive/plan.md §3 "the document lifecycle").
 *
 * Given a {@link DocumentTypeDefinition} and a set of hook adapters, it drives
 * draft → confirm → (cancel | reverse) uniformly: it guards every transition,
 * applies the workflow gate on confirm, and — inside ONE transaction — allocates
 * the number, moves the stock, posts the GL entry and persists the document, in
 * that order, then records audit + emits a domain event. Each hook fires only if
 * the type declares it, so a journal (GL + workflow) and a stock transfer (stock
 * only) run through the same code path with different hooks lit up.
 */

import { recordSensitiveEvent, type AuditSink } from "../audit/index.js";
import {
  DocumentField,
  type DocumentTypeDefinition,
  type FrameworkDocument,
  type DocumentListFilter,
  type DocumentRepository,
} from "./document.js";
import type { DocumentEffects } from "./effects.js";
import type {
  DocumentGlHook,
  DocumentNumberingHook,
  DocumentStockHook,
  DocumentWorkflowGate,
  DocumentApprovalView,
  DocumentEventPublisher,
  DocumentEventType,
  DocumentStockResult,
} from "./hooks.js";
import { assertTransition, isActive, type DocumentStatus } from "./status.js";
import { ReversalDateBeforeOriginalError } from "../gl/errors.js";
import {
  DocumentNotFoundError,
  DocumentResubmitRefusedError,
  DuplicateDocumentError,
  InvalidDocumentError,
  MissingHookError,
  assertDocumentWritten,
} from "./errors.js";

export interface DocumentServiceDeps<Line> {
  readonly repo: DocumentRepository<Line>;
  readonly numbering?: DocumentNumberingHook;
  readonly gl?: DocumentGlHook;
  readonly stock?: DocumentStockHook;
  readonly workflow?: DocumentWorkflowGate;
  readonly audit?: AuditSink;
  readonly events?: DocumentEventPublisher;
  /** Audit module label; defaults to "documents". */
  readonly auditModule?: string;
  /** ISO-8601 UTC "now"; overridable for deterministic tests. */
  readonly now?: () => string;
  /** Default acting user for audit/workflow; per-call opts override this. */
  readonly actor?: string;
  readonly actorRoles?: readonly string[];
  /** INVARIANT: runs before the workflow gate and again as the first act of the confirm's transaction. */
  readonly confirmGuard?: (doc: FrameworkDocument<Line>) => Promise<void>;
  /** INVARIANT: runs inside the reversal's transaction, on the row read there, before anything is mirrored. */
  readonly reverseGuard?: (doc: FrameworkDocument<Line>) => Promise<void>;
  /** INVARIANT: runs inside the reversal's transaction after both documents are written; a throw undoes the reversal. */
  readonly afterReverse?: (original: FrameworkDocument<Line>, reversal: FrameworkDocument<Line>) => Promise<void>;
}

/** Command to open a new draft. Lines are the concrete type's line shape. */
export interface CreateDraftCommand<Line> {
  readonly id: string;
  readonly date: string;
  readonly memo: string;
  readonly lines: readonly Line[];
}

export interface ConfirmOptions {
  readonly actor?: string;
  readonly actorRoles?: readonly string[];
  /** Workflow request id when the type is gated; defaults to a deterministic `${docId}:confirm`. */
  readonly requestId?: string;
}

export interface ReverseOptions {
  /** Id for the reversing document + its reversing journal entry (caller-supplied — domain stays pure). */
  readonly reversalId: string;
  readonly date?: string;
  readonly memo?: string;
  readonly actor?: string;
  readonly reason?: string;
}

export interface ConfirmResult<Line> {
  readonly document: FrameworkDocument<Line>;
  /** True when the gate held the document بانتظار الموافقة (pending) instead of confirming it. */
  readonly held: boolean;
}

export class DocumentService<Line> {
  constructor(
    private readonly def: DocumentTypeDefinition<Line>,
    private readonly deps: DocumentServiceDeps<Line>,
  ) {}

  private now(): string {
    return this.deps.now ? this.deps.now() : new Date().toISOString();
  }

  /** Compute the effects descriptor for a document (pure; drives the panel + gate). */
  effectsOf(doc: FrameworkDocument<Line>): DocumentEffects {
    return this.def.describeEffects(doc);
  }

  /** Open a new مسودة (draft): validated and persisted, but not numbered or posted. */
  async createDraft(cmd: CreateDraftCommand<Line>): Promise<FrameworkDocument<Line>> {
    if (await this.deps.repo.findById(cmd.id)) {
      throw new DuplicateDocumentError(this.def.code, cmd.id);
    }
    const doc: FrameworkDocument<Line> = {
      id: cmd.id,
      docType: this.def.code,
      docNo: null,
      date: cmd.date,
      memo: cmd.memo,
      status: "draft",
      lines: cmd.lines,
      createdAt: this.now(),
      confirmedAt: null,
      reversesDocId: null,
      reversedByDocId: null,
      workflowRequestId: null,
      journalEntryId: null,
    };
    this.def.validate?.(doc);
    await this.deps.repo.save(doc);
    this.emit("DOCUMENT_DRAFTED", doc);
    return doc;
  }

  /**
   * Confirm/post a document. Applies the workflow gate first: if approval is
   * required the document is held بانتظار الموافقة (pending) and `held` is true.
   * Otherwise it runs numbering → stock → GL → persist in one transaction.
   */
  async confirm(id: string, opts: ConfirmOptions = {}): Promise<ConfirmResult<Line>> {
    const existing = await this.require(id);
    await this.assertConfirmable(existing);

    // --- Workflow gate on confirm --------------------------------------
    if (this.def.gateActionType) {
      if (!this.deps.workflow) throw new MissingHookError(this.def.code, "workflow");
      const decision = await this.deps.workflow.evaluate({
        actionType: this.def.gateActionType,
        requestId: opts.requestId ?? this.requestIdOf(existing),
        submittedBy: opts.actor ?? this.deps.actor ?? "system",
        submitterRoles: opts.actorRoles ?? this.deps.actorRoles,
        entityLabel: existing.docNo ?? existing.id,
      });
      if (!decision.granted) {
        // Confirming an already-held document is a no-op, not an illegal
        // pending → pending transition: the UI's confirm button stays clickable
        // while the request sits in the inbox.
        if (existing.status === "pending") return { document: existing, held: true };
        const held = await this.deps.repo.transaction(async () => {
          const fresh = await this.require(id);
          assertTransition(this.def.code, id, fresh.status, "pending");
          const next: FrameworkDocument<Line> = { ...fresh, status: "pending", workflowRequestId: decision.requestId };
          await this.write(next, [DocumentField.Status, DocumentField.WorkflowRequestId], fresh.status);
          return next;
        });
        this.emit("DOCUMENT_SUBMITTED", held);
        return { document: held, held: true };
      }
    }

    const target = this.def.confirmedStatus;

    const confirmed = await this.deps.repo.transaction(async () => {
      // INVARIANT: every guard runs on the row as it stands inside this
      // transaction. A classification or cancel that landed since the request
      // began is posted from, or refuses this confirm — never overwritten.
      const fresh = await this.require(id);
      await this.assertConfirmable(fresh);
      return this.post(fresh, target);
    });

    this.emit("DOCUMENT_CONFIRMED", confirmed);
    return { document: confirmed, held: false };
  }

  private async assertConfirmable(doc: FrameworkDocument<Line>): Promise<void> {
    // ORDER MATTERS: the lifecycle answers first. A confirmed return re-checked
    // against its own posted lines reads as an overdraw, which is the wrong
    // refusal for "this is already confirmed".
    assertTransition(this.def.code, doc.id, doc.status, this.def.confirmedStatus);
    this.def.validate?.(doc);
    await this.deps.confirmGuard?.(doc);

    // Block confirming a document its own effects mark as not-confirmable
    // (e.g. an unbalanced journal) — the same signal the UI gates the button on.
    const effects = this.def.describeEffects(doc);
    if (effects.blocked) {
      throw new InvalidDocumentError(
        this.def.code,
        doc.id,
        effects.blockedReason ?? "Document cannot be confirmed in its current state.",
      );
    }
  }

  private async post(existing: FrameworkDocument<Line>, target: DocumentStatus): Promise<FrameworkDocument<Line>> {
    let docNo = existing.docNo;
    if (this.def.numberingSequence && !this.def.numberFromGl) {
      if (!this.deps.numbering) throw new MissingHookError(this.def.code, "numbering");
      docNo = (await this.deps.numbering.next({ branchId: this.def.branchOf?.(existing) ?? null })).formatted;
    }

    let working: FrameworkDocument<Line> = { ...existing, docNo };

    // The stock plan runs BEFORE the GL posting is built, so the posting
    // can credit inventory by the value the ledger actually moved rather
    // than by a figure the document carries (D47).
    let stockResult: DocumentStockResult | undefined;
    if (this.def.buildStockPlan) {
      const plan = this.def.buildStockPlan(working);
      if (plan) {
        if (!this.deps.stock) throw new MissingHookError(this.def.code, "stock");
        stockResult = await this.deps.stock.apply(plan);
      }
    }

    let journalEntryId = existing.journalEntryId;
    if (this.def.buildGlPosting) {
      const posting = this.def.buildGlPosting(working, stockResult);
      if (posting) {
        if (!this.deps.gl) throw new MissingHookError(this.def.code, "gl");
        const result = await this.deps.gl.post(posting);
        journalEntryId = result.journalEntryId;
        if (this.def.numberFromGl) docNo = result.journalEntryNo;
      }
    }

    const next: FrameworkDocument<Line> = {
      ...working,
      docNo,
      journalEntryId,
      status: target,
      confirmedAt: this.now(),
      workflowRequestId: null,
    };
    await this.write(
      next,
      [DocumentField.DocNo, DocumentField.Status, DocumentField.ConfirmedAt, DocumentField.JournalEntryId, DocumentField.WorkflowRequestId],
      existing.status,
    );
    await this.recordAudit("CONFIRM", next, "INFO");
    return next;
  }

  /**
   * Return a document held بانتظار الموافقة to its submitter as an editable
   * draft — what "طلب تعديل" (request modification) and a rejection mean for
   * the DOCUMENT, as opposed to for the approval request.
   */
  async returnToDraft(id: string): Promise<FrameworkDocument<Line>> {
    const returned = await this.deps.repo.transaction(async () => {
      const existing = await this.require(id);
      if (existing.status === "draft") return null;
      assertTransition(this.def.code, id, existing.status, "draft");
      const next: FrameworkDocument<Line> = { ...existing, status: "draft", workflowRequestId: null };
      await this.write(next, [DocumentField.Status, DocumentField.WorkflowRequestId], existing.status);
      return next;
    });
    if (!returned) return this.require(id);
    this.emit("DOCUMENT_DRAFTED", returned);
    return returned;
  }

  /**
   * Put a document whose approval request was REJECTED back in front of the
   * approver, under the same request so the rejection stays in its history.
   */
  async resubmit(id: string, opts: ConfirmOptions = {}): Promise<FrameworkDocument<Line>> {
    const gateActionType = this.def.gateActionType;
    const workflow = this.deps.workflow;
    if (!gateActionType || !workflow?.standing || !workflow.reopen) throw new MissingHookError(this.def.code, "workflow");
    const standing = workflow.standing.bind(workflow);
    const reopen = workflow.reopen.bind(workflow);
    const actor = opts.actor ?? this.deps.actor ?? "system";
    const held = await this.deps.repo.transaction(async () => {
      const fresh = await this.require(id);
      const requestId = opts.requestId ?? this.requestIdOf(fresh);
      // SECURITY: `reopen` also reopens an APPROVED request. Only a request read
      // as rejected inside this transaction may reach it, or a resubmit would
      // discard an approval that is waiting to post.
      const status = (await standing([requestId])).get(requestId)?.status ?? null;
      if (status !== "rejected") throw new DocumentResubmitRefusedError(this.def.code, id, status);
      assertTransition(this.def.code, id, fresh.status, "pending");
      await this.assertConfirmable(fresh);
      await reopen(requestId);
      const decision = await workflow.evaluate({
        actionType: gateActionType,
        requestId,
        submittedBy: actor,
        submitterRoles: opts.actorRoles ?? this.deps.actorRoles,
        entityLabel: fresh.docNo ?? fresh.id,
      });
      const next: FrameworkDocument<Line> = { ...fresh, status: "pending", workflowRequestId: decision.requestId };
      await this.write(next, [DocumentField.Status, DocumentField.WorkflowRequestId], fresh.status);
      await this.recordAudit("RESUBMIT", next, "INFO", { actor });
      return next;
    });
    this.emit("DOCUMENT_SUBMITTED", held);
    return held;
  }

  /** The approval request standing behind each document, keyed by document id. One read for the whole page. */
  async approvalsOf(docs: readonly FrameworkDocument<Line>[]): Promise<ReadonlyMap<string, DocumentApprovalView>> {
    const standing = this.deps.workflow?.standing;
    if (!this.def.gateActionType || !standing || docs.length === 0) return new Map();
    const requestIds = new Map(docs.map((doc) => [this.requestIdOf(doc), doc.id]));
    const views = await standing.call(this.deps.workflow, [...requestIds.keys()]);
    return new Map([...views].map(([requestId, view]) => [requestIds.get(requestId) as string, view]));
  }

  private requestIdOf(doc: FrameworkDocument<Line>): string {
    return doc.workflowRequestId ?? `${doc.id}:confirm`;
  }

  /** Cancel a draft/pending document (never a live one — those are reversed). */
  async cancel(id: string): Promise<FrameworkDocument<Line>> {
    const cancelled = await this.deps.repo.transaction(async () => {
      const existing = await this.require(id);
      assertTransition(this.def.code, id, existing.status, "cancelled");
      const cancelledLines = this.def.onCancel?.(existing) ?? null;
      const next: FrameworkDocument<Line> = {
        ...existing,
        status: "cancelled",
        lines: cancelledLines ?? existing.lines,
        workflowRequestId: null,
      };
      await this.write(
        next,
        [DocumentField.Status, DocumentField.WorkflowRequestId, ...(cancelledLines ? [DocumentField.Lines] : [])],
        existing.status,
      );
      await this.recordAudit("CANCEL", next, "WARNING");
      return next;
    });
    this.emit("DOCUMENT_CANCELLED", cancelled);
    return cancelled;
  }

  /**
   * Reverse a live (confirmed/posted) document: mark it معكوس (reversed) and, if
   * the type posts to the GL, post the mirror-image reversing entry via the GL
   * hook. Creates a reversing document linked both ways.
   */
  async reverse(id: string, opts: ReverseOptions): Promise<{ original: FrameworkDocument<Line>; reversal: FrameworkDocument<Line> }> {
    return this.deps.repo.transaction(async () => {
      const existing = await this.require(id);
      if (!isActive(existing.status)) {
        // assertTransition gives the precise error (only active → reversed is legal).
        assertTransition(this.def.code, id, existing.status, "reversed");
      }
      await this.deps.reverseGuard?.(existing);
      const resolvedDate = opts.date ?? existing.date;
      // A reversal dated before the document it reverses would restate a day
      // already reported (D270, voucher reversal). This is scoped to THIS
      // document-lifecycle path rather than the shared `reverseJournalEntry` —
      // other reversal flows (a depreciation run, a purchase-invoice cancel)
      // legitimately reverse at an earlier date and are gated by the period
      // lock alone.
      if (resolvedDate < existing.date) {
        throw new ReversalDateBeforeOriginalError(id, resolvedDate, existing.date);
      }

      let reversalJournalEntryId: string | null = null;
      let reversalDocNo: string | null = null;
      if (existing.journalEntryId) {
        if (!this.deps.gl) throw new MissingHookError(this.def.code, "gl");
        const result = await this.deps.gl.reverse(existing.journalEntryId, {
          reversalId: opts.reversalId,
          date: opts.date,
          memo: opts.memo,
        });
        reversalJournalEntryId = result.journalEntryId;
        reversalDocNo = result.journalEntryNo;
      }

      const reversal: FrameworkDocument<Line> = {
        id: opts.reversalId,
        docType: this.def.code,
        docNo: reversalDocNo,
        date: opts.date ?? existing.date,
        memo: opts.memo ?? `عكس المستند ${existing.docNo ?? existing.id}`,
        status: this.def.confirmedStatus,
        lines: existing.lines,
        createdAt: this.now(),
        confirmedAt: this.now(),
        reversesDocId: existing.id,
        reversedByDocId: null,
        workflowRequestId: null,
        journalEntryId: reversalJournalEntryId,
      };

      // Stock comes back too (B-10). Reversing only the GL credited 1200 and
      // left the goods on hand, so the sub-ledger and its control account
      // parted company by the value of every reversed movement.
      if (this.def.buildStockPlan) {
        const plan = this.def.buildStockPlan(reversal);
        if (plan) {
          if (!this.deps.stock?.reverse) throw new MissingHookError(this.def.code, "stock");
          await this.deps.stock.reverse(plan, existing.id);
        }
      }

      await this.deps.repo.save(reversal);

      const original: FrameworkDocument<Line> = {
        ...existing,
        status: "reversed",
        reversedByDocId: reversal.id,
      };
      await this.write(original, [DocumentField.Status, DocumentField.ReversedByDocId], existing.status);

      await this.deps.afterReverse?.(original, reversal);
      await this.recordAudit("REVERSE", original, "WARNING", { actor: opts.actor, reversalId: reversal.id, reason: opts.reason });
      this.emit("DOCUMENT_REVERSED", original, reversal.id);
      return { original, reversal };
    });
  }

  // INVARIANT: `fn` judges the document as it stands inside ONE transaction,
  // and whatever it writes commits or rolls back with that read. A guard on a
  // read made before the transaction lets two requests each pass alone.
  async withDocument<T>(id: string, fn: (doc: FrameworkDocument<Line>) => Promise<T>): Promise<T> {
    return this.deps.repo.transaction(async () => fn(await this.require(id)));
  }

  async findById(id: string): Promise<FrameworkDocument<Line> | null> {
    return this.deps.repo.findById(id);
  }

  async list(filter?: DocumentListFilter): Promise<readonly FrameworkDocument<Line>[]> {
    return this.deps.repo.list(filter);
  }

  /**
   * Documents whose lines cite one of `ids` at `field`. Falls back to reading
   * the type's history when the repository cannot express it, so both paths
   * answer identically; the point of the SQL path is that a page of invoices
   * costs one query instead of every return ever raised.
   */
  async listByLineRef(
    field: string,
    ids: readonly string[],
    filter?: DocumentListFilter,
  ): Promise<readonly FrameworkDocument<Line>[]> {
    if (ids.length === 0) return [];
    const repo = this.deps.repo;
    if (repo.listByLineRef) return repo.listByLineRef(field, ids, filter);
    const wanted = new Set(ids);
    return (await repo.list(filter)).filter((doc) =>
      doc.lines.some((line) => wanted.has((line as Record<string, unknown>)[field] as string)),
    );
  }

  private async write(next: FrameworkDocument<Line>, fields: readonly DocumentField[], expectedStatus: DocumentStatus): Promise<void> {
    assertDocumentWritten(await this.deps.repo.writeFields(next, fields, { status: expectedStatus }), this.def.code, next.id);
  }

  private async require(id: string): Promise<FrameworkDocument<Line>> {
    const doc = await this.deps.repo.findById(id);
    if (!doc) throw new DocumentNotFoundError(this.def.code, id);
    return doc;
  }

  private emit(type: DocumentEventType, doc: FrameworkDocument<Line>, reversedByDocId?: string): void {
    this.deps.events?.publish({
      type,
      docType: doc.docType,
      docId: doc.id,
      docNo: doc.docNo,
      occurredAt: this.now(),
      reversedByDocId: reversedByDocId ?? null,
    });
  }

  private async recordAudit(
    action: "CONFIRM" | "CANCEL" | "REVERSE" | "RESUBMIT",
    doc: FrameworkDocument<Line>,
    severity: "INFO" | "WARNING",
    by: { readonly actor?: string; readonly reversalId?: string; readonly reason?: string } = {},
  ): Promise<void> {
    if (!this.deps.audit) return;
    await recordSensitiveEvent(this.deps.audit, {
      module: this.deps.auditModule ?? "documents",
      entityType: this.def.code,
      entityId: doc.id,
      action,
      actor: by.actor ?? this.deps.actor ?? "system",
      branchId: this.def.branchOf?.(doc) ?? null,
      severity,
      details: {
        docId: doc.id,
        docNo: doc.docNo,
        status: doc.status as DocumentStatus,
        ...(by.reversalId ? { reversalId: by.reversalId } : {}),
        ...(by.reason ? { reason: by.reason } : {}),
      },
    });
  }
}
