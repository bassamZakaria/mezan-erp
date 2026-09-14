import { Hono, type Context } from "hono";
import {
  ControlsService,
  InvalidRetentionReleaseError,
  InvalidRetentionReleaseTransitionError,
  NoFiscalPeriodForDateError,
  PeriodNotOpenForPostingError,
  RetentionReleaseExceedsBalanceError,
  RetentionReleaseNotFoundError,
  VatPeriodAlreadyFiledError,
  getBoqUnitLabel,
  getRetentionReleaseKindLabel,
  getRetentionReleaseStatusLabel,
  type BoqLine,
  type ControlsServiceDeps,
  type ExceptionReport,
  type ExceptionReportParams,
  type RetentionCalendar,
  type RetentionReleaseKind,
  type RetentionReleaseStatus,
  type RetentionReleaseView,
} from "@mezan/domain";
import {
  createRetentionReleaseSchema,
  recordHandoverSchema,
  releaseRetentionSchema,
  setTheoreticalQuantitiesSchema,
  updateRetentionReleaseSchema,
} from "@mezan/contracts";
import { callerUserId, createPermissionGate, getAuthContext, type AuthContextResolver } from "./permission-gate.js";

/**
 * تقارير الاستثناءات الستة، الإفراج عن المحتجزات وتقويم المحتجزات — slice 5B
 * (docs/artifacts/mezan-contracting-designs.html §06).
 *
 * PERMISSIONS: the reports read under `contracting.certificate.view` — they are
 * the control side of the same documents. Releasing retention is its own right,
 * `contracting.retention.release`, held by the finance manager (design §06).
 */

const VIEW = "contracting.certificate.view";
const RELEASE = "contracting.retention.release";
const BOQ_MANAGE = "contracting.boq.manage";

export interface ContractingControlsRoutesDeps extends ControlsServiceDeps {}

function paramsOf(c: Context): ExceptionReportParams {
  const olderThanDays = c.req.query("olderThanDays");
  const parsed = olderThanDays === undefined ? null : Number.parseInt(olderThanDays, 10);
  return {
    projectId: c.req.query("projectId") ?? null,
    asOfDate: c.req.query("asOfDate") ?? null,
    olderThanDays: parsed === null || Number.isNaN(parsed) ? null : parsed,
    thresholdPercent: c.req.query("thresholdPercent") ?? null,
    stalenessMonths: stalenessOf(c.req.query("stalenessMonths")),
  };
}

function stalenessOf(raw: string | undefined): number | null {
  if (raw === undefined) return null;
  const parsed = Number.parseInt(raw, 10);
  return Number.isNaN(parsed) ? null : parsed;
}

/** Money and Qty go over the wire as exact decimal strings, never as numbers. */
function s(value: { toString(): string } | null | undefined): string | null {
  return value === null || value === undefined ? null : value.toString();
}

function serializeReport<TRow, TOut>(
  report: ExceptionReport<TRow>,
  row: (r: TRow) => TOut,
): Record<string, unknown> {
  return {
    key: report.key,
    labelAr: report.labelAr,
    ruleAr: report.ruleAr,
    asOfDate: report.asOfDate,
    projectId: report.projectId,
    olderThanDays: report.olderThanDays,
    thresholdPercent: report.thresholdPercent,
    stalenessMonths: report.stalenessMonths,
    rows: report.rows.map(row),
  };
}

function serializeRelease(view: RetentionReleaseView) {
  const r = view.release;
  return {
    id: r.id,
    docNo: r.docNo,
    contractId: r.contractId,
    contractDocNo: r.contractDocNo,
    contractTitleAr: view.contractTitleAr,
    projectId: r.projectId,
    customerId: r.customerId,
    kind: r.kind,
    kindLabelAr: getRetentionReleaseKindLabel(r.kind),
    date: r.date,
    amount: r.amount.toString(),
    releaseEventDate: r.releaseEventDate,
    earlyRelease: r.earlyRelease,
    status: r.status,
    statusLabelAr: getRetentionReleaseStatusLabel(r.status),
    notes: r.notes,
    invoiceId: r.invoiceId,
    invoiceDocNo: r.invoiceDocNo,
    releasedAt: r.releasedAt,
    releasedBy: r.releasedBy,
    approvedBy: r.approvedBy,
    cancelledAt: r.cancelledAt,
    createdAt: r.createdAt,
    createdBy: r.createdBy,
    held: view.position.held.toString(),
    released: view.position.released.toString(),
    balance: view.position.balance.toString(),
    cap: view.cap.toString(),
    invoiceTotal: s(view.invoice?.total),
    invoiceRemaining: s(view.invoice?.remainingBalance),
  };
}

function serializeCalendar(calendar: RetentionCalendar) {
  return {
    asOfDate: calendar.asOfDate,
    receivable: calendar.receivable.map((row) => ({
      contractId: row.contractId,
      contractDocNo: row.contractDocNo,
      contractTitleAr: row.contractTitleAr,
      contractStatus: row.contractStatus,
      projectId: row.projectId,
      projectNameAr: row.projectNameAr,
      customerId: row.customerId,
      retentionPercent: row.retentionPercent,
      provisionalReleasePercent: row.provisionalReleasePercent,
      provisionalHandoverDate: row.provisionalHandoverDate,
      finalHandoverDate: row.finalHandoverDate,
      defectsLiabilityMonths: row.defectsLiabilityMonths,
      held: row.held.toString(),
      released: row.released.toString(),
      balance: row.balance.toString(),
      provisionalReleasedToDate: row.provisionalReleasedToDate.toString(),
      event: {
        kind: row.event.kind,
        date: row.event.date,
        daysToEvent: row.event.daysToEvent,
        due: row.event.due,
        ageDays: row.event.ageDays,
      },
    })),
    payable: calendar.payable.map((row) => ({
      projectId: row.projectId,
      projectNameAr: row.projectNameAr,
      contractId: row.contractId,
      contractDocNo: row.contractDocNo,
      held: row.held.toString(),
      released: row.released.toString(),
      balance: row.balance.toString(),
      subcontracts: row.subcontracts.map((sub) => ({
        subcontractId: sub.subcontractId,
        subcontractDocNo: sub.subcontractDocNo,
        titleAr: sub.titleAr,
        supplierId: sub.supplierId,
        status: sub.status,
        held: sub.held.toString(),
        released: sub.released.toString(),
        balance: sub.balance.toString(),
        completionDate: sub.completionDate,
        defectsLiabilityMonths: sub.defectsLiabilityMonths,
        releaseEventDate: sub.releaseEventDate,
        daysToEvent: sub.daysToEvent,
        due: sub.due,
        ageDays: sub.ageDays,
      })),
    })),
  };
}

function serializeBoqLine(line: BoqLine) {
  return {
    id: line.id,
    contractId: line.contractId,
    code: line.code,
    descriptionAr: line.descriptionAr,
    unit: line.unit,
    unitLabelAr: getBoqUnitLabel(line.unit),
    qty: line.qty.toString(),
    theoreticalQtyPerUnit: s(line.theoreticalQtyPerUnit),
    theoreticalItemId: line.theoreticalItemId,
  };
}

function handleDomainError(c: Context, err: unknown) {
  if (err instanceof RetentionReleaseNotFoundError) {
    return c.json({ error: err.code, message: err.message }, 404);
  }
  if (err instanceof InvalidRetentionReleaseError) {
    return c.json({ error: err.code, message: err.message, reasons: err.reasons }, 422);
  }
  if (err instanceof RetentionReleaseExceedsBalanceError) {
    return c.json({ error: err.code, message: err.message, requested: err.requested, cap: err.cap }, 422);
  }
  if (err instanceof InvalidRetentionReleaseTransitionError) {
    return c.json({ error: err.code, message: err.message, from: err.from, to: err.to }, 409);
  }
  // A closed month is a refusal the accountant has to read, never a 500.
  if (err instanceof PeriodNotOpenForPostingError || err instanceof NoFiscalPeriodForDateError) {
    return c.json({ error: "FISCAL_PERIOD_CLOSED", message: err.message }, 409);
  }
  if (err instanceof VatPeriodAlreadyFiledError) {
    return c.json({ error: "VAT_PERIOD_FILED", message: err.message }, 409);
  }
  throw err;
}

/** `GET /contracting/reports/…` — the seven exception reports and the dashboard summary. */
export function createContractingReportsRoutes(
  deps: ContractingControlsRoutesDeps,
  resolveAuthContext: AuthContextResolver,
) {
  const app = new Hono();
  const gate = createPermissionGate(resolveAuthContext);
  const service = new ControlsService(deps);

  app.get("/summary", gate(VIEW), async (c) => {
    return c.json(await service.summary(c.req.query("asOfDate") ?? null));
  });

  app.get("/boq-overrun", gate(VIEW), async (c) => {
    const report = await service.boqOverruns(paramsOf(c));
    return c.json(
      serializeReport(report, (row) => ({
        contractId: row.contractId,
        contractDocNo: row.contractDocNo,
        projectId: row.projectId,
        boqLineId: row.boqLineId,
        code: row.code,
        descriptionAr: row.descriptionAr,
        unitLabelAr: row.unitLabelAr,
        certificateId: row.certificateId,
        certificateDocNo: row.certificateDocNo,
        executionDate: row.executionDate,
        cumulativeQty: row.cumulativeQty.toString(),
        contractedQty: row.contractedQty.toString(),
        excessQty: row.excessQty.toString(),
      })),
    );
  });

  app.get("/unreceived-issues", gate(VIEW), async (c) => {
    const report = await service.unreceivedIssues(paramsOf(c));
    return c.json(
      serializeReport(report, (row) => ({
        issueId: row.issueId,
        docNo: row.docNo,
        date: row.date,
        projectId: row.projectId,
        fromWarehouseId: row.fromWarehouseId,
        toWarehouseId: row.toWarehouseId,
        transitWarehouseId: row.transitWarehouseId,
        issuedByUserId: row.issuedByUserId,
        itemId: row.itemId,
        qtyIssued: row.qtyIssued.toString(),
        qtyReceived: row.qtyReceived.toString(),
        qtyOutstanding: row.qtyOutstanding.toString(),
        ageDays: row.ageDays,
        kind: row.kind,
        receiptId: row.receiptId,
        receiptDocNo: row.receiptDocNo,
        receiptDate: row.receiptDate,
      })),
    );
  });

  app.get("/consumption-variance", gate(VIEW), async (c) => {
    const report = await service.consumptionVariances(paramsOf(c));
    return c.json(
      serializeReport(report, (row) => ({
        contractId: row.contractId,
        contractDocNo: row.contractDocNo,
        projectId: row.projectId,
        boqLineId: row.boqLineId,
        code: row.code,
        descriptionAr: row.descriptionAr,
        itemId: row.itemId,
        theoreticalQtyPerUnit: row.theoreticalQtyPerUnit.toString(),
        certifiedCumulativeQty: row.certifiedCumulativeQty.toString(),
        theoreticalQty: row.theoreticalQty.toString(),
        consumedQty: row.consumedQty.toString(),
        consumedCost: row.consumedCost.toString(),
        varianceQty: row.varianceQty.toString(),
        variancePercent: row.variancePercent,
      })),
    );
  });

  app.get("/equipment-without-certificate", gate(VIEW), async (c) => {
    const report = await service.equipmentWithoutCertificate(paramsOf(c));
    return c.json(
      serializeReport(report, (row) => ({
        contractId: row.contractId,
        contractDocNo: row.contractDocNo,
        contractStatus: row.contractStatus,
        projectId: row.projectId,
        equipmentLogId: row.equipmentLogId,
        docNo: row.docNo,
        assetId: row.assetId,
        date: row.date,
        hours: row.hours.toString(),
        amount: row.amount.toString(),
        boqLineId: row.boqLineId,
        code: row.code,
        descriptionAr: row.descriptionAr,
        certifiedCumulativeAtLog: row.certifiedCumulativeAtLog.toString(),
        certifiedCumulativeNow: row.certifiedCumulativeNow.toString(),
        ageDays: row.ageDays,
        reason: row.reason,
      })),
    );
  });

  app.get("/late-variation-approvals", gate(VIEW), async (c) => {
    const report = await service.lateVariationApprovals(paramsOf(c));
    return c.json(
      serializeReport(report, (row) => ({
        contractId: row.contractId,
        contractDocNo: row.contractDocNo,
        projectId: row.projectId,
        variationOrderId: row.variationOrderId,
        variationDocNo: row.variationDocNo,
        variationTitleAr: row.variationTitleAr,
        approvedAt: row.approvedAt,
        boqLineId: row.boqLineId,
        code: row.code,
        descriptionAr: row.descriptionAr,
        certificateId: row.certificateId,
        certificateDocNo: row.certificateDocNo,
        executionDate: row.executionDate,
        cumulativeQty: row.cumulativeQty.toString(),
        contractedQtyAtExecution: row.contractedQtyAtExecution.toString(),
        reliedOnQty: row.reliedOnQty.toString(),
      })),
    );
  });

  app.get("/early-retention-release", gate(VIEW), async (c) => {
    const report = await service.earlyRetentionReleases(paramsOf(c));
    return c.json(
      serializeReport(report, (row) => ({
        releaseId: row.releaseId,
        docNo: row.docNo,
        party: row.party,
        counterpartyNameAr: row.counterpartyNameAr,
        contractId: row.contractId,
        contractDocNo: row.contractDocNo,
        projectId: row.projectId,
        kind: row.kind,
        date: row.date,
        amount: row.amount.toString(),
        releaseEventDate: row.releaseEventDate,
        status: row.status,
        daysEarly: row.daysEarly,
      })),
    );
  });

  app.get("/cost-overrun-vs-estimate", gate(VIEW), async (c) => {
    const report = await service.costOverrunsVsEstimate(paramsOf(c));
    return c.json(
      serializeReport(report, (row) => ({
        contractId: row.contractId,
        contractDocNo: row.contractDocNo,
        contractTitleAr: row.contractTitleAr,
        projectId: row.projectId,
        status: row.status,
        costToDate: row.costToDate.toString(),
        estimatedTotalCost: row.estimatedTotalCost.toString(),
        certifiedGrossWorks: row.certifiedGrossWorks.toString(),
        contractValue: row.contractValue.toString(),
        expectedCostToDate: row.expectedCostToDate.toString(),
        excessCost: row.excessCost.toString(),
        lastEstimateRevisionDate: row.lastEstimateRevisionDate,
        monthsSinceEstimateRevision: row.monthsSinceEstimateRevision,
        costOverrun: row.costOverrun,
        estimateStale: row.estimateStale,
      })),
    );
  });

  /**
   * الكمية النظرية لكل وحدة on the BOQ lines report 3 measures against. Gated by
   * `contracting.boq.manage` even though it touches no contracted quantity —
   * the person who prices the bill is the one who knows the consumption norm.
   */
  app.put("/theoretical-quantities/:contractId", gate(BOQ_MANAGE), async (c) => {
    const parsed = setTheoreticalQuantitiesSchema.safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) return c.json({ error: "VALIDATION_ERROR", details: parsed.error.flatten() }, 400);
    try {
      const lines = await service.setTheoreticalQuantities(
        c.req.param("contractId"),
        parsed.data.lines.map((l) => ({
          boqLineId: l.boqLineId,
          theoreticalQtyPerUnit: l.theoreticalQtyPerUnit ?? null,
          theoreticalItemId: l.theoreticalItemId ?? null,
        })),
      );
      return c.json({ lines: lines.map(serializeBoqLine) });
    } catch (err) {
      return handleDomainError(c, err);
    }
  });

  return app;
}

/** `GET/POST /contracting/retention/…` — the calendar and the release document. */
export function createContractingRetentionRoutes(
  deps: ContractingControlsRoutesDeps,
  resolveAuthContext: AuthContextResolver,
) {
  const app = new Hono();
  const gate = createPermissionGate(resolveAuthContext);
  const service = new ControlsService(deps);

  app.get("/calendar", gate(VIEW), async (c) => {
    return c.json(serializeCalendar(await service.calendar(c.req.query("asOfDate") ?? null)));
  });

  app.get("/headroom", gate(VIEW), async (c) => {
    const contractId = c.req.query("contractId");
    if (!contractId) return c.json({ error: "VALIDATION_ERROR", message: "العقد مطلوب." }, 400);
    const kind = (c.req.query("kind") ?? "provisional") as RetentionReleaseKind;
    try {
      const headroom = await service.releaseHeadroom(contractId, kind);
      return c.json({
        contractId,
        kind,
        held: headroom.position.held.toString(),
        released: headroom.position.released.toString(),
        balance: headroom.position.balance.toString(),
        cap: headroom.cap.toString(),
        releaseEventDate: (await service.calendar()).receivable.find((r) => r.contractId === contractId)?.event.date ?? null,
      });
    } catch (err) {
      return handleDomainError(c, err);
    }
  });

  app.get("/releases", gate(VIEW), async (c) => {
    const status = c.req.query("status");
    const views = await service.listReleases({
      ...(c.req.query("contractId") ? { contractId: c.req.query("contractId") as string } : {}),
      ...(c.req.query("projectId") ? { projectId: c.req.query("projectId") as string } : {}),
      ...(status ? { status: status as RetentionReleaseStatus } : {}),
    });
    return c.json(views.map(serializeRelease));
  });

  app.get("/releases/:id", gate(VIEW), async (c) => {
    try {
      return c.json(serializeRelease(await service.getRelease(c.req.param("id"))));
    } catch (err) {
      return handleDomainError(c, err);
    }
  });

  app.post("/releases", gate(RELEASE), async (c) => {
    const parsed = createRetentionReleaseSchema.safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) return c.json({ error: "VALIDATION_ERROR", details: parsed.error.flatten() }, 400);
    try {
      const view = await service.createRelease({
        id: parsed.data.id,
        contractId: parsed.data.contractId,
        kind: parsed.data.kind,
        date: parsed.data.date,
        amount: parsed.data.amount,
        notes: parsed.data.notes ?? null,
        createdBy: callerUserId(c) ?? null,
      });
      return c.json(serializeRelease(view), 201);
    } catch (err) {
      return handleDomainError(c, err);
    }
  });

  app.put("/releases/:id", gate(RELEASE), async (c) => {
    const parsed = updateRetentionReleaseSchema.safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) return c.json({ error: "VALIDATION_ERROR", details: parsed.error.flatten() }, 400);
    try {
      return c.json(serializeRelease(await service.updateRelease(c.req.param("id"), parsed.data)));
    } catch (err) {
      return handleDomainError(c, err);
    }
  });

  app.post("/releases/:id/release", gate(RELEASE), async (c) => {
    const parsed = releaseRetentionSchema.safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) return c.json({ error: "VALIDATION_ERROR", details: parsed.error.flatten() }, 400);
    try {
      const view = await service.release(
        c.req.param("id"),
        { userId: callerUserId(c) ?? "system", wildcardAdmin: getAuthContext(c)?.permissions.has("*") ?? false },
        { approvedBy: parsed.data.approvedBy ?? null },
      );
      return c.json(serializeRelease(view));
    } catch (err) {
      return handleDomainError(c, err);
    }
  });

  app.post("/releases/:id/cancel", gate(RELEASE), async (c) => {
    try {
      return c.json(serializeRelease(await service.cancelRelease(c.req.param("id"))));
    } catch (err) {
      return handleDomainError(c, err);
    }
  });

  /**
   * التسليم الابتدائي والنهائي. They are recorded when they HAPPEN — at the end
   * of the contract, often after it is closed — so this is not the contract's
   * frozen commercial-terms path, and it is gated by the retention right.
   */
  app.post("/contracts/:contractId/handover", gate(RELEASE), async (c) => {
    const parsed = recordHandoverSchema.safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) return c.json({ error: "VALIDATION_ERROR", details: parsed.error.flatten() }, 400);
    try {
      const contract = await service.recordHandover(c.req.param("contractId"), {
        ...(parsed.data.provisionalHandoverDate !== undefined
          ? { provisionalHandoverDate: parsed.data.provisionalHandoverDate ?? null }
          : {}),
        ...(parsed.data.finalHandoverDate !== undefined
          ? { finalHandoverDate: parsed.data.finalHandoverDate ?? null }
          : {}),
        ...(parsed.data.provisionalReleasePercent !== undefined
          ? { provisionalReleasePercent: parsed.data.provisionalReleasePercent }
          : {}),
      });
      return c.json({
        contractId: contract.id,
        contractDocNo: contract.docNo,
        provisionalHandoverDate: contract.provisionalHandoverDate,
        finalHandoverDate: contract.finalHandoverDate,
        provisionalReleasePercent: contract.provisionalReleasePercent,
        defectsLiabilityMonths: contract.defectsLiabilityMonths,
      });
    } catch (err) {
      return handleDomainError(c, err);
    }
  });

  return app;
}
