import { randomUUID } from "node:crypto";
import { Hono, type Context } from "hono";
import {
  Qty,
  applyLeavePolicyPreset,
  availableLeaveDays,
  correctAttendance,
  createLeaveBalance,
  assertLeaveBalanceCovers,
  LeaveBalanceExceededError,
  createEmployeeDirectory,
  createLeavePolicy,
  decideApproval,
  decideLeaveRequest,
  filterLeaveRequests,
  isOnApprovedLeave,
  leaveApprovalActionType,
  LEAVE_POLICY_PRESETS,
  recordAttendance,
  runLeaveAccrual,
  submitApproval,
  summarizeAttendance,
  updateLeavePolicy,
  ApprovalRequestNotFoundError,
  AttendanceEntryNotFoundError,
  DuplicateAttendanceEntryError,
  DuplicateLeavePolicyError,
  EmployeeNotFoundError,
  InvalidAttendanceEntryError,
  InvalidLeaveAccrualBatchError,
  InvalidLeaveBalanceError,
  InvalidLeavePolicyError,
  InvalidLeaveRequestTransitionError,
  LeavePolicyNotFoundError,
  LeaveRequestNotFoundError,
  UnknownLeavePolicyPresetError,
  WorkflowError,
  type AttendanceEntry,
  type AttendanceRepository,
  type AttendanceStatus,
  type ApprovalRequestRepository,
  type EmployeeRepository,
  type HolidayRepository,
  type LeaveAccrualBatch,
  type LeaveAccrualBatchRepository,
  type LeaveBalance,
  type LeaveBalanceRepository,
  type LeavePolicy,
  type LeavePolicyRepository,
  type LeaveRequest,
  type LeaveRequestRepository,
  type LeaveRequestStatus,
  type LeaveType,
  type WorkflowConfigRepository,
} from "@mezan/domain";
import {
  applyLeavePolicyPresetSchema,
  correctAttendanceSchema,
  createLeavePolicySchema,
  decideLeaveRequestSchema,
  recordAttendanceSchema,
  runLeaveAccrualSchema,
  updateLeavePolicySchema,
  upsertLeaveBalanceSchema,
} from "@mezan/contracts";
import { type AuthContextResolver, callerRoleCodes, createPermissionGate, getAuthContext } from "./permission-gate.js";

/**
 * HR time & leave routes — الحضور والانصراف, سياسات الإجازات, أرصدة الإجازات,
 * استحقاقات الإجازات and the ADMIN half of طلبات الإجازات (docs/archive/catalog/06).
 * Mounted inside `createHrRoutes` so every path stays under `/hr`.
 *
 * Leave approval routes through the existing workflow gate
 * (`packages/domain/src/workflow`): the catalog's 26 gateable action types
 * already include 9 granular HR_LEAVE_APPROVE_* codes, so a tenant that
 * configures a chain for a leave type has that chain actually walked here
 * rather than a bespoke status flip bypassing it.
 */
export interface HrTimeLeaveRoutesDeps {
  readonly employees: Pick<EmployeeRepository, "findById" | "list">;
  readonly holidays: Pick<HolidayRepository, "list">;
  readonly leaveRequests: LeaveRequestRepository;
  readonly attendance: AttendanceRepository;
  readonly leavePolicies: LeavePolicyRepository;
  readonly leaveBalances: LeaveBalanceRepository;
  readonly leaveAccrualBatches: LeaveAccrualBatchRepository;
  readonly numbering: { next(code: string): Promise<{ readonly formatted: string }> };
  /** Absent = no gate configured anywhere; approvals then decide directly on the `hr.leave.approve` permission alone. */
  readonly workflow?: {
    readonly configs: Pick<WorkflowConfigRepository, "findByActionType">;
    readonly requests: ApprovalRequestRepository;
  };
}

function serializeAttendance(e: AttendanceEntry) {
  return {
    id: e.id,
    employeeId: e.employeeId,
    date: e.date,
    checkIn: e.checkIn,
    checkOut: e.checkOut,
    workedMinutes: e.workedMinutes,
    status: e.status,
    notes: e.notes,
    createdAt: e.createdAt,
    updatedAt: e.updatedAt,
  };
}

function serializeLeavePolicy(p: LeavePolicy) {
  return {
    id: p.id,
    leaveType: p.leaveType,
    entitlementDays: p.entitlementDays.toString(),
    accrualFrequency: p.accrualFrequency,
    carryOver: p.carryOver,
    maxCarryOverDays: p.maxCarryOverDays?.toString() ?? null,
    payoutOnTermination: p.payoutOnTermination,
    legallyMandated: p.legallyMandated,
    presetCode: p.presetCode,
    active: p.active,
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
  };
}

function serializeLeaveBalance(b: LeaveBalance) {
  return {
    id: b.id,
    employeeId: b.employeeId,
    leaveType: b.leaveType,
    year: b.year,
    entitled: b.entitled.toString(),
    carriedOver: b.carriedOver.toString(),
    used: b.used.toString(),
    available: availableLeaveDays(b).toString(),
    createdAt: b.createdAt,
    updatedAt: b.updatedAt,
  };
}

function serializeAccrualBatch(batch: LeaveAccrualBatch) {
  return {
    id: batch.id,
    number: batch.number,
    periodKey: batch.periodKey,
    frequency: batch.frequency,
    runType: batch.runType,
    runDate: batch.runDate,
    notes: batch.notes,
    employeeCount: batch.employeeCount,
    totalDays: batch.totalDays.toString(),
    lines: batch.lines.map((l) => ({ employeeId: l.employeeId, leaveType: l.leaveType, days: l.days.toString() })),
    runBy: batch.runBy,
    createdAt: batch.createdAt,
  };
}

function serializeLeaveRequest(r: LeaveRequest) {
  return {
    id: r.id,
    number: r.number,
    employeeId: r.employeeId,
    leaveType: r.leaveType,
    halfDay: r.halfDay,
    startDate: r.startDate,
    endDate: r.endDate,
    days: r.days,
    reason: r.reason,
    status: r.status,
    createdAt: r.createdAt,
    decidedAt: r.decidedAt,
    decidedBy: r.decidedBy,
  };
}

function handleTimeLeaveError(c: Context, err: unknown): Response {
  if (
    err instanceof AttendanceEntryNotFoundError ||
    err instanceof LeavePolicyNotFoundError ||
    err instanceof LeaveRequestNotFoundError ||
    err instanceof EmployeeNotFoundError
  ) {
    return c.json({ error: err.code, message: err.message }, 404);
  }
  if (err instanceof DuplicateAttendanceEntryError || err instanceof DuplicateLeavePolicyError) {
    return c.json({ error: err.code, message: err.message }, 409);
  }
  if (
    err instanceof InvalidAttendanceEntryError ||
    err instanceof InvalidLeavePolicyError ||
    err instanceof InvalidLeaveBalanceError ||
    err instanceof InvalidLeaveAccrualBatchError ||
    err instanceof InvalidLeaveRequestTransitionError ||
    err instanceof LeaveBalanceExceededError ||
    err instanceof UnknownLeavePolicyPresetError
  ) {
    return c.json({ error: err.code, message: err.message }, 422);
  }
  throw err;
}

/**
 * `x-role-codes` names the custom roles the caller holds — a gate step names an
 * approver ROLE, not a permission code. Same resolution `workflow-routes.ts`
 * uses; a tenant admin (`"*"`) bypasses every gate.
 */
const actorRoles = callerRoleCodes;

export function createHrTimeLeaveRoutes(deps: HrTimeLeaveRoutesDeps, resolveAuthContext: AuthContextResolver): Hono {
  const app = new Hono();
  const gate = createPermissionGate(resolveAuthContext);

  // --- Attendance ----------------------------------------------------------

  app.get("/attendance/summary", gate("hr.attendance.view"), async (c) => {
    const employeeId = c.req.query("employeeId");
    const from = c.req.query("from");
    const to = c.req.query("to");
    if (!employeeId || !from || !to) {
      return c.json({ error: "VALIDATION_ERROR", message: "employeeId و from و to مطلوبة." }, 400);
    }
    const entries = await deps.attendance.list({ employeeId, from, to });
    return c.json(summarizeAttendance(employeeId, from, to, entries));
  });

  app.get("/attendance", gate("hr.attendance.view"), async (c) => {
    const statusParam = c.req.query("status");
    const entries = await deps.attendance.list({
      employeeId: c.req.query("employeeId") ?? null,
      from: c.req.query("from") ?? null,
      to: c.req.query("to") ?? null,
      status: (statusParam as AttendanceStatus | undefined) ?? null,
    });
    return c.json(entries.map(serializeAttendance));
  });

  app.post("/attendance", gate("hr.attendance.edit"), async (c) => {
    const parsed = recordAttendanceSchema.safeParse(await c.req.json());
    if (!parsed.success) return c.json({ error: "VALIDATION_ERROR", details: parsed.error.flatten() }, 400);
    try {
      const employee = await deps.employees.findById(parsed.data.employeeId);
      if (!employee) throw new EmployeeNotFoundError(parsed.data.employeeId);
      const existing = await deps.attendance.findByEmployeeAndDate(parsed.data.employeeId, parsed.data.date);
      if (existing) throw new DuplicateAttendanceEntryError(parsed.data.employeeId, parsed.data.date);

      const [holidays, leaveRequests] = await Promise.all([
        deps.holidays.list(),
        deps.leaveRequests.listByEmployeeId(parsed.data.employeeId),
      ]);
      const entry = recordAttendance({
        ...parsed.data,
        id: parsed.data.id ?? randomUUID(),
        status: parsed.data.status ?? null,
        holidays,
        onApprovedLeave: isOnApprovedLeave(leaveRequests, parsed.data.employeeId, parsed.data.date),
      });
      await deps.attendance.create(entry);
      return c.json(serializeAttendance(entry), 201);
    } catch (err) {
      return handleTimeLeaveError(c, err);
    }
  });

  app.put("/attendance/:id", gate("hr.attendance.edit"), async (c) => {
    const current = await deps.attendance.findById(c.req.param("id"));
    if (!current) return c.json({ error: "ATTENDANCE_ENTRY_NOT_FOUND" }, 404);
    const parsed = correctAttendanceSchema.safeParse(await c.req.json());
    if (!parsed.success) return c.json({ error: "VALIDATION_ERROR", details: parsed.error.flatten() }, 400);
    try {
      const [holidays, leaveRequests] = await Promise.all([deps.holidays.list(), deps.leaveRequests.listByEmployeeId(current.employeeId)]);
      const next = correctAttendance(current, {
        ...parsed.data,
        status: parsed.data.status ?? null,
        holidays,
        onApprovedLeave: isOnApprovedLeave(leaveRequests, current.employeeId, current.date),
      });
      await deps.attendance.update(next);
      return c.json(serializeAttendance(next));
    } catch (err) {
      return handleTimeLeaveError(c, err);
    }
  });

  // --- Leave policies ------------------------------------------------------

  app.get("/leave-policies/presets", gate("hr.leave_policy.view"), (c) => {
    return c.json(LEAVE_POLICY_PRESETS);
  });

  app.get("/leave-policies", gate("hr.leave_policy.view"), async (c) => {
    return c.json((await deps.leavePolicies.list()).map(serializeLeavePolicy));
  });

  app.post("/leave-policies", gate("hr.leave_policy.edit"), async (c) => {
    const parsed = createLeavePolicySchema.safeParse(await c.req.json());
    if (!parsed.success) return c.json({ error: "VALIDATION_ERROR", details: parsed.error.flatten() }, 400);
    try {
      const duplicate = await deps.leavePolicies.findByLeaveType(parsed.data.leaveType);
      if (duplicate) throw new DuplicateLeavePolicyError(parsed.data.leaveType);
      const policy = createLeavePolicy({
        ...parsed.data,
        id: parsed.data.id ?? randomUUID(),
        entitlementDays: Qty.fromMajor(parsed.data.entitlementDays),
        maxCarryOverDays: parsed.data.maxCarryOverDays ? Qty.fromMajor(parsed.data.maxCarryOverDays) : null,
      });
      await deps.leavePolicies.create(policy);
      return c.json(serializeLeavePolicy(policy), 201);
    } catch (err) {
      return handleTimeLeaveError(c, err);
    }
  });

  app.put("/leave-policies/:id", gate("hr.leave_policy.edit"), async (c) => {
    const current = await deps.leavePolicies.findById(c.req.param("id"));
    if (!current) return c.json({ error: "LEAVE_POLICY_NOT_FOUND" }, 404);
    const parsed = updateLeavePolicySchema.safeParse(await c.req.json());
    if (!parsed.success) return c.json({ error: "VALIDATION_ERROR", details: parsed.error.flatten() }, 400);
    try {
      const { entitlementDays, maxCarryOverDays, ...rest } = parsed.data;
      const next = updateLeavePolicy(current, {
        ...rest,
        ...(entitlementDays === undefined ? {} : { entitlementDays: Qty.fromMajor(entitlementDays) }),
        ...(maxCarryOverDays === undefined ? {} : { maxCarryOverDays: maxCarryOverDays === null ? null : Qty.fromMajor(maxCarryOverDays) }),
      });
      await deps.leavePolicies.update(next);
      return c.json(serializeLeavePolicy(next));
    } catch (err) {
      return handleTimeLeaveError(c, err);
    }
  });

  app.delete("/leave-policies/:id", gate("hr.leave_policy.edit"), async (c) => {
    const current = await deps.leavePolicies.findById(c.req.param("id"));
    if (!current) return c.json({ error: "LEAVE_POLICY_NOT_FOUND" }, 404);
    await deps.leavePolicies.remove(current.id);
    return c.json({ ok: true });
  });

  app.post("/leave-policies/apply-preset", gate("hr.leave_policy.apply_preset"), async (c) => {
    const parsed = applyLeavePolicyPresetSchema.safeParse(await c.req.json());
    if (!parsed.success) return c.json({ error: "VALIDATION_ERROR", details: parsed.error.flatten() }, 400);
    try {
      const existing = await deps.leavePolicies.list();
      const { created, updated } = applyLeavePolicyPreset(parsed.data.presetCode, existing, () => randomUUID());
      for (const policy of created) await deps.leavePolicies.create(policy);
      for (const policy of updated) await deps.leavePolicies.update(policy);
      return c.json((await deps.leavePolicies.list()).map(serializeLeavePolicy));
    } catch (err) {
      return handleTimeLeaveError(c, err);
    }
  });

  // --- Leave balances ------------------------------------------------------

  app.get("/leave-balances", gate("hr.leave.view"), async (c) => {
    const yearParam = c.req.query("year");
    const leaveType = c.req.query("leaveType");
    const balances = await deps.leaveBalances.list({
      employeeId: c.req.query("employeeId") ?? null,
      leaveType: (leaveType as LeaveType | undefined) ?? null,
      year: yearParam ? Number(yearParam) : null,
    });
    return c.json(balances.map(serializeLeaveBalance));
  });

  app.post("/leave-balances", gate("hr.leave_policy.edit"), async (c) => {
    const parsed = upsertLeaveBalanceSchema.safeParse(await c.req.json());
    if (!parsed.success) return c.json({ error: "VALIDATION_ERROR", details: parsed.error.flatten() }, 400);
    try {
      const employee = await deps.employees.findById(parsed.data.employeeId);
      if (!employee) throw new EmployeeNotFoundError(parsed.data.employeeId);
      const patch = {
        ...(parsed.data.entitled === undefined ? {} : { entitled: Qty.fromMajor(parsed.data.entitled) }),
        ...(parsed.data.carriedOver === undefined ? {} : { carriedOver: Qty.fromMajor(parsed.data.carriedOver) }),
        ...(parsed.data.used === undefined ? {} : { used: Qty.fromMajor(parsed.data.used) }),
      };
      const existing = await deps.leaveBalances.find(parsed.data.employeeId, parsed.data.leaveType, parsed.data.year);
      if (existing) {
        const next = { ...existing, ...patch, updatedAt: new Date().toISOString() };
        await deps.leaveBalances.update(next);
        return c.json(serializeLeaveBalance(next));
      }
      const created = createLeaveBalance({
        id: randomUUID(),
        employeeId: parsed.data.employeeId,
        leaveType: parsed.data.leaveType,
        year: parsed.data.year,
        ...patch,
      });
      await deps.leaveBalances.create(created);
      return c.json(serializeLeaveBalance(created), 201);
    } catch (err) {
      return handleTimeLeaveError(c, err);
    }
  });

  // --- Leave accrual batches -----------------------------------------------

  app.get("/leave-accrual-batches", gate("hr.leave_policy.view"), async (c) => {
    const runType = c.req.query("runType");
    const batches = await deps.leaveAccrualBatches.list({ runType: runType === "manual" || runType === "scheduled" ? runType : null });
    return c.json(batches.map(serializeAccrualBatch));
  });

  app.post("/leave-accrual-batches/run", gate("hr.leave_accrual.run"), async (c) => {
    const parsed = runLeaveAccrualSchema.safeParse(await c.req.json());
    if (!parsed.success) return c.json({ error: "VALIDATION_ERROR", details: parsed.error.flatten() }, 400);
    const ctx = getAuthContext(c);
    try {
      const { batch, created } = await runLeaveAccrual(
        {
          id: randomUUID(),
          number: (await deps.numbering.next("LEAVE_ACCRUAL_BATCH")).formatted,
          runDate: parsed.data.runDate,
          frequency: parsed.data.frequency ?? "monthly",
          runType: parsed.data.runType ?? "manual",
          notes: parsed.data.notes ?? null,
          runBy: ctx?.userId ?? null,
        },
        {
          batches: deps.leaveAccrualBatches,
          balances: deps.leaveBalances,
          policies: deps.leavePolicies,
          employees: createEmployeeDirectory(deps.employees),
          generateId: () => randomUUID(),
        },
      );
      return c.json({ batch: serializeAccrualBatch(batch), created }, created ? 201 : 200);
    } catch (err) {
      return handleTimeLeaveError(c, err);
    }
  });

  // --- Leave requests (admin surface) --------------------------------------

  app.get("/leave-requests/counts", gate("hr.leave.view"), async (c) => {
    const requests = await deps.leaveRequests.list();
    const count = (status: LeaveRequestStatus) => requests.filter((r) => r.status === status).length;
    return c.json({
      total: requests.length,
      pending: count("pending"),
      approved: count("approved"),
      rejected: count("rejected"),
      cancelled: count("cancelled"),
    });
  });

  app.get("/leave-requests", gate("hr.leave.view"), async (c) => {
    const status = c.req.query("status");
    const leaveType = c.req.query("leaveType");
    const requests = filterLeaveRequests(await deps.leaveRequests.list(), {
      employeeId: c.req.query("employeeId") ?? null,
      status: (status as LeaveRequestStatus | undefined) ?? null,
      leaveType: (leaveType as LeaveType | undefined) ?? null,
      from: c.req.query("from") ?? null,
      to: c.req.query("to") ?? null,
    });
    return c.json(requests.map(serializeLeaveRequest));
  });

  app.post("/leave-requests/:id/approve", gate("hr.leave.approve"), (c) => decide(c, "approved"));
  app.post("/leave-requests/:id/reject", gate("hr.leave.approve"), (c) => decide(c, "rejected"));

  async function decide(c: Context, fallbackDecision: "approved" | "rejected"): Promise<Response> {
    const current = await deps.leaveRequests.findById(c.req.param("id") ?? "");
    if (!current) return c.json({ error: "LEAVE_REQUEST_NOT_FOUND" }, 404);
    const body = await c.req.json().catch(() => ({}));
    const parsed = decideLeaveRequestSchema.safeParse({ decision: fallbackDecision, ...(body as object) });
    if (!parsed.success) return c.json({ error: "VALIDATION_ERROR", details: parsed.error.flatten() }, 400);

    const ctx = getAuthContext(c);
    if (!ctx) return c.json({ error: "UNAUTHENTICATED" }, 401);

    try {
      const outcome = await walkGate(c, current, parsed.data.decision, parsed.data.comment ?? undefined);
      if (outcome.kind === "held") {
        return c.json(
          {
            held: true,
            workflowRequestId: outcome.workflowRequestId,
            requiredRole: outcome.requiredRole,
            request: serializeLeaveRequest(current),
          },
          202,
        );
      }
      if (outcome.decision === "approved") {
        const year = Number(current.startDate.slice(0, 4));
        assertLeaveBalanceCovers(
          current.leaveType,
          current.days,
          await deps.leaveBalances.find(current.employeeId, current.leaveType, year),
        );
      }
      const next = decideLeaveRequest(current, outcome.decision, ctx.userId);
      await deps.leaveRequests.update(next);
      if (next.status === "approved") await consumeBalance(next);
      return c.json({ held: false, workflowRequestId: outcome.workflowRequestId, request: serializeLeaveRequest(next) });
    } catch (err) {
      if (err instanceof ApprovalRequestNotFoundError) return c.json({ error: err.code, message: err.message }, 404);
      if (err instanceof WorkflowError) return c.json({ error: err.code, message: err.message }, 409);
      return handleTimeLeaveError(c, err);
    }
  }

  type GateOutcome =
    | { kind: "decided"; decision: "approved" | "rejected"; workflowRequestId: string | null }
    | { kind: "held"; workflowRequestId: string; requiredRole: string | null };

  /**
   * Walks the configured approval chain for this leave type. With no chain (or
   * an admin actor) the decision applies immediately, exactly as
   * `createDocumentWorkflowGate` grants an unconfigured document confirm.
   */
  async function walkGate(c: Context, request: LeaveRequest, decision: "approved" | "rejected", comment?: string): Promise<GateOutcome> {
    const workflow = deps.workflow;
    if (!workflow) return { kind: "decided", decision, workflowRequestId: null };

    const roles = actorRoles(c);
    const ctx = getAuthContext(c);
    const actionType = leaveApprovalActionType(request.leaveType);
    const config = (await workflow.configs.findByActionType(actionType)) ?? (await workflow.configs.findByActionType("HR_LEAVE_APPROVE_ALL"));
    const steps = config?.steps ?? [];
    if (steps.length === 0 || roles.includes("*")) return { kind: "decided", decision, workflowRequestId: null };

    const workflowRequestId = `${request.id}:approve`;
    const existing = await workflow.requests.findById(workflowRequestId);
    if (!existing) {
      await submitApproval(
        {
          requestId: workflowRequestId,
          actionType,
          submittedBy: ctx?.userId ?? "system",
          submitterRoles: roles,
          entityLabel: `طلب إجازة ${request.number}`,
        },
        { actionType, steps },
        workflow.requests,
      );
    }

    const record = await decideApproval(
      workflowRequestId,
      { actorId: ctx?.userId ?? "system", actorRoles: roles, decision: decision === "approved" ? "approve" : "reject", comment },
      workflow.requests,
    );
    if (record.status === "approved") return { kind: "decided", decision: "approved", workflowRequestId };
    if (record.status === "rejected") return { kind: "decided", decision: "rejected", workflowRequestId };
    return { kind: "held", workflowRequestId, requiredRole: record.steps[record.currentStep]?.role ?? null };
  }

  async function consumeBalance(request: LeaveRequest): Promise<void> {
    const year = Number(request.startDate.slice(0, 4));
    const days = Qty.fromMajor(String(request.days));
    const existing = await deps.leaveBalances.find(request.employeeId, request.leaveType, year);
    if (existing) {
      await deps.leaveBalances.update({ ...existing, used: existing.used.add(days), updatedAt: new Date().toISOString() });
      return;
    }
    await deps.leaveBalances.create(
      createLeaveBalance({ id: randomUUID(), employeeId: request.employeeId, leaveType: request.leaveType, year, used: days }),
    );
  }

  return app;
}
