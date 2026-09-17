import { Hono } from "hono";
import {
  Money,
  journalDocumentType,
  voucherDocumentType,
  stockAdjustmentDocumentType,
  stockTransferDocumentType,
  type DocumentTypeDefinition,
  type FrameworkDocument,
  type JournalDocLine,
} from "@mezan/domain";
import { journalDocumentEffectsRequestSchema } from "@mezan/contracts";
import { createPermissionGate, type AuthContextResolver } from "./permission-gate.js";

/**
 * Document-framework routes (docs/archive/plan.md §3 + docs/archive/plan.md §3),
 * mounted under `/documents`:
 *   GET  /documents/types            list registered document types + their hooks
 *   POST /documents/journal/effects  compute the "تأثيرات هذا المستند" descriptor
 *
 * The effects endpoint is a pure computation over the journal document type's
 * `describeEffects` — no persistence — so the web effects panel and the confirm
 * gate share one authoritative balance check. Actual posting stays on `/gl`
 * (which the journal document's GL hook wraps).
 */

const DOCUMENT_TYPES: readonly DocumentTypeDefinition<unknown>[] = [
  journalDocumentType as DocumentTypeDefinition<unknown>,
  voucherDocumentType as DocumentTypeDefinition<unknown>,
  stockAdjustmentDocumentType as DocumentTypeDefinition<unknown>,
  stockTransferDocumentType as DocumentTypeDefinition<unknown>,
];

function describeType(def: DocumentTypeDefinition<unknown>) {
  return {
    code: def.code,
    labelAr: def.labelAr,
    confirmedStatus: def.confirmedStatus,
    numberingSequence: def.numberingSequence,
    numberFromGl: def.numberFromGl ?? false,
    gateActionType: def.gateActionType,
    hooks: {
      numbering: def.numberingSequence !== null && !def.numberFromGl,
      gl: typeof def.buildGlPosting === "function",
      stock: typeof def.buildStockPlan === "function",
      workflow: def.gateActionType !== null,
    },
  };
}

/** Build a throwaway draft document so `describeEffects` (which only reads lines) can run. */
function draftFromLines(lines: readonly JournalDocLine[]): FrameworkDocument<JournalDocLine> {
  return {
    id: "preview",
    docType: journalDocumentType.code,
    docNo: null,
    date: "",
    memo: "",
    status: "draft",
    lines,
    createdAt: "",
    confirmedAt: null,
    reversesDocId: null,
    reversedByDocId: null,
    workflowRequestId: null,
    journalEntryId: null,
  };
}

export function createDocumentsRoutes(
  resolveAuthContext: AuthContextResolver,
) {
  const app = new Hono();
  const gate = createPermissionGate(resolveAuthContext);

  app.get("/types", gate("accounting.journal.view"), (c) => {
    return c.json(DOCUMENT_TYPES.map(describeType));
  });

  app.post("/journal/effects", gate("accounting.journal.view"), async (c) => {
    const parsed = journalDocumentEffectsRequestSchema.safeParse(await c.req.json());
    if (!parsed.success) {
      return c.json({ error: "VALIDATION_ERROR", details: parsed.error.flatten() }, 400);
    }
    const draft = draftFromLines(
      parsed.data.lines.map((l) => ({
        accountId: l.accountId,
        debit: Money.fromMajor(l.debit),
        credit: Money.fromMajor(l.credit),
        memo: l.memo ?? null,
        costCenterId: l.costCenterId ?? null,
        projectId: l.projectId ?? null,
        costCategory: l.costCategory ?? null,
      })),
    );
    const effects = journalDocumentType.describeEffects(draft);
    return c.json({
      effects: effects.effects,
      balanced: effects.balanced,
      totalDebit: effects.totalDebit?.toString(),
      totalCredit: effects.totalCredit?.toString(),
      blocked: effects.blocked,
      blockedReason: effects.blockedReason ?? null,
    });
  });

  return app;
}
