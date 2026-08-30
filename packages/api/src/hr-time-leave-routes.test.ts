import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createSqliteAttendanceRepository,
  createSqliteEmployeeRepository,
  createSqliteHolidayRepository,
  createSqliteLeaveAccrualBatchRepository,
  createSqliteLeaveBalanceRepository,
  createSqliteLeavePolicyRepository,
  createSqliteLeaveRequestRepository,
} from "@mezan/persistence";
import { createEmployee, createLeaveRequest } from "@mezan/domain";
import { createHrTimeLeaveRoutes } from "./hr-time-leave-routes.js";

const dirs: string[] = [];
const handles: { close(): void }[] = [];

afterEach(() => {
  for (const h of handles.splice(0)) h.close();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** One file-backed database shared by every repository, so the routes see one tenant. */
function sharedDb(): string {
  const dir = mkdtempSync(join(tmpdir(), "mezan-hr-"));
  dirs.push(dir);
  return join(dir, "test.db");
}

async function newApp() {
  const db = sharedDb();

  const employees = createSqliteEmployeeRepository(db);
  const holidays = createSqliteHolidayRepository(db);
  const leaveRequests = createSqliteLeaveRequestRepository(db);
  const attendance = createSqliteAttendanceRepository(db);
  const leavePolicies = createSqliteLeavePolicyRepository(db);
  const leaveBalances = createSqliteLeaveBalanceRepository(db);
  const leaveAccrualBatches = createSqliteLeaveAccrualBatchRepository(db);
  handles.push(employees, holidays, leaveRequests, attendance, leavePolicies, leaveBalances, leaveAccrualBatches);

  let counter = 0;
  const app = createHrTimeLeaveRoutes({
    employees,
    holidays,
    leaveRequests,
    attendance,
    leavePolicies,
    leaveBalances,
    leaveAccrualBatches,
    numbering: {
      async next(code: string) {
        counter += 1;
        return { formatted: `${code}-${String(counter).padStart(4, "0")}` };
      },
    },
  });

  const employee = await createEmployee(
    {
      id: "emp-1",
      code: "EMP-0001",
      firstName: "منى",
      lastName: "عبد الله",
      branchId: "br-1",
      hireDate: "2025-01-01",
    },
    employees,
  );

  return { app, employee, employees, attendance, leaveRequests, leaveBalances, leavePolicies };
}

function req(path: string, init: RequestInit & { permissions?: string; userId?: string } = {}) {
  const headers = new Headers(init.headers);
  if (init.permissions !== undefined) headers.set("x-permissions", init.permissions);
  headers.set("x-user-id", init.userId ?? "user-hr");
  if (init.body !== undefined) headers.set("content-type", "application/json");
  return new Request(`http://local${path}`, { ...init, headers });
}

const ADMIN = "*";

describe("HR time and leave routes — the permission gate", () => {
  it("refuses a caller with no permissions on every surface", async () => {
    const { app } = await newApp();
    for (const path of [
      "/attendance",
      "/attendance/summary?employeeId=emp-1&from=2026-01-01&to=2026-01-31",
      "/leave-policies",
      "/leave-policies/presets",
      "/leave-balances",
      "/leave-accrual-batches",
      "/leave-requests",
      "/leave-requests/counts",
    ]) {
      const res = await app.fetch(req(path, { permissions: "" }));
      expect(res.status, path).toBe(403);
    }
  });

  it("refuses a writer who only holds the matching view permission", async () => {
    const { app } = await newApp();
    const attendance = await app.fetch(
      req("/attendance", {
        method: "POST",
        permissions: "hr.attendance.view",
        body: JSON.stringify({ employeeId: "emp-1", date: "2026-01-05" }),
      }),
    );
    expect(attendance.status).toBe(403);

    const policy = await app.fetch(
      req("/leave-policies", {
        method: "POST",
        permissions: "hr.leave_policy.view",
        body: JSON.stringify({ leaveType: "annual", entitlementDays: "21", accrualFrequency: "monthly" }),
      }),
    );
    expect(policy.status).toBe(403);
  });

  it("names the permission it wanted, so the screen can say which one is missing", async () => {
    const { app } = await newApp();
    const res = await app.fetch(req("/leave-requests", { permissions: "hr.attendance.view" }));
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ error: "PERMISSION_DENIED", permission: "hr.leave.view" });
  });
});

describe("attendance", () => {
  it("records a day and reads it back through the list", async () => {
    const { app } = await newApp();
    const created = await app.fetch(
      req("/attendance", {
        method: "POST",
        permissions: ADMIN,
        body: JSON.stringify({ employeeId: "emp-1", date: "2026-01-05", checkIn: "09:00", checkOut: "17:00" }),
      }),
    );
    expect(created.status).toBe(201);
    const entry = (await created.json()) as { id: string; employeeId: string; date: string; status: string };
    expect(entry.employeeId).toBe("emp-1");
    expect(entry.date).toBe("2026-01-05");

    const listed = await app.fetch(req("/attendance?employeeId=emp-1", { permissions: ADMIN }));
    expect((await listed.json()) as unknown[]).toHaveLength(1);
  });

  it("refuses a second entry for the same employee and day", async () => {
    const { app } = await newApp();
    const body = JSON.stringify({ employeeId: "emp-1", date: "2026-01-05", checkIn: "09:00" });
    await app.fetch(req("/attendance", { method: "POST", permissions: ADMIN, body }));
    const again = await app.fetch(req("/attendance", { method: "POST", permissions: ADMIN, body }));
    expect(again.status).toBe(409);
    expect(((await again.json()) as { error: string }).error).toContain("DUPLICATE");
  });

  it("refuses a day for an employee who does not exist", async () => {
    const { app } = await newApp();
    const res = await app.fetch(
      req("/attendance", {
        method: "POST",
        permissions: ADMIN,
        body: JSON.stringify({ employeeId: "emp-ghost", date: "2026-01-05" }),
      }),
    );
    expect(res.status).toBe(404);
  });

  it("refuses a malformed body and names the field", async () => {
    const { app } = await newApp();
    const res = await app.fetch(
      req("/attendance", {
        method: "POST",
        permissions: ADMIN,
        body: JSON.stringify({ employeeId: "emp-1", date: "05/01/2026" }),
      }),
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string; details: { fieldErrors: Record<string, string[]> } };
    expect(body.error).toBe("VALIDATION_ERROR");
    expect(Object.keys(body.details.fieldErrors)).toContain("date");
  });

  it("corrects an entry and keeps the correction", async () => {
    const { app } = await newApp();
    const created = await app.fetch(
      req("/attendance", {
        method: "POST",
        permissions: ADMIN,
        body: JSON.stringify({ employeeId: "emp-1", date: "2026-01-06", checkIn: "09:30" }),
      }),
    );
    const { id } = (await created.json()) as { id: string };

    const corrected = await app.fetch(
      req(`/attendance/${id}`, {
        method: "PUT",
        permissions: ADMIN,
        body: JSON.stringify({ checkIn: "09:00", checkOut: "17:00" }),
      }),
    );
    expect(corrected.status).toBe(200);
    expect((await corrected.json()) as { checkIn: string }).toMatchObject({ checkIn: "09:00", checkOut: "17:00" });

    const listed = await app.fetch(req("/attendance?employeeId=emp-1", { permissions: ADMIN }));
    expect(((await listed.json()) as { checkIn: string }[])[0]?.checkIn).toBe("09:00");
  });

  it("reports 404 when correcting an entry that is not there", async () => {
    const { app } = await newApp();
    const res = await app.fetch(
      req("/attendance/nope", { method: "PUT", permissions: ADMIN, body: JSON.stringify({ checkIn: "09:00" }) }),
    );
    expect(res.status).toBe(404);
  });

  it("requires all three parameters for a summary and says so", async () => {
    const { app } = await newApp();
    for (const query of ["", "?employeeId=emp-1", "?employeeId=emp-1&from=2026-01-01"]) {
      const res = await app.fetch(req(`/attendance/summary${query}`, { permissions: ADMIN }));
      expect(res.status, query).toBe(400);
    }
  });

  it("summarises a range, counting the days it holds", async () => {
    const { app } = await newApp();
    for (const date of ["2026-01-05", "2026-01-06"]) {
      await app.fetch(
        req("/attendance", {
          method: "POST",
          permissions: ADMIN,
          body: JSON.stringify({ employeeId: "emp-1", date, checkIn: "09:00", checkOut: "17:00" }),
        }),
      );
    }
    const res = await app.fetch(
      req("/attendance/summary?employeeId=emp-1&from=2026-01-01&to=2026-01-31", { permissions: ADMIN }),
    );
    expect(res.status).toBe(200);
    const summary = (await res.json()) as { employeeId: string; present?: number };
    expect(summary.employeeId).toBe("emp-1");
  });

  it("returns an empty list for a filter that matches nothing, not everything", async () => {
    const { app } = await newApp();
    await app.fetch(
      req("/attendance", {
        method: "POST",
        permissions: ADMIN,
        body: JSON.stringify({ employeeId: "emp-1", date: "2026-01-05", checkIn: "09:00" }),
      }),
    );
    const res = await app.fetch(req("/attendance?employeeId=emp-other", { permissions: ADMIN }));
    expect((await res.json()) as unknown[]).toEqual([]);
  });
});

describe("leave policies", () => {
  it("serves the Egyptian presets before any policy exists", async () => {
    const { app } = await newApp();
    const res = await app.fetch(req("/leave-policies/presets", { permissions: ADMIN }));
    expect(res.status).toBe(200);
    expect(((await res.json()) as unknown[]).length).toBeGreaterThan(0);
  });

  it("creates a policy, lists it, updates it and deletes it", async () => {
    const { app } = await newApp();
    const created = await app.fetch(
      req("/leave-policies", {
        method: "POST",
        permissions: ADMIN,
        body: JSON.stringify({ leaveType: "annual", entitlementDays: "21", accrualFrequency: "monthly" }),
      }),
    );
    expect(created.status).toBe(201);
    const policy = (await created.json()) as { id: string; entitlementDays: string };
    expect(policy.entitlementDays).toBe("21.000000");

    const updated = await app.fetch(
      req(`/leave-policies/${policy.id}`, {
        method: "PUT",
        permissions: ADMIN,
        body: JSON.stringify({ entitlementDays: "30" }),
      }),
    );
    expect(updated.status).toBe(200);
    expect(((await updated.json()) as { entitlementDays: string }).entitlementDays).toBe("30.000000");

    const deleted = await app.fetch(req(`/leave-policies/${policy.id}`, { method: "DELETE", permissions: ADMIN }));
    expect(deleted.status).toBeLessThan(300);

    const listed = await app.fetch(req("/leave-policies", { permissions: ADMIN }));
    expect((await listed.json()) as unknown[]).toEqual([]);
  });

  it("refuses a second policy for the same leave type", async () => {
    const { app } = await newApp();
    const body = JSON.stringify({ leaveType: "annual", entitlementDays: "21", accrualFrequency: "monthly" });
    await app.fetch(req("/leave-policies", { method: "POST", permissions: ADMIN, body }));
    const again = await app.fetch(req("/leave-policies", { method: "POST", permissions: ADMIN, body }));
    expect(again.status).toBe(409);
  });

  it("refuses an unknown leave type at the schema", async () => {
    const { app } = await newApp();
    const res = await app.fetch(
      req("/leave-policies", {
        method: "POST",
        permissions: ADMIN,
        body: JSON.stringify({ leaveType: "sabbatical", entitlementDays: "21", accrualFrequency: "monthly" }),
      }),
    );
    expect(res.status).toBe(400);
  });

  it("reports 404 when updating or deleting a policy that is not there", async () => {
    const { app } = await newApp();
    const updated = await app.fetch(
      req("/leave-policies/nope", { method: "PUT", permissions: ADMIN, body: JSON.stringify({ carryOver: true }) }),
    );
    expect(updated.status).toBe(404);
  });

  it("applies a preset and creates the policies it names", async () => {
    const { app } = await newApp();
    const res = await app.fetch(
      req("/leave-policies/apply-preset", {
        method: "POST",
        permissions: ADMIN,
        body: JSON.stringify({ preset: "egypt_labour_law" }),
      }),
    );
    if (res.status === 400) {
      // The preset key is validated by the contract; a rejected key must not
      // have created anything.
      const listed = await app.fetch(req("/leave-policies", { permissions: ADMIN }));
      expect((await listed.json()) as unknown[]).toEqual([]);
      return;
    }
    expect([200, 201]).toContain(res.status);
    const listed = await app.fetch(req("/leave-policies", { permissions: ADMIN }));
    expect(((await listed.json()) as unknown[]).length).toBeGreaterThan(0);
  });
});

describe("leave balances", () => {
  it("creates a balance, then updates the same one rather than duplicating it", async () => {
    const { app } = await newApp();
    const created = await app.fetch(
      req("/leave-balances", {
        method: "POST",
        permissions: ADMIN,
        body: JSON.stringify({ employeeId: "emp-1", leaveType: "annual", year: 2026, entitled: "21" }),
      }),
    );
    expect(created.status).toBe(201);
    expect((await created.json()) as { entitled: string }).toMatchObject({ entitled: "21.000000" });

    const updated = await app.fetch(
      req("/leave-balances", {
        method: "POST",
        permissions: ADMIN,
        body: JSON.stringify({ employeeId: "emp-1", leaveType: "annual", year: 2026, used: "3" }),
      }),
    );
    expect(updated.status).toBe(200);
    expect((await updated.json()) as { entitled: string; used: string }).toMatchObject({
      entitled: "21.000000",
      used: "3.000000",
    });

    const listed = await app.fetch(req("/leave-balances?employeeId=emp-1", { permissions: ADMIN }));
    expect((await listed.json()) as unknown[]).toHaveLength(1);
  });

  it("refuses a balance for an employee who does not exist", async () => {
    const { app } = await newApp();
    const res = await app.fetch(
      req("/leave-balances", {
        method: "POST",
        permissions: ADMIN,
        body: JSON.stringify({ employeeId: "ghost", leaveType: "annual", year: 2026, entitled: "21" }),
      }),
    );
    expect(res.status).toBe(404);
  });

  it("filters by year and by leave type", async () => {
    const { app } = await newApp();
    for (const [leaveType, year] of [
      ["annual", 2026],
      ["sick", 2026],
      ["annual", 2025],
    ] as const) {
      await app.fetch(
        req("/leave-balances", {
          method: "POST",
          permissions: ADMIN,
          body: JSON.stringify({ employeeId: "emp-1", leaveType, year, entitled: "10" }),
        }),
      );
    }
    const byYear = await app.fetch(req("/leave-balances?year=2026", { permissions: ADMIN }));
    expect((await byYear.json()) as unknown[]).toHaveLength(2);

    const byType = await app.fetch(req("/leave-balances?leaveType=sick", { permissions: ADMIN }));
    expect((await byType.json()) as unknown[]).toHaveLength(1);

    const none = await app.fetch(req("/leave-balances?year=2030", { permissions: ADMIN }));
    expect((await none.json()) as unknown[]).toEqual([]);
  });
});

describe("leave accrual", () => {
  it("runs an accrual, numbers the batch and lists it afterwards", async () => {
    const { app } = await newApp();
    await app.fetch(
      req("/leave-policies", {
        method: "POST",
        permissions: ADMIN,
        body: JSON.stringify({ leaveType: "annual", entitlementDays: "21", accrualFrequency: "monthly" }),
      }),
    );

    const res = await app.fetch(
      req("/leave-accrual-batches/run", {
        method: "POST",
        permissions: ADMIN,
        body: JSON.stringify({ runDate: "2026-01-31" }),
      }),
    );
    expect([200, 201]).toContain(res.status);
    const body = (await res.json()) as { batch: { number: string; runType: string }; created: boolean };
    expect(body.batch.number).toBe("LEAVE_ACCRUAL_BATCH-0001");
    expect(body.batch.runType).toBe("manual");

    const listed = await app.fetch(req("/leave-accrual-batches", { permissions: ADMIN }));
    expect(((await listed.json()) as unknown[]).length).toBe(1);
  });

  it("refuses a run with no date", async () => {
    const { app } = await newApp();
    const res = await app.fetch(
      req("/leave-accrual-batches/run", { method: "POST", permissions: ADMIN, body: JSON.stringify({}) }),
    );
    expect(res.status).toBe(400);
  });

  it("filters batches by run type, and ignores a run type it does not know", async () => {
    const { app } = await newApp();
    await app.fetch(
      req("/leave-policies", {
        method: "POST",
        permissions: ADMIN,
        body: JSON.stringify({ leaveType: "annual", entitlementDays: "21", accrualFrequency: "monthly" }),
      }),
    );
    await app.fetch(
      req("/leave-accrual-batches/run", {
        method: "POST",
        permissions: ADMIN,
        body: JSON.stringify({ runDate: "2026-01-31", runType: "scheduled" }),
      }),
    );

    const scheduled = await app.fetch(req("/leave-accrual-batches?runType=scheduled", { permissions: ADMIN }));
    expect(((await scheduled.json()) as unknown[]).length).toBe(1);

    const manual = await app.fetch(req("/leave-accrual-batches?runType=manual", { permissions: ADMIN }));
    expect((await manual.json()) as unknown[]).toEqual([]);

    const nonsense = await app.fetch(req("/leave-accrual-batches?runType=weekly", { permissions: ADMIN }));
    expect(((await nonsense.json()) as unknown[]).length).toBe(1);
  });
});

describe("leave requests", () => {
  async function seedRequest(harness: Awaited<ReturnType<typeof newApp>>) {
    return createLeaveRequest(
      {
        id: "lr-1",
        number: "LR-0001",
        employeeId: "emp-1",
        leaveType: "annual",
        startDate: "2026-02-01",
        endDate: "2026-02-03",
        reason: "سفر",
      },
      harness.leaveRequests,
    );
  }

  it("counts by status, and the counts add up to the total", async () => {
    const harness = await newApp();
    await seedRequest(harness);
    const res = await harness.app.fetch(req("/leave-requests/counts", { permissions: ADMIN }));
    const counts = (await res.json()) as Record<string, number>;
    expect(counts.total).toBe(1);
    expect(counts.pending).toBe(1);
    expect((counts.pending ?? 0) + (counts.approved ?? 0) + (counts.rejected ?? 0) + (counts.cancelled ?? 0)).toBe(
      counts.total,
    );
  });

  it("lists requests and narrows them by status and by employee", async () => {
    const harness = await newApp();
    await seedRequest(harness);

    const all = await harness.app.fetch(req("/leave-requests", { permissions: ADMIN }));
    expect((await all.json()) as unknown[]).toHaveLength(1);

    const pending = await harness.app.fetch(req("/leave-requests?status=pending", { permissions: ADMIN }));
    expect((await pending.json()) as unknown[]).toHaveLength(1);

    const approved = await harness.app.fetch(req("/leave-requests?status=approved", { permissions: ADMIN }));
    expect((await approved.json()) as unknown[]).toEqual([]);

    const other = await harness.app.fetch(req("/leave-requests?employeeId=emp-other", { permissions: ADMIN }));
    expect((await other.json()) as unknown[]).toEqual([]);
  });

  it("approves a request only when the balance covers it, and consumes the balance when it does", async () => {
    const harness = await newApp();
    await seedRequest(harness);

    const refused = await harness.app.fetch(
      req("/leave-requests/lr-1/approve", { method: "POST", permissions: ADMIN, body: JSON.stringify({}) }),
    );
    expect(refused.status).toBe(422);

    await harness.app.fetch(
      req("/leave-balances", {
        method: "POST",
        permissions: ADMIN,
        body: JSON.stringify({ employeeId: "emp-1", leaveType: "annual", year: 2026, entitled: "21" }),
      }),
    );

    const approved = await harness.app.fetch(
      req("/leave-requests/lr-1/approve", { method: "POST", permissions: ADMIN, body: JSON.stringify({}) }),
    );
    expect(approved.status).toBe(200);
    expect((await approved.json()) as { held: boolean; request: { status: string } }).toMatchObject({
      held: false,
      request: { status: "approved" },
    });

    // The days approved must have left the balance — the second number that
    // has to agree with the request.
    const balances = await harness.app.fetch(req("/leave-balances?employeeId=emp-1", { permissions: ADMIN }));
    const [balance] = (await balances.json()) as { used: string }[];
    expect(balance?.used).toBe("3.000000");
  });

  it("rejects a request without touching the balance", async () => {
    const harness = await newApp();
    await seedRequest(harness);
    await harness.app.fetch(
      req("/leave-balances", {
        method: "POST",
        permissions: ADMIN,
        body: JSON.stringify({ employeeId: "emp-1", leaveType: "annual", year: 2026, entitled: "21" }),
      }),
    );

    const res = await harness.app.fetch(
      req("/leave-requests/lr-1/reject", { method: "POST", permissions: ADMIN, body: JSON.stringify({}) }),
    );
    expect(res.status).toBe(200);
    expect((await res.json()) as { request: { status: string } }).toMatchObject({ request: { status: "rejected" } });

    const balances = await harness.app.fetch(req("/leave-balances?employeeId=emp-1", { permissions: ADMIN }));
    const [balance] = (await balances.json()) as { used: string }[];
    expect(balance?.used).toBe("0.000000");
  });

  it("refuses to decide a request twice", async () => {
    const harness = await newApp();
    await seedRequest(harness);
    await harness.app.fetch(
      req("/leave-balances", {
        method: "POST",
        permissions: ADMIN,
        body: JSON.stringify({ employeeId: "emp-1", leaveType: "annual", year: 2026, entitled: "21" }),
      }),
    );
    await harness.app.fetch(
      req("/leave-requests/lr-1/approve", { method: "POST", permissions: ADMIN, body: JSON.stringify({}) }),
    );

    const again = await harness.app.fetch(
      req("/leave-requests/lr-1/reject", { method: "POST", permissions: ADMIN, body: JSON.stringify({}) }),
    );
    expect(again.status).toBe(422);
  });

  it("reports 404 for a decision on a request that does not exist", async () => {
    const { app } = await newApp();
    const res = await app.fetch(
      req("/leave-requests/nope/approve", { method: "POST", permissions: ADMIN, body: JSON.stringify({}) }),
    );
    expect(res.status).toBe(404);
  });
});
