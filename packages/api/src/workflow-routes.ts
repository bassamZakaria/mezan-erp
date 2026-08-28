import { randomUUID } from "node:crypto";
import { Hono, type Context } from "hono";
import {
  can,
  isGateableActionType,
  saveWorkflowConfig,
  deleteWorkflowConfig,
  submitApproval,
  decideApproval,
  UnknownActionTypeError,
  EmptyStepsError,
  InvalidStepRoleError,
  DuplicateWorkflowConfigError,
  WorkflowConfigNotFoundError,
  ApprovalRequestNotFoundError,
  WorkflowError,
  type ApprovalRequestRecord,
  type ApprovalRequestRepository,
  type WorkflowConfigRecord,
  type WorkflowConfigRepository,
} from "@mezan/domain";
import { createWorkflowConfigSchema, updateWorkflowConfigSchema, submitApprovalRequestSchema, decideApprovalRequestSchema } from "@mezan/contracts";
import { type AuthContextResolver, callerRoleCodes, createPermissionGate, getAuthContext, headerAuthContextResolver } from "./permission-gate.js";

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
  /** Post the document the request was gating (its gate now grants). */
  confirm(docId: string, actor: string): Promise<void>;
  /** Hand the document back to its submitter as an editable draft. */
  returnToDraft(docId: string): Promise<void>;
}

export interface WorkflowRoutesDeps {
  readonly configs: WorkflowConfigRepository;
  readonly requests: ApprovalRequestRepository;
  /** Resolves the held document for a decided request, by action type. Omit and a decision only moves the request. */
  readonly heldDocuments?: (record: ApprovalRequestRecord) => HeldDocumentActions | null;
}

/**
 * A gated confirm names its request `${docId}:confirm` (DocumentService's own
 * default), so the document id is recoverable from the request id.
 */
function heldDocumentId(requestId: string): string {
  return requestId.endsWith(":confirm") ? requestId.slice(0, -":confirm".length) : requestId;
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

function serializeRequest(request: ApprovalRequestRecord) {
  return {
    id: request.id,
    actionType: request.actionType,
    submittedBy: request.submittedBy,
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
 * `x-role-codes` (comma-separated custom-role codes the caller holds) drives
 * the workflow gate's `actorRoles` — distinct from `x-permissions`, since a
 * gate step names an approver ROLE, not a permission code (see
 * `session.ts`'s `authHeaders`, which sends the single `x-role-code` a user's
 * one assigned role carries). A tenant admin (`"*"` in `x-permissions`)
 * bypasses every gate exactly as `gate.ts`'s `hasAdminRole` does.
 */
const actorRoles = callerRoleCodes;

/**
 * إعدادات الموافقات + الموافقات — the workflow-config chain-builder and the
 * approvals-inbox API (docs/catalog/09 §سير العمل), mounted at `/workflow`.
 * Permissions per the catalog's `workflow.*` group: `workflow.config.view` /
 * `.config.manage` gate the config CRUD; `workflow.view` gates the inbox;
 * `workflow.approve` gates approve/request-modification decisions,
 * `workflow.reject` gates reject decisions.
 */
export function createWorkflowRoutes(
  deps: WorkflowRoutesDeps,
  resolveAuthContext: AuthContextResolver = headerAuthContextResolver,
) {
  const gate = createPermissionGate(resolveAuthContext);
  const app = new Hono();

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
      );
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
      );
      return c.json(serializeConfig(config));
    } catch (err) {
      return configErrorResponse(c, err);
    }
  });

  app.delete("/configs/:id", gate("workflow.config.manage"), async (c) => {
    try {
      await deleteWorkflowConfig(c.req.param("id"), deps.configs);
      return c.body(null, 204);
    } catch (err) {
      return configErrorResponse(c, err);
    }
  });

  // --- الموافقات inbox ----------------------------------------------------

  app.get("/requests/pending", gate("workflow.view"), async (c) => {
    const roles = actorRoles(c);
    const rows = await deps.requests.listPendingForRoles(roles);
    return c.json(rows.map(serializeRequest));
  });

  app.get("/requests/pending-count", gate("workflow.view"), async (c) => {
    const roles = actorRoles(c);
    const rows = await deps.requests.listPendingForRoles(roles);
    return c.json({ count: rows.length });
  });

  app.get("/requests/mine", gate("workflow.view"), async (c) => {
    const ctx = getAuthContext(c);
    const rows = ctx ? await deps.requests.listBySubmitter(ctx.userId) : [];
    return c.json(rows.map(serializeRequest));
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
    return c.json(mine.map(serializeRequest));
  });

  app.get("/requests", gate("workflow.view"), async (c) => {
    const rows = await deps.requests.list();
    return c.json(rows.map(serializeRequest));
  });

  /**
   * Submits a new approval request for a gateable action type. Ungated
   * beyond a resolvable identity: the permission catalog has no
   * `workflow.submit` code — submitting is a side effect of whatever the
   * caller was already allowed to do (e.g. `sales.invoice.confirm`), the
   * same way a document's own `confirm` route would call this.
   */
  app.post("/requests", async (c) => {
    const parsed = submitApprovalRequestSchema.safeParse(await c.req.json());
    if (!parsed.success) return c.json({ error: "VALIDATION_ERROR", details: parsed.error.flatten() }, 400);
    if (!isGateableActionType(parsed.data.actionType)) {
      return c.json({ error: "UNKNOWN_ACTION_TYPE", message: `"${parsed.data.actionType}" is not a gateable action type.` }, 400);
    }
    const actionType = parsed.data.actionType;
    const ctx = await resolveAuthContext(c);
    const config = await deps.configs.findByActionType(actionType);
    const record = await submitApproval(
      {
        requestId: parsed.data.requestId ?? randomUUID(),
        actionType,
        submittedBy: ctx.userId,
        submitterRoles: actorRoles(c),
        entityLabel: parsed.data.entityLabel ?? null,
      },
      config ? { actionType: config.actionType, steps: config.steps } : { actionType, steps: [] },
      deps.requests,
    );
    return c.json(serializeRequest(record), 201);
  });

  app.post("/requests/:id/decide", gate("workflow.view"), async (c) => {
    const parsed = decideApprovalRequestSchema.safeParse(await c.req.json());
    if (!parsed.success) return c.json({ error: "VALIDATION_ERROR", details: parsed.error.flatten() }, 400);
    const ctx = getAuthContext(c);
    if (!ctx) return c.json({ error: "UNAUTHENTICATED" }, 401);
    const requiredPermission = parsed.data.decision === "reject" ? "workflow.reject" : "workflow.approve";
    if (!can(ctx, requiredPermission)) {
      return c.json({ error: "PERMISSION_DENIED", permission: requiredPermission }, 403);
    }
    try {
      const record = await decideApproval(
        c.req.param("id"),
        { actorId: ctx.userId, actorRoles: actorRoles(c), decision: parsed.data.decision, comment: parsed.data.comment },
        deps.requests,
      );
      const actions = deps.heldDocuments?.(record) ?? null;
      if (actions) {
        const docId = heldDocumentId(record.id);
        try {
          if ((await actions.heldRequestId(docId)) !== record.id) return c.json(serializeRequest(record));
          if (record.status === "approved") await actions.confirm(docId, ctx.userId);
          else if (record.status === "rejected" || record.status === "modification_requested") {
            await actions.returnToDraft(docId);
          }
        } catch (err) {
          // The decision itself stands — it is already persisted. Report the
          // document-side failure instead of swallowing it, so an approval that
          // could not post its document never reads as a clean success.
          return c.json(
            {
              error: "HELD_DOCUMENT_NOT_RESOLVED",
              message: err instanceof Error ? err.message : String(err),
              request: serializeRequest(record),
            },
            409,
          );
        }
      }
      return c.json(serializeRequest(record));
    } catch (err) {
      if (err instanceof ApprovalRequestNotFoundError) return c.json({ error: err.code, message: err.message }, 404);
      if (err instanceof WorkflowError) return c.json({ error: err.code, message: err.message }, 409);
      throw err;
    }
  });

  return app;
}
