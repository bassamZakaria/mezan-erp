import { Hono, type Context } from "hono";
import {
  GATEABLE_ACTION_TYPES,
  isGateableActionType,
  decide,
  isTenantAdmin,
  WorkflowError,
  type ApprovalRequest,
  type UnitOfWork,
} from "@mezan/domain";
import {
  workflowConfigInputSchema,
  workflowDecisionCommentSchema,
  type ApprovalRequestDTO,
  type WorkflowConfigDTO,
  type WorkflowRequestScopeDTO,
} from "@mezan/contracts";
import type {
  GateConfigStore,
  StoredApprovalRequest,
  WorkflowRequestStore,
  WorkflowSubject,
} from "@mezan/persistence";
import { workflowDocTypeLabelAr } from "@mezan/persistence";
import { createPermissionGate, getAuthContext, headerAuthContextResolver, type AuthContextResolver } from "./permission-gate.js";

/**
 * Workflow/approvals routes (docs/catalog/09 §الموافقات), mounted at
 * `/workflow`:
 *
 *   GET  /workflow/config              every gateable action type + its configured chain
 *   PUT  /workflow/config/:actionType  set (or clear, with an empty `steps`) an action type's chain
 *   GET  /workflow/requests            the approvals inbox — `?scope=inbox|mine|acted`
 *   GET  /workflow/requests/:id        one request's full detail
 *   POST /workflow/requests/:id/approve
 *   POST /workflow/requests/:id/reject
 *
 * The gate engine itself (`packages/domain/src/workflow/gate.ts`) is pure and
 * already wired into document confirm flows via the persisted adapter
 * (`createPersistedDocumentWorkflowGate`) — these routes are the read/act
 * surface over the state that adapter produces.
 *
 * "Role" here means a tenant-defined role's `code` (matching `GateStep.role`
 * per gate.ts's own contract) — the acting user's role is resolved via
 * `uow.users`/`uow.roles`, not from the request's `x-permissions` header
 * (which, note for whoever wires document confirm handlers next, is what
 * `sales-invoices-routes.ts`/`vouchers-routes.ts` currently pass as
 * `actorRoles` — a permission code is not a role code, so a role-gated step
 * configured here cannot be satisfied by those two confirm handlers today;
 * only the tenant-admin `"*"` bypass works through them).
 */

function handleWorkflowError(c: Context, err: unknown) {
  if (err instanceof WorkflowError) {
    if (err.code === "WRONG_APPROVER") return c.json({ error: err.code, message: err.message }, 403);
    if (err.code === "NOT_PENDING" || err.code === "NOT_MODIFIABLE") {
      return c.json({ error: err.code, message: err.message }, 409);
    }
    return c.json({ error: err.code, message: err.message }, 400);
  }
  throw err;
}

async function resolveActorRoleCode(uow: UnitOfWork, userId: string): Promise<string | null> {
  const user = await uow.users.findById(userId);
  if (!user?.roleId) return null;
  const role = await uow.roles.findById(user.roleId);
  return role?.code ?? null;
}

function canActOn(request: ApprovalRequest, isAdmin: boolean, actorRoleCode: string | null): boolean {
  if (request.status !== "pending") return false;
  if (isAdmin) return true;
  const step = request.steps[request.currentStep];
  return !!step && !!actorRoleCode && step.role === actorRoleCode;
}

function actionLabelAr(actionType: string): string {
  return GATEABLE_ACTION_TYPES.find((a) => a.code === actionType)?.labelAr ?? actionType;
}

function serializeSubject(subject: WorkflowSubject | null) {
  if (!subject) return null;
  return {
    docType: subject.docType,
    docTypeLabelAr: workflowDocTypeLabelAr(subject.docType),
    docId: subject.docId,
    docNo: subject.docNo,
    date: subject.date,
    amount: subject.amount,
    currency: subject.currency,
  };
}

function serializeRequest(
  request: StoredApprovalRequest,
  subject: WorkflowSubject | null,
  nameOf: (userId: string) => string | null,
  isAdmin: boolean,
  actorRoleCode: string | null,
): ApprovalRequestDTO {
  return {
    id: request.id,
    actionType: request.actionType,
    actionLabelAr: actionLabelAr(request.actionType),
    submittedBy: request.submittedBy,
    submittedByName: nameOf(request.submittedBy),
    currentStep: request.currentStep,
    totalSteps: request.steps.length,
    currentStepRole: request.steps[request.currentStep]?.role ?? null,
    status: request.status,
    steps: request.steps.map((s) => ({ role: s.role, description: s.description })),
    decisions: request.decisions.map((d) => ({
      stepIndex: d.stepIndex,
      kind: d.kind,
      actorId: d.actorId,
      actorName: nameOf(d.actorId),
      comment: d.comment ?? null,
      at: d.at ? new Date(d.at).toISOString() : null,
    })),
    createdAt: request.createdAt,
    updatedAt: request.updatedAt,
    subject: serializeSubject(subject),
    canAct: canActOn(request, isAdmin, actorRoleCode),
  };
}

export interface WorkflowRoutesDeps {
  readonly uow: UnitOfWork;
  readonly configStore: GateConfigStore;
  readonly requestStore: WorkflowRequestStore;
  readonly resolveSubject: (requestId: string) => Promise<WorkflowSubject | null>;
}

export function createWorkflowRoutes(
  deps: WorkflowRoutesDeps,
  resolveAuthContext: AuthContextResolver = headerAuthContextResolver,
) {
  const { uow, configStore, requestStore, resolveSubject } = deps;
  const gate = createPermissionGate(resolveAuthContext);
  const app = new Hono();

  async function nameLookup(): Promise<(userId: string) => string | null> {
    const users = await uow.users.list();
    const byId = new Map(users.map((u) => [u.id, u.fullName]));
    return (userId: string) => byId.get(userId) ?? null;
  }

  app.get("/config", gate("workflow.config.view"), async (c) => {
    const stored = await configStore.list();
    const byActionType = new Map(stored.map((s) => [s.actionType, s]));
    const result: WorkflowConfigDTO[] = GATEABLE_ACTION_TYPES.map((def) => {
      const existing = byActionType.get(def.code);
      return {
        actionType: def.code,
        labelAr: def.labelAr,
        category: def.category,
        steps: existing?.steps.map((s) => ({ role: s.role, description: s.description })) ?? [],
        minAmount: existing?.minAmount ?? null,
        configured: !!existing && existing.steps.length > 0,
        updatedAt: existing?.updatedAt ?? null,
      };
    });
    return c.json(result);
  });

  app.put("/config/:actionType", gate("workflow.config.manage"), async (c) => {
    const actionType = c.req.param("actionType");
    if (!isGateableActionType(actionType)) {
      return c.json({ error: "UNKNOWN_ACTION_TYPE", message: `"${actionType}" is not a gateable action type.` }, 400);
    }
    const parsed = workflowConfigInputSchema.safeParse(await c.req.json());
    if (!parsed.success) {
      return c.json({ error: "VALIDATION_ERROR", details: parsed.error.flatten() }, 400);
    }
    const stored = await configStore.set(actionType, {
      steps: parsed.data.steps,
      minAmount: parsed.data.minAmount ?? null,
    });
    const def = GATEABLE_ACTION_TYPES.find((a) => a.code === actionType);
    const result: WorkflowConfigDTO = {
      actionType: stored.actionType,
      labelAr: def?.labelAr ?? actionType,
      category: def?.category ?? "sales",
      steps: stored.steps.map((s) => ({ role: s.role, description: s.description })),
      minAmount: stored.minAmount,
      configured: stored.steps.length > 0,
      updatedAt: stored.updatedAt,
    };
    return c.json(result);
  });

  app.get("/requests", gate("workflow.view"), async (c) => {
    const ctx = getAuthContext(c);
    if (!ctx) return c.json({ error: "UNAUTHENTICATED" }, 401);
    const scopeParam = (c.req.query("scope") ?? "inbox") as WorkflowRequestScopeDTO;
    if (!["inbox", "mine", "acted"].includes(scopeParam)) {
      return c.json({ error: "VALIDATION_ERROR", message: "scope must be inbox, mine or acted" }, 400);
    }

    const isAdmin = isTenantAdmin(ctx);
    const actorRoleCode = isAdmin ? null : await resolveActorRoleCode(uow, ctx.userId);
    const all = await requestStore.list();

    let rows: StoredApprovalRequest[];
    if (scopeParam === "inbox") {
      rows = all.filter((r) => canActOn(r, isAdmin, actorRoleCode));
    } else if (scopeParam === "mine") {
      rows = all.filter((r) => r.submittedBy === ctx.userId);
    } else {
      rows = all.filter((r) => r.decisions.some((d) => d.actorId === ctx.userId));
    }

    const nameOf = await nameLookup();
    const result = await Promise.all(
      rows.map(async (r) => serializeRequest(r, await resolveSubject(r.id), nameOf, isAdmin, actorRoleCode)),
    );
    return c.json(result);
  });

  app.get("/requests/:id", gate("workflow.view"), async (c) => {
    const ctx = getAuthContext(c);
    if (!ctx) return c.json({ error: "UNAUTHENTICATED" }, 401);
    const request = await requestStore.findById(c.req.param("id"));
    if (!request) return c.json({ error: "NOT_FOUND" }, 404);
    const isAdmin = isTenantAdmin(ctx);
    const actorRoleCode = isAdmin ? null : await resolveActorRoleCode(uow, ctx.userId);
    const nameOf = await nameLookup();
    const subject = await resolveSubject(request.id);
    return c.json(serializeRequest(request, subject, nameOf, isAdmin, actorRoleCode));
  });

  async function act(c: Context, decision: "approve" | "reject") {
    const ctx = getAuthContext(c);
    if (!ctx) return c.json({ error: "UNAUTHENTICATED" }, 401);
    let body: unknown = {};
    try {
      body = await c.req.json();
    } catch {
      body = {};
    }
    const parsed = workflowDecisionCommentSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: "VALIDATION_ERROR", details: parsed.error.flatten() }, 400);
    }
    const request = await requestStore.findById(c.req.param("id") ?? "");
    if (!request) return c.json({ error: "NOT_FOUND" }, 404);

    const isAdmin = isTenantAdmin(ctx);
    const actorRoleCode = isAdmin ? null : await resolveActorRoleCode(uow, ctx.userId);
    const actorRoles = isAdmin ? ["*"] : actorRoleCode ? [actorRoleCode] : [];

    try {
      const { request: next } = decide(request, {
        actorId: ctx.userId,
        actorRoles,
        decision,
        comment: parsed.data.comment,
        at: Date.now(),
      });
      await requestStore.save(next);
      const stored = await requestStore.findById(next.id);
      if (!stored) return c.json({ error: "NOT_FOUND" }, 404);
      const nameOf = await nameLookup();
      const subject = await resolveSubject(stored.id);
      return c.json(serializeRequest(stored, subject, nameOf, isAdmin, actorRoleCode));
    } catch (err) {
      return handleWorkflowError(c, err);
    }
  }

  app.post("/requests/:id/approve", gate("workflow.approve"), (c) => act(c, "approve"));
  app.post("/requests/:id/reject", gate("workflow.reject"), (c) => act(c, "reject"));

  return app;
}
