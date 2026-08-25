/**
 * DocumentService — the generic lifecycle orchestrator every document module
 * reuses (docs/plan.md §3 "the document lifecycle").
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
import type {
  DocumentTypeDefinition,
  FrameworkDocument,
  DocumentListFilter,
  DocumentRepository,
} from "./document.js";
import type { DocumentEffects } from "./effects.js";
import type {
  DocumentGlHook,
  DocumentNumberingHook,
  DocumentStockHook,
  DocumentWorkflowGate,
  DocumentEventPublisher,
  DocumentEventType,
  DocumentStockResult,
} from "./hooks.js";
import { assertTransition, isActive, type DocumentStatus } from "./status.js";
import {
  DocumentNotFoundError,
  DuplicateDocumentError,
  InvalidDocumentError,
  MissingHookError,
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
    this.def.validate?.(existing);

    // Block confirming a document its own effects mark as not-confirmable
    // (e.g. an unbalanced journal) — the same signal the UI gates the button on.
    const effects = this.def.describeEffects(existing);
    if (effects.blocked) {
      throw new InvalidDocumentError(
        this.def.code,
        id,
        effects.blockedReason ?? "Document cannot be confirmed in its current state.",
      );
    }

    // --- Workflow gate on confirm --------------------------------------
    if (this.def.gateActionType) {
      if (!this.deps.workflow) throw new MissingHookError(this.def.code, "workflow");
      const decision = await this.deps.workflow.evaluate({
        actionType: this.def.gateActionType,
        requestId: opts.requestId ?? `${id}:confirm`,
        submittedBy: opts.actor ?? this.deps.actor ?? "system",
        submitterRoles: opts.actorRoles ?? this.deps.actorRoles,
        entityLabel: existing.docNo ?? existing.id,
      });
      if (!decision.granted) {
        // Confirming an already-held document is a no-op, not an illegal
        // pending → pending transition: the UI's confirm button stays clickable
        // while the request sits in the inbox.
        if (existing.status === "pending") return { document: existing, held: true };
        assertTransition(this.def.code, id, existing.status, "pending");
        const held: FrameworkDocument<Line> = {
          ...existing,
          status: "pending",
          workflowRequestId: decision.requestId,
        };
        await this.deps.repo.update(held);
        this.emit("DOCUMENT_SUBMITTED", held);
        return { document: held, held: true };
      }
    }

    const target = this.def.confirmedStatus;
    assertTransition(this.def.code, id, existing.status, target);

    const confirmed = await this.deps.repo.transaction(async () => {
      let docNo = existing.docNo;
      if (this.def.numberingSequence && !this.def.numberFromGl) {
        if (!this.deps.numbering) throw new MissingHookError(this.def.code, "numbering");
        docNo = (await this.deps.numbering.next({ branchId: this.def.branchOf?.(existing) ?? null })).formatted;
      }

      let working: FrameworkDocument<Line> = { ...existing, docNo };

      let stockResult: DocumentStockResult | undefined;
      if (this.def.buildStockPlan) {
        const plan = this.def.buildStockPlan(working);
        if (plan) {
          if (!this.deps.stock) throw new MissingHookError(this.def.code, "stock");
          stockResult = (await this.deps.stock.apply(plan)) ?? undefined;
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
      await this.deps.repo.update(next);
      return next;
    });

    await this.recordAudit("CONFIRM", confirmed, "INFO");
    this.emit("DOCUMENT_CONFIRMED", confirmed);
    return { document: confirmed, held: false };
  }

  /**
   * Return a document held بانتظار الموافقة to its submitter as an editable
   * draft — what "طلب تعديل" (request modification) and a rejection mean for
   * the DOCUMENT, as opposed to for the approval request.
   */
  async returnToDraft(id: string): Promise<FrameworkDocument<Line>> {
    const existing = await this.require(id);
    if (existing.status === "draft") return existing;
    assertTransition(this.def.code, id, existing.status, "draft");
    const returned: FrameworkDocument<Line> = { ...existing, status: "draft", workflowRequestId: null };
    await this.deps.repo.update(returned);
    this.emit("DOCUMENT_DRAFTED", returned);
    return returned;
  }

  /** Cancel a draft/pending document (never a live one — those are reversed). */
  async cancel(id: string): Promise<FrameworkDocument<Line>> {
    const existing = await this.require(id);
    assertTransition(this.def.code, id, existing.status, "cancelled");
    const cancelled: FrameworkDocument<Line> = { ...existing, status: "cancelled", workflowRequestId: null };
    await this.deps.repo.update(cancelled);
    await this.recordAudit("CANCEL", cancelled, "WARNING");
    this.emit("DOCUMENT_CANCELLED", cancelled);
    return cancelled;
  }

  /**
   * Reverse a live (confirmed/posted) document: mark it معكوس (reversed) and, if
   * the type posts to the GL, post the mirror-image reversing entry via the GL
   * hook. Creates a reversing document linked both ways.
   */
  async reverse(id: string, opts: ReverseOptions): Promise<{ original: FrameworkDocument<Line>; reversal: FrameworkDocument<Line> }> {
    const existing = await this.require(id);
    if (!isActive(existing.status)) {
      // assertTransition gives the precise error (only active → reversed is legal).
      assertTransition(this.def.code, id, existing.status, "reversed");
    }

    return this.deps.repo.transaction(async () => {
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
      await this.deps.repo.save(reversal);

      const original: FrameworkDocument<Line> = {
        ...existing,
        status: "reversed",
        reversedByDocId: reversal.id,
      };
      await this.deps.repo.update(original);

      await this.recordAudit("REVERSE", original, "WARNING", reversal.id);
      this.emit("DOCUMENT_REVERSED", original, reversal.id);
      return { original, reversal };
    });
  }

  async findById(id: string): Promise<FrameworkDocument<Line> | null> {
    return this.deps.repo.findById(id);
  }

  async list(filter?: DocumentListFilter): Promise<readonly FrameworkDocument<Line>[]> {
    return this.deps.repo.list(filter);
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
    action: "CONFIRM" | "CANCEL" | "REVERSE",
    doc: FrameworkDocument<Line>,
    severity: "INFO" | "WARNING",
    reversalId?: string,
  ): Promise<void> {
    if (!this.deps.audit) return;
    await recordSensitiveEvent(this.deps.audit, {
      module: this.deps.auditModule ?? "documents",
      entityType: this.def.code,
      action,
      actor: this.deps.actor ?? "system",
      branchId: this.def.branchOf?.(doc) ?? null,
      severity,
      details: {
        docId: doc.id,
        docNo: doc.docNo,
        status: doc.status as DocumentStatus,
        ...(reversalId ? { reversalId } : {}),
      },
    });
  }
}
