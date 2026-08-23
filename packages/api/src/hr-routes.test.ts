import { describe, it, expect, afterEach } from "vitest";
import {
  createSqliteDepartmentRepository,
  createSqliteJobTitleRepository,
  createSqliteEmployeeRepository,
  createSqliteContractRepository,
  createSqliteHolidayRepository,
  createSqliteLeaveRequestRepository,
} from "@mezan/persistence";
import type { User, UserRepository } from "@mezan/domain";
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
    fullName: "Test User",
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
    lastLoginAt: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function newApp(users: User[] = []) {
  const departments = createSqliteDepartmentRepository();
  const jobTitles = createSqliteJobTitleRepository();
  const employees = createSqliteEmployeeRepository();
  const contracts = createSqliteContractRepository();
  const holidays = createSqliteHolidayRepository();
  const leaveRequests = createSqliteLeaveRequestRepository();
  handles.push(departments, jobTitles, employees, contracts, holidays, leaveRequests);

  const prefixes: Record<string, string> = { EMPLOYEE: "EMP-", CONTRACT: "CTR-", LEAVE_REQUEST: "LR-" };
  const counters = new Map<string, number>();
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
  };
  const app = createHrRoutes(deps);
  return { app, ...deps };
}

function req(path: string, init: RequestInit & { permissions?: string; userId?: string } = {}) {
  const headers = new Headers(init.headers);
  if (init.permissions !== undefined) headers.set("x-permissions", init.permissions);
  if (init.userId !== undefined) headers.set("x-user-id", init.userId);
  return new Request(`http://local${path}`, { ...init, headers });
}

function jsonReq(path: string, permissions: string, body: unknown, method = "POST", extra: { userId?: string } = {}) {
  return req(path, { method, permissions, userId: extra.userId, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
}

describe("hr router — permission gate", () => {
  it("rejects GET /departments with no permissions with 403", async () => {
    const { app } = newApp();
    const res = await app.fetch(req("/departments"));
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: string; permission: string };
    expect(body.error).toBe("PERMISSION_DENIED");
    expect(body.permission).toBe("hr.department.view");
  });

  it("rejects POST /employees with only view permission", async () => {
    const { app } = newApp();
    const res = await app.fetch(jsonReq("/employees", "hr.employee.view", { firstName: "A", lastName: "B", branchId: "MAIN", hireDate: "2026-01-01" }));
    expect(res.status).toBe(403);
  });
});

describe("Departments + Job Titles", () => {
  it("creates, lists and edits a department", async () => {
    const { app } = newApp();
    const create = await app.fetch(jsonReq("/departments", "hr.department.create", { code: "SALES", name: "Sales", nameAr: "المبيعات" }));
    expect(create.status).toBe(201);
    const dept = (await create.json()) as { id: string };

    const list = await app.fetch(req("/departments", { permissions: "hr.department.view" }));
    expect(await list.json()).toHaveLength(1);

    const edit = await app.fetch(jsonReq(`/departments/${dept.id}`, "hr.department.edit", { active: false, managerId: "emp-1" }, "PUT"));
    expect(edit.status).toBe(200);
    expect(((await edit.json()) as { active: boolean }).active).toBe(false);
  });

  it("rejects a duplicate department code with 422", async () => {
    const { app } = newApp();
    await app.fetch(jsonReq("/departments", "hr.department.create", { code: "SALES", name: "Sales" }));
    const dup = await app.fetch(jsonReq("/departments", "hr.department.create", { code: "SALES", name: "Sales 2" }));
    expect(dup.status).toBe(422);
  });

  it("creates a job title scoped to a department and filters by departmentId", async () => {
    const { app } = newApp();
    const dept = (await (await app.fetch(jsonReq("/departments", "hr.department.create", { code: "SALES", name: "Sales" }))).json()) as { id: string };
    await app.fetch(jsonReq("/job-titles", "hr.job_title.create", { departmentId: dept.id, name: "Sales Officer" }));
    await app.fetch(jsonReq("/job-titles", "hr.job_title.create", { departmentId: "other-dept", name: "Accountant" }));

    const filtered = await app.fetch(req(`/job-titles?departmentId=${dept.id}`, { permissions: "hr.job_title.view" }));
    expect(await filtered.json()).toHaveLength(1);
  });
});

describe("Employees", () => {
  it("creates an employee with an EMP-#### code from the numbering port", async () => {
    const { app } = newApp();
    const res = await app.fetch(
      jsonReq("/employees", "hr.employee.create", { firstName: "أحمد", lastName: "محمود", branchId: "MAIN", hireDate: "2026-01-01" }),
    );
    expect(res.status).toBe(201);
    const emp = (await res.json()) as { id: string; code: string; status: string };
    expect(emp.code).toBe("EMP-0001");
    expect(emp.status).toBe("active");

    const fetched = await app.fetch(req(`/employees/${emp.id}`, { permissions: "hr.employee.view" }));
    expect(fetched.status).toBe(200);
  });

  it("transitions and terminates an employee", async () => {
    const { app } = newApp();
    const created = (await (
      await app.fetch(jsonReq("/employees", "hr.employee.create", { firstName: "A", lastName: "B", branchId: "MAIN", hireDate: "2026-01-01" }))
    ).json()) as { id: string };

    const onLeave = await app.fetch(jsonReq(`/employees/${created.id}/transition`, "hr.employee.edit", { status: "on_leave" }));
    expect(((await onLeave.json()) as { status: string }).status).toBe("on_leave");

    const terminate = await app.fetch(jsonReq(`/employees/${created.id}/terminate`, "hr.employee.terminate", {}));
    expect(terminate.status).toBe(200);
    expect(((await terminate.json()) as { status: string }).status).toBe("terminated");

    const reTransition = await app.fetch(jsonReq(`/employees/${created.id}/transition`, "hr.employee.edit", { status: "active" }));
    expect(reTransition.status).toBe(422);
  });
});

describe("Contracts", () => {
  it("creates a contract with a CTR-#### number and money round-trips as a decimal string", async () => {
    const { app } = newApp();
    const emp = (await (
      await app.fetch(jsonReq("/employees", "hr.employee.create", { firstName: "A", lastName: "B", branchId: "MAIN", hireDate: "2026-01-01" }))
    ).json()) as { id: string };

    const res = await app.fetch(
      jsonReq("/contracts", "hr.contract.create", { employeeId: emp.id, startDate: "2026-01-01", monthlySalary: "14000.00" }),
    );
    expect(res.status).toBe(201);
    const contract = (await res.json()) as { number: string; monthlySalary: string; status: string };
    expect(contract.number).toBe("CTR-0001");
    expect(contract.monthlySalary).toBe("14000.000000");
    expect(contract.status).toBe("active");

    const byEmployee = await app.fetch(req(`/employees/${emp.id}/contracts`, { permissions: "hr.contract.view" }));
    expect(await byEmployee.json()).toHaveLength(1);
  });

  it("rejects an indefinite contract with an end date (422)", async () => {
    const { app } = newApp();
    const emp = (await (
      await app.fetch(jsonReq("/employees", "hr.employee.create", { firstName: "A", lastName: "B", branchId: "MAIN", hireDate: "2026-01-01" }))
    ).json()) as { id: string };
    const res = await app.fetch(
      jsonReq("/contracts", "hr.contract.create", {
        employeeId: emp.id,
        type: "indefinite",
        startDate: "2026-01-01",
        endDate: "2026-12-31",
        monthlySalary: "1000.00",
      }),
    );
    expect(res.status).toBe(422);
  });

  it("terminates a contract, and rejects a second termination", async () => {
    const { app } = newApp();
    const emp = (await (
      await app.fetch(jsonReq("/employees", "hr.employee.create", { firstName: "A", lastName: "B", branchId: "MAIN", hireDate: "2026-01-01" }))
    ).json()) as { id: string };
    const contract = (await (
      await app.fetch(jsonReq("/contracts", "hr.contract.create", { employeeId: emp.id, startDate: "2026-01-01", monthlySalary: "1000.00" }))
    ).json()) as { id: string };

    const terminate = await app.fetch(jsonReq(`/contracts/${contract.id}/terminate`, "hr.contract.edit", {}));
    expect(terminate.status).toBe(200);
    const again = await app.fetch(jsonReq(`/contracts/${contract.id}/terminate`, "hr.contract.edit", {}));
    expect(again.status).toBe(422);
  });
});

describe("Holidays", () => {
  it("creates a holiday and projects a recurring one onto the requested year", async () => {
    const { app } = newApp();
    await app.fetch(jsonReq("/holidays", "hr.leave_policy.edit", { date: "2026-10-06", nameEn: "National Day", recurringAnnual: true }));

    const year2027 = await app.fetch(req("/holidays?year=2027", { permissions: "hr.leave_policy.view" }));
    const rows = (await year2027.json()) as { date: string }[];
    expect(rows.map((r) => r.date)).toEqual(["2027-10-06"]);
  });

  it("deletes a holiday", async () => {
    const { app } = newApp();
    const created = (await (
      await app.fetch(jsonReq("/holidays", "hr.leave_policy.edit", { date: "2026-10-06", nameEn: "National Day" }))
    ).json()) as { id: string };
    const del = await app.fetch(req(`/holidays/${created.id}`, { method: "DELETE", permissions: "hr.leave_policy.edit" }));
    expect(del.status).toBe(200);
    const all = await app.fetch(req("/holidays", { permissions: "hr.leave_policy.view" }));
    expect(await all.json()).toEqual([]);
  });
});

describe("Leave Requests — My Leave self-service", () => {
  it("gates /leave-requests/me on the caller's linked employee, returning employeeId: null when unlinked", async () => {
    const user = fakeUser({ id: "user-1", employeeId: null });
    const { app } = newApp([user]);
    const res = await app.fetch(req("/leave-requests/me", { permissions: "hr.leave.view", userId: "user-1" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ employeeId: null, requests: [] });
  });

  it("creates a leave request for the caller's linked employee and lists it back via /me", async () => {
    const user = fakeUser({ id: "user-1", employeeId: "emp-1" });
    const { app } = newApp([user]);

    const create = await app.fetch(
      jsonReq("/leave-requests", "hr.leave.create", { leaveType: "annual", startDate: "2026-08-10", endDate: "2026-08-12" }, "POST", {
        userId: "user-1",
      }),
    );
    expect(create.status).toBe(201);
    const created = (await create.json()) as { id: string; number: string; days: number; status: string };
    expect(created.number).toBe("LR-0001");
    expect(created.days).toBe(3);
    expect(created.status).toBe("pending");

    const me = await app.fetch(req("/leave-requests/me", { permissions: "hr.leave.view", userId: "user-1" }));
    const body = (await me.json()) as { employeeId: string; requests: unknown[] };
    expect(body.employeeId).toBe("emp-1");
    expect(body.requests).toHaveLength(1);
  });

  it("rejects creating a leave request when the caller has no linked employee (409)", async () => {
    const user = fakeUser({ id: "user-1", employeeId: null });
    const { app } = newApp([user]);
    const res = await app.fetch(
      jsonReq("/leave-requests", "hr.leave.create", { leaveType: "annual", startDate: "2026-08-10", endDate: "2026-08-10" }, "POST", {
        userId: "user-1",
      }),
    );
    expect(res.status).toBe(409);
  });

  it("lets the owning employee cancel their own pending request, but not another employee's", async () => {
    const owner = fakeUser({ id: "user-1", employeeId: "emp-1" });
    const other = fakeUser({ id: "user-2", employeeId: "emp-2" });
    const { app } = newApp([owner, other]);

    const created = (await (
      await app.fetch(
        jsonReq("/leave-requests", "hr.leave.create", { leaveType: "annual", startDate: "2026-08-10", endDate: "2026-08-10" }, "POST", {
          userId: "user-1",
        }),
      )
    ).json()) as { id: string };

    const forbidden = await app.fetch(jsonReq(`/leave-requests/${created.id}/cancel`, "hr.leave.create", {}, "POST", { userId: "user-2" }));
    expect(forbidden.status).toBe(403);

    const ok = await app.fetch(jsonReq(`/leave-requests/${created.id}/cancel`, "hr.leave.create", {}, "POST", { userId: "user-1" }));
    expect(ok.status).toBe(200);
    expect(((await ok.json()) as { status: string }).status).toBe("cancelled");
  });
});

describe("HR dashboard", () => {
  it("aggregates headcount/leave-consumption KPIs", async () => {
    const { app } = newApp();
    await app.fetch(jsonReq("/employees", "hr.employee.create", { firstName: "A", lastName: "B", branchId: "MAIN", hireDate: new Date().toISOString().slice(0, 10) }));
    const res = await app.fetch(req("/dashboard", { permissions: "hr.employee.view" }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { activeEmployees: number; hiresThisMonth: number; leaveConsumption: unknown[] };
    expect(body.activeEmployees).toBe(1);
    expect(body.hiresThisMonth).toBe(1);
    expect(body.leaveConsumption).toHaveLength(3);
  });
});
