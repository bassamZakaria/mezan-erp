import { Hono, type Context } from "hono";
import {
  InvalidRecognitionRunError,
  NoFiscalPeriodForDateError,
  PeriodNotOpenForPostingError,
  RecognitionPreviousPeriodMissingError,
  RecognitionRunAlreadyPostedError,
  RecognitionRunAlreadyReversedError,
  RecognitionRunNotFoundError,
  RecognitionRunNotLatestError,
  RecognitionService,
  VatPeriodAlreadyFiledError,
  type RecognitionFigures,
  type RecognitionPreview,
  type RecognitionServiceDeps,
  type RevenueRecognitionRun,
} from "@mezan/domain";
import { postRecognitionRunSchema } from "@mezan/contracts";
import { callerUserId, createPermissionGate, type AuthContextResolver } from "./permission-gate.js";

/**
 * تشغيل الاعتراف بالإيراد — the monthly EAS 48 run, its cost-to-complete
 * workspace and the reversal (design D-03, D-12).
 *
 * PERMISSIONS: a run posts revenue and relieves WIP, which is the same
 * authority as approving a مستخلص — it reads under
 * `contracting.certificate.view` and posts under
 * `contracting.certificate.approve`. No new code is minted.
 */
const VIEW = "contracting.certificate.view";
const APPROVE = "contracting.certificate.approve";

export interface ContractingRecognitionRoutesDeps extends RecognitionServiceDeps {}

function serializeFigures(figures: RecognitionFigures) {
  return {
    recognitionPolicy: figures.recognitionPolicy,
    estimatedTotalCost: figures.estimatedTotalCost.toString(),
    costToDate: figures.costToDate.toString(),
    costToComplete: figures.costToComplete.toString(),
    percentComplete: figures.percentComplete,
    contractValue: figures.contractValue.toString(),
    revenueToDate: figures.revenueToDate.toString(),
    revenueRecognisedPreviously: figures.revenueRecognisedPreviously.toString(),
    periodRevenue: figures.periodRevenue.toString(),
    billedInPeriod: figures.billedInPeriod.toString(),
    billedToDate: figures.billedToDate.toString(),
    contractAsset: figures.contractAsset.toString(),
    contractLiability: figures.contractLiability.toString(),
    contractPositionMovement: figures.contractPositionMovement.toString(),
    foreseeableLoss: figures.foreseeableLoss.toString(),
    provisionRequired: figures.provisionRequired.toString(),
    provisionBalance: figures.provisionBalance.toString(),
    provisionMovement: figures.provisionMovement.toString(),
    wipOpening: figures.wipOpening.toString(),
    wipIncurred: figures.wipIncurred.toString(),
    wipRelieved: figures.wipRelieved.toString(),
    wipClosing: figures.wipClosing.toString(),
    wipByCategory: figures.wipByCategory.map((b) => ({
      costCategory: b.costCategory,
      amount: b.amount.toString(),
    })),
    advanceOutstanding: figures.advanceOutstanding.toString(),
    retentionHeld: figures.retentionHeld.toString(),
  };
}

function serializeRun(run: RevenueRecognitionRun) {
  return {
    ...serializeFigures(run),
    id: run.id,
    docNo: run.docNo,
    contractId: run.contractId,
    contractDocNo: run.contractDocNo,
    projectId: run.projectId,
    periodEnd: run.periodEnd,
    status: run.status,
    journalEntryId: run.journalEntryId,
    reversalJournalEntryId: run.reversalJournalEntryId,
    postedAt: run.postedAt,
    postedBy: run.postedBy,
    reversedAt: run.reversedAt,
    reversedBy: run.reversedBy,
  };
}

function serializePreview(preview: RecognitionPreview) {
  return {
    ...serializeFigures(preview),
    contractId: preview.contractId,
    contractDocNo: preview.contractDocNo,
    contractTitleAr: preview.contractTitleAr,
    contractStatus: preview.contractStatus,
    projectId: preview.projectId,
    periodEnd: preview.periodEnd,
    lastRunPeriodEnd: preview.lastRunPeriodEnd,
    existingRunId: preview.existingRunId,
    existingRunDocNo: preview.existingRunDocNo,
    due: preview.due,
    blockedReasonAr: preview.blockedReasonAr,
    recomputed: preview.recomputed ? serializeFigures(preview.recomputed) : null,
    divergent: preview.divergent,
  };
}

function handleDomainError(c: Context, err: unknown) {
  if (err instanceof RecognitionRunNotFoundError) {
    return c.json({ error: err.code, message: err.message }, 404);
  }
  if (err instanceof InvalidRecognitionRunError) {
    return c.json({ error: err.code, message: err.message, reasons: err.reasons }, 422);
  }
  if (err instanceof RecognitionRunAlreadyPostedError) {
    return c.json({ error: err.code, message: err.message, periodEnd: err.periodEnd, docNo: err.docNo }, 409);
  }
  if (err instanceof RecognitionPreviousPeriodMissingError) {
    return c.json({ error: err.code, message: err.message, previousPeriodEnd: err.previousPeriodEnd }, 409);
  }
  if (err instanceof RecognitionRunNotLatestError) {
    return c.json({ error: err.code, message: err.message, latestPeriodEnd: err.latestPeriodEnd }, 409);
  }
  if (err instanceof RecognitionRunAlreadyReversedError) {
    return c.json({ error: err.code, message: err.message }, 409);
  }
  // The fiscal-period and VAT gates live inside the GL engine; a closed month
  // is a refusal the accountant has to read, never a 500.
  if (err instanceof PeriodNotOpenForPostingError || err instanceof NoFiscalPeriodForDateError) {
    return c.json({ error: "FISCAL_PERIOD_CLOSED", message: err.message }, 409);
  }
  if (err instanceof VatPeriodAlreadyFiledError) {
    return c.json({ error: "VAT_PERIOD_FILED", message: err.message }, 409);
  }
  throw err;
}

export function createContractingRecognitionRoutes(
  deps: ContractingRecognitionRoutesDeps,
  resolveAuthContext: AuthContextResolver,
) {
  const app = new Hono();
  const gate = createPermissionGate(resolveAuthContext);
  const service = new RecognitionService(deps);

  app.get("/preview", gate(VIEW), async (c) => {
    const contractId = c.req.query("contractId");
    if (!contractId) {
      return c.json({ error: "VALIDATION_ERROR", message: "العقد مطلوب." }, 400);
    }
    const periodEnd = c.req.query("periodEnd") ?? service.defaultPeriodEnd();
    try {
      return c.json(serializePreview(await service.preview(contractId, periodEnd)));
    } catch (err) {
      return handleDomainError(c, err);
    }
  });

  app.get("/status", gate(VIEW), async (c) => {
    const periodEnd = c.req.query("periodEnd") ?? service.defaultPeriodEnd();
    try {
      const rows = await service.status(periodEnd);
      return c.json({ periodEnd, rows: rows.map(serializePreview) });
    } catch (err) {
      return handleDomainError(c, err);
    }
  });

  app.get("/runs", gate(VIEW), async (c) => {
    const runs = await service.listRuns({
      contractId: c.req.query("contractId"),
      projectId: c.req.query("projectId"),
      periodEnd: c.req.query("periodEnd"),
    });
    return c.json(runs.map(serializeRun));
  });

  app.post("/runs", gate(APPROVE), async (c) => {
    const parsed = postRecognitionRunSchema.safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) return c.json({ error: "VALIDATION_ERROR", details: parsed.error.flatten() }, 400);
    try {
      const run = await service.post({
        id: parsed.data.id,
        contractId: parsed.data.contractId,
        periodEnd: parsed.data.periodEnd,
        postedBy: callerUserId(c) ?? null,
      });
      return c.json(serializeRun(run), 201);
    } catch (err) {
      return handleDomainError(c, err);
    }
  });

  app.get("/runs/:id", gate(VIEW), async (c) => {
    const run = await service.findRun(c.req.param("id"));
    if (!run) return c.json({ error: "RECOGNITION_RUN_NOT_FOUND", message: "تشغيل الاعتراف بالإيراد غير موجود." }, 404);
    return c.json(serializeRun(run));
  });

  app.post("/runs/:id/reverse", gate(APPROVE), async (c) => {
    try {
      const run = await service.reverse(c.req.param("id"), { reversedBy: callerUserId(c) ?? null });
      return c.json(serializeRun(run));
    } catch (err) {
      return handleDomainError(c, err);
    }
  });

  return app;
}
