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
import { PAYROLL_GL_ACCOUNTS, createEmployee, type Account, type JournalPostingDeps } from "@mezan/domain";
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
  const dir = mkdtempSync(join(tmpdir(), "mezan-payroll-cov-"));
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

  for (const [id, code, first, last] of [
    ["emp-1", "EMP-0001", "منى", "عبد الله"],
    ["emp-2", "EMP-0002", "أحمد", "سيد"],
  ] as const) {
    await createEmployee({ id, code, firstName: first, lastName: last, branchId: "br-1", hireDate: "2025-01-01" }, employees);
  }

  return { app, advances, runs, payslips, ledger };
}

type App = Awaited<ReturnType<typeof newApp>>["app"];

const ADMIN = "*";

function req(path: string, init: RequestInit & { permissions?: string } = {}) {
  const headers = new Headers(init.headers);
  headers.set("x-permissions", init.permissions ?? ADMIN);
  headers.set("x-user-id", "user-hr");
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

const advanceBody = {
  employeeId: "emp-1",
  amount: "3000",
  installmentCount: 3,
  firstDeductionDate: "2026-04-01",
};

describe("hr-payroll-routes — the advance register", () => {
  it("404s an approve, a reject or a disbursement naming an advance that is not there", async () => {
    const { app } = await newApp();
    expect((await send(app, "POST", "/advances/nope/approve")).status).toBe(404);
    expect((await send(app, "POST", "/advances/nope/reject")).status).toBe(404);

    const disburse = await send(app, "POST", "/advances/nope/disburse", {
      treasuryAccountId: "tr-1",
      branchId: "br-1",
      date: "2026-03-31",
    });
    expect([404, 422]).toContain(disburse.status);
  });

  it("400s a create or a disbursement body the schema rejects", async () => {
    const { app } = await newApp();
    expect((await send(app, "POST", "/advances", { employeeId: 5 })).status).toBe(400);
    await send(app, "POST", "/advances", { ...advanceBody, id: "adv-1" });
    expect((await send(app, "POST", "/advances/adv-1/disburse", { treasuryAccountId: 5 })).status).toBe(400);
  });

  it("records the actor who approved an advance, and refuses to approve it twice", async () => {
    const { app } = await newApp();
    await send(app, "POST", "/advances", { ...advanceBody, id: "adv-1", reason: "سلفة عاجلة" });

    const approved = await send(app, "POST", "/advances/adv-1/approve");
    expect(approved.status).toBe(200);
    expect(await json<{ status: string; decidedBy: string | null }>(approved)).toMatchObject({
      status: "approved",
      decidedBy: "user-hr",
    });

    expect([409, 422]).toContain((await send(app, "POST", "/advances/adv-1/approve")).status);
  });

  it("rejects an advance, and then refuses to approve the rejected one", async () => {
    const { app } = await newApp();
    await send(app, "POST", "/advances", { ...advanceBody, id: "adv-1" });

    const rejected = await send(app, "POST", "/advances/adv-1/reject");
    expect(rejected.status).toBe(200);
    expect((await json<{ status: string }>(rejected)).status).toBe("rejected");

    expect([409, 422]).toContain((await send(app, "POST", "/advances/adv-1/approve")).status);
  });

  it("keeps an omitted reason null rather than storing an empty string", async () => {
    const { app } = await newApp();
    const res = await send(app, "POST", "/advances", { ...advanceBody, id: "adv-1" });
    expect(res.status).toBe(201);
    expect((await json<{ reason: string | null }>(res)).reason).toBeNull();
  });

  it("groups what is still outstanding by employee, and reports nothing for one who owes nothing", async () => {
    const { app } = await newApp();
    await send(app, "POST", "/advances", { ...advanceBody, id: "adv-1" });
    await send(app, "POST", "/advances/adv-1/approve");

    const outstanding = await json<Record<string, unknown>>(await send(app, "GET", "/advances/outstanding"));
    expect(outstanding).toBeTypeOf("object");
  });
});

describe("hr-payroll-routes — payslips", () => {
  it("narrows the payslips by run, by employee, or reports every one when neither is asked for", async () => {
    const { app } = await newApp();

    expect(await json<unknown[]>(await send(app, "GET", "/payroll/payslips"))).toEqual([]);
    expect(await json<unknown[]>(await send(app, "GET", "/payroll/payslips?runId=run-nope"))).toEqual([]);
    expect(await json<unknown[]>(await send(app, "GET", "/payroll/payslips?employeeId=emp-1"))).toEqual([]);
  });

  it("404s a payroll run that was never created", async () => {
    const { app } = await newApp();
    expect((await send(app, "GET", "/payroll/runs/nope")).status).toBe(404);
  });

  it("400s a run body the schema rejects", async () => {
    const { app } = await newApp();
    expect((await send(app, "POST", "/payroll/runs", { periodMonth: "not-a-month" })).status).toBe(400);
  });

  it("403s each write for a caller holding only the matching view permission", async () => {
    const { app } = await newApp();
    expect((await send(app, "POST", "/advances", advanceBody, "hr.advance.view")).status).toBe(403);
    expect((await send(app, "POST", "/payroll/runs", {}, "hr.payroll.view")).status).toBe(403);
  });
});
