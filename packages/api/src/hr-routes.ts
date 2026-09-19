import { randomUUID } from "node:crypto";
import { Hono, type Context } from "hono";
import {
  Money,
  Qty,
  can,
  releaseLeaveBalance,
  createDepartment,
  updateDepartment,
  createJobTitle,
  updateJobTitle,
  createEmployee,
  updateEmployee,
  transitionEmployee,
  terminateEmployee,
  rehireEmployee,
  createContract,
  terminateContract,
  isContractExpiringSoon,
  createHoliday,
  updateHoliday,
  listHolidaysForYear,
  createLeaveRequest,
  createUnpaidLeaveDaysProvider,
  advanceOutstanding,
  createOvertimeHoursProvider,
  createWorkedTimeProvider,
  employeeOvertimePolicy,
  calculateEndOfServiceSettlement,
  EmployeeStillEmployedError,
  StatutoryRulesUnavailableError,
  cancelLeaveRequest,
  summarizeWorkforceAttendance,
  LEAVE_TYPE_DEFINITIONS,
  DepartmentNotFoundError,
  InvalidDepartmentError,
  JobTitleNotFoundError,
  InvalidJobTitleError,
  EmployeeNotFoundError,
  InvalidEmployeeError,
  InvalidEmployeeTransitionError,
  ContractNotFoundError,
  InvalidContractError,
  ContractNotActiveError,
  HolidayNotFoundError,
  InvalidHolidayError,
  LeaveRequestNotFoundError,
  InvalidLeaveRequestError,
  InvalidLeaveRequestTransitionError,
  type Department,
  type DepartmentRepository,
  type JobTitle,
  type JobTitleRepository,
  type Employee,
  type EmployeeRepository,
  type Contract,
  type ContractRepository,
  type Holiday,
  type HolidayRepository,
  type LeaveRequest,
  type LeaveRequestRepository,
  type LeaveType,
  type UserRepository,
} from "@mezan/domain";
import {
  createDepartmentSchema,
  updateDepartmentSchema,
  createJobTitleSchema,
  updateJobTitleSchema,
  createEmployeeSchema,
  updateEmployeeSchema,
  transitionEmployeeSchema,
  rehireEmployeeSchema,
  createContractSchema,
  createHolidaySchema,
  updateHolidaySchema,
  createLeaveRequestSchema,
} from "@mezan/contracts";
import { createPermissionGate, getAuthContext, type AuthContextResolver, branchScopeOf, withinScope } from "./permission-gate.js";
import { createHrTimeLeaveRoutes, type HrTimeLeaveRoutesDeps } from "./hr-time-leave-routes.js";
import { createHrPayrollRoutes, type HrPayrollRoutesDeps } from "./hr-payroll-routes.js";

/**
 * The hr/time-leave stores are OPTIONAL here so the composition root can adopt
 * them in its own step: without them `createHrRoutes` simply does not mount the
 * attendance/leave-policy/balance/accrual/admin-leave surface.
 */
type HrTimeLeaveDeps = Pick<HrTimeLeaveRoutesDeps, "attendance" | "leavePolicies" | "leaveBalances" | "leaveAccrualBatches" | "workflow" | "audit">;

/**
 * The payroll/advance stores are OPTIONAL for the same reason: without them
 * `createHrRoutes` does not mount the الرواتب / سلف الموظفين surface. Employees,
 * contracts and numbering are reused from the master-data deps above.
 */
export type HrPayrollDeps = Omit<HrPayrollRoutesDeps, "employees" | "contracts" | "numbering">;

/**
 * HR master-data routes (docs/archive/catalog/06-crm-hr.md "الموارد البشرية" —
 * hr/master-data scope: departments, job titles, employees, contracts,
 * holidays, the دashboard, and the minimal leave-request slice backing
 * إجازاتي (My Leave). Paths are root-relative — mounted under `/hr` by the
 * parent app (`app.ts`).
 *
 * Holidays reuse `hr.leave_policy.*` (no dedicated "holiday" permission code
 * exists in the 36-permission `hr` catalog module — the calendar is
 * leave/attendance-adjacent config, same shape as `/settings/leave-policies`).
 */
export interface HrRoutesDeps extends Partial<HrTimeLeaveDeps> {
  /** Payroll runs, payslips and employee advances (docs/archive/catalog/06 §"الرواتب"/"سلف الموظفين"). */
  readonly payroll?: HrPayrollDeps;
  readonly departments: DepartmentRepository;
  readonly jobTitles: JobTitleRepository;
  readonly employees: EmployeeRepository;
  readonly contracts: ContractRepository;
  readonly holidays: HolidayRepository;
  readonly leaveRequests: LeaveRequestRepository;
  readonly users: Pick<UserRepository, "findById">;
  /** Same shape as `NextNumberService.next(code)` (`packages/domain/src/numbering`) — the SQLite-backed engine slots straight in. */
  readonly numbering: { next(code: string): Promise<{ readonly formatted: string }> };
}

function serializeDepartment(d: Department) {
  return {
    id: d.id,
    code: d.code,
    name: d.name,
    nameAr: d.nameAr,
    parentDepartmentId: d.parentDepartmentId,
    managerId: d.managerId,
    overtimeEligible: d.overtimeEligible,
    standardWorkHours: d.standardWorkHours,
    active: d.active,
    createdAt: d.createdAt,
  };
}

function serializeJobTitle(j: JobTitle) {
  return {
    id: j.id,
    departmentId: j.departmentId,
    name: j.name,
    nameAr: j.nameAr,
    active: j.active,
    createdAt: j.createdAt,
  };
}

function serializeEmployee(e: Employee) {
  return {
    id: e.id,
    code: e.code,
    firstName: e.firstName,
    lastName: e.lastName,
    firstNameAr: e.firstNameAr,
    lastNameAr: e.lastNameAr,
    email: e.email,
    phone: e.phone,
    birthDate: e.birthDate,
    nationalId: e.nationalId,
    gender: e.gender,
    maritalStatus: e.maritalStatus,
    departmentId: e.departmentId,
    jobTitleId: e.jobTitleId,
    managerId: e.managerId,
    branchId: e.branchId,
    hireDate: e.hireDate,
    workerCategory: e.workerCategory,
    employmentType: e.employmentType,
    overtimeEligibility: e.overtimeEligibility,
    standardWorkHours: e.standardWorkHours,
    probationEndDate: e.probationEndDate,
    priorServiceYears: e.priorServiceYears,
    requireSelfieAtClockIn: e.requireSelfieAtClockIn,
    requireBiometricAtClockIn: e.requireBiometricAtClockIn,
    deviceBadgeId: e.deviceBadgeId,
    hasPensionEntitlement: e.hasPensionEntitlement,
    taxDisabilityExemption: e.taxDisabilityExemption,
    address: e.address,
    emergencyContact: e.emergencyContact,
    status: e.status,
    terminatedAt: e.terminatedAt,
    createdAt: e.createdAt,
  };
}

/**
 * `withSalary` is `hr.employee.view_salary`, which the catalog flags ⚠ sensitive
 * and which no route used to consult: `hr.contract.view` alone returned every
 * colleague's pay (D31). The pay fields are OMITTED rather than nulled — a null
 * still tells the caller what it is not being shown.
 */
function serializeContract(c: Contract, withSalary = true) {
  return {
    id: c.id,
    number: c.number,
    employeeId: c.employeeId,
    type: c.type,
    payBasis: c.payBasis,
    payFrequency: c.payFrequency,
    startDate: c.startDate,
    endDate: c.endDate,
    ...(withSalary
      ? {
          monthlySalary: c.monthlySalary.toString(),
          allowances: c.allowances.map((a) => ({ id: a.id, name: a.name, amount: a.amount.toString() })),
          deductions: c.deductions.map((d) => ({ id: d.id, name: d.name, amount: d.amount.toString() })),
        }
      : {}),
    currency: c.currency,
    leaveEntitlement: c.leaveEntitlement,
    allowances: c.allowances.map((a) => ({ id: a.id, name: a.name, amount: a.amount.toString(), componentId: a.componentId })),
    deductions: c.deductions.map((d) => ({ id: d.id, name: d.name, amount: d.amount.toString(), componentId: d.componentId })),
    status: c.status,
    /** Derived server-side so the 30-day window lives in one place (domain `CONTRACT_EXPIRING_SOON_WINDOW_DAYS`). */
    expiringSoon: isContractExpiringSoon(c),
    terminatedAt: c.terminatedAt,
    createdAt: c.createdAt,
  };
}

function serializeHoliday(h: Holiday) {
  return {
    id: h.id,
    date: h.date,
    nameEn: h.nameEn,
    nameAr: h.nameAr,
    recurringAnnual: h.recurringAnnual,
    createdAt: h.createdAt,
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

function handleDomainError(c: Context, err: unknown): Response {
  if (
    err instanceof DepartmentNotFoundError ||
    err instanceof JobTitleNotFoundError ||
    err instanceof EmployeeNotFoundError ||
    err instanceof ContractNotFoundError ||
    err instanceof HolidayNotFoundError ||
    err instanceof LeaveRequestNotFoundError
  ) {
    return c.json(withMessageEn(err), 404);
  }
  if (
    err instanceof InvalidDepartmentError ||
    err instanceof InvalidJobTitleError ||
    err instanceof InvalidEmployeeError ||
    err instanceof InvalidEmployeeTransitionError ||
    err instanceof InvalidContractError ||
    err instanceof ContractNotActiveError ||
    err instanceof InvalidHolidayError ||
    err instanceof InvalidLeaveRequestError ||
    err instanceof InvalidLeaveRequestTransitionError
  ) {
    return c.json(withMessageEn(err), 422);
  }
  throw err;
}

/** Resolves the employee id linked to the calling user's account, or null (My Leave self-service gate). */
async function resolveCallerEmployeeId(c: Context, deps: HrRoutesDeps): Promise<string | null> {
  const ctx = getAuthContext(c);
  if (!ctx) return null;
  const user = await deps.users.findById(ctx.userId);
  return user?.employeeId ?? null;
}

export function createHrRoutes(deps: HrRoutesDeps, resolveAuthContext: AuthContextResolver): Hono {
  const app = new Hono();
  const gate = createPermissionGate(resolveAuthContext);
  const maySeeSalary = (c: Context) => {
    const ctx = getAuthContext(c);
    return ctx ? can(ctx, "hr.employee.view_salary") : false;
  };

  // --- Dashboard -----------------------------------------------------------

  app.get("/dashboard", gate("hr.employee.view"), async (c) => {
    const [employees, departments, contracts] = await Promise.all([deps.employees.list(), deps.departments.list(), deps.contracts.list()]);
    const now = new Date();
    const monthPrefix = now.toISOString().slice(0, 7);

    const activeEmployees = employees.filter((e) => e.status === "active").length;
    const onLeave = employees.filter((e) => e.status === "on_leave").length;
    const hiresThisMonth = employees.filter((e) => e.hireDate.startsWith(monthPrefix)).length;
    const terminationsThisMonth = employees.filter((e) => e.status === "terminated" && (e.terminatedAt ?? "").startsWith(monthPrefix)).length;
    const contractsExpiringSoon = contracts.filter((ct) => isContractExpiringSoon(ct, now)).length;
    const probationEndingSoonWindowMs = 30 * 24 * 60 * 60 * 1000;
    const probationEndingSoon = employees.filter((e) => {
      if (!e.probationEndDate || e.status !== "active") return false;
      const end = new Date(`${e.probationEndDate}T00:00:00Z`).getTime();
      const diff = end - now.getTime();
      return diff >= 0 && diff <= probationEndingSoonWindowMs;
    }).length;

    const byDepartmentMap = new Map<string, number>();
    for (const e of employees) {
      if (!e.departmentId || e.status === "terminated") continue;
      byDepartmentMap.set(e.departmentId, (byDepartmentMap.get(e.departmentId) ?? 0) + 1);
    }
    const departmentsById = new Map(departments.map((d) => [d.id, d]));
    const byDepartment = [...byDepartmentMap.entries()].map(([departmentId, count]) => ({
      departmentId,
      departmentName: departmentsById.get(departmentId)?.name ?? departmentId,
      departmentNameAr: departmentsById.get(departmentId)?.nameAr ?? null,
      count,
    }));

    const byBranchMap = new Map<string, number>();
    for (const e of employees) {
      if (e.status === "terminated") continue;
      byBranchMap.set(e.branchId, (byBranchMap.get(e.branchId) ?? 0) + 1);
    }
    const byBranch = [...byBranchMap.entries()].map(([branchId, count]) => ({ branchId, count }));

    const leaveRequests = await deps.leaveRequests.list();
    const year = now.getUTCFullYear();
    const balances = (await deps.leaveBalances?.list({ year })) ?? [];
    const leaveTypes: LeaveType[] = LEAVE_TYPE_DEFINITIONS.map((d) => d.code);
    const leaveConsumption = leaveTypes.map((leaveType) => {
      const forType = leaveRequests.filter((r) => r.leaveType === leaveType);
      const balanceRows = balances.filter((b) => b.leaveType === leaveType);
      // Entitlement is the accrual sub-ledger's figure, never the request log's:
      // days can be taken against a balance no request ever asked for.
      const entitled = balanceRows.length === 0 ? null : balanceRows.reduce((sum, b) => sum + Number(b.entitled.add(b.carriedOver).toString()), 0);
      const used = forType.filter((r) => r.status === "approved").reduce((sum, r) => sum + r.days, 0);
      const pending = forType.filter((r) => r.status === "pending").reduce((sum, r) => sum + r.days, 0);
      return {
        leaveType,
        entitled,
        used,
        pending,
        usedPercent: entitled === null || entitled === 0 ? null : Math.round((used / entitled) * 100),
      };
    });

    // Headcount movement over the trailing 12 months, from the employee record's
    // own hire/termination dates — the dashboard's اتجاه القوى العاملة chart.
    const headcountTrend: Array<{ month: string; hires: number; leavers: number }> = [];
    for (let offset = 11; offset >= 0; offset -= 1) {
      const cursor = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - offset, 1));
      const key = cursor.toISOString().slice(0, 7);
      headcountTrend.push({
        month: key,
        hires: employees.filter((e) => e.hireDate.startsWith(key)).length,
        leavers: employees.filter((e) => (e.terminatedAt ?? "").startsWith(key)).length,
      });
    }

    const attendanceWindowDays = 30;
    const windowEnd = now.toISOString().slice(0, 10);
    const windowStart = new Date(now.getTime() - attendanceWindowDays * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const attendanceEntries = (await deps.attendance?.list({ from: windowStart, to: windowEnd })) ?? [];
    const attendance = summarizeWorkforceAttendance(windowStart, windowEnd, attendanceEntries);

    return c.json({
      activeEmployees,
      onLeave,
      hiresThisMonth,
      terminationsThisMonth,
      contractsExpiringSoon,
      probationEndingSoon,
      byDepartment,
      byBranch,
      leaveConsumption,
      headcountTrend,
      attendance: {
        from: attendance.from,
        to: attendance.to,
        workingDays: attendance.workingDays,
        daysPresent: attendance.daysPresent,
        daysLate: attendance.daysLate,
        halfDays: attendance.halfDays,
        daysAbsent: attendance.daysAbsent,
        daysOnLeave: attendance.daysOnLeave,
        absenceRatePercent: attendance.absenceRatePercent,
        lateArrivalRatePercent: attendance.lateArrivalRatePercent,
      },
    });
  });

  // --- Departments -----------------------------------------------------------

  app.get("/departments", gate("hr.department.view"), async (c) => {
    return c.json((await deps.departments.list()).map(serializeDepartment));
  });

  app.post("/departments", gate("hr.department.create"), async (c) => {
    const parsed = createDepartmentSchema.safeParse(await c.req.json());
    if (!parsed.success) return c.json({ error: "VALIDATION_ERROR", details: parsed.error.flatten() }, 400);
    try {
      const department = await createDepartment({ ...parsed.data, id: parsed.data.id ?? randomUUID() }, deps.departments);
      return c.json(serializeDepartment(department), 201);
    } catch (err) {
      return handleDomainError(c, err);
    }
  });

  app.put("/departments/:id", gate("hr.department.edit"), async (c) => {
    const current = await deps.departments.findById(c.req.param("id"));
    if (!current) return c.json({ error: "DEPARTMENT_NOT_FOUND" }, 404);
    const parsed = updateDepartmentSchema.safeParse(await c.req.json());
    if (!parsed.success) return c.json({ error: "VALIDATION_ERROR", details: parsed.error.flatten() }, 400);
    try {
      const next = updateDepartment(current, parsed.data);
      await deps.departments.update(next);
      return c.json(serializeDepartment(next));
    } catch (err) {
      return handleDomainError(c, err);
    }
  });

  // --- Job Titles ----------------------------------------------------------

  app.get("/job-titles", gate("hr.job_title.view"), async (c) => {
    const departmentId = c.req.query("departmentId");
    const rows = departmentId ? await deps.jobTitles.listByDepartmentId(departmentId) : await deps.jobTitles.list();
    return c.json(rows.map(serializeJobTitle));
  });

  app.post("/job-titles", gate("hr.job_title.create"), async (c) => {
    const parsed = createJobTitleSchema.safeParse(await c.req.json());
    if (!parsed.success) return c.json({ error: "VALIDATION_ERROR", details: parsed.error.flatten() }, 400);
    try {
      const jobTitle = await createJobTitle({ ...parsed.data, id: parsed.data.id ?? randomUUID() }, deps.jobTitles);
      return c.json(serializeJobTitle(jobTitle), 201);
    } catch (err) {
      return handleDomainError(c, err);
    }
  });

  app.put("/job-titles/:id", gate("hr.job_title.edit"), async (c) => {
    const current = await deps.jobTitles.findById(c.req.param("id"));
    if (!current) return c.json({ error: "JOB_TITLE_NOT_FOUND" }, 404);
    const parsed = updateJobTitleSchema.safeParse(await c.req.json());
    if (!parsed.success) return c.json({ error: "VALIDATION_ERROR", details: parsed.error.flatten() }, 400);
    try {
      const next = updateJobTitle(current, parsed.data);
      await deps.jobTitles.update(next);
      return c.json(serializeJobTitle(next));
    } catch (err) {
      return handleDomainError(c, err);
    }
  });

  // --- Employees -----------------------------------------------------------

  app.get("/employees", gate("hr.employee.view"), async (c) => {
    return c.json(withinScope(await deps.employees.list(), branchScopeOf(c), (e) => e.branchId).map(serializeEmployee));
  });

  app.get("/employees/:id", gate("hr.employee.view"), async (c) => {
    const employee = await deps.employees.findById(c.req.param("id"));
    if (!employee) return c.json({ error: "EMPLOYEE_NOT_FOUND" }, 404);
    return c.json(serializeEmployee(employee));
  });

  app.get("/employees/:id/contracts", gate("hr.contract.view"), async (c) => {
    const withSalary = maySeeSalary(c);
    return c.json((await deps.contracts.listByEmployeeId(c.req.param("id"))).map((row) => serializeContract(row, withSalary)));
  });

  app.post("/employees", gate("hr.employee.create"), async (c) => {
    const parsed = createEmployeeSchema.safeParse(await c.req.json());
    if (!parsed.success) return c.json({ error: "VALIDATION_ERROR", details: parsed.error.flatten() }, 400);
    try {
      const id = parsed.data.id ?? randomUUID();
      const code = (await deps.numbering.next("EMPLOYEE")).formatted;
      const employee = await createEmployee({ ...parsed.data, id, code }, deps.employees);
      return c.json(serializeEmployee(employee), 201);
    } catch (err) {
      return handleDomainError(c, err);
    }
  });

  app.put("/employees/:id", gate("hr.employee.edit"), async (c) => {
    const current = await deps.employees.findById(c.req.param("id"));
    if (!current) return c.json({ error: "EMPLOYEE_NOT_FOUND" }, 404);
    const parsed = updateEmployeeSchema.safeParse(await c.req.json());
    if (!parsed.success) return c.json({ error: "VALIDATION_ERROR", details: parsed.error.flatten() }, 400);
    try {
      const next = updateEmployee(current, parsed.data);
      await deps.employees.update(next);
      return c.json(serializeEmployee(next));
    } catch (err) {
      return handleDomainError(c, err);
    }
  });

  app.post("/employees/:id/transition", gate("hr.employee.edit"), async (c) => {
    const current = await deps.employees.findById(c.req.param("id"));
    if (!current) return c.json({ error: "EMPLOYEE_NOT_FOUND" }, 404);
    const parsed = transitionEmployeeSchema.safeParse(await c.req.json());
    if (!parsed.success) return c.json({ error: "VALIDATION_ERROR", details: parsed.error.flatten() }, 400);
    try {
      const next = transitionEmployee(current, parsed.data.status);
      await deps.employees.update(next);
      return c.json(serializeEmployee(next));
    } catch (err) {
      return handleDomainError(c, err);
    }
  });

  app.post("/employees/:id/terminate", gate("hr.employee.terminate"), async (c) => {
    const current = await deps.employees.findById(c.req.param("id"));
    if (!current) return c.json({ error: "EMPLOYEE_NOT_FOUND" }, 404);
    try {
      const next = terminateEmployee(current);
      await deps.employees.update(next);
      return c.json(serializeEmployee(next));
    } catch (err) {
      return handleDomainError(c, err);
    }
  });

  /**
   * مستحقات نهاية الخدمة — the settlement statement for a terminated employee.
   *
   * A STATEMENT, not a posting: it computes gratuity, the payable leave balance
   * and outstanding advances so the figures can be checked before a voucher is
   * raised against them. Reading it changes nothing.
   */
  app.get("/employees/:id/end-of-service", gate("hr.payroll.view"), async (c) => {
    // A gratuity is a statutory figure: with the tenant's switch off it is not
    // computed at all, the same as tax and insurance on the payslip.
    if (!(await deps.payroll?.statutoryFlag?.get())?.enabled) {
      return c.json({ error: "STATUTORY_DISABLED", message: "احتساب المستحقات القانونية غير مفعّل لهذه المنشأة." }, 409);
    }
    const employee = await deps.employees.findById(c.req.param("id"));
    if (!employee) return c.json({ error: "EMPLOYEE_NOT_FOUND" }, 404);

    const contracts = await deps.contracts.listByEmployeeId(employee.id);
    // The last contract, running or terminated — an employee who has left has no
    // active one, so filtering to active would answer 409 for every real case.
    const contract = [...contracts].sort((a, b) => (a.startDate < b.startDate ? 1 : a.startDate > b.startDate ? -1 : 0))[0];
    if (!contract) return c.json({ error: "CONTRACT_NOT_FOUND", message: "لا يوجد عقد لهذا الموظف." }, 404);

    const lastWorkingDay = c.req.query("lastWorkingDay") ?? employee.terminatedAt?.slice(0, 10) ?? new Date().toISOString().slice(0, 10);

    const payableBalances = [];
    if (deps.leaveBalances && deps.leavePolicies) {
      const policies = await deps.leavePolicies.list();
      const payoutTypes = new Set(policies.filter((p) => p.payoutOnTermination && p.active).map((p) => p.leaveType));
      for (const balance of await deps.leaveBalances.list({ employeeId: employee.id })) {
        if (payoutTypes.has(balance.leaveType)) payableBalances.push(balance);
      }
    }

    let outstandingAdvances = Money.zero();
    if (deps.payroll?.advances) {
      for (const advance of await deps.payroll.advances.listByEmployeeId(employee.id)) {
        if (advance.status === "disbursed") outstandingAdvances = outstandingAdvances.add(advanceOutstanding(advance));
      }
    }

    try {
      const settlement = calculateEndOfServiceSettlement({
        employee,
        contract,
        lastWorkingDay,
        payableLeaveBalances: payableBalances,
        outstandingAdvances,
      });
      return c.json({
        employeeId: settlement.employeeId,
        lastWorkingDay: settlement.lastWorkingDay,
        currency: settlement.currency,
        serviceYears: settlement.serviceYears,
        priorServiceYears: settlement.priorServiceYears,
        settlementWage: settlement.settlementWage.toString(),
        allowancesIncluded: settlement.allowancesIncluded,
        gratuity: settlement.gratuity.gratuity.toString(),
        monthsEarned: settlement.gratuity.monthsEarned,
        gratuityBreakdown: settlement.gratuity.tierBreakdown.map((t) => ({
          labelAr: t.labelAr,
          years: t.years,
          monthsPerYear: t.monthsPerYear,
          amount: t.amount.toString(),
        })),
        leavePayoutDays: settlement.leavePayoutDays,
        leavePayout: settlement.leavePayout.toString(),
        outstandingAdvances: settlement.outstandingAdvances.toString(),
        netSettlement: settlement.netSettlement.toString(),
        advanceShortfall: settlement.advanceShortfall.toString(),
        statutoryTableCode: settlement.statutoryTableCode,
        citationAr: settlement.citationAr,
        verified: settlement.verified,
        gratuityEligible: settlement.gratuity.eligible,
        gratuityIneligibleReasonAr: settlement.gratuity.ineligibleReasonAr,
      });
    } catch (err) {
      if (err instanceof EmployeeStillEmployedError || err instanceof StatutoryRulesUnavailableError) {
        return c.json({ error: err.code, message: err.message }, 422);
      }
      return handleDomainError(c, err);
    }
  });

  app.post("/employees/:id/rehire", gate("hr.employee.create"), async (c) => {
    const current = await deps.employees.findById(c.req.param("id"));
    if (!current) return c.json({ error: "EMPLOYEE_NOT_FOUND" }, 404);
    const parsed = rehireEmployeeSchema.safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) return c.json({ error: "VALIDATION_ERROR", details: parsed.error.flatten() }, 400);
    try {
      const next = rehireEmployee(current, parsed.data.hireDate);
      await deps.employees.update(next);
      return c.json(serializeEmployee(next));
    } catch (err) {
      return handleDomainError(c, err);
    }
  });

  // --- Contracts -----------------------------------------------------------

  app.get("/contracts", gate("hr.contract.view"), async (c) => {
    const withSalary = maySeeSalary(c);
    return c.json((await deps.contracts.list()).map((row) => serializeContract(row, withSalary)));
  });

  app.get("/contracts/:id", gate("hr.contract.view"), async (c) => {
    const contract = await deps.contracts.findById(c.req.param("id"));
    if (!contract) return c.json({ error: "CONTRACT_NOT_FOUND" }, 404);
    return c.json(serializeContract(contract, maySeeSalary(c)));
  });

  app.post("/contracts", gate("hr.contract.create"), async (c) => {
    const parsed = createContractSchema.safeParse(await c.req.json());
    if (!parsed.success) return c.json({ error: "VALIDATION_ERROR", details: parsed.error.flatten() }, 400);
    try {
      const id = parsed.data.id ?? randomUUID();
      const number = (await deps.numbering.next("EMPLOYMENT_CONTRACT")).formatted;
      const contract = await createContract(
        {
          ...parsed.data,
          id,
          number,
          monthlySalary: Money.fromMajor(parsed.data.monthlySalary),
          allowances: parsed.data.allowances?.map((a) => ({ id: a.id ?? randomUUID(), name: a.name, amount: Money.fromMajor(a.amount), componentId: a.componentId ?? null })),
          deductions: parsed.data.deductions?.map((d) => ({ id: d.id ?? randomUUID(), name: d.name, amount: Money.fromMajor(d.amount), componentId: d.componentId ?? null })),
        },
        deps.contracts,
      );
      return c.json(serializeContract(contract), 201);
    } catch (err) {
      return handleDomainError(c, err);
    }
  });

  app.post("/contracts/:id/terminate", gate("hr.contract.edit"), async (c) => {
    const current = await deps.contracts.findById(c.req.param("id"));
    if (!current) return c.json({ error: "CONTRACT_NOT_FOUND" }, 404);
    try {
      const next = terminateContract(current);
      await deps.contracts.update(next);
      return c.json(serializeContract(next));
    } catch (err) {
      return handleDomainError(c, err);
    }
  });

  // --- Holidays (gated on hr.leave_policy.* — see HrRoutesDeps doc comment) --

  app.get("/holidays", gate("hr.leave_policy.view"), async (c) => {
    const yearParam = c.req.query("year");
    const all = await deps.holidays.list();
    if (!yearParam) return c.json(all.map(serializeHoliday));
    const year = Number(yearParam);
    return c.json(listHolidaysForYear(all, year).map(serializeHoliday));
  });

  app.post("/holidays", gate("hr.leave_policy.edit"), async (c) => {
    const parsed = createHolidaySchema.safeParse(await c.req.json());
    if (!parsed.success) return c.json({ error: "VALIDATION_ERROR", details: parsed.error.flatten() }, 400);
    try {
      const holiday = createHoliday({ ...parsed.data, id: parsed.data.id ?? randomUUID() });
      await deps.holidays.create(holiday);
      return c.json(serializeHoliday(holiday), 201);
    } catch (err) {
      return handleDomainError(c, err);
    }
  });

  app.put("/holidays/:id", gate("hr.leave_policy.edit"), async (c) => {
    const current = await deps.holidays.findById(c.req.param("id"));
    if (!current) return c.json({ error: "HOLIDAY_NOT_FOUND" }, 404);
    const parsed = updateHolidaySchema.safeParse(await c.req.json());
    if (!parsed.success) return c.json({ error: "VALIDATION_ERROR", details: parsed.error.flatten() }, 400);
    try {
      const next = updateHoliday(current, parsed.data);
      await deps.holidays.update(next);
      return c.json(serializeHoliday(next));
    } catch (err) {
      return handleDomainError(c, err);
    }
  });

  app.delete("/holidays/:id", gate("hr.leave_policy.edit"), async (c) => {
    const current = await deps.holidays.findById(c.req.param("id"));
    if (!current) return c.json({ error: "HOLIDAY_NOT_FOUND" }, 404);
    await deps.holidays.remove(c.req.param("id"));
    return c.json({ ok: true });
  });

  // --- Leave Requests (إجازاتي — My Leave self-service) ---------------------

  app.get("/leave-requests/me", gate("hr.leave.view"), async (c) => {
    const employeeId = await resolveCallerEmployeeId(c, deps);
    if (!employeeId) return c.json({ employeeId: null, requests: [] });
    const requests = await deps.leaveRequests.listByEmployeeId(employeeId);
    return c.json({ employeeId, requests: requests.map(serializeLeaveRequest) });
  });

  app.post("/leave-requests", gate("hr.leave.create"), async (c) => {
    const parsed = createLeaveRequestSchema.safeParse(await c.req.json());
    if (!parsed.success) return c.json({ error: "VALIDATION_ERROR", details: parsed.error.flatten() }, 400);

    const callerEmployeeId = await resolveCallerEmployeeId(c, deps);
    const onBehalfOf = parsed.data.employeeId ?? null;
    // Filing for someone else is a manager act, not self-service: `hr.leave.create`
    // alone only ever creates the caller's OWN request.
    const ctx = getAuthContext(c);
    if (onBehalfOf !== null && onBehalfOf !== callerEmployeeId && !(ctx !== undefined && can(ctx, "hr.leave.approve"))) {
      return c.json({ error: "PERMISSION_DENIED", permission: "hr.leave.approve", message: "لا يمكن تقديم طلب إجازة نيابة عن موظف آخر بدون صلاحية اعتماد الإجازات." }, 403);
    }
    const employeeId = onBehalfOf ?? callerEmployeeId;
    if (!employeeId) return c.json({ error: "USER_NOT_LINKED_TO_EMPLOYEE" }, 409);
    if (onBehalfOf !== null && !(await deps.employees.findById(onBehalfOf))) {
      return c.json({ error: "EMPLOYEE_NOT_FOUND", message: "الموظف غير موجود." }, 404);
    }

    try {
      const id = parsed.data.id ?? randomUUID();
      const number = (await deps.numbering.next("LEAVE_REQUEST")).formatted;
      const request = await createLeaveRequest({ ...parsed.data, id, number, employeeId }, deps.leaveRequests);
      return c.json(serializeLeaveRequest(request), 201);
    } catch (err) {
      return handleDomainError(c, err);
    }
  });

  app.post("/leave-requests/:id/cancel", gate("hr.leave.create"), async (c) => {
    const employeeId = await resolveCallerEmployeeId(c, deps);
    const current = await deps.leaveRequests.findById(c.req.param("id"));
    if (!current) return c.json({ error: "LEAVE_REQUEST_NOT_FOUND" }, 404);
    const ctx = getAuthContext(c);
    const isApprover = ctx !== undefined && can(ctx, "hr.leave.approve");
    if (!isApprover && (!employeeId || current.employeeId !== employeeId)) {
      return c.json({ error: "PERMISSION_DENIED", message: "لا يمكن إلغاء طلب إجازة موظف آخر." }, 403);
    }
    try {
      const wasApproved = current.status === "approved";
      const next = cancelLeaveRequest(current);
      await deps.leaveRequests.update(next);
      // Approval consumed the balance; cancelling has to give it back, or the
      // matrix keeps counting days that were never taken.
      if (wasApproved && deps.leaveBalances) {
        await releaseLeaveBalance(
          current.employeeId,
          current.leaveType,
          Number(current.startDate.slice(0, 4)),
          Qty.fromMajor(String(current.days)),
          deps.leaveBalances,
        );
      }
      return c.json(serializeLeaveRequest(next));
    } catch (err) {
      return handleDomainError(c, err);
    }
  });

  // --- Attendance / leave policies / balances / accrual / admin leave requests
  // (hr/time-leave, mounted here so every path stays under `/hr`) ------------

  const { attendance, leavePolicies, leaveBalances, leaveAccrualBatches } = deps;
  if (attendance && leavePolicies && leaveBalances && leaveAccrualBatches) {
    app.route("/", createHrTimeLeaveRoutes({ ...deps, attendance, leavePolicies, leaveBalances, leaveAccrualBatches }, resolveAuthContext));
  }

  // --- Payroll runs, payslips and employee advances (mounted here so every
  // path stays under `/hr`) --------------------------------------------------

  if (deps.payroll) {
    // Attendance turns clock times into payable overtime. The standard day, the
    // eligibility, the weekend and the holiday calendar are resolved per
    // employee per run, not captured here; each day is priced by the table in
    // force on that day.
    const attendanceRepo = deps.attendance;
    const holidaysRepo = deps.holidays;
    const settingsRepo = deps.payroll.settings;
    const resolveDerivationOptions = async (employeeId: string) => {
      const [settings, employee, holidays] = await Promise.all([settingsRepo?.get(), deps.employees.findById(employeeId), holidaysRepo.list()]);
      const department = employee?.departmentId ? await deps.departments.findById(employee.departmentId) : null;
      return {
        ...employeeOvertimePolicy(employee, department, settings?.standardDailyWorkHours ?? 8),
        requireApproval: true,
        weeklyOffDays: settings?.weekendDays,
        holidays,
      };
    };
    app.route(
      "/",
      createHrPayrollRoutes(
        {
          ...deps.payroll,
          employees: deps.employees,
          contracts: deps.contracts,
          numbering: deps.numbering,
          unpaidLeave: deps.payroll.unpaidLeave ?? createUnpaidLeaveDaysProvider(deps.leaveRequests),
          overtime:
            deps.payroll.overtime ??
            (attendanceRepo ? createOvertimeHoursProvider(attendanceRepo, resolveDerivationOptions) : undefined),
          workedTime:
            deps.payroll.workedTime ??
            (attendanceRepo ? createWorkedTimeProvider(attendanceRepo, deps.leaveRequests, resolveDerivationOptions) : undefined),
          leave:
            deps.payroll.leave ?? (deps.leaveBalances && deps.leavePolicies ? { balances: deps.leaveBalances, policies: deps.leavePolicies } : undefined),
        },
        resolveAuthContext,
      ),
    );
  }

  return app;
}
