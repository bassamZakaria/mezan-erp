import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createSqliteAccountRepository,
  createSqliteContractRepository,
  createSqliteEmployeeAdvanceRepository,
  createSqliteEmployeeRepository,
  createSqliteFiscalPeriodRepository,
  createSqliteLedgerStore,
  createSqlitePayrollRunRepository,
  createSqlitePayslipRepository,
} from "@mezan/persistence";
import { Money, PAYROLL_GL_ACCOUNTS, createEmployee, type Account, type JournalPostingDeps } from "@mezan/domain";
import { createHrPayrollRoutes } from "./hr-payroll-routes.js";

const dirs: string[] = [];
const handles: { close(): void }[] = [];

afterEach(() => {
  for (const h of handles.splice(0)) h.close();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function account(id: string, overrides: Partial<Account> = {}): Account {
  return {
    id,
    code: id,
    nameAr: id,
    nameEn: null,
    type: "expense",
    naturalBalance: "debit",
    parentId: null,
    isHeader: false,
    status: "active",
    ...overrides,
  };
}

async function newApp() {
  const dir = mkdtempSync(join(tmpdir(), "mezan-payroll-"));
  dirs.push(dir);
  const db = join(dir, "test.db");

  const employees = createSqliteEmployeeRepository(db);
  const contracts = createSqliteContractRepository(db);
  const advances = createSqliteEmployeeAdvanceRepository(db);
  const runs = createSqlitePayrollRunRepository(db);
  const payslips = createSqlitePayslipRepository(db);
  const accounts = createSqliteAccountRepository(db);
  const periods = createSqliteFiscalPeriodRepository(db);
  const ledger = createSqliteLedgerStore(db);
  handles.push(employees, contracts, advances, runs, payslips, accounts, periods, ledger);

  for (const [id, type, natural] of [
    [PAYROLL_GL_ACCOUNTS.salaryExpenseAccountId, "expense", "debit"],
    [PAYROLL_GL_ACCOUNTS.salariesPayableAccountId, "liability", "credit"],
    [PAYROLL_GL_ACCOUNTS.employeeAdvanceAccountId, "asset", "debit"],
    [PAYROLL_GL_ACCOUNTS.deductionLiabilityAccountId, "liability", "credit"],
    [PAYROLL_GL_ACCOUNTS.employerContributionExpenseAccountId, "expense", "debit"],
    [PAYROLL_GL_ACCOUNTS.employerContributionLiabilityAccountId, "liability", "credit"],
  ] as const) {
    await accounts.create(account(id, { type, naturalBalance: natural }));
  }
  await periods.create({
    id: "fp-2026-03",
    year: 2026,
    periodNumber: 3,
    startDate: "2026-03-01",
    endDate: "2026-03-31",
    status: "open",
  });

  const gl: JournalPostingDeps = {
    ledger,
    accounts,
    periods,
    numbering: ledger.numbering,
    now: () => "2026-03-31T12:00:00.000Z",
    actor: "tester",
  };

  let counter = 0;
  const numbered = new Map<string, number>();
  const app = createHrPayrollRoutes({
    advances,
    runs,
    payslips,
    employees,
    contracts,
    gl,
    accounts: PAYROLL_GL_ACCOUNTS,
    numbering: {
      async next(code: string) {
        const seen = (numbered.get(code) ?? 0) + 1;
        numbered.set(code, seen);
        return { formatted: `${code}-${String(seen).padStart(4, "0")}` };
      },
    },
    idGen: () => `gen-${++counter}`,
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

  return { app, advances, runs, payslips, ledger, accounts };
}

function req(path: string, init: RequestInit & { permissions?: string } = {}) {
  const headers = new Headers(init.headers);
  if (init.permissions !== undefined) headers.set("x-permissions", init.permissions);
  headers.set("x-user-id", "user-hr");
  if (init.body !== undefined) headers.set("content-type", "application/json");
  return new Request(`http://local${path}`, { ...init, headers });
}

const ADMIN = "*";

const advanceBody = {
  employeeId: "emp-1",
  amount: "3000",
  installmentCount: 3,
  firstDeductionDate: "2026-04-01",
};

describe("HR payroll routes — the permission gate", () => {
  it("refuses a caller with no permissions on every surface", async () => {
    const { app } = await newApp();
    for (const path of ["/advances", "/advances/outstanding", "/payroll/runs", "/payroll/payslips"]) {
      expect((await app.fetch(req(path, { permissions: "" }))).status, path).toBe(403);
    }
  });

  it("refuses a writer who only holds the view permission", async () => {
    const { app } = await newApp();
    const res = await app.fetch(
      req("/advances", { method: "POST", permissions: "hr.advance.view", body: JSON.stringify(advanceBody) }),
    );
    expect(res.status).toBe(403);
  });

  it("names the permission it wanted", async () => {
    const { app } = await newApp();
    const res = await app.fetch(req("/payroll/runs", { permissions: "hr.advance.view" }));
    expect(await res.json()).toMatchObject({ error: "PERMISSION_DENIED", permission: "hr.payroll.view" });
  });
});

describe("employee advances", () => {
  it("requests an advance, numbers it, and reads it back", async () => {
    const { app } = await newApp();
    const created = await app.fetch(
      req("/advances", { method: "POST", permissions: ADMIN, body: JSON.stringify(advanceBody) }),
    );
    expect(created.status).toBe(201);
    const advance = (await created.json()) as { id: string; number: string; amount: string; status: string };
    expect(advance.number).toBe("EMPLOYEE_ADVANCE-0001");
    expect(advance.amount).toBe("3000.000000");
    expect(advance.status).toBe("pending");

    const fetched = await app.fetch(req(`/advances/${advance.id}`, { permissions: ADMIN }));
    expect((await fetched.json()) as { id: string }).toMatchObject({ id: advance.id });
  });

  it("refuses an advance for an employee who does not exist", async () => {
    const { app } = await newApp();
    const res = await app.fetch(
      req("/advances", {
        method: "POST",
        permissions: ADMIN,
        body: JSON.stringify({ ...advanceBody, employeeId: "ghost" }),
      }),
    );
    expect(res.status).toBe(404);
  });

  it("refuses a malformed body and names the field", async () => {
    const { app } = await newApp();
    const res = await app.fetch(
      req("/advances", {
        method: "POST",
        permissions: ADMIN,
        body: JSON.stringify({ ...advanceBody, installmentCount: 0 }),
      }),
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { details: { fieldErrors: Record<string, string[]> } };
    expect(Object.keys(body.details.fieldErrors)).toContain("installmentCount");
  });

  it("reports 404 for an advance that is not there", async () => {
    const { app } = await newApp();
    expect((await app.fetch(req("/advances/nope", { permissions: ADMIN }))).status).toBe(404);
  });

  it("approves and rejects, and refuses to decide the same advance twice", async () => {
    const { app } = await newApp();
    const created = await app.fetch(
      req("/advances", { method: "POST", permissions: ADMIN, body: JSON.stringify(advanceBody) }),
    );
    const { id } = (await created.json()) as { id: string };

    const approved = await app.fetch(req(`/advances/${id}/approve`, { method: "POST", permissions: ADMIN }));
    expect(approved.status).toBe(200);
    expect((await approved.json()) as { status: string }).toMatchObject({ status: "approved" });

    const rejectedAfter = await app.fetch(req(`/advances/${id}/reject`, { method: "POST", permissions: ADMIN }));
    expect(rejectedAfter.status).toBeGreaterThanOrEqual(400);
  });

  it("rejects a fresh request outright", async () => {
    const { app } = await newApp();
    const created = await app.fetch(
      req("/advances", { method: "POST", permissions: ADMIN, body: JSON.stringify(advanceBody) }),
    );
    const { id } = (await created.json()) as { id: string };
    const res = await app.fetch(req(`/advances/${id}/reject`, { method: "POST", permissions: ADMIN }));
    expect(res.status).toBe(200);
    expect((await res.json()) as { status: string }).toMatchObject({ status: "rejected" });
  });

  it("answers 409 when a disbursement is asked for and no treasury is wired in", async () => {
    const { app } = await newApp();
    const created = await app.fetch(
      req("/advances", { method: "POST", permissions: ADMIN, body: JSON.stringify(advanceBody) }),
    );
    const { id } = (await created.json()) as { id: string };
    await app.fetch(req(`/advances/${id}/approve`, { method: "POST", permissions: ADMIN }));

    const res = await app.fetch(
      req(`/advances/${id}/disburse`, {
        method: "POST",
        permissions: ADMIN,
        body: JSON.stringify({ treasuryAccountId: "tr-1", branchId: "br-1" }),
      }),
    );
    expect(res.status).toBe(409);
  });

  it("lists advances, narrows them by employee, and reports an outstanding balance per employee", async () => {
    const { app } = await newApp();
    await app.fetch(req("/advances", { method: "POST", permissions: ADMIN, body: JSON.stringify(advanceBody) }));

    const all = await app.fetch(req("/advances", { permissions: ADMIN }));
    expect((await all.json()) as unknown[]).toHaveLength(1);

    const mine = await app.fetch(req("/advances?employeeId=emp-1", { permissions: ADMIN }));
    expect((await mine.json()) as unknown[]).toHaveLength(1);

    const other = await app.fetch(req("/advances?employeeId=emp-2", { permissions: ADMIN }));
    expect((await other.json()) as unknown[]).toEqual([]);

    const outstanding = await app.fetch(req("/advances/outstanding", { permissions: ADMIN }));
    const rows = (await outstanding.json()) as { employeeId: string; outstanding: string; advanceCount: number }[];
    expect(rows).toHaveLength(1);
    expect(rows[0]?.employeeId).toBe("emp-1");
    // Nothing has been disbursed, so nothing is owed yet.
    expect(rows[0]?.advanceCount).toBe(0);
  });
});

describe("payroll runs", () => {
  const runBody = { year: 2026, month: 3, currency: "EGP" };

  it("creates a run, numbers it, and reads it back with its payslips", async () => {
    const { app } = await newApp();
    const created = await app.fetch(
      req("/payroll/runs", { method: "POST", permissions: ADMIN, body: JSON.stringify(runBody) }),
    );
    expect(created.status).toBe(201);
    const run = (await created.json()) as { id: string; number: string; status: string };
    expect(run.number).toBe("PAYROLL_RUN-0001");
    expect(run.status).toBe("draft");

    const fetched = await app.fetch(req(`/payroll/runs/${run.id}`, { permissions: ADMIN }));
    expect((await fetched.json()) as { payslips: unknown[] }).toMatchObject({ id: run.id, payslips: [] });
  });

  it("refuses a second run for the same month", async () => {
    const { app } = await newApp();
    await app.fetch(req("/payroll/runs", { method: "POST", permissions: ADMIN, body: JSON.stringify(runBody) }));
    const again = await app.fetch(
      req("/payroll/runs", { method: "POST", permissions: ADMIN, body: JSON.stringify(runBody) }),
    );
    expect(again.status).toBeGreaterThanOrEqual(400);
  });

  it("refuses a month outside 1–12", async () => {
    const { app } = await newApp();
    const res = await app.fetch(
      req("/payroll/runs", { method: "POST", permissions: ADMIN, body: JSON.stringify({ ...runBody, month: 13 }) }),
    );
    expect(res.status).toBe(400);
  });

  it("reports 404 for a run that is not there, on every verb", async () => {
    const { app } = await newApp();
    expect((await app.fetch(req("/payroll/runs/nope", { permissions: ADMIN }))).status).toBe(404);
    expect(
      (await app.fetch(req("/payroll/runs/nope/calculate", { method: "POST", permissions: ADMIN }))).status,
    ).toBe(404);
    expect((await app.fetch(req("/payroll/runs/nope/approve", { method: "POST", permissions: ADMIN }))).status).toBe(
      404,
    );
    expect((await app.fetch(req("/payroll/runs/nope/cancel", { method: "POST", permissions: ADMIN }))).status).toBe(
      404,
    );
  });

  it("refuses to calculate a run with nobody to pay, rather than posting an empty entry", async () => {
    const { app, ledger } = await newApp();
    const created = await app.fetch(
      req("/payroll/runs", { method: "POST", permissions: ADMIN, body: JSON.stringify(runBody) }),
    );
    const { id } = (await created.json()) as { id: string };

    const calculated = await app.fetch(req(`/payroll/runs/${id}/calculate`, { method: "POST", permissions: ADMIN }));
    expect(calculated.status).toBeGreaterThanOrEqual(400);
    expect(await ledger.list()).toHaveLength(0);
  });

  it("cancels a draft run", async () => {
    const { app } = await newApp();
    const created = await app.fetch(
      req("/payroll/runs", { method: "POST", permissions: ADMIN, body: JSON.stringify(runBody) }),
    );
    const { id } = (await created.json()) as { id: string };
    const res = await app.fetch(req(`/payroll/runs/${id}/cancel`, { method: "POST", permissions: ADMIN }));
    expect(res.status).toBe(200);
    expect((await res.json()) as { status: string }).toMatchObject({ status: "cancelled" });
  });

  it("lists runs and payslips, and filters payslips that match nothing to an empty list", async () => {
    const { app } = await newApp();
    await app.fetch(req("/payroll/runs", { method: "POST", permissions: ADMIN, body: JSON.stringify(runBody) }));

    const runs = await app.fetch(req("/payroll/runs", { permissions: ADMIN }));
    expect(((await runs.json()) as unknown[]).length).toBe(1);

    const payslips = await app.fetch(req("/payroll/payslips?employeeId=emp-1", { permissions: ADMIN }));
    expect((await payslips.json()) as unknown[]).toEqual([]);
  });

  it("refuses a disbursement body with no treasury account", async () => {
    const { app } = await newApp();
    const created = await app.fetch(
      req("/payroll/runs", { method: "POST", permissions: ADMIN, body: JSON.stringify(runBody) }),
    );
    const { id } = (await created.json()) as { id: string };
    const res = await app.fetch(
      req(`/payroll/runs/${id}/disburse`, { method: "POST", permissions: ADMIN, body: JSON.stringify({}) }),
    );
    expect(res.status).toBe(400);
  });

  it("posts nothing to the ledger anywhere along the refused paths", async () => {
    const { app, ledger } = await newApp();
    const created = await app.fetch(
      req("/payroll/runs", { method: "POST", permissions: ADMIN, body: JSON.stringify(runBody) }),
    );
    const { id } = (await created.json()) as { id: string };
    await app.fetch(req(`/payroll/runs/${id}/calculate`, { method: "POST", permissions: ADMIN }));
    await app.fetch(req(`/payroll/runs/${id}/approve`, { method: "POST", permissions: ADMIN }));
    expect(await ledger.list()).toHaveLength(0);
    expect(Money.zero().scaled).toBe(0n);
  });
});
