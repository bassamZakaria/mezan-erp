import { BranchRecordKind, BranchRefusalCode, branchRefusal, recordInBranchGrant, recordsInBranchGrant } from "./branch-policy.js";
import { randomUUID } from "node:crypto";
import { Hono, type Context } from "hono";
import {
  Qty,
  applyLeavePolicyPreset,
  availableLeaveDays,
  buildAttendanceImportPreview,
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
  parseAttendanceDeviceCsv,
  recordAttendance,
  runLeaveAccrual,
  submitApproval,
  summarizeAttendance,
  summarizeWorkforceAttendance,
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
  type AttendanceImportDayGroup,
  type AttendanceRepository,
  type AttendanceStatus,
  type ApprovalRequestRepository,
  type AuditSink,
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
  attendanceImportRequestSchema,
  correctAttendanceSchema,
  createLeavePolicySchema,
  decideLeaveRequestSchema,
  recordAttendanceSchema,
  runLeaveAccrualSchema,
  updateLeavePolicySchema,
  upsertLeaveBalanceSchema,
} from "@mezan/contracts";
import { type AuthContextResolver, callerRoleCodes, createPermissionGate, getAuthContext } from "./permission-gate.js";
import { recordAdminEvent } from "./admin-audit.js";
import { duplicateIdRefusal } from "./duplicate-id.js";
import { DuplicateRecordIdError } from "@mezan/domain";

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
  /** Best-effort forensic trail for the attendance-device import commit; absent sink writes nothing rather than failing the request. */
  readonly audit?: AuditSink;
}

export function serializeAttendance(e: AttendanceEntry) {
  return {
    id: e.id,
    employeeId: e.employeeId,
    date: e.date,
    checkIn: e.checkIn,
    checkOut: e.checkOut,
    workedMinutes: e.workedMinutes,
    approvedOvertimeMinutes: e.approvedOvertimeMinutes,
    holidayCompensation: e.holidayCompensation,
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

function withMessageEn(err: { readonly code: string; readonly message: string; readonly messageEn?: string }) {
  return { error: err.code, message: err.message, ...(err.messageEn ? { messageEn: err.messageEn } : {}) };
}

function handleTimeLeaveError(c: Context, err: unknown): Response {
  if (err instanceof DuplicateRecordIdError) return duplicateIdRefusal(c, err);
  if (
    err instanceof AttendanceEntryNotFoundError ||
    err instanceof LeavePolicyNotFoundError ||
    err instanceof LeaveRequestNotFoundError ||
    err instanceof EmployeeNotFoundError
  ) {
    return c.json(withMessageEn(err), 404);
  }
  if (err instanceof DuplicateAttendanceEntryError || err instanceof DuplicateLeavePolicyError) {
    return c.json(withMessageEn(err), 409);
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
    return c.json(withMessageEn(err), 422);
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
    if (!from || !to) {
      return c.json({ error: "VALIDATION_ERROR", message: "from و to مطلوبتان." }, 400);
    }
    // No employee named = the WHOLE workforce. The screen's summary tiles used
    // to render `?? 0` in that state, so four zeros sat above a table of forty
    // present days: a plausible figure where the honest one was available.
    if (!employeeId) {
      const entries = await recordsInBranchGrant(c, BranchRecordKind.Attendance, await deps.attendance.list({ from, to }), (entry) => entry.id);
      const workforce = summarizeWorkforceAttendance(from, to, entries);
      return c.json({
        employeeId: null,
        from,
        to,
        workingDays: workforce.workingDays,
        daysPresent: workforce.daysPresent,
        daysLate: workforce.daysLate,
        daysAbsent: workforce.daysAbsent,
        halfDays: workforce.halfDays,
        daysOnLeave: workforce.daysOnLeave,
        holidays: 0,
        weeklyOffDays: 0,
        workedMinutes: entries.reduce((sum, entry) => sum + entry.workedMinutes, 0),
        // The screen shows an attendance rate; the workforce summary computes
        // its complement, so it is derived here rather than left blank.
        attendanceRatePercent: 100 - workforce.absenceRatePercent,
      });
    }
    if (!(await recordInBranchGrant(c, BranchRecordKind.Employee, employeeId))) return branchRefusal(c, BranchRefusalCode.NotFound);
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

  // --- Attendance-device CSV import -----------------------------------------

  function importNoteFor(group: AttendanceImportDayGroup): string {
    return group.device ? `مستورد من جهاز البصمة (${group.device})` : "مستورد من جهاز البصمة";
  }

  /**
   * Shared preview/commit core. Preview is a pure dry-run (no persistence at
   * all); commit replays every ready group through the SAME `recordAttendance`
   * domain function the manual form uses — never approving overtime and never
   * setting a shift baseline (D187: an import never invents an approval) — and
   * is idempotent per (employee, date): a group already recorded (checked both
   * in the preview snapshot AND again right before each create, since commit
   * can run well after preview) is skipped, never duplicated or overwritten.
   */
  async function runAttendanceImport(c: Context, commit: boolean): Promise<Response> {
    const parsedBody = attendanceImportRequestSchema.safeParse(await c.req.json().catch(() => ({})));
    if (!parsedBody.success) return c.json({ error: "VALIDATION_ERROR", details: parsedBody.error.flatten() }, 400);

    const { punches, errors: parseErrors } = parseAttendanceDeviceCsv(parsedBody.data.csv);

    const employees = await deps.employees.list();
    const employeeIdByBadge = new Map<string, string>();
    for (const employee of employees) {
      if (employee.deviceBadgeId) employeeIdByBadge.set(employee.deviceBadgeId, employee.id);
    }

    let existingEntryKeys = new Set<string>();
    if (punches.length > 0) {
      const dates = punches.map((p) => p.date).sort();
      const from = dates[0] as string;
      const to = dates[dates.length - 1] as string;
      const existing = await deps.attendance.list({ from, to });
      existingEntryKeys = new Set(existing.map((e) => `${e.employeeId}|${e.date}`));
    }

    const preview = buildAttendanceImportPreview(punches, employeeIdByBadge, existingEntryKeys, parseErrors);

    if (!commit) return c.json(preview);

    const holidays = await deps.holidays.list();
    const leaveRequestsByEmployee = new Map<string, LeaveRequest[]>();
    let createdCount = 0;
    let skippedAlreadyRecordedCount = 0;

    for (const group of preview.groups) {
      if (group.issues.includes("already_recorded")) skippedAlreadyRecordedCount++;
      if (!group.readyToCommit || !group.employeeId) continue;

      // Re-checked at commit time: the preview snapshot can be stale by the
      // time the user confirms it (another import, or a manual edit, may have
      // landed in between).
      const existing = await deps.attendance.findByEmployeeAndDate(group.employeeId, group.date);
      if (existing) {
        skippedAlreadyRecordedCount++;
        continue;
      }

      let leaveRequests = leaveRequestsByEmployee.get(group.employeeId);
      if (!leaveRequests) {
        leaveRequests = await deps.leaveRequests.listByEmployeeId(group.employeeId);
        leaveRequestsByEmployee.set(group.employeeId, leaveRequests);
      }

      try {
        const entry = recordAttendance({
          id: randomUUID(),
          employeeId: group.employeeId,
          date: group.date,
          checkIn: group.checkIn,
          checkOut: group.checkOut,
          notes: importNoteFor(group),
          holidays,
          onApprovedLeave: isOnApprovedLeave(leaveRequests, group.employeeId, group.date),
        });
        await deps.attendance.create(entry);
        createdCount++;
      } catch {
        // A row the domain layer itself refuses (e.g. an unparseable time
        // that slipped past the CSV parser) is dropped from this commit
        // rather than aborting the whole batch — it still shows up as
        // "not ready" the next time the same file is previewed.
      }
    }

    await recordAdminEvent(deps.audit, c, {
      module: "hr",
      entityType: "attendance_import",
      entityId: null,
      action: "commit",
      details: {
        createdCount,
        skippedAlreadyRecordedCount,
        totalPunches: preview.totalPunches,
        unmatchedBadges: preview.unmatchedBadges,
      },
    });

    return c.json({ ...preview, createdCount, skippedAlreadyRecordedCount });
  }

  app.post("/attendance/import/preview", gate("hr.attendance.edit"), (c) => runAttendanceImport(c, false));
  app.post("/attendance/import/commit", gate("hr.attendance.edit"), (c) => runAttendanceImport(c, true));

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
    const requests = await recordsInBranchGrant(c, BranchRecordKind.LeaveRequest, await deps.leaveRequests.list(), (request) => request.id);
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
