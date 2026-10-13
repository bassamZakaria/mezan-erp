import { postingRefusalResponse } from "./posting-refusal.js";
import { Hono, type Context } from "hono";
import {
  CertificateDateOrderError,
  CertificateQuantityError,
  CertificateSegregationError,
  CertificateService,
  InvalidProgressCertificateError,
  InvalidProgressCertificateTransitionError,
  LaterCertificateExistsError,
  NoFiscalPeriodForDateError,
  PeriodNotOpenForPostingError,
  ProgressCertificateNotFoundError,
  VatPeriodAlreadyFiledError,
  type CertificateComputation,
  type CertificateMaterialLine,
  type CertificateServiceDeps,
  type CertificateView,
  type CertificateWorkLine,
  type InternalCertificateReport,
  type ProgressCertificateStatus,
} from "@mezan/domain";
import {
  approveProgressCertificateSchema,
  cancelProgressCertificateSchema,
  certifyProgressCertificateSchema,
  createProgressCertificateSchema,
  measureProgressCertificateSchema,
  previewProgressCertificateSchema,
  updateProgressCertificateSchema,
  voidProgressCertificateSchema,
} from "@mezan/contracts";
import { createPermissionGate, getAuthContext, type AuthContextResolver } from "./permission-gate.js";

/**
 * المستخلص — the certificate, its two-stage approval, the generated invoice
 * and the internal certificate (design §04, D-02, D-09).
 *
 * Every derived figure on these responses is computed by the domain from
 * posted documents. The request bodies carry only this period's quantities and
 * the four manual cumulative deduction amounts; everything else is on the
 * design's "never accepted from the client" list (§06).
 */

const VIEW = "contracting.certificate.view";
const PREPARE = "contracting.certificate.prepare";
const CERTIFY = "contracting.certificate.certify";
const APPROVE = "contracting.certificate.approve";

export interface ContractingCertificatesRoutesDeps extends CertificateServiceDeps {}

function actorOf(c: Context) {
  const ctx = getAuthContext(c);
  return {
    userId: ctx?.userId ?? "anonymous",
    wildcardAdmin: ctx?.permissions.has("*") ?? false,
  };
}

function serializeWorkLine(line: CertificateWorkLine) {
  return {
    id: line.id,
    boqLineId: line.boqLineId,
    code: line.code,
    descriptionAr: line.descriptionAr,
    unit: line.unit,
    unitRate: line.unitRate.toString(),
    thisPeriodQty: line.thisPeriodQty.toString(),
    previousCumulativeQty: line.previousCumulativeQty.toString(),
    cumulativeQty: line.cumulativeQty.toString(),
    contractedQty: line.contractedQty.toString(),
    completionPercent: line.completionPercent,
    previousCumulativeValue: line.previousCumulativeValue.toString(),
    cumulativeValue: line.cumulativeValue.toString(),
    thisPeriodValue: line.thisPeriodValue.toString(),
    sortOrder: line.sortOrder,
  };
}

function serializeMaterialLine(line: CertificateMaterialLine) {
  return {
    id: line.id,
    materialKey: line.materialKey,
    descriptionAr: line.descriptionAr,
    unit: line.unit,
    qty: line.qty.toString(),
    unitRate: line.unitRate.toString(),
    previousCumulativeQty: line.previousCumulativeQty.toString(),
    cumulativeQty: line.cumulativeQty.toString(),
    value: line.value.toString(),
    previousValue: line.previousValue.toString(),
    sortOrder: line.sortOrder,
  };
}

function serializeComputation(computed: CertificateComputation) {
  return {
    grossWorks: computed.grossWorks.toString(),
    materialsOnSite: computed.materialsOnSite.toString(),
    certificateTotal: computed.certificateTotal.toString(),
    tenderDiscountPercent: computed.tenderDiscountPercent,
    tenderDiscount: computed.tenderDiscount.toString(),
    netCertified: computed.netCertified.toString(),
    previousNetCertified: computed.previousNetCertified.toString(),
    thisCertificateNetCertified: computed.thisCertificateNetCertified.toString(),
    deductions: computed.deductions.map((d) => ({
      key: d.key,
      labelAr: d.labelAr,
      percent: d.percent,
      cumulative: d.cumulative.toString(),
      previous: d.previous.toString(),
      thisCertificate: d.thisCertificate.toString(),
      posted: d.posted,
      capped: d.capped,
      noteAr: d.noteAr,
    })),
    deductionsThisCertificate: computed.deductionsThisCertificate.toString(),
    deductionsCumulative: computed.deductionsCumulative.toString(),
    suspendedBalance: computed.suspendedBalance.toString(),
    invoiceBase: computed.invoiceBase.toString(),
    vatBasis: computed.vatBasis,
    vatStatutoryRatePercent: computed.vatStatutoryRatePercent,
    vatEffectiveRatePercent: computed.vatEffectiveRatePercent,
    vat: computed.vat.toString(),
    previousPayments: computed.previousPayments.toString(),
    netPayableThisCertificate: computed.netPayableThisCertificate.toString(),
    cumulativeNetPayable: computed.cumulativeNetPayable.toString(),
    contractValueAfterVariations: computed.contractValueAfterVariations.toString(),
    completionPercent: computed.completionPercent,
    retentionHeldCumulative: computed.retentionHeldCumulative.toString(),
    advanceReceived: computed.advanceReceived.toString(),
    advanceOutstanding: computed.advanceOutstanding.toString(),
  };
}

function serialize(view: CertificateView) {
  const c = view.certificate;
  return {
    id: c.id,
    docNo: c.docNo,
    contractId: c.contractId,
    contractDocNo: view.contractDocNo,
    contractTitleAr: view.contractTitleAr,
    customerId: view.customerId,
    projectId: c.projectId,
    serial: c.serial,
    previousCertificateId: c.previousCertificateId,
    periodFrom: c.periodFrom,
    periodTo: c.periodTo,
    executionDate: c.executionDate,
    isFinal: c.isFinal,
    status: c.status,
    derivedStatus: view.derivedStatus,
    preparedBy: c.preparedBy,
    preparedAt: c.preparedAt,
    measuredBy: c.measuredBy,
    measuredAt: c.measuredAt,
    certifiedBy: c.certifiedBy,
    certifiedAt: c.certifiedAt,
    approvedBy: c.approvedBy,
    approvedAt: c.approvedAt,
    cancelledAt: c.cancelledAt,
    cancelledBy: c.cancelledBy,
    cancelReasonAr: c.cancelReasonAr,
    voidedAt: c.voidedAt,
    voidedBy: c.voidedBy,
    voidReasonAr: c.voidReasonAr,
    voidJournalEntryId: c.voidJournalEntryId,
    invoiceId: c.invoiceId,
    invoiceDocNo: c.invoiceDocNo,
    journalEntryId: c.journalEntryId,
    postedDeductionsTotal: c.postedDeductionsTotal.toString(),
    dueDate: c.dueDate,
    penaltiesCumulative: c.penaltiesCumulative.toString(),
    suspendedCumulative: c.suspendedCumulative.toString(),
    employerMaterialsCumulative: c.employerMaterialsCumulative.toString(),
    waterElectricityCumulative: c.waterElectricityCumulative.toString(),
    notes: c.notes,
    workLines: c.workLines.map(serializeWorkLine),
    materialLines: c.materialLines.map(serializeMaterialLine),
    computed: serializeComputation(c.computed),
    invoice: view.invoice
      ? {
          invoiceId: view.invoice.invoiceId,
          docNo: view.invoice.docNo,
          total: view.invoice.total.toString(),
          amountPaid: view.invoice.amountPaid.toString(),
          remainingBalance: view.invoice.remainingBalance.toString(),
          dueDate: view.invoice.dueDate,
          status: view.invoice.status,
        }
      : null,
    daysOverdue: view.daysOverdue,
    latePaymentCompensation: view.latePaymentCompensation.toString(),
    cbeCreditDiscountRatePercent: view.cbeCreditDiscountRatePercent,
    hasLaterCertificate: view.hasLaterCertificate,
  };
}

function serializeInternal(report: InternalCertificateReport) {
  return {
    contractId: report.contractId,
    contractDocNo: report.contractDocNo,
    projectId: report.projectId,
    asOfCertificateId: report.asOfCertificateId,
    asOfDocNo: report.asOfDocNo,
    asOfSerial: report.asOfSerial,
    rows: report.rows.map((r) => ({
      boqLineId: r.boqLineId,
      code: r.code,
      descriptionAr: r.descriptionAr,
      unit: r.unit,
      cumulativeQty: r.cumulativeQty.toString(),
      estimatedUnitCost: r.estimatedUnitCost?.toString() ?? null,
      estimatedCost: r.estimatedCost.toString(),
      sellingValue: r.sellingValue.toString(),
      lineMargin: r.lineMargin.toString(),
      lineMarginPercent: r.lineMarginPercent,
    })),
    totals: {
      estimatedCost: report.totals.estimatedCost.toString(),
      sellingValue: report.totals.sellingValue.toString(),
      margin: report.totals.margin.toString(),
      marginPercent: report.totals.marginPercent,
    },
    projectActual: report.projectActual
      ? {
          cost: report.projectActual.cost.toString(),
          revenue: report.projectActual.revenue.toString(),
          byCategory: Object.fromEntries(
            Object.entries(report.projectActual.byCategory).map(([k, v]) => [k, v.toString()]),
          ),
        }
      : null,
    actualCostNoteAr: report.actualCostNoteAr,
  };
}

function handleDomainError(c: Context, err: unknown) {
  const postingRefusal = postingRefusalResponse(c, err);
  if (postingRefusal) return postingRefusal;
  if (err instanceof ProgressCertificateNotFoundError) {
    return c.json({ error: err.code, message: err.message }, 404);
  }
  if (err instanceof InvalidProgressCertificateError) {
    return c.json({ error: err.code, message: err.message, reasons: err.reasons }, 422);
  }
  if (err instanceof CertificateQuantityError) {
    return c.json({ error: err.code, message: err.message, reasons: err.reasons }, 422);
  }
  if (err instanceof CertificateDateOrderError) {
    return c.json({ error: err.code, message: err.message, reasons: err.reasons }, 422);
  }
  /**
   * The GL engine's own refusals. They are a CLOSED period or a FILED VAT
   * return telling the user to pick another date — a 409, never the 500 an
   * unhandled throw turned them into.
   */
  if (
    err instanceof PeriodNotOpenForPostingError ||
    err instanceof NoFiscalPeriodForDateError ||
    err instanceof VatPeriodAlreadyFiledError
  ) {
    return c.json({ error: (err as { code?: string }).code ?? "PERIOD_REFUSED", message: err.message }, 409);
  }
  if (err instanceof CertificateSegregationError) {
    return c.json({ error: err.code, message: err.message }, 409);
  }
  if (err instanceof LaterCertificateExistsError) {
    return c.json({ error: err.code, message: err.message, laterDocNo: err.laterDocNo }, 409);
  }
  if (err instanceof InvalidProgressCertificateTransitionError) {
    return c.json({ error: err.code, message: err.message, from: err.from, to: err.to }, 409);
  }
  throw err;
}

export function createContractingCertificatesRoutes(
  deps: ContractingCertificatesRoutesDeps,
  resolveAuthContext: AuthContextResolver,
) {
  const app = new Hono();
  const gate = createPermissionGate(resolveAuthContext);
  const service = new CertificateService(deps);

  /**
   * The live block the «مستخلص جديد» screen shows while the surveyor types.
   * Persists nothing — and it answers with the same refusals the حصر step
   * would raise, so an over-certified line is visible before the last click.
   */
  app.post("/preview", gate(VIEW), async (c) => {
    const parsed = previewProgressCertificateSchema.safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) return c.json({ error: "VALIDATION_ERROR", details: parsed.error.flatten() }, 400);
    try {
      const body = parsed.data;
      const result = await service.preview({
        contractId: body.contractId,
        certificateId: body.certificateId ?? null,
        periodFrom: body.periodFrom,
        periodTo: body.periodTo,
        executionDate: body.executionDate ?? null,
        isFinal: body.isFinal ?? false,
        workLines: body.workLines ?? [],
        materialLines: body.materialLines ?? [],
        penaltiesCumulative: body.penaltiesCumulative ?? "0",
        suspendedCumulative: body.suspendedCumulative ?? "0",
        employerMaterialsCumulative: body.employerMaterialsCumulative ?? "0",
        waterElectricityCumulative: body.waterElectricityCumulative ?? "0",
        notes: body.notes ?? null,
      });
      return c.json({
        serial: result.serial,
        executionDate: result.executionDate,
        workLines: result.workLines.map(serializeWorkLine),
        materialLines: result.materialLines.map(serializeMaterialLine),
        computed: serializeComputation(result.computed),
        refusals: result.refusals,
      });
    } catch (err) {
      return handleDomainError(c, err);
    }
  });

  /** مستخلص تنفيذي — internal only, never presented for payment (05-egypt.md). */
  app.get("/internal", gate(VIEW), async (c) => {
    const contractId = c.req.query("contractId");
    if (!contractId) {
      return c.json({ error: "VALIDATION_ERROR", message: "معرّف العقد مطلوب." }, 400);
    }
    try {
      return c.json(serializeInternal(await service.internalCertificate(contractId)));
    } catch (err) {
      return handleDomainError(c, err);
    }
  });

  app.get("/", gate(VIEW), async (c) => {
    const contractId = c.req.query("contractId");
    const projectId = c.req.query("projectId");
    const status = c.req.query("status");
    const views = await service.list({
      ...(contractId ? { contractId } : {}),
      ...(projectId ? { projectId } : {}),
      ...(status ? { status: status as ProgressCertificateStatus } : {}),
    });
    return c.json(views.map(serialize));
  });

  app.post("/", gate(PREPARE), async (c) => {
    const parsed = createProgressCertificateSchema.safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) return c.json({ error: "VALIDATION_ERROR", details: parsed.error.flatten() }, 400);
    try {
      const body = parsed.data;
      const view = await service.create(
        {
          id: body.id,
          contractId: body.contractId,
          periodFrom: body.periodFrom,
          periodTo: body.periodTo,
          executionDate: body.executionDate ?? null,
          isFinal: body.isFinal ?? false,
          workLines: body.workLines ?? [],
          materialLines: body.materialLines ?? [],
          penaltiesCumulative: body.penaltiesCumulative ?? "0",
          suspendedCumulative: body.suspendedCumulative ?? "0",
          employerMaterialsCumulative: body.employerMaterialsCumulative ?? "0",
          waterElectricityCumulative: body.waterElectricityCumulative ?? "0",
          notes: body.notes ?? null,
        },
        actorOf(c),
      );
      return c.json(serialize(view), 201);
    } catch (err) {
      return handleDomainError(c, err);
    }
  });

  app.get("/:id", gate(VIEW), async (c) => {
    try {
      return c.json(serialize(await service.get(c.req.param("id"))));
    } catch (err) {
      return handleDomainError(c, err);
    }
  });

  app.patch("/:id", gate(PREPARE), async (c) => {
    const parsed = updateProgressCertificateSchema.safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) return c.json({ error: "VALIDATION_ERROR", details: parsed.error.flatten() }, 400);
    try {
      const body = parsed.data;
      const view = await service.update(
        c.req.param("id"),
        {
          ...(body.periodFrom !== undefined ? { periodFrom: body.periodFrom } : {}),
          ...(body.periodTo !== undefined ? { periodTo: body.periodTo } : {}),
          ...(body.executionDate !== undefined ? { executionDate: body.executionDate } : {}),
          ...(body.isFinal !== undefined ? { isFinal: body.isFinal } : {}),
          ...(body.workLines !== undefined ? { workLines: body.workLines } : {}),
          ...(body.materialLines !== undefined ? { materialLines: body.materialLines } : {}),
          ...(body.penaltiesCumulative !== undefined ? { penaltiesCumulative: body.penaltiesCumulative } : {}),
          ...(body.suspendedCumulative !== undefined ? { suspendedCumulative: body.suspendedCumulative } : {}),
          ...(body.employerMaterialsCumulative !== undefined
            ? { employerMaterialsCumulative: body.employerMaterialsCumulative }
            : {}),
          ...(body.waterElectricityCumulative !== undefined
            ? { waterElectricityCumulative: body.waterElectricityCumulative }
            : {}),
          ...(body.notes !== undefined ? { notes: body.notes } : {}),
        },
        actorOf(c),
      );
      return c.json(serialize(view));
    } catch (err) {
      return handleDomainError(c, err);
    }
  });

  app.post("/:id/measure", gate(PREPARE), async (c) => {
    const parsed = measureProgressCertificateSchema.safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) return c.json({ error: "VALIDATION_ERROR", details: parsed.error.flatten() }, 400);
    try {
      return c.json(serialize(await service.measure(c.req.param("id"), actorOf(c), parsed.data.measuredAt ?? null)));
    } catch (err) {
      return handleDomainError(c, err);
    }
  });

  app.post("/:id/certify", gate(CERTIFY), async (c) => {
    const parsed = certifyProgressCertificateSchema.safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) return c.json({ error: "VALIDATION_ERROR", details: parsed.error.flatten() }, 400);
    try {
      return c.json(serialize(await service.certify(c.req.param("id"), actorOf(c), parsed.data.certifiedAt ?? null)));
    } catch (err) {
      return handleDomainError(c, err);
    }
  });

  app.post("/:id/approve", gate(APPROVE), async (c) => {
    const parsed = approveProgressCertificateSchema.safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) return c.json({ error: "VALIDATION_ERROR", details: parsed.error.flatten() }, 400);
    try {
      return c.json(serialize(await service.approve(c.req.param("id"), parsed.data.approvedAt, actorOf(c))));
    } catch (err) {
      return handleDomainError(c, err);
    }
  });

  app.post("/:id/cancel", gate(PREPARE), async (c) => {
    const parsed = cancelProgressCertificateSchema.safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) return c.json({ error: "VALIDATION_ERROR", details: parsed.error.flatten() }, 400);
    try {
      return c.json(serialize(await service.cancel(c.req.param("id"), parsed.data.reasonAr, actorOf(c))));
    } catch (err) {
      return handleDomainError(c, err);
    }
  });

  /**
   * إلغاء مستخلص معتمد — the reversal path. Gated by the SAME permission that
   * approved it: whoever can start the payment clock is the one who can stop
   * it, and nobody else.
   */
  app.post("/:id/void", gate(APPROVE), async (c) => {
    const parsed = voidProgressCertificateSchema.safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) return c.json({ error: "VALIDATION_ERROR", details: parsed.error.flatten() }, 400);
    try {
      return c.json(
        serialize(
          await service.void(c.req.param("id"), { date: parsed.data.date, reasonAr: parsed.data.reasonAr }, actorOf(c)),
        ),
      );
    } catch (err) {
      return handleDomainError(c, err);
    }
  });

  return app;
}
