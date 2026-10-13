import { randomUUID } from "node:crypto";
import { Hono, type Context } from "hono";
import {
  ALL_SCOPE,
  can,
  isGateableActionType,
  saveWorkflowConfig,
  deleteWorkflowConfig,
  submitApproval,
  decideApproval,
  UnknownActionTypeError,
  EmptyStepsError,
  InvalidStepRoleError,
  UnknownStepRoleError,
  DuplicateWorkflowConfigError,
  WorkflowConfigNotFoundError,
  ApprovalRequestNotFoundError,
  ApprovalRequestReapprovalRequiredError,
  ApprovalStatusCode,
  REAPPROVAL_REQUIRED_REASON_AR,
  REAPPROVAL_REQUIRED_REASON_EN,
  WorkflowError,
  type ApproverRoleResolver,
  type AuditSink,
  type ApprovalRequestRecord,
  type ApprovalRequestRepository,
  type WorkflowConfigRecord,
  type WorkflowConfigRepository,
} from "@mezan/domain";
import { createWorkflowConfigSchema, updateWorkflowConfigSchema, submitApprovalRequestSchema, decideApprovalRequestSchema } from "@mezan/contracts";
import { type AuthContextResolver, callerRoleCodes, createAnyPermissionGate, createPermissionGate, getAuthContext, permissionDeniedBody, roleCodesOf } from "./permission-gate.js";
import { recordAdminEvent } from "./admin-audit.js";
import { BranchRecordKind, recordInBranchGrant } from "./branch-policy.js";

/**
 * Acts on the DOCUMENT behind an approval request once a decision is recorded.
 * Deciding used to mutate only the `ApprovalRequestRecord`: an approved
 * document stayed بانتظار الموافقة forever, because nothing re-invoked its
 * confirm and no route could resolve it.
 */
export interface HeldDocumentActions {
  /**
   * The request's own workflow-request id, or null when no such document
   * exists. A request submitted straight through `POST /workflow/requests`
   * (the approvals inbox' own demo rows) gates no document at all.
   */
  heldRequestId(docId: string): Promise<string | null>;
  /** The held document's number, null until one is stamped or when the document is not there. */
  documentNo(docId: string): Promise<string | null>;
  /** Post the document the request was gating (its gate now grants). */
  confirm(docId: string, actor: string): Promise<void>;
  /** Hand the document back to its submitter as an editable draft. */
  returnToDraft(docId: string, actor: string): Promise<void>;
}

export interface WorkflowRoutesDeps {
  readonly configs: WorkflowConfigRepository;
  readonly requests: ApprovalRequestRepository;
  /** Resolves the held document for a decided request, by action type. Omit and a decision only moves the request. */
  readonly heldDocuments?: (record: ApprovalRequestRecord) => HeldDocumentActions | null;
  /**
   * Who rewrote the approval chain.
   *
   * إعدادات الموافقات is the product's ONLY segregation-of-duties control, and
   * its CRUD was mounted with no audit sink at all — so a holder of
   * `workflow.config.manage` could delete the config for
   * `PAYMENT_VOUCHER_CONFIRM`, let an unapproved payment out, and re-create the
   * config, with `GET /audit` showing nothing for any of it. The control that
   * requires a second signature could be switched off and back on inside a
   * minute, invisibly.
   */
  readonly audit?: AuditSink;
  /** Whether an approver role code resolves to a real role. See `saveWorkflowConfig`. */
  readonly roleExists?: ApproverRoleResolver;
  /** The user directory's name for a submitter, joined into each request the caller is already served. */
  readonly submitterName?: (userId: string) => Promise<string | null>;
}

function serializeConfig(config: WorkflowConfigRecord) {
  return {
    id: config.id,
    actionType: config.actionType,
    steps: config.steps,
    createdAt: config.createdAt,
    updatedAt: config.updatedAt,
  };
}

const HELD_DOCUMENT_READ_PERMISSIONS: readonly string[] = [
  "sales.invoice.view",
  "sales.invoice.view_own",
  "sales.return.view",
  "purchases.invoice.view",
  "purchases.return.view",
  "purchases.landed_cost.view",
  "treasury.cash_voucher.view",
];

async function serializeRequest(deps: WorkflowRoutesDeps, request: ApprovalRequestRecord) {
  const documentId = request.subject?.documentId ?? null;
  const [submittedByName, documentNo] = await Promise.all([
    deps.submitterName?.(request.submittedBy) ?? null,
    documentId === null ? null : (deps.heldDocuments?.(request)?.documentNo(documentId) ?? null),
  ]);
  return {
    id: request.id,
    actionType: request.actionType,
    submittedBy: request.submittedBy,
    submittedByName,
    documentId,
    documentNo,
    steps: request.steps,
    currentStep: request.currentStep,
    status: request.status,
    decisions: request.decisions,
    entityLabel: request.entityLabel,
    createdAt: request.createdAt,
    updatedAt: request.updatedAt,
  };
}

function configErrorResponse(c: Context, err: unknown) {
  if (err instanceof UnknownStepRoleError) {
    return c.json({ error: err.code, message: `الخطوة ${err.index + 1}: الدور "${err.role}" غير موجود.` }, 400);
  }
  if (err instanceof UnknownActionTypeError || err instanceof EmptyStepsError || err instanceof InvalidStepRoleError) {
    return c.json({ error: err.code, message: err.message }, 400);
  }
  if (err instanceof DuplicateWorkflowConfigError) {
    return c.json({ error: err.code, message: err.message }, 409);
  }
  if (err instanceof WorkflowConfigNotFoundError) {
    return c.json({ error: err.code, message: err.message }, 404);
  }
  throw err;
}

/**
 * The custom-role codes the caller holds, resolved off the SESSION grant and
 * never off a header, drive the workflow gate's `actorRoles` — a gate step
 * names an approver ROLE, not a permission code, and the two vocabularies must
 * not be fed to each other (DEC-2). A tenant admin (`"*"` in the resolved
 * permission set) bypasses every gate exactly as `gate.ts`'s `hasAdminRole` does.
 */
const actorRoles = callerRoleCodes;

/**
 * إعدادات الموافقات + الموافقات — the workflow-config chain-builder and the
 * approvals-inbox API (docs/archive/catalog/09 §سير العمل), mounted at `/workflow`.
 * Permissions per the catalog's `workflow.*` group: `workflow.config.view` /
 * `.config.manage` gate the config CRUD; `workflow.view` gates the inbox;
 * `workflow.approve` gates approve/request-modification decisions,
 * `workflow.reject` gates reject decisions.
 */
export function createWorkflowRoutes(
  deps: WorkflowRoutesDeps,
  resolveAuthContext: AuthContextResolver,
) {
  const gate = createPermissionGate(resolveAuthContext);
  const gateAny = createAnyPermissionGate(resolveAuthContext);
  const app = new Hono();

  /**
   * The STEP LIST travels, both ends of it. "Approval config changed" is not
   * evidence; "PAYMENT_VOUCHER_CONFIRM stopped requiring the finance manager"
   * is, and it is the only thing that answers whether somebody switched off the
   * control that was in their way.
   */
  function auditConfig(
    c: Context,
    action: "CREATE" | "UPDATE" | "DELETE",
    config: { id: string; actionType: string; steps: readonly unknown[] },
    before?: WorkflowConfigRecord | null,
  ) {
    return recordAdminEvent(deps.audit, c, {
      module: "workflow",
      entityType: "WORKFLOW_CONFIG",
      entityId: config.id,
      action,
      severity: "CRITICAL",
      details: {
        actionType: config.actionType,
        steps: config.steps,
        ...(before ? { previousSteps: before.steps } : {}),
      },
    });
  }

  app.get("/configs", gate("workflow.config.view"), async (c) => {
    const configs = await deps.configs.list();
    return c.json(configs.map(serializeConfig));
  });

  app.get("/configs/:id", gate("workflow.config.view"), async (c) => {
    const config = await deps.configs.findById(c.req.param("id"));
    if (!config) return c.json({ error: "NOT_FOUND" }, 404);
    return c.json(serializeConfig(config));
  });

  app.post("/configs", gate("workflow.config.manage"), async (c) => {
    const parsed = createWorkflowConfigSchema.safeParse(await c.req.json());
    if (!parsed.success) return c.json({ error: "VALIDATION_ERROR", details: parsed.error.flatten() }, 400);
    try {
      const config = await saveWorkflowConfig(
        { id: randomUUID(), actionType: parsed.data.actionType, steps: parsed.data.steps, createdAt: new Date().toISOString() },
        deps.configs,
        deps.roleExists,
      );
      await auditConfig(c, "CREATE", config);
      return c.json(serializeConfig(config), 201);
    } catch (err) {
      return configErrorResponse(c, err);
    }
  });

  app.put("/configs/:id", gate("workflow.config.manage"), async (c) => {
    const id = c.req.param("id");
    const existing = await deps.configs.findById(id);
    if (!existing) return c.json({ error: "NOT_FOUND" }, 404);
    const parsed = updateWorkflowConfigSchema.safeParse(await c.req.json());
    if (!parsed.success) return c.json({ error: "VALIDATION_ERROR", details: parsed.error.flatten() }, 400);
    try {
      const config = await saveWorkflowConfig(
        { id, actionType: existing.actionType, steps: parsed.data.steps, createdAt: existing.createdAt },
        deps.configs,
        deps.roleExists,
      );
      await auditConfig(c, "UPDATE", config, existing);
      return c.json(serializeConfig(config));
    } catch (err) {
      return configErrorResponse(c, err);
    }
  });

  app.delete("/configs/:id", gate("workflow.config.manage"), async (c) => {
    const id = c.req.param("id");
    // Read before the delete: a DELETE row with no steps on it cannot answer
    // "which signature stopped being required", which is the entire question.
    const before = await deps.configs.findById(id);
    try {
      await deleteWorkflowConfig(id, deps.configs);
      await auditConfig(
        c,
        "DELETE",
        { id, actionType: before?.actionType ?? "", steps: before?.steps ?? [] },
        before,
      );
      return c.body(null, 204);
    } catch (err) {
      return configErrorResponse(c, err);
    }
  });

  // --- الموافقات inbox ----------------------------------------------------

  /**
   * SECURITY: answers only whether a request stands and why not — never its
   * chain, decisions or label — so the people who may read a held document can
   * be told what it waits for without holding the approvals inbox.
   */
  app.get("/requests/:id/standing", gateAny("workflow.view", ...HELD_DOCUMENT_READ_PERMISSIONS), async (c) => {
    const record = await deps.requests.findById(c.req.param("id"));
    const grant = getAuthContext(c)?.branchGrant ?? ALL_SCOPE;
    const branchId = record?.subject?.branchId ?? null;
    const outsideGrant = grant !== ALL_SCOPE && branchId !== null && !grant.includes(branchId);
    if (!record || outsideGrant) return c.json({ error: "NOT_FOUND" }, 404);
    const needsReapproval = record.status === ApprovalStatusCode.ReapprovalRequired;
    return c.json({
      id: record.id,
      status: record.status,
      reason: needsReapproval ? REAPPROVAL_REQUIRED_REASON_AR : null,
      reasonEn: needsReapproval ? REAPPROVAL_REQUIRED_REASON_EN : null,
    });
  });

  app.get("/requests/pending", gate("workflow.view"), async (c) => {
    const roles = actorRoles(c);
    const rows = await deps.requests.listPendingForRoles(roles);
    return c.json(await Promise.all(rows.map((row) => serializeRequest(deps, row))));
  });

  app.get("/requests/pending-count", gate("workflow.view"), async (c) => {
    const roles = actorRoles(c);
    const rows = await deps.requests.listPendingForRoles(roles);
    let count = 0;
    for (const row of rows) if (await recordInBranchGrant(c, BranchRecordKind.ApprovalRequest, row.id)) count += 1;
    return c.json({ count });
  });

  app.get("/requests/mine", gate("workflow.view"), async (c) => {
    const ctx = getAuthContext(c);
    const rows = ctx ? await deps.requests.listBySubmitter(ctx.userId) : [];
    return c.json(await Promise.all(rows.map((row) => serializeRequest(deps, row))));
  });

  /**
   * إجراءاتي — requests this user has already decided on. Derived from the
   * decision log's `actorId` rather than the caller filtering `/requests`,
   * so the tab stays correct however many requests exist.
   */
  app.get("/requests/acted", gate("workflow.view"), async (c) => {
    const ctx = getAuthContext(c);
    if (!ctx) return c.json([]);
    const rows = await deps.requests.list();
    const mine = rows.filter((row) => row.decisions.some((decision) => decision.actorId === ctx.userId));
    return c.json(await Promise.all(mine.map((row) => serializeRequest(deps, row))));
  });

  app.get("/requests", gate("workflow.view"), async (c) => {
    const rows = await deps.requests.list();
    return c.json(await Promise.all(rows.map((row) => serializeRequest(deps, row))));
  });

  /**
   * SECURITY: opens a request that gates NO document. A document's own
   * request is raised by its confirm, under an id derived from the stored
   * document; this route takes no id, so it can neither create nor replace
   * the request a held document is judged by.
   */
  app.post("/requests", gate("workflow.view"), async (c) => {
    const parsed = submitApprovalRequestSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) {
      return c.json(
        {
          error: "VALIDATION_ERROR",
          message: "بيانات طلب الموافقة غير صحيحة: يُحدَّد نوع الإجراء فقط، ورقم الطلب يولّده النظام.",
          messageEn: "The approval request is not valid: only the action type is stated, and the system assigns the request id.",
          details: parsed.error.flatten(),
        },
        400,
      );
    }
    if (!isGateableActionType(parsed.data.actionType)) {
      return c.json({ error: "UNKNOWN_ACTION_TYPE", message: `"${parsed.data.actionType}" is not a gateable action type.` }, 400);
    }
    const actionType = parsed.data.actionType;
    const ctx = await resolveAuthContext(c);
    const config = await deps.configs.findByActionType(actionType);
    const record = await submitApproval(
      {
        requestId: randomUUID(),
        actionType,
        submittedBy: ctx.userId,
        submitterRoles: roleCodesOf(ctx),
        entityLabel: parsed.data.entityLabel ?? null,
      },
      config ? { actionType: config.actionType, steps: config.steps } : { actionType, steps: [] },
      deps.requests,
    );
    return c.json(await serializeRequest(deps, record), 201);
  });

  app.post("/requests/:id/decide", gate("workflow.view"), async (c) => {
    const parsed = decideApprovalRequestSchema.safeParse(await c.req.json());
    if (!parsed.success) return c.json({ error: "VALIDATION_ERROR", details: parsed.error.flatten() }, 400);
    const ctx = getAuthContext(c);
    if (!ctx) return c.json({ error: "UNAUTHENTICATED" }, 401);
    const requiredPermission = parsed.data.decision === "reject" ? "workflow.reject" : "workflow.approve";
    if (!can(ctx, requiredPermission)) {
      return c.json(permissionDeniedBody(requiredPermission), 403);
    }
    try {
      const record = await decideApproval(
        c.req.param("id"),
        { actorId: ctx.userId, actorRoles: actorRoles(c), decision: parsed.data.decision, comment: parsed.data.comment },
        deps.requests,
      );
      const actions = deps.heldDocuments?.(record) ?? null;
      if (actions) {
        const docId = record.subject?.documentId;
        if (!docId) return c.json(await serializeRequest(deps, record));
        try {
          if ((await actions.heldRequestId(docId)) !== record.id) return c.json(await serializeRequest(deps, record));
          if (record.status === "approved") await actions.confirm(docId, ctx.userId);
          else if (record.status === "rejected" || record.status === "modification_requested") {
            await actions.returnToDraft(docId, ctx.userId);
          }
        } catch (err) {
          // The decision itself stands — it is already persisted. Report the
          // document-side failure instead of swallowing it, so an approval that
          // could not post its document never reads as a clean success.
          return c.json(
            {
              error: "HELD_DOCUMENT_NOT_RESOLVED",
              message: err instanceof Error ? err.message : String(err),
              ...(err instanceof Error && "messageEn" in err && typeof err.messageEn === "string" ? { messageEn: err.messageEn } : {}),
              ...(err instanceof Error && "code" in err && typeof err.code === "string" ? { reason: err.code } : {}),
              request: await serializeRequest(deps, record),
            },
            409,
          );
        }
      }
      return c.json(await serializeRequest(deps, record));
    } catch (err) {
      if (err instanceof ApprovalRequestNotFoundError) return c.json({ error: err.code, message: err.message }, 404);
      if (err instanceof ApprovalRequestReapprovalRequiredError) return c.json({ error: err.code, message: err.message, messageEn: err.messageEn }, 409);
      if (err instanceof WorkflowError) return c.json({ error: err.code, message: err.message }, 409);
      throw err;
    }
  });

  return app;
}
