import { messageEnOf } from "./observability/error-message-backfill.js";
import { postingRefusalResponse } from "./posting-refusal.js";
import { randomUUID } from "node:crypto";
import { Hono, type Context } from "hono";
import { z } from "zod";
import {
  Money,
  createLead,
  transitionLead,
  convertLead,
  createOpportunity,
  moveOpportunityStage,
  createPipelineStage,
  movePipelineStage,
  createActivity,
  completeActivity,
  cancelActivity,
  LeadNotFoundError,
  InvalidLeadError,
  InvalidCustomerError,
  InvalidLeadTransitionError,
  LeadNotConvertibleError,
  InvalidOpportunityError,
  DuplicatePipelineStageWinError,
  PipelineStageNotFoundError,
  OpportunityNotFoundError,
  ActivityNotFoundError,
  InvalidActivityError,
  ActivityNotPendingError,
  type Lead,
  type LeadRepository,
  type Opportunity,
  type OpportunityRepository,
  type PipelineStage,
  type PipelineStageRepository,
  type Activity,
  type ActivityRepository,
  type CustomerRepository,
  AuditChangeAction,
  type AuditSink,
} from "@mezan/domain";
import {
  assignOpportunitySchema,
  createLeadSchema,
  transitionLeadSchema,
  convertLeadSchema,
  createOpportunitySchema,
  moveOpportunityStageSchema,
  createPipelineStageSchema,
  createActivitySchema,
} from "@mezan/contracts";
import {
  callerUserId,
  createAnyPermissionGate,
  createPermissionGate,
  permissionDeniedBody,
  type AuthContextResolver,
} from "./permission-gate.js";
import {
  mayAssignOpportunities,
  OPPORTUNITY_ASSIGN,
  OPPORTUNITY_VIEW_ALL,
  OPPORTUNITY_VIEW_OWN,
  seesEveryActivity,
  visibleActivities,
  visibleOpportunities,
  type CrmOwnerDirectory,
} from "./crm-visibility.js";
import { nextMasterCode } from "./master-code.js";
import { recordAdminEvent } from "./admin-audit.js";
import { recordCustomerChange } from "./customers-routes.js";
import { MasterDataKind, refuseUnknownMasterData, type MasterDataChecks } from "./master-data-check.js";
import { duplicateIdRefusal } from "./duplicate-id.js";
import { DuplicateRecordIdError } from "@mezan/domain";

/**
 * CRM routes (docs/archive/catalog/06-crm-hr.md "العملاء المحتملون / الفرص / خط
 * المبيعات / مراحل خط المبيعات / الأنشطة"). Paths are root-relative — a
 * parent app mounts this whole router under `/crm`.
 */
export interface CrmRoutesDeps {
  readonly leads: LeadRepository;
  readonly opportunities: OpportunityRepository;
  readonly pipelineStages: PipelineStageRepository;
  readonly activities: ActivityRepository;
  readonly customers: Pick<CustomerRepository, "save" | "findAll" | "findById">;
  /**
   * Converting a lead MINTS A CUSTOMER — a party every invoice, allocation and
   * receivable then hangs off — and it was the one master-data creation path in
   * the product that left no trail of who created the party or from what.
   */
  readonly audit?: AuditSink;
  readonly masterData?: MasterDataChecks;
  /** Who may own a deal or an activity; omitted, any user id is accepted. */
  readonly owners?: CrmOwnerDirectory;
  readonly now?: () => string;
}

const movePipelineStageSchema = z.object({
  direction: z.enum(["up", "down"]),
});

function serializeLead(lead: Lead) {
  return {
    id: lead.id,
    name: lead.name,
    company: lead.company,
    email: lead.email,
    phone: lead.phone,
    source: lead.source,
    expectedValue: lead.expectedValue == null ? null : lead.expectedValue.toString(),
    interest: lead.interest,
    notes: lead.notes,
    status: lead.status,
    convertedCustomerId: lead.convertedCustomerId,
    convertedOpportunityId: lead.convertedOpportunityId,
    createdAt: lead.createdAt,
  };
}

function serializeOpportunity(opportunity: Opportunity) {
  return {
    id: opportunity.id,
    title: opportunity.title,
    customerId: opportunity.customerId,
    branchId: opportunity.branchId,
    stageId: opportunity.stageId,
    expectedValue: opportunity.expectedValue.toString(),
    probability: opportunity.probability,
    expectedCloseDate: opportunity.expectedCloseDate,
    notes: opportunity.notes,
    ownerUserId: opportunity.ownerUserId,
    lostReason: opportunity.lostReason,
    lostNote: opportunity.lostNote,
    status: opportunity.status,
    createdAt: opportunity.createdAt,
    closedAt: opportunity.closedAt,
  };
}

function serializePipelineStage(stage: PipelineStage) {
  return {
    id: stage.id,
    name: stage.name,
    order: stage.order,
    defaultProbability: stage.defaultProbability,
    color: stage.color,
    isWinStage: stage.isWinStage,
    isLossStage: stage.isLossStage,
    active: stage.active,
  };
}

function serializeActivity(activity: Activity) {
  return {
    id: activity.id,
    subject: activity.subject,
    type: activity.type,
    relatedLeadId: activity.relatedLeadId,
    relatedOpportunityId: activity.relatedOpportunityId,
    dueDate: activity.dueDate,
    assigneeUserId: activity.assigneeUserId,
    status: activity.status,
    notes: activity.notes,
    createdAt: activity.createdAt,
  };
}

function withMessageEn(err: { code: string; message: string }) {
  return { error: err.code, message: err.message, messageEn: messageEnOf(err) };
}

function handleDomainError(c: Context, err: unknown): Response {
  if (err instanceof DuplicateRecordIdError) return duplicateIdRefusal(c, err);
  const postingRefusal = postingRefusalResponse(c, err);
  if (postingRefusal) return postingRefusal;
  if (err instanceof LeadNotFoundError || err instanceof OpportunityNotFoundError || err instanceof PipelineStageNotFoundError || err instanceof ActivityNotFoundError) {
    return c.json(withMessageEn(err), 404);
  }
  if (
    err instanceof InvalidLeadError ||
    err instanceof InvalidLeadTransitionError ||
    err instanceof LeadNotConvertibleError ||
    err instanceof InvalidOpportunityError ||
    err instanceof DuplicatePipelineStageWinError ||
    err instanceof InvalidActivityError ||
    err instanceof ActivityNotPendingError ||
    err instanceof InvalidCustomerError
  ) {
    return c.json(withMessageEn(err), 422);
  }
  throw err;
}

export function createCrmRoutes(deps: CrmRoutesDeps, resolveAuthContext: AuthContextResolver): Hono {
  const app = new Hono();
  const gate = createPermissionGate(resolveAuthContext);
  const gateAny = createAnyPermissionGate(resolveAuthContext);
  const nowIso = deps.now ?? (() => new Date().toISOString());

  type OwnerChoice = { readonly owner: string | null } | { readonly refusal: Response };

  /**
   * SECURITY: who a new deal or activity is assigned to is decided here, not by
   * the caller. Leaving the owner out assigns it to the caller; naming anyone
   * else (or nobody) needs the assign permission, and the named person must be
   * a real user the directory knows.
   */
  async function resolveOwner(c: Context, requested: string | null | undefined): Promise<OwnerChoice> {
    const me = callerUserId(c) ?? null;
    if (requested === undefined) return { owner: me };
    if (requested === me) return { owner: me };
    if (!mayAssignOpportunities(c)) {
      return { refusal: c.json(permissionDeniedBody(OPPORTUNITY_ASSIGN), 403) };
    }
    if (requested !== null && deps.owners && !(await deps.owners.has(requested))) {
      return {
        refusal: c.json({ error: "OWNER_NOT_ELIGIBLE", message: "المسؤول المختار غير موجود أو لا يملك صلاحية العمل على فرص البيع.", messageEn: "The selected owner does not exist or lacks permission to work on sales opportunities." }, 422),
      };
    }
    return { owner: requested };
  }

  // --- Leads ---------------------------------------------------------------

  app.get("/leads", gate("crm.lead.view"), async (c) => {
    return c.json((await deps.leads.list()).map(serializeLead));
  });

  app.post("/leads", gate("crm.lead.create"), async (c) => {
    const parsed = createLeadSchema.safeParse(await c.req.json());
    if (!parsed.success) {
      return c.json({ error: "VALIDATION_ERROR", details: parsed.error.flatten() }, 400);
    }
    try {
      const lead = await createLead(
        {
          id: parsed.data.id ?? randomUUID(),
          name: parsed.data.name,
          company: parsed.data.company,
          email: parsed.data.email,
          phone: parsed.data.phone,
          source: parsed.data.source,
          expectedValue: parsed.data.expectedValue == null ? parsed.data.expectedValue : Money.fromMajor(parsed.data.expectedValue),
          interest: parsed.data.interest,
          notes: parsed.data.notes,
        },
        deps.leads,
      );
      return c.json(serializeLead(lead), 201);
    } catch (err) {
      return handleDomainError(c, err);
    }
  });

  app.get("/leads/:id", gate("crm.lead.view"), async (c) => {
    const lead = await deps.leads.findById(c.req.param("id"));
    if (!lead) return c.json({ error: "LEAD_NOT_FOUND" }, 404);
    return c.json(serializeLead(lead));
  });

  app.post("/leads/:id/transition", gate("crm.lead.edit"), async (c) => {
    const parsed = transitionLeadSchema.safeParse(await c.req.json());
    if (!parsed.success) {
      return c.json({ error: "VALIDATION_ERROR", details: parsed.error.flatten() }, 400);
    }
    const lead = await deps.leads.findById(c.req.param("id"));
    if (!lead) return c.json({ error: "LEAD_NOT_FOUND" }, 404);
    try {
      const transitioned = transitionLead(lead, parsed.data.status);
      await deps.leads.update(transitioned);
      return c.json(serializeLead(transitioned));
    } catch (err) {
      return handleDomainError(c, err);
    }
  });

  app.post("/leads/:id/convert", gate("crm.lead.convert"), async (c) => {
    const parsed = convertLeadSchema.safeParse(await c.req.json());
    if (!parsed.success) {
      return c.json({ error: "VALIDATION_ERROR", details: parsed.error.flatten() }, 400);
    }
    const branchRefusal = await refuseUnknownMasterData(c, deps.masterData, [
      { kind: MasterDataKind.Branch, ids: [parsed.data.opportunity?.branchId] },
    ]);
    if (branchRefusal) return branchRefusal;
    const convertChoice: OwnerChoice = parsed.data.opportunity ? await resolveOwner(c, parsed.data.opportunity.ownerUserId) : { owner: null };
    if ("refusal" in convertChoice) return convertChoice.refusal;
    const convertOwner = convertChoice.owner;
    let customer: { id: string; code: string } | undefined;
    if (parsed.data.createCustomer) {
      const existing = (await deps.customers.findAll()).map((row) => row.code);
      const code = parsed.data.customer?.code ?? nextMasterCode(existing, "C");
      if (existing.includes(code)) {
        return c.json({ error: "DUPLICATE_CUSTOMER_CODE", message: `كود العميل «${code}» مستخدم بالفعل.`, messageEn: `Customer code "${code}" is already in use.` }, 409);
      }
      customer = { id: parsed.data.customer?.id ?? randomUUID(), code };
    }
    try {
      const result = await convertLead(
        {
          leadId: c.req.param("id"),
          createCustomer: parsed.data.createCustomer,
          customer,
          createOpportunity: parsed.data.createOpportunity,
          opportunity: parsed.data.opportunity
            ? {
                id: parsed.data.opportunity.id,
                title: parsed.data.opportunity.title,
                branchId: parsed.data.opportunity.branchId,
                stageId: parsed.data.opportunity.stageId,
                expectedValue: Money.fromMajor(parsed.data.opportunity.expectedValue),
                probability: parsed.data.opportunity.probability,
                expectedCloseDate: parsed.data.opportunity.expectedCloseDate,
                ownerUserId: convertOwner,
              }
            : undefined,
        },
        { leads: deps.leads, customers: deps.customers, opportunities: deps.opportunities },
      );
      const created = result.customerId ? await deps.customers.findById(result.customerId) : null;
      if (created) await recordCustomerChange(deps.audit, c, created, AuditChangeAction.Create);
      await recordAdminEvent(deps.audit, c, {
        module: "crm",
        entityType: "LEAD",
        entityId: result.lead.id,
        action: "CONVERT",
        details: {
          leadId: result.lead.id,
          leadName: result.lead.name,
          customerId: result.customerId,
          customerCode: customer?.code ?? null,
          opportunityId: result.opportunityId,
        },
      });
      return c.json({
        lead: serializeLead(result.lead),
        customerId: result.customerId,
        opportunityId: result.opportunityId,
      });
    } catch (err) {
      return handleDomainError(c, err);
    }
  });

  // --- Opportunities ---------------------------------------------------------

  app.get("/opportunities", gateAny(OPPORTUNITY_VIEW_ALL, OPPORTUNITY_VIEW_OWN), async (c) => {
    // Branch SCOPE and ownership first — no query parameter may widen what this
    // caller may see — then the board's own branch filter narrows within it.
    const scoped = visibleOpportunities(c, await deps.opportunities.list());
    const branchId = c.req.query("branchId");
    const rows = branchId ? scoped.filter((o) => o.branchId === branchId) : scoped;
    return c.json(rows.map(serializeOpportunity));
  });

  app.post("/opportunities", gate("crm.opportunity.create"), async (c) => {
    const parsed = createOpportunitySchema.safeParse(await c.req.json());
    if (!parsed.success) {
      return c.json({ error: "VALIDATION_ERROR", details: parsed.error.flatten() }, 400);
    }
    const partyRefusal = await refuseUnknownMasterData(c, deps.masterData, [
      { kind: MasterDataKind.Customer, ids: [parsed.data.customerId] },
      { kind: MasterDataKind.Branch, ids: [parsed.data.branchId] },
    ]);
    if (partyRefusal) return partyRefusal;
    const choice = await resolveOwner(c, parsed.data.ownerUserId);
    if ("refusal" in choice) return choice.refusal;
    try {
      const opportunity = await createOpportunity(
        {
          id: parsed.data.id ?? randomUUID(),
          title: parsed.data.title,
          customerId: parsed.data.customerId,
          branchId: parsed.data.branchId,
          stageId: parsed.data.stageId,
          expectedValue: parsed.data.expectedValue == null ? undefined : Money.fromMajor(parsed.data.expectedValue),
          probability: parsed.data.probability,
          expectedCloseDate: parsed.data.expectedCloseDate,
          notes: parsed.data.notes,
          ownerUserId: choice.owner,
        },
        deps.opportunities,
      );
      await recordAdminEvent(deps.audit, c, {
        module: "crm",
        entityType: "OPPORTUNITY",
        entityId: opportunity.id,
        action: "CREATE",
        severity: "INFO",
        details: { title: opportunity.title, customerId: opportunity.customerId, ownerUserId: opportunity.ownerUserId },
      });
      return c.json(serializeOpportunity(opportunity), 201);
    } catch (err) {
      return handleDomainError(c, err);
    }
  });

  app.get("/opportunities/:id", gateAny(OPPORTUNITY_VIEW_ALL, OPPORTUNITY_VIEW_OWN), async (c) => {
    const opportunity = await deps.opportunities.findById(c.req.param("id"));
    if (!opportunity || visibleOpportunities(c, [opportunity]).length === 0) return c.json({ error: "OPPORTUNITY_NOT_FOUND" }, 404);
    return c.json(serializeOpportunity(opportunity));
  });

  app.post("/opportunities/:id/move-stage", gate("crm.opportunity.edit"), async (c) => {
    const parsed = moveOpportunityStageSchema.safeParse(await c.req.json());
    if (!parsed.success) {
      return c.json({ error: "VALIDATION_ERROR", details: parsed.error.flatten() }, 400);
    }
    const opportunity = await deps.opportunities.findById(c.req.param("id"));
    if (!opportunity || visibleOpportunities(c, [opportunity]).length === 0) return c.json({ error: "OPPORTUNITY_NOT_FOUND" }, 404);
    const stage = await deps.pipelineStages.findById(parsed.data.stageId);
    if (!stage) return c.json({ error: "PIPELINE_STAGE_NOT_FOUND" }, 404);
    try {
      const moved = moveOpportunityStage(opportunity, stage, nowIso(), {
        reason: parsed.data.lostReason,
        note: parsed.data.lostNote,
      });
      await deps.opportunities.update(moved);
      await recordAdminEvent(deps.audit, c, {
        module: "crm",
        entityType: "OPPORTUNITY",
        entityId: moved.id,
        action: "MOVE_STAGE",
        severity: "INFO",
        details: {
          fromStageId: opportunity.stageId,
          toStageId: moved.stageId,
          status: moved.status,
          lostReason: moved.lostReason,
          lostNote: moved.lostNote,
        },
      });
      return c.json(serializeOpportunity(moved));
    } catch (err) {
      return handleDomainError(c, err);
    }
  });

  app.post("/opportunities/:id/assign", gate(OPPORTUNITY_ASSIGN), async (c) => {
    const parsed = assignOpportunitySchema.safeParse(await c.req.json());
    if (!parsed.success) {
      return c.json({ error: "VALIDATION_ERROR", details: parsed.error.flatten() }, 400);
    }
    const opportunity = await deps.opportunities.findById(c.req.param("id"));
    if (!opportunity || visibleOpportunities(c, [opportunity]).length === 0) return c.json({ error: "OPPORTUNITY_NOT_FOUND" }, 404);
    const choice = await resolveOwner(c, parsed.data.ownerUserId);
    if ("refusal" in choice) return choice.refusal;
    const reassigned = { ...opportunity, ownerUserId: choice.owner };
    await deps.opportunities.update(reassigned);
    await recordAdminEvent(deps.audit, c, {
      module: "crm",
      entityType: "OPPORTUNITY",
      entityId: reassigned.id,
      action: "ASSIGN",
      severity: "INFO",
      details: { fromOwnerUserId: opportunity.ownerUserId, toOwnerUserId: reassigned.ownerUserId },
    });
    return c.json(serializeOpportunity(reassigned));
  });

  // --- Pipeline Stages ---------------------------------------------------------

  app.get("/pipeline-stages", gate("crm.pipeline.view"), async (c) => {
    return c.json((await deps.pipelineStages.list()).map(serializePipelineStage));
  });

  app.post("/pipeline-stages", gate("crm.pipeline.manage"), async (c) => {
    const parsed = createPipelineStageSchema.safeParse(await c.req.json());
    if (!parsed.success) {
      return c.json({ error: "VALIDATION_ERROR", details: parsed.error.flatten() }, 400);
    }
    try {
      const existing = await deps.pipelineStages.list();
      const stage = await createPipelineStage(
        {
          id: parsed.data.id ?? randomUUID(),
          name: parsed.data.name,
          defaultProbability: parsed.data.defaultProbability,
          color: parsed.data.color,
          isWinStage: parsed.data.isWinStage,
          isLossStage: parsed.data.isLossStage,
        },
        existing,
        deps.pipelineStages,
      );
      return c.json(serializePipelineStage(stage), 201);
    } catch (err) {
      return handleDomainError(c, err);
    }
  });

  app.post("/pipeline-stages/:id/move", gate("crm.pipeline.manage"), async (c) => {
    const parsed = movePipelineStageSchema.safeParse(await c.req.json());
    if (!parsed.success) {
      return c.json({ error: "VALIDATION_ERROR", details: parsed.error.flatten() }, 400);
    }
    try {
      const existing = await deps.pipelineStages.list();
      const reordered = movePipelineStage(existing, c.req.param("id"), parsed.data.direction);
      for (const stage of reordered) {
        await deps.pipelineStages.update(stage);
      }
      return c.json(reordered.map(serializePipelineStage));
    } catch (err) {
      return handleDomainError(c, err);
    }
  });

  // --- Activities ---------------------------------------------------------

  async function visibleActivityList(c: Context): Promise<readonly Activity[]> {
    const all = await deps.activities.list();
    return seesEveryActivity(c) ? all : visibleActivities(c, all, await deps.opportunities.list());
  }

  app.get("/activities", gate("crm.activity.view"), async (c) => {
    return c.json((await visibleActivityList(c)).map(serializeActivity));
  });

  app.post("/activities", gate("crm.activity.create"), async (c) => {
    const parsed = createActivitySchema.safeParse(await c.req.json());
    if (!parsed.success) {
      return c.json({ error: "VALIDATION_ERROR", details: parsed.error.flatten() }, 400);
    }
    const assignee = await resolveOwner(c, parsed.data.assigneeUserId);
    if ("refusal" in assignee) return assignee.refusal;
    try {
      const activity = await createActivity(
        {
          id: parsed.data.id ?? randomUUID(),
          subject: parsed.data.subject,
          type: parsed.data.type,
          relatedLeadId: parsed.data.relatedLeadId,
          relatedOpportunityId: parsed.data.relatedOpportunityId,
          dueDate: parsed.data.dueDate,
          assigneeUserId: assignee.owner,
          notes: parsed.data.notes,
        },
        deps.activities,
      );
      return c.json(serializeActivity(activity), 201);
    } catch (err) {
      return handleDomainError(c, err);
    }
  });

  app.post("/activities/:id/complete", gate("crm.activity.edit"), async (c) => {
    const activity = await deps.activities.findById(c.req.param("id"));
    if (!activity || !(await visibleActivityList(c)).some((a) => a.id === activity.id)) return c.json({ error: "ACTIVITY_NOT_FOUND" }, 404);
    try {
      const completed = completeActivity(activity);
      await deps.activities.update(completed);
      return c.json(serializeActivity(completed));
    } catch (err) {
      return handleDomainError(c, err);
    }
  });

  app.post("/activities/:id/cancel", gate("crm.activity.edit"), async (c) => {
    const activity = await deps.activities.findById(c.req.param("id"));
    if (!activity || !(await visibleActivityList(c)).some((a) => a.id === activity.id)) return c.json({ error: "ACTIVITY_NOT_FOUND" }, 404);
    try {
      const cancelled = cancelActivity(activity);
      await deps.activities.update(cancelled);
      return c.json(serializeActivity(cancelled));
    } catch (err) {
      return handleDomainError(c, err);
    }
  });

  return app;
}
