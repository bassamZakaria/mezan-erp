import { describe, it, expect, afterEach } from "vitest";
import {
  createSqliteDepartmentRepository,
  createSqliteJobTitleRepository,
  createSqliteEmployeeRepository,
  createSqliteContractRepository,
  createSqliteHolidayRepository,
  createSqliteLeaveRequestRepository,
  createSqliteAttendanceRepository,
  createSqliteLeavePolicyRepository,
  createSqliteLeaveBalanceRepository,
  createSqliteLeaveAccrualBatchRepository,
} from "@mezan/persistence";
import { Qty, type User, type UserRepository } from "@mezan/domain";
import { createHrRoutes, type HrRoutesDeps } from "./hr-routes.js";

const handles: { close(): void }[] = [];
afterEach(() => {
  for (const h of handles.splice(0)) h.close();
});

function fakeUsers(users: User[]): Pick<UserRepository, "findById"> {
  return {
    async findById(id) {
      return users.find((u) => u.id === id) ?? null;
    },
  };
}

function fakeUser(overrides: Partial<User> = {}): User {
  return {
    id: "user-1",
    nameAr: "Test User",
    nameEn: null,
    email: "test@example.com",
    phone: null,
    passwordHash: "x",
    pinHash: null,
    roleId: null,
    isCompanyAdmin: false,
    employeeId: null,
    branchScope: "*",
    warehouseScope: "*",
    status: "active",
    photoUrl: null,
    lastLoginAt: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function newApp(users: User[] = [], opts: { withTimeLeave?: boolean } = {}) {
  const departments = createSqliteDepartmentRepository();
  const jobTitles = createSqliteJobTitleRepository();
  const employees = createSqliteEmployeeRepository();
  const contracts = createSqliteContractRepository();
  const holidays = createSqliteHolidayRepository();
  const leaveRequests = createSqliteLeaveRequestRepository();
  const attendance = createSqliteAttendanceRepository();
  const leavePolicies = createSqliteLeavePolicyRepository();
  const leaveBalances = createSqliteLeaveBalanceRepository();
  const leaveAccrualBatches = createSqliteLeaveAccrualBatchRepository();
  handles.push(
    departments,
    jobTitles,
    employees,
    contracts,
    holidays,
    leaveRequests,
    attendance,
    leavePolicies,
    leaveBalances,
    leaveAccrualBatches,
  );

  const prefixes: Record<string, string> = { EMPLOYEE: "EMP-", CONTRACT: "CTR-", LEAVE_REQUEST: "LR-" };
  const counters = new Map<string, number>();
  const timeLeave = opts.withTimeLeave
    ? { attendance, leavePolicies, leaveBalances, leaveAccrualBatches }
    : {};
  const deps: HrRoutesDeps = {
    departments,
    jobTitles,
    employees,
    contracts,
    holidays,
    leaveRequests,
    users: fakeUsers(users),
    numbering: {
      next: async (code) => {
        const next = (counters.get(code) ?? 0) + 1;
        counters.set(code, next);
        return { formatted: `${prefixes[code] ?? `${code}-`}${String(next).padStart(4, "0")}` };
      },
    },
    ...timeLeave,
  };
  return { app: createHrRoutes(deps), ...deps, attendance, leaveBalances };
}

type App = ReturnType<typeof newApp>["app"];

function req(
  path: string,
  init: RequestInit & { permissions?: string; userId?: string; branchScope?: string } = {},
) {
  const headers = new Headers(init.headers);
  if (init.permissions !== undefined) headers.set("x-permissions", init.permissions);
  if (init.userId !== undefined) headers.set("x-user-id", init.userId);
  if (init.branchScope !== undefined) headers.set("x-branch-scope", init.branchScope);
  return new Request(`http://local${path}`, { ...init, headers });
}

const ADMIN = "*";

async function send(
  app: App,
  method: string,
  path: string,
  payload?: unknown,
  init: { permissions?: string; userId?: string; branchScope?: string } = {},
) {
  return app.fetch(
    req(path, {
      method,
      permissions: init.permissions ?? ADMIN,
      userId: init.userId,
      branchScope: init.branchScope,
      headers: payload === undefined ? undefined : { "content-type": "application/json" },
      body: payload === undefined ? undefined : JSON.stringify(payload),
    }),
  );
}

async function json<T>(res: Response): Promise<T> {
  return (await res.json()) as T;
}

const employeeBody = {
  id: "emp-1",
  firstName: "سارة",
  lastName: "محمود",
  branchId: "MAIN",
  hireDate: "2026-01-15",
};

const contractBody = {
  id: "ctr-1",
  employeeId: "emp-1",
  type: "indefinite",
  payBasis: "monthly",
  payFrequency: "monthly",
  startDate: "2026-01-15",
  monthlySalary: "9000.00",
};

describe("hr-routes — the 404 in front of every edit", () => {
  it("404s an edit, a transition, a termination or a rehire naming a record that is gone", async () => {
    const { app } = newApp();
    expect((await send(app, "PUT", "/departments/nope", { name: "X" })).status).toBe(404);
    expect((await send(app, "PUT", "/job-titles/nope", { name: "X" })).status).toBe(404);
    expect((await send(app, "GET", "/employees/nope")).status).toBe(404);
    expect((await send(app, "PUT", "/employees/nope", { firstName: "X" })).status).toBe(404);
    expect((await send(app, "POST", "/employees/nope/transition", { status: "on_leave" })).status).toBe(404);
    expect((await send(app, "POST", "/employees/nope/terminate")).status).toBe(404);
    expect((await send(app, "POST", "/employees/nope/rehire", { hireDate: "2026-08-01" })).status).toBe(404);
    expect((await send(app, "GET", "/contracts/nope")).status).toBe(404);
    expect((await send(app, "POST", "/contracts/nope/terminate")).status).toBe(404);
    expect((await send(app, "PUT", "/holidays/nope", { name: "X" })).status).toBe(404);
    expect((await send(app, "DELETE", "/holidays/nope")).status).toBe(404);
    expect((await send(app, "POST", "/leave-requests/nope/cancel")).status).toBe(404);
  });

  it("400s a body the schema rejects on every create and edit", async () => {
    const { app } = newApp();
    await send(app, "POST", "/departments", { code: "OPS", name: "Ops" });
    const dept = await json<Array<{ id: string }>>(await send(app, "GET", "/departments"));
    await send(app, "POST", "/employees", employeeBody);
    await send(app, "POST", "/holidays", { id: "hol-1", nameEn: "Sham El-Nessim", date: "2026-04-20" });

    expect((await send(app, "POST", "/departments", { name: 5 })).status).toBe(400);
    expect((await send(app, "PUT", `/departments/${dept[0]!.id}`, { active: "yes" })).status).toBe(400);
    expect((await send(app, "POST", "/job-titles", { name: 5 })).status).toBe(400);
    expect((await send(app, "POST", "/employees", { firstName: 5 })).status).toBe(400);
    expect((await send(app, "PUT", "/employees/emp-1", { firstName: 5 })).status).toBe(400);
    expect((await send(app, "POST", "/employees/emp-1/transition", { status: "moonwalking" })).status).toBe(400);
    expect((await send(app, "POST", "/employees/emp-1/rehire", { hireDate: 5 })).status).toBe(400);
    expect((await send(app, "POST", "/contracts", { employeeId: 5 })).status).toBe(400);
    expect((await send(app, "POST", "/holidays", { nameEn: 5 })).status).toBe(400);
    expect((await send(app, "PUT", "/holidays/hol-1", { recurringAnnual: "sometimes" })).status).toBe(400);
    expect((await send(app, "POST", "/leave-requests", { leaveType: "sabbatical" })).status).toBe(400);
  });

  it("rehires a terminated employee, and 400s a rehire that names no date at all", async () => {
    const { app } = newApp();
    await send(app, "POST", "/employees", employeeBody);
    await send(app, "POST", "/employees/emp-1/terminate");

    // No body at all: the route swallows the parse failure and lets the schema
    // answer, so an empty request is a 400 rather than a 500.
    expect((await send(app, "POST", "/employees/emp-1/rehire")).status).toBe(400);

    const res = await send(app, "POST", "/employees/emp-1/rehire", { hireDate: "2026-08-01" });
    expect(res.status).toBe(200);
    expect((await json<{ status: string; hireDate: string }>(res))).toMatchObject({
      status: "active",
      hireDate: "2026-08-01",
    });
  });

  it("edits a job title and a department in place", async () => {
    const { app } = newApp();
    await send(app, "POST", "/departments", { id: "dep-1", code: "OPS", name: "Ops" });
    await send(app, "POST", "/job-titles", { id: "jt-1", departmentId: "dep-1", name: "Storekeeper" });

    const res = await send(app, "PUT", "/job-titles/jt-1", { name: "Senior Storekeeper", active: false });
    expect(res.status).toBe(200);
    expect(await json<{ name: string; active: boolean }>(res)).toMatchObject({
      name: "Senior Storekeeper",
      active: false,
    });
  });

  it("lists the holidays of one year, and every holiday when no year is asked for", async () => {
    const { app } = newApp();
    await send(app, "POST", "/holidays", { id: "h-1", nameEn: "Sham El-Nessim", date: "2026-04-20" });
    await send(app, "POST", "/holidays", {
      id: "h-2",
      nameEn: "New Year",
      nameAr: "رأس السنة",
      date: "2020-01-01",
      recurringAnnual: true,
    });

    expect(await json<unknown[]>(await send(app, "GET", "/holidays"))).toHaveLength(2);
    const of2026 = await json<Array<{ date: string }>>(await send(app, "GET", "/holidays?year=2026"));
    expect(of2026.map((h) => h.date).sort()).toEqual(["2026-01-01", "2026-04-20"]);
  });

  it("shows a caller only the branches their scope reaches", async () => {
    const { app } = newApp();
    await send(app, "POST", "/employees", employeeBody);
    await send(app, "POST", "/employees", { ...employeeBody, id: "emp-2", branchId: "BR2" });

    const scoped = await json<Array<{ id: string }>>(await send(app, "GET", "/employees", undefined, { branchScope: "BR2" }));
    expect(scoped.map((e) => e.id)).toEqual(["emp-2"]);
  });
});

describe("hr-routes — salary is only for the caller allowed to see it", () => {
  async function withContract(app: App) {
    await send(app, "POST", "/employees", employeeBody);
    await send(app, "POST", "/contracts", {
      ...contractBody,
      allowances: [{ name: "بدل انتقال", amount: "500.00" }],
      deductions: [{ id: "ded-1", name: "خصم تأمين", amount: "120.00", componentId: "comp-9" }],
    });
  }

  it("carries the salary and its components for a caller holding hr.employee.view_salary", async () => {
    const { app } = newApp();
    await withContract(app);

    const rows = await json<Array<{ monthlySalary: string; allowances: Array<{ id: string; amount: string }> }>>(
      await send(app, "GET", "/contracts", undefined, { permissions: "hr.contract.view,hr.employee.view_salary" }),
    );
    expect(rows[0]!.monthlySalary).toBe("9000.000000");
    expect(rows[0]!.allowances[0]!.amount).toBe("500.000000");
    // The allowance id was not supplied, so the route minted one.
    expect(rows[0]!.allowances[0]!.id).toMatch(/.+/);
  });

  it("withholds the basic AND its allowances and deductions from a caller without it", async () => {
    const { app } = newApp();
    await withContract(app);

    for (const path of ["/contracts", "/employees/emp-1/contracts"]) {
      const rows = await json<Array<Record<string, unknown>>>(
        await send(app, "GET", path, undefined, { permissions: "hr.contract.view" }),
      );
      expect(rows[0]).not.toHaveProperty("monthlySalary");
      expect(rows[0]).not.toHaveProperty("allowances");
      expect(rows[0]).not.toHaveProperty("deductions");
      expect(rows[0]).toHaveProperty("status");
    }

    const one = await json<Record<string, unknown>>(
      await send(app, "GET", "/contracts/ctr-1", undefined, { permissions: "hr.contract.view" }),
    );
    expect(one).not.toHaveProperty("monthlySalary");
  });
});

describe("hr-routes — إجازاتي and filing on someone else's behalf", () => {
  const leaveBody = {
    leaveType: "annual",
    startDate: "2026-08-10",
    endDate: "2026-08-12",
    days: 3,
  };

  it("403s a caller filing for another employee without hr.leave.approve", async () => {
    const { app } = newApp([fakeUser({ employeeId: "emp-1" })]);
    await send(app, "POST", "/employees", employeeBody);
    await send(app, "POST", "/employees", { ...employeeBody, id: "emp-2" });

    const res = await send(app, "POST", "/leave-requests", { ...leaveBody, employeeId: "emp-2" }, {
      permissions: "hr.leave.create",
      userId: "user-1",
    });
    expect(res.status).toBe(403);
    expect((await json<{ permission: string }>(res)).permission).toBe("hr.leave.approve");
  });

  it("404s an approver filing for an employee who is not on the payroll", async () => {
    const { app } = newApp([fakeUser({ employeeId: "emp-1" })]);
    await send(app, "POST", "/employees", employeeBody);

    const res = await send(app, "POST", "/leave-requests", { ...leaveBody, employeeId: "ghost" }, { userId: "user-1" });
    expect(res.status).toBe(404);
    expect((await json<{ error: string }>(res)).error).toBe("EMPLOYEE_NOT_FOUND");
  });

  it("lets an approver file for another employee, and lets them cancel it too", async () => {
    const { app } = newApp([fakeUser({ employeeId: "emp-1" })]);
    await send(app, "POST", "/employees", employeeBody);
    await send(app, "POST", "/employees", { ...employeeBody, id: "emp-2" });

    const created = await send(app, "POST", "/leave-requests", { id: "lr-1", ...leaveBody, employeeId: "emp-2" }, {
      userId: "user-1",
    });
    expect(created.status).toBe(201);
    expect((await json<{ employeeId: string }>(created)).employeeId).toBe("emp-2");

    const cancelled = await send(app, "POST", "/leave-requests/lr-1/cancel", undefined, { userId: "user-1" });
    expect(cancelled.status).toBe(200);
    expect((await json<{ status: string }>(cancelled)).status).toBe("cancelled");
  });

  it("returns the caller's own requests, and an empty envelope when no user is identified at all", async () => {
    const { app } = newApp([fakeUser({ employeeId: "emp-1" })]);
    await send(app, "POST", "/employees", employeeBody);
    await send(app, "POST", "/leave-requests", { id: "lr-1", ...leaveBody }, { userId: "user-1" });

    const mine = await json<{ employeeId: string; requests: unknown[] }>(
      await send(app, "GET", "/leave-requests/me", undefined, { userId: "user-1" }),
    );
    expect(mine.employeeId).toBe("emp-1");
    expect(mine.requests).toHaveLength(1);

    const unknownUser = await json<{ employeeId: string | null; requests: unknown[] }>(
      await send(app, "GET", "/leave-requests/me", undefined, { userId: "user-nope" }),
    );
    expect(unknownUser).toEqual({ employeeId: null, requests: [] });
  });

  it("gives an approved day back to the balance when the request is cancelled", async () => {
    const { app, leaveBalances } = newApp([fakeUser({ employeeId: "emp-1" })], { withTimeLeave: true });
    await send(app, "POST", "/employees", employeeBody);
    await leaveBalances.create({
      id: "bal-1",
      employeeId: "emp-1",
      leaveType: "annual",
      year: 2026,
      entitled: Qty.fromMajor("21"),
      carriedOver: Qty.zero(),
      used: Qty.fromMajor("3"),
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });
    await send(app, "POST", "/leave-requests", { id: "lr-1", ...leaveBody }, { userId: "user-1" });
    await send(app, "POST", "/leave-requests/lr-1/approve", { approverId: "user-1" }, { userId: "user-1" });

    const before = await leaveBalances.find("emp-1", "annual", 2026);
    await send(app, "POST", "/leave-requests/lr-1/cancel", undefined, { userId: "user-1" });
    const after = await leaveBalances.find("emp-1", "annual", 2026);

    expect(Number(after!.used.toString())).toBe(Number(before!.used.toString()) - 3);
  });

  it("403s cancelling another employee's request when the caller is not an approver", async () => {
    const { app } = newApp([fakeUser({ employeeId: "emp-1" }), fakeUser({ id: "user-2", employeeId: "emp-2" })]);
    await send(app, "POST", "/employees", employeeBody);
    await send(app, "POST", "/employees", { ...employeeBody, id: "emp-2" });
    await send(app, "POST", "/leave-requests", { id: "lr-1", ...leaveBody }, { userId: "user-1" });

    const res = await send(app, "POST", "/leave-requests/lr-1/cancel", undefined, {
      permissions: "hr.leave.create",
      userId: "user-2",
    });
    expect(res.status).toBe(403);
  });
});

describe("hr-routes — the workforce dashboard", () => {
  it("aggregates headcount, probation, departments, branches and the 12-month trend", async () => {
    const { app } = newApp([], { withTimeLeave: true });
    const today = new Date();
    const thisMonth = today.toISOString().slice(0, 7);
    const soon = new Date(today.getTime() + 10 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

    await send(app, "POST", "/departments", { id: "dep-1", code: "OPS", name: "Ops", nameAr: "العمليات" });
    await send(app, "POST", "/employees", {
      ...employeeBody,
      hireDate: `${thisMonth}-01`,
      departmentId: "dep-1",
      probationEndDate: soon,
    });
    // An employee in a department that is not in the register any more: the
    // dashboard has to fall back to the id rather than render "undefined".
    await send(app, "POST", "/employees", {
      ...employeeBody,
      id: "emp-2",
      branchId: "BR2",
      departmentId: "dep-gone",
      hireDate: "2026-02-01",
    });
    await send(app, "POST", "/employees", { ...employeeBody, id: "emp-3", hireDate: "2026-03-01" });
    await send(app, "POST", "/employees/emp-3/transition", { status: "on_leave" });
    await send(app, "POST", "/employees", { ...employeeBody, id: "emp-4", hireDate: "2026-04-01" });
    await send(app, "POST", "/employees/emp-4/terminate");

    const dash = await json<{
      activeEmployees: number;
      onLeave: number;
      hiresThisMonth: number;
      terminationsThisMonth: number;
      probationEndingSoon: number;
      byDepartment: Array<{ departmentId: string; departmentName: string; departmentNameAr: string | null; count: number }>;
      byBranch: Array<{ branchId: string; count: number }>;
      headcountTrend: Array<{ month: string; hires: number; leavers: number }>;
      attendance: { workingDays: number; daysPresent: number };
    }>(await send(app, "GET", "/dashboard"));

    expect(dash.activeEmployees).toBe(2);
    expect(dash.onLeave).toBe(1);
    expect(dash.hiresThisMonth).toBe(1);
    expect(dash.terminationsThisMonth).toBe(1);
    expect(dash.probationEndingSoon).toBe(1);

    // A terminated employee counts towards neither the department nor the branch.
    expect(dash.byDepartment).toEqual(
      expect.arrayContaining([
        { departmentId: "dep-1", departmentName: "Ops", departmentNameAr: "العمليات", count: 1 },
        { departmentId: "dep-gone", departmentName: "dep-gone", departmentNameAr: null, count: 1 },
      ]),
    );
    expect(dash.byBranch).toEqual(
      expect.arrayContaining([
        { branchId: "MAIN", count: 2 },
        { branchId: "BR2", count: 1 },
      ]),
    );
    expect(dash.headcountTrend).toHaveLength(12);
    expect(dash.headcountTrend.at(-1)!.month).toBe(thisMonth);
  });

  it("reports leave entitlement from the accrual sub-ledger, and null when it holds nothing", async () => {
    const { app, leaveBalances } = newApp([fakeUser({ employeeId: "emp-1" })], { withTimeLeave: true });
    await send(app, "POST", "/employees", employeeBody);
    const year = new Date().getUTCFullYear();
    await leaveBalances.create({
      id: "bal-1",
      employeeId: "emp-1",
      leaveType: "annual",
      year,
      entitled: Qty.fromMajor("18"),
      carriedOver: Qty.fromMajor("2"),
      used: Qty.zero(),
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });
    await send(
      app,
      "POST",
      "/leave-requests",
      { id: "lr-1", leaveType: "annual", startDate: `${year}-08-10`, endDate: `${year}-08-14`, days: 5 },
      { userId: "user-1" },
    );

    const dash = await json<{
      leaveConsumption: Array<{ leaveType: string; entitled: number | null; used: number; pending: number; usedPercent: number | null }>;
    }>(await send(app, "GET", "/dashboard"));

    const annual = dash.leaveConsumption.find((row) => row.leaveType === "annual")!;
    expect(annual.entitled).toBe(20);
    expect(annual.pending).toBe(5);
    expect(annual.used).toBe(0);
    expect(annual.usedPercent).toBe(0);

    // A leave type the sub-ledger carries no row for reports no entitlement at
    // all rather than a zero that would read as "all of it is used".
    const sick = dash.leaveConsumption.find((row) => row.leaveType === "sick")!;
    expect(sick.entitled).toBeNull();
    expect(sick.usedPercent).toBeNull();
  });

  it("summarises the trailing attendance window when the attendance register is wired", async () => {
    const { app, attendance } = newApp([], { withTimeLeave: true });
    await send(app, "POST", "/employees", employeeBody);
    const day = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    await attendance.create({
      id: "att-1",
      employeeId: "emp-1",
      date: day,
      checkIn: "09:00",
      checkOut: "17:00",
      workedMinutes: 480,
      status: "present",
      notes: null,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });

    const dash = await json<{ attendance: { from: string; to: string; daysPresent: number } }>(
      await send(app, "GET", "/dashboard"),
    );
    expect(dash.attendance.daysPresent).toBe(1);
    expect(dash.attendance.from < dash.attendance.to).toBe(true);
  });

  it("mounts the attendance sub-router only once its four repositories are supplied", async () => {
    const without = newApp();
    expect((await send(without.app, "GET", "/attendance")).status).toBe(404);

    const withThem = newApp([], { withTimeLeave: true });
    expect((await send(withThem.app, "GET", "/attendance")).status).toBe(200);
  });
});
