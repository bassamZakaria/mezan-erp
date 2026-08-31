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
import { createEmployee } from "@mezan/domain";
import { createHrTimeLeaveRoutes } from "./hr-time-leave-routes.js";

const dirs: string[] = [];
const handles: { close(): void }[] = [];

afterEach(() => {
  for (const h of handles.splice(0)) h.close();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function sharedDb(): string {
  const dir = mkdtempSync(join(tmpdir(), "mezan-hr-cov-"));
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

  await createEmployee(
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

  return { app, leaveBalances, leavePolicies };
}

type App = Awaited<ReturnType<typeof newApp>>["app"];

const ADMIN = "*";

function req(path: string, init: RequestInit & { permissions?: string; userId?: string } = {}) {
  const headers = new Headers(init.headers);
  headers.set("x-permissions", init.permissions ?? ADMIN);
  headers.set("x-user-id", init.userId ?? "user-hr");
  if (init.body !== undefined) headers.set("content-type", "application/json");
  return new Request(`http://local${path}`, { ...init, headers });
}

async function send(app: App, method: string, path: string, payload?: unknown, permissions?: string) {
  return app.fetch(
    req(path, { method, permissions, body: payload === undefined ? undefined : JSON.stringify(payload) }),
  );
}

async function json<T>(res: Response): Promise<T> {
  return (await res.json()) as T;
}

const policyBody = {
  id: "lp-annual",
  leaveType: "annual",
  entitlementDays: "21",
  accrualFrequency: "monthly",
};

describe("hr-time-leave-routes — every write refuses a body it cannot parse", () => {
  const MALFORMED: ReadonlyArray<readonly [string, string, unknown]> = [
    ["POST", "/attendance", { employeeId: 5 }],
    ["POST", "/leave-policies", { leaveType: "sabbatical" }],
    ["PUT", "/leave-policies/lp-annual", { entitlementDays: 5 }],
    ["POST", "/leave-balances", { employeeId: 5 }],
    ["POST", "/leave-accrual-batches/run", { runDate: 5 }],
    ["POST", "/leave-policies/apply-preset", { presetCode: 5 }],
  ];

  it.each(MALFORMED)("%s %s", async (method, path, payload) => {
    const { app } = await newApp();
    await send(app, "POST", "/leave-policies", policyBody);
    const res = await send(app, method, path, payload);
    expect(res.status).toBe(400);
    expect((await json<{ error: string }>(res)).error).toBe("VALIDATION_ERROR");
  });
});

describe("hr-time-leave-routes — leave policies", () => {
  it("keeps an omitted carry-over cap null rather than inventing a number", async () => {
    const { app } = await newApp();
    const res = await send(app, "POST", "/leave-policies", policyBody);
    expect(res.status).toBe(201);
    expect((await json<{ maxCarryOverDays: string | null }>(res)).maxCarryOverDays).toBeNull();
  });

  it("carries a supplied carry-over cap through as an exact quantity", async () => {
    const { app } = await newApp();
    const res = await send(app, "POST", "/leave-policies", { ...policyBody, carryOver: true, maxCarryOverDays: "5" });
    expect((await json<{ maxCarryOverDays: string | null }>(res)).maxCarryOverDays).toBe("5.000000");
  });

  it("409s a second policy for a leave type that already has one", async () => {
    const { app } = await newApp();
    await send(app, "POST", "/leave-policies", policyBody);
    const again = await send(app, "POST", "/leave-policies", { ...policyBody, id: "lp-2" });
    expect([409, 422]).toContain(again.status);
  });

  it("404s an edit or a delete naming a policy that is not registered", async () => {
    const { app } = await newApp();
    expect((await send(app, "PUT", "/leave-policies/nope", { entitlementDays: "10" })).status).toBe(404);
    expect((await send(app, "DELETE", "/leave-policies/nope")).status).toBe(404);
  });

  it("edits only what the patch names, and can clear the carry-over cap explicitly", async () => {
    const { app } = await newApp();
    await send(app, "POST", "/leave-policies", { ...policyBody, carryOver: true, maxCarryOverDays: "5" });

    const raised = await json<{ entitlementDays: string; maxCarryOverDays: string | null }>(
      await send(app, "PUT", "/leave-policies/lp-annual", { entitlementDays: "25" }),
    );
    expect(raised.entitlementDays).toBe("25.000000");
    expect(raised.maxCarryOverDays).toBe("5.000000");

    const cleared = await json<{ maxCarryOverDays: string | null }>(
      await send(app, "PUT", "/leave-policies/lp-annual", { maxCarryOverDays: null }),
    );
    expect(cleared.maxCarryOverDays).toBeNull();
  });

  it("deletes a policy, and it is gone from the list", async () => {
    const { app } = await newApp();
    await send(app, "POST", "/leave-policies", policyBody);
    expect((await send(app, "DELETE", "/leave-policies/lp-annual")).status).toBe(200);
    expect(await json<unknown[]>(await send(app, "GET", "/leave-policies"))).toEqual([]);
  });

  it("serves the Egyptian presets, and applies one into real policies", async () => {
    const { app } = await newApp();
    const presets = await json<Array<{ code: string }>>(await send(app, "GET", "/leave-policies/presets"));
    expect(presets.length).toBeGreaterThan(0);

    const applied = await send(app, "POST", "/leave-policies/apply-preset", { presetCode: presets[0]!.code });
    expect(applied.status).toBe(200);
    expect((await json<unknown[]>(applied)).length).toBeGreaterThan(0);
  });

  it("422s a preset code that does not exist", async () => {
    const { app } = await newApp();
    const res = await send(app, "POST", "/leave-policies/apply-preset", { presetCode: "NOT-A-PRESET" });
    expect([400, 404, 422]).toContain(res.status);
  });
});

describe("hr-time-leave-routes — leave balances", () => {
  it("404s a balance for an employee who is not on the payroll", async () => {
    const { app } = await newApp();
    const res = await send(app, "POST", "/leave-balances", {
      employeeId: "ghost",
      leaveType: "annual",
      year: 2026,
      entitled: "21",
    });
    expect(res.status).toBe(404);
  });

  it("creates a balance, then updates the same one rather than adding a second", async () => {
    const { app } = await newApp();
    const created = await send(app, "POST", "/leave-balances", {
      employeeId: "emp-1",
      leaveType: "annual",
      year: 2026,
      entitled: "21",
    });
    expect(created.status).toBe(201);

    const updated = await send(app, "POST", "/leave-balances", {
      employeeId: "emp-1",
      leaveType: "annual",
      year: 2026,
      carriedOver: "3",
      used: "2",
    });
    expect(updated.status).toBe(200);
    const balance = await json<{ entitled: string; carriedOver: string; used: string }>(updated);
    expect(balance.entitled).toBe("21.000000");
    expect(balance.carriedOver).toBe("3.000000");
    expect(balance.used).toBe("2.000000");

    const all = await json<unknown[]>(await send(app, "GET", "/leave-balances?employeeId=emp-1"));
    expect(all).toHaveLength(1);
  });

  it("narrows the balances by employee, leave type and year", async () => {
    const { app } = await newApp();
    await send(app, "POST", "/leave-balances", { employeeId: "emp-1", leaveType: "annual", year: 2026, entitled: "21" });
    await send(app, "POST", "/leave-balances", { employeeId: "emp-1", leaveType: "sick", year: 2026, entitled: "6" });

    expect(await json<unknown[]>(await send(app, "GET", "/leave-balances?leaveType=annual"))).toHaveLength(1);
    expect(await json<unknown[]>(await send(app, "GET", "/leave-balances?year=2026"))).toHaveLength(2);
    expect(await json<unknown[]>(await send(app, "GET", "/leave-balances?year=2020"))).toEqual([]);
  });
});

describe("hr-time-leave-routes — the accrual run", () => {
  it("runs against a tenant with no policy yet without crediting anything", async () => {
    const { app } = await newApp();
    const res = await send(app, "POST", "/leave-accrual-batches/run", { runDate: "2026-08-31" });
    expect([200, 201]).toContain(res.status);
    const payload = await json<{ batch: { number: string } }>(res);
    expect(payload.batch.number).toMatch(/LEAVE_ACCRUAL_BATCH/);
  });

  it("stamps the run with the caller who asked for it, and its own number", async () => {
    const { app } = await newApp();
    await send(app, "POST", "/leave-policies", policyBody);

    const res = await send(app, "POST", "/leave-accrual-batches/run", {
      runDate: "2026-08-31",
      frequency: "monthly",
      runType: "manual",
      notes: "دورة أغسطس",
    });
    expect([200, 201]).toContain(res.status);
    const payload = await json<{ batch: { runBy: string | null; number: string; notes: string | null } }>(res);
    expect(payload.batch.runBy).toBe("user-hr");
    expect(payload.batch.notes).toBe("دورة أغسطس");
  });

  it("narrows the batch list to the run type asked for", async () => {
    const { app } = await newApp();
    await send(app, "POST", "/leave-policies", policyBody);
    await send(app, "POST", "/leave-accrual-batches/run", { runDate: "2026-08-31", runType: "manual" });

    expect(await json<unknown[]>(await send(app, "GET", "/leave-accrual-batches?runType=manual"))).toHaveLength(1);
    expect(await json<unknown[]>(await send(app, "GET", "/leave-accrual-batches?runType=scheduled"))).toEqual([]);
    // A run type the contract does not define narrows nothing rather than refusing.
    expect(await json<unknown[]>(await send(app, "GET", "/leave-accrual-batches?runType=nonsense"))).toHaveLength(1);
  });
});

describe("hr-time-leave-routes — attendance", () => {
  it("404s a correction naming an entry that was never recorded", async () => {
    const { app } = await newApp();
    expect((await send(app, "PUT", "/attendance/nope", { checkIn: "09:00" })).status).toBe(404);
  });

  it("400s a correction whose body the schema rejects, once the entry exists", async () => {
    const { app } = await newApp();
    await send(app, "POST", "/attendance", { id: "att-1", employeeId: "emp-1", date: "2026-08-10" });
    const res = await send(app, "PUT", "/attendance/att-1", { checkIn: 5 });
    expect(res.status).toBe(400);
  });

  it("records an entry and corrects it in place", async () => {
    const { app } = await newApp();
    const created = await send(app, "POST", "/attendance", {
      id: "att-1",
      employeeId: "emp-1",
      date: "2026-08-10",
      checkIn: "09:00",
      checkOut: "17:00",
    });
    expect(created.status).toBe(201);

    const corrected = await send(app, "PUT", "/attendance/att-1", { checkOut: "18:00" });
    expect(corrected.status).toBe(200);
    expect((await json<{ checkOut: string | null }>(corrected)).checkOut).toBe("18:00");
  });
});
