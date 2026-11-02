import type { Context } from "hono";
import { can, type FrameworkDocument, type NameReturnJournalLineTaxRequest, type NameReturnJournalLineTaxResult } from "@mezan/domain";
import { lineTaxClassificationSchema, nameJournalLineTaxSchema, TaxClassificationFilingOutcomeCode } from "@mezan/contracts";
import { handleDocumentError } from "./document-error-handling.js";
import { callerUserId, getAuthContext } from "./permission-gate.js";
import { taxClassificationRefusal } from "./tax-rate-refusal.js";

const JOURNAL_VIEW_PERMISSION = "accounting.journal.view";

export type ReturnJournalTaxPort<Line> = (id: string, request: NameReturnJournalLineTaxRequest) => Promise<NameReturnJournalLineTaxResult<Line>>;

// SECURITY: the caller has already been shown the return under its own
// visibility rule. This adds the right to read the journal — the request
// points into the entry — and reads nothing about the return's state: every
// guard is the port's, inside its transaction.
export async function handleReturnJournalTax<Line>(
  c: Context,
  visible: FrameworkDocument<Line>,
  viewPermissions: readonly string[],
  port: ReturnJournalTaxPort<Line> | undefined,
): Promise<Response> {
  const ctx = getAuthContext(c);
  if (!ctx || !can(ctx, JOURNAL_VIEW_PERMISSION) || !viewPermissions.some((permission) => can(ctx, permission))) {
    return c.json({ error: "FORBIDDEN", message: "تسمية ضريبة سطر القيد تتطلب صلاحية عرض المرتجع وصلاحية عرض قيود اليومية.", messageEn: "Naming the tax of a journal line requires permission to view the return and permission to view journal entries." }, 403);
  }
  if (!port) {
    return c.json({ error: "TAX_CLASSIFICATION_NOT_CONFIGURED", message: "تصنيف ضريبة البنود غير مُفعّل على هذا الخادم.", messageEn: "Line tax classification is not enabled on this server." }, 501);
  }
  const parsed = nameJournalLineTaxSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) {
    return c.json({ error: "VALIDATION_ERROR", details: parsed.error.flatten() }, 400);
  }
  try {
    const result = await port(visible.id, {
      lineRef: c.req.param("lineId") ?? "",
      taxRateId: parsed.data.taxRateId,
      journalLineIndexes: parsed.data.journalLineIndexes,
      actor: callerUserId(c),
    });
    return c.json(
      lineTaxClassificationSchema.parse({
        documentId: result.document.id,
        documentNumber: result.document.docNo,
        lineIds: result.plan.lineRefs,
        taxRateId: result.plan.after.taxRateId,
        taxRateName: result.plan.taxRateName,
        taxRatePercent: result.plan.after.taxRatePercent,
        journalLinesNamed: result.journalLinesNamed,
        filing: TaxClassificationFilingOutcomeCode.NotQueued,
      }),
    );
  } catch (err) {
    return taxClassificationRefusal(c, err) ?? handleDocumentError(c, err);
  }
}
