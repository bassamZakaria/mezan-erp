import { Hono } from "hono";
import {
  Money,
  createFollowUp,
  completeFollowUp,
  cancelFollowUp,
  generateInstallmentSchedule,
  processOverdueInstallments,
  FollowUpNotFoundError,
  InvalidFollowUpTransitionError,
  InvalidInstallmentScheduleError,
  type CollectionFollowUp,
  type CollectionFollowUpRepository,
  type DocumentRepository,
  type DocumentService,
  type FrameworkDocument,
  type InstallmentLine,
  type InstallmentPlanDocument,
} from "@mezan/domain";
import {
  createInstallmentPlanSchema,
  processOverdueInstallmentsSchema,
  createFollowUpSchema,
  completeFollowUpSchema,
} from "@mezan/contracts";
import { createPermissionGate, headerAuthContextResolver, type AuthContextResolver } from "./permission-gate.js";
import { handleDocumentError } from "./document-error-handling.js";

function serializePlanLine(l: InstallmentLine) {
  return {
    no: l.no,
    customerId: l.customerId,
    sourceInvoiceId: l.sourceInvoiceId,
    sourceInvoiceNumber: l.sourceInvoiceNumber,
    frequency: l.frequency,
    downPayment: l.downPayment.toString(),
    dueDate: l.dueDate,
    amount: l.amount.toString(),
    paidAmount: l.paidAmount.toString(),
    status: l.status,
    lateFeeAmount: l.lateFeeAmount.toString(),
  };
}

function serializePlan(doc: FrameworkDocument<InstallmentLine>) {
  return {
    id: doc.id,
    docType: doc.docType,
    docNo: doc.docNo,
    date: doc.date,
    memo: doc.memo,
    status: doc.status,
    lines: doc.lines.map(serializePlanLine),
    createdAt: doc.createdAt,
    confirmedAt: doc.confirmedAt,
    reversesDocId: doc.reversesDocId,
    reversedByDocId: doc.reversedByDocId,
    workflowRequestId: doc.workflowRequestId,
    journalEntryId: doc.journalEntryId,
  };
}

function serializeFollowUp(f: CollectionFollowUp) {
  return {
    id: f.id,
    customerId: f.customerId,
    installmentPlanId: f.installmentPlanId,
    type: f.type,
    followUpDate: f.followUpDate,
    assignedTo: f.assignedTo,
    notes: f.notes,
    status: f.status,
    outcome: f.outcome,
    createdAt: f.createdAt,
  };
}

export interface InstallmentsRoutesDeps {
  readonly plans: DocumentService<InstallmentLine>;
  /** Direct repo access for the overdue batch, which rewrites line statuses in place rather than transitioning the document's own status (see `overdue.ts`). */
  readonly plansRepo: DocumentRepository<InstallmentLine>;
  readonly followUps: CollectionFollowUpRepository;
}

/**
 * Installments routes (docs/catalog/05 §"خطط الأقساط" + §"متابعة التحصيل"),
 * mounted under `/installments`: `/installments/plans` (+ `/overdue/process`
 * — معالجة المتأخرات) and `/installments/follow-ups`.
 */
export function createInstallmentsRoutes(
  deps: InstallmentsRoutesDeps,
  resolveAuthContext: AuthContextResolver = headerAuthContextResolver,
) {
  const app = new Hono();
  const gate = createPermissionGate(resolveAuthContext);

  // --- خطط الأقساط ------------------------------------------------------
  const plans = new Hono();

  plans.post("/overdue/process", gate("installments.overdue.process"), async (c) => {
    const parsed = processOverdueInstallmentsSchema.safeParse(await c.req.json());
    if (!parsed.success) {
      return c.json({ error: "VALIDATION_ERROR", details: parsed.error.flatten() }, 400);
    }
    const confirmedPlans = (await deps.plansRepo.list({ status: "confirmed" })) as readonly InstallmentPlanDocument[];
    const result = processOverdueInstallments(confirmedPlans, parsed.data.asOfDate);
    for (let i = 0; i < confirmedPlans.length; i++) {
      const before = confirmedPlans[i] as InstallmentPlanDocument;
      const after = result.updatedPlans[i] as InstallmentPlanDocument;
      if (after !== before) await deps.plansRepo.update(after);
    }
    return c.json({
      newlyOverdueCount: result.newlyOverdueCount,
      totalLateFeesApplied: result.totalLateFeesApplied.toString(),
    });
  });

  plans.get("/", gate("installments.plan.view"), async (c) => {
    const status = c.req.query("status");
    const list = await deps.plans.list({ status: status as never });
    return c.json(list.map(serializePlan));
  });

  plans.get("/:id", gate("installments.plan.view"), async (c) => {
    const doc = await deps.plans.findById(c.req.param("id"));
    if (!doc) return c.json({ error: "NOT_FOUND" }, 404);
    return c.json(serializePlan(doc));
  });

  plans.post("/", gate("installments.plan.create"), async (c) => {
    const parsed = createInstallmentPlanSchema.safeParse(await c.req.json());
    if (!parsed.success) {
      return c.json({ error: "VALIDATION_ERROR", details: parsed.error.flatten() }, 400);
    }
    try {
      const schedule = generateInstallmentSchedule({
        invoiceTotal: Money.fromMajor(parsed.data.invoiceTotal),
        downPayment: Money.fromMajor(parsed.data.downPayment),
        installmentCount: parsed.data.installmentCount,
        frequency: parsed.data.frequency,
        startDate: parsed.data.startDate,
      });
      const lines: InstallmentLine[] = schedule.installments.map((i) => ({
        no: i.no,
        customerId: parsed.data.customerId,
        sourceInvoiceId: parsed.data.sourceInvoiceId,
        sourceInvoiceNumber: parsed.data.sourceInvoiceNumber,
        frequency: parsed.data.frequency,
        downPayment: schedule.downPayment,
        dueDate: i.dueDate,
        amount: i.amount,
        paidAmount: Money.zero(),
        status: "pending",
        lateFeeAmount: Money.zero(),
      }));
      const doc = await deps.plans.createDraft({ id: parsed.data.id, date: parsed.data.startDate, memo: parsed.data.memo, lines });
      return c.json(serializePlan(doc), 201);
    } catch (err) {
      if (err instanceof InvalidInstallmentScheduleError) {
        return c.json({ error: err.code, message: err.message }, 422);
      }
      return handleDocumentError(c, err);
    }
  });

  // No dedicated "confirm" permission exists in the 8-entry installments
  // catalog (docs/catalog/09) — the create form has one "حفظ" action with no
  // separate post-creation confirm step observed, so confirming reuses the
  // create permission.
  plans.post("/:id/confirm", gate("installments.plan.create"), async (c) => {
    try {
      const result = await deps.plans.confirm(c.req.param("id"), { actor: c.req.header("x-user-id") ?? undefined });
      return c.json({ document: serializePlan(result.document), held: result.held });
    } catch (err) {
      return handleDocumentError(c, err);
    }
  });

  plans.post("/:id/cancel", gate("installments.plan.cancel"), async (c) => {
    try {
      const doc = await deps.plans.cancel(c.req.param("id"));
      return c.json(serializePlan(doc));
    } catch (err) {
      return handleDocumentError(c, err);
    }
  });

  // --- متابعة التحصيل ----------------------------------------------------
  const followUps = new Hono();

  followUps.get("/", gate("installments.follow_up.view"), async (c) => {
    const status = c.req.query("status");
    const customerId = c.req.query("customerId");
    const list = await deps.followUps.list({
      status: status as never,
      customerId: customerId ?? undefined,
    });
    return c.json(list.map(serializeFollowUp));
  });

  followUps.post("/", gate("installments.follow_up.manage"), async (c) => {
    const parsed = createFollowUpSchema.safeParse(await c.req.json());
    if (!parsed.success) {
      return c.json({ error: "VALIDATION_ERROR", details: parsed.error.flatten() }, 400);
    }
    const followUp = createFollowUp({ ...parsed.data, createdAt: new Date().toISOString() });
    await deps.followUps.save(followUp);
    return c.json(serializeFollowUp(followUp), 201);
  });

  followUps.post("/:id/complete", gate("installments.follow_up.manage"), async (c) => {
    const parsed = completeFollowUpSchema.safeParse(await c.req.json());
    if (!parsed.success) {
      return c.json({ error: "VALIDATION_ERROR", details: parsed.error.flatten() }, 400);
    }
    try {
      const existing = await deps.followUps.findById(c.req.param("id"));
      if (!existing) throw new FollowUpNotFoundError(c.req.param("id"));
      const updated = completeFollowUp(existing, parsed.data.outcome);
      await deps.followUps.update(updated);
      return c.json(serializeFollowUp(updated));
    } catch (err) {
      if (err instanceof FollowUpNotFoundError) return c.json({ error: err.code, message: err.message }, 404);
      if (err instanceof InvalidFollowUpTransitionError) return c.json({ error: err.code, message: err.message }, 409);
      throw err;
    }
  });

  followUps.post("/:id/cancel", gate("installments.follow_up.manage"), async (c) => {
    try {
      const existing = await deps.followUps.findById(c.req.param("id"));
      if (!existing) throw new FollowUpNotFoundError(c.req.param("id"));
      const updated = cancelFollowUp(existing);
      await deps.followUps.update(updated);
      return c.json(serializeFollowUp(updated));
    } catch (err) {
      if (err instanceof FollowUpNotFoundError) return c.json({ error: err.code, message: err.message }, 404);
      if (err instanceof InvalidFollowUpTransitionError) return c.json({ error: err.code, message: err.message }, 409);
      throw err;
    }
  });

  app.route("/plans", plans);
  app.route("/follow-ups", followUps);
  return app;
}
