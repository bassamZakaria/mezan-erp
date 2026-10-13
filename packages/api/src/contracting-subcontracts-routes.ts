import { postingRefusalResponse } from "./posting-refusal.js";
import { Hono, type Context } from "hono";
import {
  InvalidSubCertificateError,
  InvalidSubCertificateTransitionError,
  InvalidSubcontractError,
  InvalidSubcontractTransitionError,
  LaterSubCertificateExistsError,
  NoFiscalPeriodForDateError,
  PeriodNotOpenForPostingError,
  SubCertificateDeductionError,
  SubCertificateNotFoundError,
  SubCertificateQuantityError,
  SubCertificateSegregationError,
  SubCertificateService,
  SubcontractNotFoundError,
  SubcontractRetentionError,
  SubcontractService,
  SubcontractorNotPayableError,
  type CertificateComputation,
  type SubCertificatePreview,
  type SubCertificateServiceDeps,
  type SubCertificateStatus,
  type SubCertificateView,
  type SubCertificateWorkLine,
  type SubcontractLine,
  type SubcontractRetentionRelease,
  type SubcontractServiceDeps,
  type SubcontractStatus,
  type SubcontractView,
} from "@mezan/domain";
import {
  activateSubcontractSchema,
  approveSubCertificateSchema,
  cancelSubCertificateSchema,
  certifySubCertificateSchema,
  completeSubcontractSchema,
  createSubCertificateSchema,
  createSubcontractSchema,
  linkSubcontractAdvanceSchema,
  measureSubCertificateSchema,
  previewSubCertificateSchema,
  releaseSubcontractRetentionSchema,
  replaceSubcontractLinesSchema,
  terminateSubcontractSchema,
  updateSubCertificateSchema,
  updateSubcontractSchema,
} from "@mezan/contracts";
import { createPermissionGate, getAuthContext, type AuthContextResolver } from "./permission-gate.js";
import { duplicateIdRefusal } from "./duplicate-id.js";
import { DuplicateRecordIdError } from "@mezan/domain";

/**
 * عقود الباطن ومستخلصاتها — the mirror of the client contract and its
 * certificate (design §03 "THE MIRROR", D-04, D-05).
 *
 * The permission codes are the certificate's own: preparing, certifying and
 * approving a subcontractor's certificate is the same separation of duties as
 * on the client side, and minting a second set would let a grant that refuses
 * one accept the other.
 */

const VIEW = "contracting.certificate.view";
const PREPARE = "contracting.certificate.prepare";
const CERTIFY = "contracting.certificate.certify";
const APPROVE = "contracting.certificate.approve";
const BOQ_MANAGE = "contracting.boq.manage";
const RELEASE = "contracting.retention.release";

export interface ContractingSubcontractsRoutesDeps {
  readonly subcontracts: SubcontractServiceDeps;
  readonly certificates: SubCertificateServiceDeps;
}

function actorOf(c: Context) {
  const ctx = getAuthContext(c);
  return {
    userId: ctx?.userId ?? "anonymous",
    wildcardAdmin: ctx?.permissions.has("*") ?? false,
  };
}

function serializeLine(line: SubcontractLine) {
  return {
    id: line.id,
    subcontractId: line.subcontractId,
    clientBoqLineId: line.clientBoqLineId,
    code: line.code,
    descriptionAr: line.descriptionAr,
    unit: line.unit,
    qty: line.qty.toString(),
    unitRate: line.unitRate.toString(),
    clientUnitRate: line.clientUnitRate.toString(),
    marginVsClient: line.marginVsClient.toString(),
    estimatedUnitCost: line.estimatedUnitCost?.toString() ?? null,
    sortOrder: line.sortOrder,
  };
}

function serializeSubcontract(view: SubcontractView) {
  const s = view.subcontract;
  return {
    id: s.id,
    docNo: s.docNo,
    contractId: s.contractId,
    contractDocNo: view.contractDocNo,
    contractTitleAr: view.contractTitleAr,
    projectId: s.projectId,
    supplierId: s.supplierId,
    supplierNameAr: view.supplierNameAr,
    titleAr: s.titleAr,
    kind: s.kind,
    disguisedEmploymentReviewed: s.disguisedEmploymentReviewed,
    reviewNote: s.reviewNote,
    signedDate: s.signedDate,
    startDate: s.startDate,
    plannedEndDate: s.plannedEndDate,
    currency: s.currency,
    status: s.status,
    activatedAt: s.activatedAt,
    completedAt: s.completedAt,
    terminatedAt: s.terminatedAt,
    notes: s.notes,
    retentionPercent: s.retentionPercent,
    retentionCapPercent: s.retentionCapPercent,
    advancePercent: s.advancePercent,
    advanceRecoveryPercent: s.advanceRecoveryPercent,
    withholdingTaxPercent: s.withholdingTaxPercent,
    deemedWagePercent: s.deemedWagePercent,
    socialInsuranceRatePercent: s.socialInsuranceRatePercent,
    withholdSocialInsurance: s.withholdSocialInsurance,
    socialInsuranceNote: s.socialInsuranceNote,
    penaltyCapPercent: s.penaltyCapPercent,
    paymentTermDays: s.paymentTermDays,
    defectsLiabilityMonths: s.defectsLiabilityMonths,
    vatBasis: s.vatBasis,
    lines: s.lines.map(serializeLine),
    advances: s.advances.map((a) => ({
      voucherId: a.voucherId,
      voucherNo: a.voucherNo,
      date: a.date,
      amount: a.amount.toString(),
    })),
    value: view.value.toString(),
    clientValue: view.clientValue.toString(),
    margin: view.margin.toString(),
    advancePaid: view.advancePaid.toString(),
    advanceRecovered: view.advanceRecovered.toString(),
    advanceOutstanding: view.advanceOutstanding.toString(),
    retention: {
      held: view.retention.held.toString(),
      released: view.retention.released.toString(),
      balance: view.retention.balance.toString(),
      completionDate: view.retention.completionDate,
      defectsLiabilityMonths: view.retention.defectsLiabilityMonths,
      provisionalReleaseEventDate: view.retention.provisionalReleaseEventDate,
      finalReleaseEventDate: view.retention.finalReleaseEventDate,
      releases: view.retention.releases.map(serializeRelease),
    },
    certifiedToDate: view.certifiedToDate.toString(),
    remainingCommitment: view.remainingCommitment.toString(),
    certificateCount: view.certificateCount,
    payabilityRefusals: view.payabilityRefusals,
  };
}

function serializeRelease(r: SubcontractRetentionRelease) {
  return {
    id: r.id,
    date: r.date,
    amount: r.amount.toString(),
    journalEntryId: r.journalEntryId,
    kind: r.kind,
    releaseEventDate: r.releaseEventDate,
    earlyRelease: r.earlyRelease,
    invoiceId: r.invoiceId,
    invoiceDocNo: r.invoiceDocNo,
    releasedBy: r.releasedBy,
    notes: r.notes,
  };
}

function serializeWorkLine(line: SubCertificateWorkLine) {
  return {
    id: line.id,
    subcontractLineId: line.boqLineId,
    clientBoqLineId: line.clientBoqLineId,
    clientCertifiedCumulativeQty: line.clientCertifiedCumulativeQty.toString(),
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

function serializeCertificate(view: SubCertificateView) {
  const c = view.certificate;
  return {
    id: c.id,
    docNo: c.docNo,
    subcontractId: c.subcontractId,
    subcontractDocNo: view.subcontractDocNo,
    subcontractTitleAr: view.subcontractTitleAr,
    contractId: c.contractId,
    contractDocNo: view.contractDocNo,
    projectId: c.projectId,
    supplierId: c.supplierId,
    supplierNameAr: view.supplierNameAr,
    supplierTaxNumber: view.supplierTaxNumber,
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
    cancelledBy: c.cancelledBy,
    cancelledAt: c.cancelledAt,
    cancelReasonAr: c.cancelReasonAr,
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
    hasLaterCertificate: view.hasLaterCertificate,
    payabilityRefusals: view.payabilityRefusals,
  };
}

function serializePreview(preview: SubCertificatePreview) {
  return {
    serial: preview.serial,
    executionDate: preview.executionDate,
    workLines: preview.workLines.map(serializeWorkLine),
    computed: serializeComputation(preview.computed),
    refusals: preview.refusals,
    employerMaterialsPrefill: preview.employerMaterialsPrefill.toString(),
  };
}

function handleDomainError(c: Context, err: unknown) {
  if (err instanceof DuplicateRecordIdError) return duplicateIdRefusal(c, err);
  const postingRefusal = postingRefusalResponse(c, err);
  if (postingRefusal) return postingRefusal;
  if (err instanceof SubcontractNotFoundError || err instanceof SubCertificateNotFoundError) {
    return c.json({ error: err.code, message: err.message }, 404);
  }
  if (err instanceof InvalidSubcontractError || err instanceof InvalidSubCertificateError) {
    return c.json({ error: err.code, message: err.message, reasons: err.reasons }, 422);
  }
  if (err instanceof SubCertificateQuantityError || err instanceof SubCertificateDeductionError) {
    return c.json({ error: err.code, message: err.message, reasons: err.reasons }, 422);
  }
  // A closed period or a filed VAT return is a state conflict, not a server
  // fault: the caller has to reopen the period or change the date.
  if (
    err instanceof PeriodNotOpenForPostingError ||
    err instanceof NoFiscalPeriodForDateError
  ) {
    return c.json({ error: err.code, message: err.message }, 409);
  }
  if (err instanceof SubcontractorNotPayableError) {
    return c.json({ error: err.code, message: err.message, reasons: err.reasons }, 422);
  }
  if (err instanceof SubcontractRetentionError) {
    return c.json({ error: err.code, message: err.message }, 422);
  }
  if (err instanceof SubCertificateSegregationError) {
    return c.json({ error: err.code, message: err.message }, 409);
  }
  if (err instanceof LaterSubCertificateExistsError) {
    return c.json({ error: err.code, message: err.message, laterDocNo: err.laterDocNo }, 409);
  }
  if (err instanceof InvalidSubcontractTransitionError || err instanceof InvalidSubCertificateTransitionError) {
    return c.json({ error: err.code, message: err.message, from: err.from, to: err.to }, 409);
  }
  throw err;
}

export function createContractingSubcontractsRoutes(
  deps: ContractingSubcontractsRoutesDeps,
  resolveAuthContext: AuthContextResolver,
) {
  const app = new Hono();
  const gate = createPermissionGate(resolveAuthContext);
  const service = new SubcontractService(deps.subcontracts);

  app.get("/", gate(VIEW), async (c) => {
    const contractId = c.req.query("contractId");
    const projectId = c.req.query("projectId");
    const supplierId = c.req.query("supplierId");
    const status = c.req.query("status");
    const views = await service.list({
      ...(contractId ? { contractId } : {}),
      ...(projectId ? { projectId } : {}),
      ...(supplierId ? { supplierId } : {}),
      ...(status ? { status: status as SubcontractStatus } : {}),
    });
    return c.json(views.map(serializeSubcontract));
  });

  app.post("/", gate(BOQ_MANAGE), async (c) => {
    const parsed = createSubcontractSchema.safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) return c.json({ error: "VALIDATION_ERROR", details: parsed.error.flatten() }, 400);
    try {
      const body = parsed.data;
      const view = await service.create(
        {
          id: body.id,
          contractId: body.contractId,
          supplierId: body.supplierId,
          titleAr: body.titleAr,
          ...(body.kind !== undefined ? { kind: body.kind } : {}),
          ...(body.disguisedEmploymentReviewed !== undefined
            ? { disguisedEmploymentReviewed: body.disguisedEmploymentReviewed }
            : {}),
          reviewNote: body.reviewNote ?? null,
          signedDate: body.signedDate,
          startDate: body.startDate,
          plannedEndDate: body.plannedEndDate,
          notes: body.notes ?? null,
          lines: (body.lines ?? []).map((l) => ({
            id: l.id ?? null,
            clientBoqLineId: l.clientBoqLineId,
            descriptionAr: l.descriptionAr ?? null,
            qty: l.qty,
            unitRate: l.unitRate,
            estimatedUnitCost: l.estimatedUnitCost ?? null,
          })),
          ...termsOf(body),
        },
        actorOf(c),
      );
      return c.json(serializeSubcontract(view), 201);
    } catch (err) {
      return handleDomainError(c, err);
    }
  });

  app.get("/:id", gate(VIEW), async (c) => {
    try {
      return c.json(serializeSubcontract(await service.get(c.req.param("id"))));
    } catch (err) {
      return handleDomainError(c, err);
    }
  });

  app.patch("/:id", gate(BOQ_MANAGE), async (c) => {
    const parsed = updateSubcontractSchema.safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) return c.json({ error: "VALIDATION_ERROR", details: parsed.error.flatten() }, 400);
    try {
      const body = parsed.data;
      const view = await service.update(c.req.param("id"), {
        ...(body.supplierId !== undefined ? { supplierId: body.supplierId } : {}),
        ...(body.titleAr !== undefined ? { titleAr: body.titleAr } : {}),
        ...(body.kind !== undefined ? { kind: body.kind } : {}),
        ...(body.disguisedEmploymentReviewed !== undefined
          ? { disguisedEmploymentReviewed: body.disguisedEmploymentReviewed }
          : {}),
        ...(body.reviewNote !== undefined ? { reviewNote: body.reviewNote ?? null } : {}),
        ...(body.signedDate !== undefined ? { signedDate: body.signedDate } : {}),
        ...(body.startDate !== undefined ? { startDate: body.startDate } : {}),
        ...(body.plannedEndDate !== undefined ? { plannedEndDate: body.plannedEndDate } : {}),
        ...(body.notes !== undefined ? { notes: body.notes ?? null } : {}),
        ...termsOf(body),
      });
      return c.json(serializeSubcontract(view));
    } catch (err) {
      return handleDomainError(c, err);
    }
  });

  app.put("/:id/lines", gate(BOQ_MANAGE), async (c) => {
    const parsed = replaceSubcontractLinesSchema.safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) return c.json({ error: "VALIDATION_ERROR", details: parsed.error.flatten() }, 400);
    try {
      const view = await service.replaceLines(
        c.req.param("id"),
        parsed.data.lines.map((l) => ({
          id: l.id ?? null,
          clientBoqLineId: l.clientBoqLineId,
          descriptionAr: l.descriptionAr ?? null,
          qty: l.qty,
          unitRate: l.unitRate,
          estimatedUnitCost: l.estimatedUnitCost ?? null,
        })),
      );
      return c.json(serializeSubcontract(view));
    } catch (err) {
      return handleDomainError(c, err);
    }
  });

  app.post("/:id/activate", gate(BOQ_MANAGE), async (c) => {
    const parsed = activateSubcontractSchema.safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) return c.json({ error: "VALIDATION_ERROR", details: parsed.error.flatten() }, 400);
    try {
      return c.json(serializeSubcontract(await service.activate(c.req.param("id"), parsed.data.activatedAt)));
    } catch (err) {
      return handleDomainError(c, err);
    }
  });

  app.post("/:id/complete", gate(BOQ_MANAGE), async (c) => {
    const parsed = completeSubcontractSchema.safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) return c.json({ error: "VALIDATION_ERROR", details: parsed.error.flatten() }, 400);
    try {
      return c.json(serializeSubcontract(await service.complete(c.req.param("id"), parsed.data.completedAt)));
    } catch (err) {
      return handleDomainError(c, err);
    }
  });

  app.post("/:id/terminate", gate(BOQ_MANAGE), async (c) => {
    const parsed = terminateSubcontractSchema.safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) return c.json({ error: "VALIDATION_ERROR", details: parsed.error.flatten() }, 400);
    try {
      const view = await service.terminate(
        c.req.param("id"),
        parsed.data.terminatedAt,
        parsed.data.reason ?? null,
      );
      return c.json(serializeSubcontract(view));
    } catch (err) {
      return handleDomainError(c, err);
    }
  });

  /** Links an already-confirmed payment voucher; the server reads its amount and its account. */
  app.post("/:id/advance", gate(BOQ_MANAGE), async (c) => {
    const parsed = linkSubcontractAdvanceSchema.safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) return c.json({ error: "VALIDATION_ERROR", details: parsed.error.flatten() }, 400);
    try {
      return c.json(serializeSubcontract(await service.linkAdvance(c.req.param("id"), parsed.data.voucherId)));
    } catch (err) {
      return handleDomainError(c, err);
    }
  });

  app.get("/:id/retention", gate(VIEW), async (c) => {
    try {
      const position = await service.retentionPosition(c.req.param("id"));
      return c.json({
        held: position.held.toString(),
        released: position.released.toString(),
        balance: position.balance.toString(),
        completionDate: position.completionDate,
        defectsLiabilityMonths: position.defectsLiabilityMonths,
        provisionalReleaseEventDate: position.provisionalReleaseEventDate,
        finalReleaseEventDate: position.finalReleaseEventDate,
        releases: position.releases.map(serializeRelease),
      });
    } catch (err) {
      return handleDomainError(c, err);
    }
  });

  app.post("/:id/release-retention", gate(RELEASE), async (c) => {
    const parsed = releaseSubcontractRetentionSchema.safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) return c.json({ error: "VALIDATION_ERROR", details: parsed.error.flatten() }, 400);
    try {
      const view = await service.releaseRetention(
        c.req.param("id"),
        {
          amount: parsed.data.amount,
          date: parsed.data.date,
          ...(parsed.data.kind !== undefined ? { kind: parsed.data.kind } : {}),
          notes: parsed.data.notes ?? null,
        },
        actorOf(c),
      );
      return c.json(serializeSubcontract(view));
    } catch (err) {
      return handleDomainError(c, err);
    }
  });

  return app;
}

export function createSubcontractCertificatesRoutes(
  deps: ContractingSubcontractsRoutesDeps,
  resolveAuthContext: AuthContextResolver,
) {
  const app = new Hono();
  const gate = createPermissionGate(resolveAuthContext);
  const service = new SubCertificateService(deps.certificates);

  app.post("/preview", gate(VIEW), async (c) => {
    const parsed = previewSubCertificateSchema.safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) return c.json({ error: "VALIDATION_ERROR", details: parsed.error.flatten() }, 400);
    try {
      const body = parsed.data;
      const result = await service.preview({
        subcontractId: body.subcontractId,
        certificateId: body.certificateId ?? null,
        periodFrom: body.periodFrom,
        periodTo: body.periodTo,
        executionDate: body.executionDate ?? null,
        isFinal: body.isFinal ?? false,
        workLines: body.workLines ?? [],
        penaltiesCumulative: body.penaltiesCumulative ?? "0",
        suspendedCumulative: body.suspendedCumulative ?? "0",
        employerMaterialsCumulative: body.employerMaterialsCumulative ?? "0",
        waterElectricityCumulative: body.waterElectricityCumulative ?? "0",
        notes: body.notes ?? null,
      });
      return c.json(serializePreview(result));
    } catch (err) {
      return handleDomainError(c, err);
    }
  });

  app.get("/", gate(VIEW), async (c) => {
    const subcontractId = c.req.query("subcontractId");
    const contractId = c.req.query("contractId");
    const projectId = c.req.query("projectId");
    const supplierId = c.req.query("supplierId");
    const status = c.req.query("status");
    const views = await service.list({
      ...(subcontractId ? { subcontractId } : {}),
      ...(contractId ? { contractId } : {}),
      ...(projectId ? { projectId } : {}),
      ...(supplierId ? { supplierId } : {}),
      ...(status ? { status: status as SubCertificateStatus } : {}),
    });
    return c.json(views.map(serializeCertificate));
  });

  app.post("/", gate(PREPARE), async (c) => {
    const parsed = createSubCertificateSchema.safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) return c.json({ error: "VALIDATION_ERROR", details: parsed.error.flatten() }, 400);
    try {
      const body = parsed.data;
      const view = await service.create(
        {
          id: body.id,
          subcontractId: body.subcontractId,
          periodFrom: body.periodFrom,
          periodTo: body.periodTo,
          executionDate: body.executionDate ?? null,
          isFinal: body.isFinal ?? false,
          workLines: body.workLines ?? [],
          penaltiesCumulative: body.penaltiesCumulative ?? "0",
          suspendedCumulative: body.suspendedCumulative ?? "0",
          employerMaterialsCumulative: body.employerMaterialsCumulative ?? "0",
          waterElectricityCumulative: body.waterElectricityCumulative ?? "0",
          notes: body.notes ?? null,
        },
        actorOf(c),
      );
      return c.json(serializeCertificate(view), 201);
    } catch (err) {
      return handleDomainError(c, err);
    }
  });

  app.get("/:id", gate(VIEW), async (c) => {
    try {
      return c.json(serializeCertificate(await service.get(c.req.param("id"))));
    } catch (err) {
      return handleDomainError(c, err);
    }
  });

  app.patch("/:id", gate(PREPARE), async (c) => {
    const parsed = updateSubCertificateSchema.safeParse(await c.req.json().catch(() => ({})));
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
      return c.json(serializeCertificate(view));
    } catch (err) {
      return handleDomainError(c, err);
    }
  });

  app.post("/:id/measure", gate(PREPARE), async (c) => {
    const parsed = measureSubCertificateSchema.safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) return c.json({ error: "VALIDATION_ERROR", details: parsed.error.flatten() }, 400);
    try {
      const view = await service.measure(c.req.param("id"), actorOf(c), parsed.data.measuredAt ?? null);
      return c.json(serializeCertificate(view));
    } catch (err) {
      return handleDomainError(c, err);
    }
  });

  app.post("/:id/certify", gate(CERTIFY), async (c) => {
    const parsed = certifySubCertificateSchema.safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) return c.json({ error: "VALIDATION_ERROR", details: parsed.error.flatten() }, 400);
    try {
      const view = await service.certify(c.req.param("id"), actorOf(c), parsed.data.certifiedAt ?? null);
      return c.json(serializeCertificate(view));
    } catch (err) {
      return handleDomainError(c, err);
    }
  });

  app.post("/:id/approve", gate(APPROVE), async (c) => {
    const parsed = approveSubCertificateSchema.safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) return c.json({ error: "VALIDATION_ERROR", details: parsed.error.flatten() }, 400);
    try {
      return c.json(
        serializeCertificate(await service.approve(c.req.param("id"), parsed.data.approvedAt, actorOf(c))),
      );
    } catch (err) {
      return handleDomainError(c, err);
    }
  });

  app.post("/:id/cancel", gate(PREPARE), async (c) => {
    const parsed = cancelSubCertificateSchema.safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) return c.json({ error: "VALIDATION_ERROR", details: parsed.error.flatten() }, 400);
    try {
      const view = await service.cancel(c.req.param("id"), parsed.data.reasonAr, actorOf(c));
      return c.json(serializeCertificate(view));
    } catch (err) {
      return handleDomainError(c, err);
    }
  });

  return app;
}

function termsOf(body: {
  retentionPercent?: string;
  retentionCapPercent?: string | null;
  advancePercent?: string;
  advanceRecoveryPercent?: string;
  withholdingTaxPercent?: string;
  deemedWagePercent?: string;
  socialInsuranceRatePercent?: string;
  withholdSocialInsurance?: boolean;
  socialInsuranceNote?: string | null;
  penaltyCapPercent?: string;
  paymentTermDays?: number;
  defectsLiabilityMonths?: number;
  vatBasis?: "standard" | "transitional";
}) {
  return {
    ...(body.retentionPercent !== undefined ? { retentionPercent: body.retentionPercent } : {}),
    ...(body.retentionCapPercent !== undefined ? { retentionCapPercent: body.retentionCapPercent } : {}),
    ...(body.advancePercent !== undefined ? { advancePercent: body.advancePercent } : {}),
    ...(body.advanceRecoveryPercent !== undefined ? { advanceRecoveryPercent: body.advanceRecoveryPercent } : {}),
    ...(body.withholdingTaxPercent !== undefined ? { withholdingTaxPercent: body.withholdingTaxPercent } : {}),
    ...(body.deemedWagePercent !== undefined ? { deemedWagePercent: body.deemedWagePercent } : {}),
    ...(body.socialInsuranceRatePercent !== undefined
      ? { socialInsuranceRatePercent: body.socialInsuranceRatePercent }
      : {}),
    ...(body.withholdSocialInsurance !== undefined
      ? { withholdSocialInsurance: body.withholdSocialInsurance }
      : {}),
    ...(body.socialInsuranceNote !== undefined ? { socialInsuranceNote: body.socialInsuranceNote } : {}),
    ...(body.penaltyCapPercent !== undefined ? { penaltyCapPercent: body.penaltyCapPercent } : {}),
    ...(body.paymentTermDays !== undefined ? { paymentTermDays: body.paymentTermDays } : {}),
    ...(body.defectsLiabilityMonths !== undefined ? { defectsLiabilityMonths: body.defectsLiabilityMonths } : {}),
    ...(body.vatBasis !== undefined ? { vatBasis: body.vatBasis } : {}),
  };
}
