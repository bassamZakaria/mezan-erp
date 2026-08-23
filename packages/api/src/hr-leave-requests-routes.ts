import { randomUUID } from "node:crypto";
import { Hono, type Context } from "hono";
import {
  DEFAULT_SETTINGS,
  InvalidLeaveApplicationError,
  LeaveApplicationNotFoundError,
  LeaveApplicationNotPendingError,
  cancelLeaveApplication,
  computeLeaveBalance,
  decideLeaveApplication,
  defaultLeaveGateConfigResolver,
  isLeaveTypeCode,
  submitLeaveApplication,
  WorkflowError,
  type LeaveAccrualCreditSource,
  type LeaveGateConfigResolver,
  type LeaveApplicationRepository,
  type LeaveApplicationStatus,
  type NextNumberService,
  type SettingsRepository,
} from "@mezan/domain";
import { decideLeaveApplicationSchema, submitLeaveApplicationSchema } from "@mezan/contracts";
import { createPermissionGate, getAuthContext, headerAuthContextResolver, type AuthContextResolver } from "./permission-gate.js";

export interface HrLeaveApplicationsRoutesDeps {
  readonly requests: LeaveApplicationRepository;
  readonly numbering: NextNumberService;
  readonly settings: SettingsRepository;
  readonly accrualCreditSource: LeaveAccrualCreditSource;
  readonly resolveGateConfig?: LeaveGateConfigResolver;
  readonly idGen?: () => string;
}

function handleDomainError(c: Context, err: unknown) {
  if (err instanceof LeaveApplicationNotFoundError) {
    return c.json({ error: err.code, message: err.message }, 404);
  }
  if (err instanceof LeaveApplicationNotPendingError) {
    return c.json({ error: err.code, message: err.message }, 409);
  }
  if (err instanceof InvalidLeaveApplicationError) {
    return c.json({ error: err.code, message: err.message }, 422);
  }
  if (err instanceof WorkflowError) {
    return c.json({ error: err.code, message: err.message }, 409);
  }
  throw err;
}

/**
 * Roles the acting user holds, for the workflow gate's `decide()` — this
 * codebase's `AuthContext` carries resolved PERMISSIONS, not role names (see
 * `permissions/auth-context.ts`), so a leave-request decision separately reads
 * an `x-roles` header (comma-separated role codes; `"*"` = admin bypass, same
 * sentinel `hasAdminRole` in `workflow/gate.ts` already checks for). Kept
 * local to this route file rather than added to the shared
 * `AuthContextResolver` so it doesn't ripple into every other gated route.
 */
function actorRolesFrom(c: Context): readonly string[] {
  return (c.req.header("x-roles") ?? "")
    .split(",")
    .map((r) => r.trim())
    .filter(Boolean);
}

/**
 * Leave Requests routes (docs/catalog/06 §"طلبات الإجازات") — the full,
 * leave-policy-driven, workflow-gated flow — mounted under
 * `/hr/leave-applications`. Deliberately NOT `/hr/leave-requests`: that path
 * belongs to `hr/master-data`'s simpler 3-type "My Leave" self-service stand-in
 * (`packages/api/src/hr-routes.ts`, `POST /hr/leave-requests` etc.), which
 * predates and is out of scope for this module's full 8-type/9-gate build.
 */
export function createHrLeaveApplicationsRoutes(
  deps: HrLeaveApplicationsRoutesDeps,
  resolveAuthContext: AuthContextResolver = headerAuthContextResolver,
) {
  const app = new Hono();
  const gate = createPermissionGate(resolveAuthContext);
  const idGen = deps.idGen ?? randomUUID;
  const resolveGateConfig = deps.resolveGateConfig ?? defaultLeaveGateConfigResolver;

  app.get("/", gate("hr.leave.view"), async (c) => {
    const employeeId = c.req.query("employeeId") ?? undefined;
    const statusParam = c.req.query("status") ?? undefined;
    const leaveTypeCodeParam = c.req.query("leaveTypeCode") ?? undefined;
    const list = await deps.requests.list({
      employeeId,
      status: statusParam as LeaveApplicationStatus | undefined,
      leaveTypeCode: leaveTypeCodeParam && isLeaveTypeCode(leaveTypeCodeParam) ? leaveTypeCodeParam : undefined,
    });
    return c.json(list);
  });

  app.get("/:id", gate("hr.leave.view"), async (c) => {
    const request = await deps.requests.findById(c.req.param("id"));
    if (!request) return c.json({ error: "LEAVE_REQUEST_NOT_FOUND" }, 404);
    return c.json(request);
  });

  app.get("/balance/:employeeId/:leaveTypeCode", gate("hr.leave.view"), async (c) => {
    const leaveTypeCode = c.req.param("leaveTypeCode");
    if (!isLeaveTypeCode(leaveTypeCode)) {
      return c.json({ error: "VALIDATION_ERROR", message: `Unknown leave type: "${leaveTypeCode}"` }, 400);
    }
    const balance = await computeLeaveBalance(c.req.param("employeeId"), leaveTypeCode, {
      requests: deps.requests,
      accrual: deps.accrualCreditSource,
    });
    return c.json(balance);
  });

  app.post("/", gate("hr.leave.create"), async (c) => {
    const parsed = submitLeaveApplicationSchema.safeParse(await c.req.json());
    if (!parsed.success) {
      return c.json({ error: "VALIDATION_ERROR", details: parsed.error.flatten() }, 400);
    }
    const authCtx = getAuthContext(c);
    try {
      const current = await deps.settings.get();
      const request = await submitLeaveApplication(
        {
          id: idGen(),
          employeeId: parsed.data.employeeId,
          leaveTypeCode: parsed.data.leaveTypeCode,
          startDate: parsed.data.startDate,
          endDate: parsed.data.endDate,
          halfDay: parsed.data.halfDay,
          reason: parsed.data.reason,
          submittedBy: authCtx?.userId ?? "anonymous",
          submitterRoles: actorRolesFrom(c),
        },
        {
          requests: deps.requests,
          numbering: deps.numbering,
          weekendDays: current?.weekendDays ?? DEFAULT_SETTINGS.weekendDays,
          resolveGateConfig,
        },
      );
      return c.json(request, 201);
    } catch (err) {
      return handleDomainError(c, err);
    }
  });

  app.post("/:id/decide", gate("hr.leave.approve"), async (c) => {
    const parsed = decideLeaveApplicationSchema.safeParse(await c.req.json());
    if (!parsed.success) {
      return c.json({ error: "VALIDATION_ERROR", details: parsed.error.flatten() }, 400);
    }
    const authCtx = getAuthContext(c);
    try {
      const request = await decideLeaveApplication(
        {
          id: c.req.param("id"),
          actorId: authCtx?.userId ?? "anonymous",
          actorRoles: actorRolesFrom(c),
          decision: parsed.data.decision,
          comment: parsed.data.comment,
        },
        { requests: deps.requests },
      );
      return c.json(request);
    } catch (err) {
      return handleDomainError(c, err);
    }
  });

  app.post("/:id/cancel", gate("hr.leave.create"), async (c) => {
    try {
      const request = await cancelLeaveApplication({ id: c.req.param("id") }, { requests: deps.requests });
      return c.json(request);
    } catch (err) {
      return handleDomainError(c, err);
    }
  });

  return app;
}
