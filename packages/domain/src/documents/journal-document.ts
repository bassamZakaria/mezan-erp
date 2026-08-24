/**
 * Journal Entry as a document-framework consumer (docs/catalog/04 §القيود
 * المحاسبية) — the first module to prove the framework end to end.
 *
 * A manual journal entry IS its own GL entry, so this type takes its number from
 * the GL engine (`numberFromGl`), posts through the GL-posting hook, and gates
 * confirmation behind ACCOUNTING_JOURNAL_POST. The debit/credit balance check
 * lives in `describeEffects` (so the UI can show "متوازن ✓" / block the post
 * button live) and is re-enforced by the GL engine's own `assertBalanced` when
 * the hook actually posts.
 *
 * The adapters below bind the REAL GL posting engine (gl/) and the REAL workflow
 * gate (workflow/) behind the framework's hook ports — the document layer never
 * imports those engines directly.
 */

import { Money } from "../money/index.js";
import { postJournalEntry, reverseJournalEntry, type JournalPostingDeps } from "../gl/index.js";
import {
  ApprovalRequestRejectedError,
  resubmitApproval,
  startApproval,
  submitApproval,
  type ApprovalRequestRepository,
  type GateConfig,
  type GateableActionType,
} from "../workflow/index.js";
import type { DocumentTypeDefinition, FrameworkDocument } from "./document.js";
import { buildEffects } from "./effects.js";
import type { DocumentGlHook, DocumentGlPosting, DocumentWorkflowGate } from "./hooks.js";
import { InvalidDocumentError } from "./errors.js";

/** A single debit/credit line of a journal document. */
export interface JournalDocLine {
  readonly accountId: string;
  readonly debit: Money;
  readonly credit: Money;
  readonly memo?: string | null;
}

export type JournalDocument = FrameworkDocument<JournalDocLine>;

const DOC_TYPE = "JOURNAL_ENTRY";

function totals(lines: readonly JournalDocLine[]): { totalDebit: Money; totalCredit: Money } {
  return {
    totalDebit: Money.sum(lines.map((l) => l.debit)),
    totalCredit: Money.sum(lines.map((l) => l.credit)),
  };
}

/** The journal-entry document type definition. Plugs into {@link DocumentService}. */
export const journalDocumentType: DocumentTypeDefinition<JournalDocLine> = {
  code: DOC_TYPE,
  labelAr: "قيد محاسبي",
  confirmedStatus: "posted",
  numberingSequence: "JOURNAL_ENTRY",
  numberFromGl: true, // the document IS the journal entry — the GL engine numbers it
  gateActionType: "ACCOUNTING_JOURNAL_POST",

  validate(doc) {
    const { lines } = doc;
    if (lines.length < 2) {
      throw new InvalidDocumentError(DOC_TYPE, doc.id, "القيد يتطلب سطرين على الأقل.");
    }
    for (const line of lines) {
      if (line.accountId.trim() === "") {
        throw new InvalidDocumentError(DOC_TYPE, doc.id, "كل بند يجب أن يستهدف حساباً.");
      }
      if (line.debit.scaled < 0n || line.credit.scaled < 0n) {
        throw new InvalidDocumentError(DOC_TYPE, doc.id, `بند الحساب "${line.accountId}" لا يقبل مبلغاً سالباً.`);
      }
      const hasDebit = line.debit.scaled !== 0n;
      const hasCredit = line.credit.scaled !== 0n;
      if (hasDebit && hasCredit) {
        throw new InvalidDocumentError(DOC_TYPE, doc.id, `بند الحساب "${line.accountId}" لا يكون مديناً ودائناً معاً.`);
      }
      if (!hasDebit && !hasCredit) {
        throw new InvalidDocumentError(DOC_TYPE, doc.id, `بند الحساب "${line.accountId}" يجب أن يحمل مبلغاً في المدين أو الدائن.`);
      }
    }
  },

  buildGlPosting(doc): DocumentGlPosting {
    return {
      sourceDocType: DOC_TYPE,
      sourceDocId: doc.id,
      sourceDocNumber: doc.docNo,
      date: doc.date,
      memo: doc.memo,
      lines: doc.lines.map((l) => ({
        accountId: l.accountId,
        debit: l.debit,
        credit: l.credit,
        memo: l.memo ?? null,
      })),
    };
  },

  describeEffects(doc) {
    const { totalDebit, totalCredit } = totals(doc.lines);
    const balanced = totalDebit.equals(totalCredit);
    const accountCount = new Set(doc.lines.map((l) => l.accountId)).size;
    return buildEffects({
      balanced,
      totalDebit,
      totalCredit,
      blocked: !balanced,
      blockedReason: balanced ? undefined : "القيد غير متوازن: مجموع المدين لا يساوي مجموع الدائن.",
      effects: [
        {
          kind: "gl",
          description: `يُنشئ قيداً محاسبياً مرحّلاً من ${doc.lines.length} بند`,
          detail: balanced ? "متوازن ✓" : "غير متوازن — لا يمكن الترحيل",
        },
        {
          kind: "balance",
          description: `يُحدّث أرصدة ${accountCount} حساب في دفتر الأستاذ`,
        },
      ],
    });
  },
};

/**
 * Bind the GL posting engine behind the framework's GL hook. The journal's GL
 * entry id equals the document id (`posting.sourceDocId`), so the ledger entry
 * and the document share one identity and one JE- number.
 */
export function createJournalGlHook(deps: JournalPostingDeps): DocumentGlHook {
  return {
    async post(posting) {
      const entry = await postJournalEntry(
        {
          id: posting.sourceDocId,
          date: posting.date,
          memo: posting.memo,
          source: "manual",
          lines: posting.lines.map((l) => ({
            accountId: l.accountId,
            debit: l.debit,
            credit: l.credit,
            memo: l.memo ?? null,
          })),
        },
        deps,
      );
      return { journalEntryId: entry.id, journalEntryNo: entry.entryNo ?? null };
    },
    async reverse(journalEntryId, opts) {
      const { reversal } = await reverseJournalEntry(journalEntryId, deps, {
        reversalId: opts.reversalId,
        date: opts.date,
        memo: opts.memo,
      });
      return { journalEntryId: reversal.id, journalEntryNo: reversal.entryNo ?? null };
    },
  };
}

/**
 * Bind the workflow gate behind the framework's workflow hook. `resolveConfig`
 * returns the configured approval chain for an action type (or null when the
 * tenant has none). With no steps — or an admin submitter — `startApproval`
 * grants immediately and the document confirms without a hold.
 */
export function createDocumentWorkflowGate(
  resolveConfig: (actionType: GateableActionType) => GateConfig | null,
  /**
   * Persists a request that is actually held, so it reaches the approvals
   * inbox. Without it the gate built the request in memory, returned
   * `granted: false`, and dropped it — the document sat pending while no
   * approval request existed anywhere, so nobody could ever approve or reject
   * it and the inbox showed nothing.
   */
  requests?: ApprovalRequestRepository,
): DocumentWorkflowGate {
  return {
    async evaluate(input) {
      const config = resolveConfig(input.actionType) ?? { actionType: input.actionType, steps: [] };
      if (requests) {
        // A confirm of an already-submitted document must READ its standing
        // request, never overwrite it: submitting afresh on every confirm threw
        // away the approval that had just been granted, so an approved document
        // could never be posted by anyone.
        const existing = await requests.findById(input.requestId);
        if (existing) {
          if (existing.status === "approved") return { granted: true, requestId: existing.id };
          if (existing.status === "pending") return { granted: false, requestId: existing.id };
          if (existing.status === "rejected") throw new ApprovalRequestRejectedError(existing.id);
          const resumed = await resubmitApproval(existing.id, { submittedBy: input.submittedBy }, requests);
          return { granted: resumed.status === "approved", requestId: resumed.id };
        }
        const record = await submitApproval(
          {
            requestId: input.requestId,
            actionType: input.actionType,
            submittedBy: input.submittedBy,
            submitterRoles: input.submitterRoles,
            entityLabel: input.entityLabel ?? null,
          },
          config,
          requests,
        );
        return { granted: record.status === "approved", requestId: record.id };
      }
      const { request } = startApproval(config, {
        requestId: input.requestId,
        submittedBy: input.submittedBy,
        submitterRoles: input.submitterRoles,
      });
      return { granted: request.status === "approved", requestId: request.id };
    },
  };
}
