import { postingRefusalResponse } from "./posting-refusal.js";
import { Hono, type Context } from "hono";
import { importRowLimit } from "./import-limit.js";
import {
  WorksContractService,
  WorksContractNotDraftError,
  WorksContractNotFoundError,
  InvalidWorksContractError,
  InvalidWorksContractTransitionError,
  SelfApprovalError,
  VariationOrderNotFoundError,
  computeVariationOrderValue,
  extendBoqLine,
  getBoqUnitLabel,
  Money,
  type BoqImportReview,
  type ContractedQtyRow,
  type BoqLine,
  type BoqLineInput,
  type VariationOrderLineInput,
  type VariationOrderView,
  type WorksContractServiceDeps,
  type WorksContractStatus,
  type WorksContractView,
  type VariationOrderStatus,
} from "@mezan/domain";
import {
  activateWorksContractSchema,
  approveVariationOrderSchema,
  boqImportSchema,
  completeWorksContractSchema,
  createVariationOrderSchema,
  createWorksContractSchema,
  putBoqSchema,
  rejectVariationOrderSchema,
  terminateWorksContractSchema,
  updateVariationOrderSchema,
  updateWorksContractSchema,
} from "@mezan/contracts";
import { createPermissionGate, getAuthContext, type AuthContextResolver } from "./permission-gate.js";
import { duplicateIdRefusal } from "./duplicate-id.js";
import { DuplicateRecordIdError } from "@mezan/domain";

/**
 * العقود وجداول الكميات وأوامر التغيير — slice 1 of المقاولات.
 *
 * Every derived figure on these responses (contract value, value after
 * variations, contracted quantity as of a date) is computed HERE from the
 * stored documents and is never read off the request body: they are on the
 * design's "never accepted from the client" list (§06).
 */

const VIEW = "contracting.boq.view";
const MANAGE = "contracting.boq.manage";
const APPROVE = "contracting.variation.approve";

export interface ContractingContractsRoutesDeps extends WorksContractServiceDeps {}

function actorOf(c: Context) {
  const ctx = getAuthContext(c);
  return {
    userId: ctx?.userId ?? "anonymous",
    wildcardAdmin: ctx?.permissions.has("*") ?? false,
  };
}

function serializeContract(view: WorksContractView) {
  const c = view.contract;
  return {
    id: c.id,
    docNo: c.docNo,
    projectId: c.projectId,
    customerId: c.customerId,
    titleAr: c.titleAr,
    titleEn: c.titleEn,
    contractType: c.contractType,
    signedDate: c.signedDate,
    startDate: c.startDate,
    plannedEndDate: c.plannedEndDate,
    currency: c.currency,
    status: c.status,
    activatedAt: c.activatedAt,
    completedAt: c.completedAt,
    terminatedAt: c.terminatedAt,
    notes: c.notes,
    estimatedTotalCost: c.estimatedTotalCost?.toString() ?? null,
    budgetRevisions: c.budgetRevisions.map((r) => ({
      date: r.date,
      previousValue: r.previousValue?.toString() ?? null,
      newValue: r.newValue?.toString() ?? null,
      reason: r.reason,
      userId: r.userId,
    })),
    tenderDiscountPercent: c.tenderDiscountPercent,
    retentionPercent: c.retentionPercent,
    retentionCapPercent: c.retentionCapPercent,
    advancePercent: c.advancePercent,
    advanceRecoveryPercent: c.advanceRecoveryPercent,
    materialsOnSitePercent: c.materialsOnSitePercent,
    deemedWagePercent: c.deemedWagePercent,
    socialInsuranceRatePercent: c.socialInsuranceRatePercent,
    socialInsuranceNote: c.socialInsuranceNote,
    withholdingTaxPercent: c.withholdingTaxPercent,
    vatBasis: c.vatBasis,
    paymentTermDays: c.paymentTermDays,
    defectsLiabilityMonths: c.defectsLiabilityMonths,
    recognitionPolicy: c.recognitionPolicy,
    stampDutyPercent: c.stampDutyPercent,
    latePenaltyPercentPerPeriod: c.latePenaltyPercentPerPeriod,
    latePenaltyCapPercent: c.latePenaltyCapPercent,
    finalSecurityPercent: c.finalSecurityPercent,
    provisionalReleasePercent: c.provisionalReleasePercent,
    provisionalHandoverDate: c.provisionalHandoverDate,
    finalHandoverDate: c.finalHandoverDate,
    contractValue: view.contractValue.toString(),
    approvedVariationsValue: view.approvedVariationsValue.toString(),
    contractValueAfterVariations: view.contractValueAfterVariations.toString(),
    boqLineCount: view.boqLineCount,
    variationCount: view.variationCount,
    canComplete: view.canComplete,
    finalSecurityStatus:
      view.finalSecurityStatus === null
        ? null
        : {
            required: view.finalSecurityStatus.required.toString(),
            covered: view.finalSecurityStatus.covered.toString(),
            shortfall: view.finalSecurityStatus.shortfall.toString(),
            guaranteeId: view.finalSecurityStatus.guaranteeId,
            guaranteeDocNo: view.finalSecurityStatus.guaranteeDocNo,
            expiryDate: view.finalSecurityStatus.expiryDate,
          },
  };
}

function serializeBoqLine(line: BoqLine) {
  return {
    id: line.id,
    contractId: line.contractId,
    code: line.code,
    descriptionAr: line.descriptionAr,
    descriptionEn: line.descriptionEn,
    unit: line.unit,
    unitLabelAr: getBoqUnitLabel(line.unit),
    qty: line.qty.toString(),
    unitRate: line.unitRate.toString(),
    lineValue: extendBoqLine(line.qty, line.unitRate).toString(),
    estimatedUnitCost: line.estimatedUnitCost?.toString() ?? null,
    section: line.section,
    sortOrder: line.sortOrder,
    origin: line.origin,
    variationOrderId: line.variationOrderId,
    costCategory: line.costCategory,
    theoreticalQtyPerUnit: line.theoreticalQtyPerUnit?.toString() ?? null,
    theoreticalItemId: line.theoreticalItemId,
  };
}

function serializeContractedQty(row: ContractedQtyRow) {
  return {
    boqLineId: row.boqLineId,
    code: row.code,
    descriptionAr: row.descriptionAr,
    baseQty: row.baseQty.toString(),
    adjustmentQty: row.adjustmentQty.toString(),
    contractedQty: row.contractedQty.toString(),
  };
}

function serializeReview(review: BoqImportReview) {
  return {
    rows: review.rows.map((r) => ({
      rowNumber: r.rowNumber,
      accepted: r.accepted,
      problems: r.problems,
      problemsEn: r.problemsEn,
      code: (r.raw.code ?? "").toString(),
      descriptionAr: (r.raw.descriptionAr ?? "").toString(),
      unit: r.value ? r.value.unit : (r.raw.unit ?? "").toString(),
      qty: r.value ? r.value.qty.toString() : (r.raw.qty ?? "").toString(),
      unitRate: r.value ? r.value.unitRate.toString() : (r.raw.unitRate ?? "").toString(),
    })),
    acceptedCount: review.acceptedCount,
    rejectedCount: review.rejectedCount,
  };
}

function serializeVariationOrder(view: VariationOrderView, contractDocNo: string, boqLines: readonly BoqLine[]) {
  const o = view.order;
  return {
    id: o.id,
    docNo: o.docNo,
    contractId: o.contractId,
    contractDocNo,
    date: o.date,
    titleAr: o.titleAr,
    reason: o.reason,
    requestedBy: o.requestedBy,
    status: o.status,
    approvedAt: o.approvedAt,
    approvedBy: o.approvedBy,
    rejectedReason: o.rejectedReason,
    createdBy: o.createdBy,
    netValue: view.netValue.toString(),
    lines: o.lines.map((line) => ({
      id: line.id,
      kind: line.kind,
      boqLineId: line.boqLineId,
      newLine: line.newLine
        ? {
            code: line.newLine.code,
            descriptionAr: line.newLine.descriptionAr,
            descriptionEn: line.newLine.descriptionEn,
            unit: line.newLine.unit,
            qty: line.newLine.qty.toString(),
            unitRate: line.newLine.unitRate.toString(),
            estimatedUnitCost: line.newLine.estimatedUnitCost?.toString() ?? null,
            section: line.newLine.section,
            costCategory: line.newLine.costCategory,
          }
        : null,
      qtyDelta: line.qtyDelta?.toString() ?? null,
      unitRateOverride: line.unitRateOverride?.toString() ?? null,
      sortOrder: line.sortOrder,
      lineValue: computeVariationOrderValue({ lines: [line] }, boqLines).toString(),
    })),
  };
}

function handleDomainError(c: Context, err: unknown) {
  if (err instanceof DuplicateRecordIdError) return duplicateIdRefusal(c, err);
  const postingRefusal = postingRefusalResponse(c, err);
  if (postingRefusal) return postingRefusal;
  if (err instanceof WorksContractNotFoundError || err instanceof VariationOrderNotFoundError) {
    return c.json({ error: err.code, message: err.message, messageEn: err.messageEn }, 404);
  }
  if (err instanceof InvalidWorksContractError) {
    return c.json({ error: err.code, message: err.message, messageEn: err.messageEn, reasons: err.reasons }, 422);
  }
  if (err instanceof WorksContractNotDraftError) {
    return c.json({ error: err.code, message: err.message, messageEn: err.messageEn, status: err.status }, 409);
  }
  if (err instanceof InvalidWorksContractTransitionError) {
    return c.json({ error: err.code, message: err.message, messageEn: err.messageEn, from: err.from, to: err.to }, 409);
  }
  if (err instanceof SelfApprovalError) {
    return c.json({ error: err.code, message: err.message, messageEn: err.messageEn }, 403);
  }
  throw err;
}

function toBoqInputs(lines: readonly unknown[]): BoqLineInput[] {
  return lines as BoqLineInput[];
}

export function createContractingContractsRoutes(
  deps: ContractingContractsRoutesDeps,
  resolveAuthContext: AuthContextResolver,
) {
  const app = new Hono();
  const gate = createPermissionGate(resolveAuthContext);
  const service = new WorksContractService(deps);

  app.get("/", gate(VIEW), async (c) => {
    const projectId = c.req.query("projectId");
    const status = c.req.query("status") as WorksContractStatus | undefined;
    const views = await service.list({
      ...(projectId ? { projectId } : {}),
      ...(status ? { status } : {}),
    });
    return c.json(views.map(serializeContract));
  });

  app.get("/:id", gate(VIEW), async (c) => {
    try {
      return c.json(serializeContract(await service.get(c.req.param("id"))));
    } catch (err) {
      return handleDomainError(c, err);
    }
  });

  app.post("/", gate(MANAGE), async (c) => {
    const parsed = createWorksContractSchema.safeParse(await c.req.json());
    if (!parsed.success) return c.json({ error: "VALIDATION_ERROR", details: parsed.error.flatten() }, 400);
    try {
      return c.json(serializeContract(await service.create(parsed.data)), 201);
    } catch (err) {
      return handleDomainError(c, err);
    }
  });

  app.patch("/:id", gate(MANAGE), async (c) => {
    const parsed = updateWorksContractSchema.safeParse(await c.req.json());
    if (!parsed.success) return c.json({ error: "VALIDATION_ERROR", details: parsed.error.flatten() }, 400);
    try {
      return c.json(serializeContract(await service.update(c.req.param("id"), parsed.data, actorOf(c))));
    } catch (err) {
      return handleDomainError(c, err);
    }
  });

  app.post("/:id/activate", gate(MANAGE), async (c) => {
    const parsed = activateWorksContractSchema.safeParse(await c.req.json());
    if (!parsed.success) return c.json({ error: "VALIDATION_ERROR", details: parsed.error.flatten() }, 400);
    try {
      return c.json(serializeContract(await service.activate(c.req.param("id"), parsed.data.activatedAt)));
    } catch (err) {
      return handleDomainError(c, err);
    }
  });

  app.post("/:id/complete", gate(MANAGE), async (c) => {
    const parsed = completeWorksContractSchema.safeParse(await c.req.json());
    if (!parsed.success) return c.json({ error: "VALIDATION_ERROR", details: parsed.error.flatten() }, 400);
    try {
      return c.json(serializeContract(await service.complete(c.req.param("id"), parsed.data.completedAt)));
    } catch (err) {
      return handleDomainError(c, err);
    }
  });

  app.post("/:id/terminate", gate(MANAGE), async (c) => {
    const parsed = terminateWorksContractSchema.safeParse(await c.req.json());
    if (!parsed.success) return c.json({ error: "VALIDATION_ERROR", details: parsed.error.flatten() }, 400);
    try {
      return c.json(
        serializeContract(await service.terminate(c.req.param("id"), parsed.data.terminatedAt, parsed.data.reason ?? null)),
      );
    } catch (err) {
      return handleDomainError(c, err);
    }
  });

  app.get("/:id/boq", gate(VIEW), async (c) => {
    try {
      const lines = await service.listBoq(c.req.param("id"));
      return c.json({
        lines: lines.map(serializeBoqLine),
        total: Money.sum(lines.map((l) => extendBoqLine(l.qty, l.unitRate))).toString(),
      });
    } catch (err) {
      return handleDomainError(c, err);
    }
  });

  app.put("/:id/boq", gate(MANAGE), async (c) => {
    const parsed = putBoqSchema.safeParse(await c.req.json());
    if (!parsed.success) return c.json({ error: "VALIDATION_ERROR", details: parsed.error.flatten() }, 400);
    try {
      const lines = await service.putBoq(c.req.param("id"), toBoqInputs(parsed.data.lines));
      return c.json({
        lines: lines.map(serializeBoqLine),
        total: Money.sum(lines.map((l) => extendBoqLine(l.qty, l.unitRate))).toString(),
      });
    } catch (err) {
      return handleDomainError(c, err);
    }
  });

  app.get("/:id/boq/contracted-qty", gate(VIEW), async (c) => {
    try {
      const asOfDate = c.req.query("asOfDate") ?? null;
      const rows = await service.contractedQuantities(c.req.param("id"), asOfDate);
      return c.json({ asOfDate, rows: rows.map(serializeContractedQty) });
    } catch (err) {
      return handleDomainError(c, err);
    }
  });

  const boqRowLimit = importRowLimit();
  app.post("/:id/boq/import", gate(MANAGE), boqRowLimit, async (c) => {
    const parsed = boqImportSchema.safeParse(await c.req.json());
    if (!parsed.success) return c.json({ error: "VALIDATION_ERROR", details: parsed.error.flatten() }, 400);
    try {
      return c.json(serializeReview(await service.reviewImport(c.req.param("id"), parsed.data.rows)));
    } catch (err) {
      return handleDomainError(c, err);
    }
  });

  app.post("/:id/boq/import/commit", gate(MANAGE), boqRowLimit, async (c) => {
    const parsed = boqImportSchema.safeParse(await c.req.json());
    if (!parsed.success) return c.json({ error: "VALIDATION_ERROR", details: parsed.error.flatten() }, 400);
    try {
      const { review, lines } = await service.commitImport(c.req.param("id"), parsed.data.rows);
      return c.json({ review: serializeReview(review), lines: lines.map(serializeBoqLine) });
    } catch (err) {
      return handleDomainError(c, err);
    }
  });

  return app;
}

export function createVariationOrdersRoutes(
  deps: ContractingContractsRoutesDeps,
  resolveAuthContext: AuthContextResolver,
) {
  const app = new Hono();
  const gate = createPermissionGate(resolveAuthContext);
  const service = new WorksContractService(deps);

  async function serialize(view: VariationOrderView) {
    const contract = await deps.store.findContractById(view.order.contractId);
    const boqLines = await deps.store.listBoqLines(view.order.contractId);
    return serializeVariationOrder(view, contract?.docNo ?? view.order.contractId, boqLines);
  }

  app.get("/", gate(VIEW), async (c) => {
    const contractId = c.req.query("contractId");
    const status = c.req.query("status") as VariationOrderStatus | undefined;
    const views = await service.listVariationOrders({
      ...(contractId ? { contractId } : {}),
      ...(status ? { status } : {}),
    });
    return c.json(await Promise.all(views.map((v) => serialize(v))));
  });

  app.get("/:id", gate(VIEW), async (c) => {
    try {
      return c.json(await serialize(await service.getVariationOrder(c.req.param("id"))));
    } catch (err) {
      return handleDomainError(c, err);
    }
  });

  app.post("/", gate(MANAGE), async (c) => {
    const parsed = createVariationOrderSchema.safeParse(await c.req.json());
    if (!parsed.success) return c.json({ error: "VALIDATION_ERROR", details: parsed.error.flatten() }, 400);
    try {
      const view = await service.createVariationOrder(
        { ...parsed.data, lines: parsed.data.lines as VariationOrderLineInput[] },
        actorOf(c),
      );
      return c.json(await serialize(view), 201);
    } catch (err) {
      return handleDomainError(c, err);
    }
  });

  app.patch("/:id", gate(MANAGE), async (c) => {
    const parsed = updateVariationOrderSchema.safeParse(await c.req.json());
    if (!parsed.success) return c.json({ error: "VALIDATION_ERROR", details: parsed.error.flatten() }, 400);
    try {
      const view = await service.updateVariationOrder(c.req.param("id"), {
        ...parsed.data,
        ...(parsed.data.lines ? { lines: parsed.data.lines as VariationOrderLineInput[] } : {}),
      });
      return c.json(await serialize(view));
    } catch (err) {
      return handleDomainError(c, err);
    }
  });

  app.post("/:id/approve", gate(APPROVE), async (c) => {
    const parsed = approveVariationOrderSchema.safeParse(await c.req.json());
    if (!parsed.success) return c.json({ error: "VALIDATION_ERROR", details: parsed.error.flatten() }, 400);
    try {
      const view = await service.approveVariationOrder(c.req.param("id"), parsed.data.approvedAt, actorOf(c));
      return c.json(await serialize(view));
    } catch (err) {
      return handleDomainError(c, err);
    }
  });

  app.post("/:id/reject", gate(APPROVE), async (c) => {
    const parsed = rejectVariationOrderSchema.safeParse(await c.req.json());
    if (!parsed.success) return c.json({ error: "VALIDATION_ERROR", details: parsed.error.flatten() }, 400);
    try {
      const view = await service.rejectVariationOrder(c.req.param("id"), parsed.data.reason, actorOf(c));
      return c.json(await serialize(view));
    } catch (err) {
      return handleDomainError(c, err);
    }
  });

  return app;
}
