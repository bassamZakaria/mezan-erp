import { describe, it, expect, afterEach } from "vitest";
import type { Account, JournalPostingDeps } from "@mezan/domain";
import { applyLeavePolicyPreset, Money } from "@mezan/domain";
import {
  createSqliteAccountRepository,
  createSqliteEmployeeRefRepository,
  createSqliteFiscalPeriodRepository,
  createSqliteLeaveAccrualBatchRepository,
  createSqliteLeavePolicyRepository,
  createSqliteLedgerStore,
} from "@mezan/persistence";
import { createHrLeaveAccrualRoutes } from "./hr-leave-accrual-routes.js";

const closers: { close(): void }[] = [];
afterEach(() => {
  for (const h of closers.splice(0)) h.close();
});

function account(id: string, overrides: Partial<Account> = {}): Account {
  return { id, code: id, nameAr: id, nameEn: null, type: "asset", naturalBalance: "debit", parentId: null, isHeader: false, status: "active", ...overrides };
}

function req(path: string, init: RequestInit & { permissions?: string } = {}) {
  const headers = new Headers(init.headers);
  if (init.permissions !== undefined) headers.set("x-permissions", init.permissions);
  if (init.body) headers.set("content-type", "application/json");
  return new Request(`http://local${path}`, { ...init, headers });
}

async function newApp() {
  const batches = createSqliteLeaveAccrualBatchRepository();
  const employees = createSqliteEmployeeRefRepository();
  const policies = createSqliteLeavePolicyRepository();
  const ledger = createSqliteLedgerStore();
  const accounts = createSqliteAccountRepository();
  const periods = createSqliteFiscalPeriodRepository();
  closers.push(batches, employees, policies, ledger, accounts, periods);

  await accounts.create(account("5300", { type: "expense", naturalBalance: "debit" }));
  await accounts.create(account("2250", { type: "liability", naturalBalance: "credit" }));
  await periods.create({ id: "fp-2026-08", year: 2026, periodNumber: 8, startDate: "2026-08-01", endDate: "2026-08-31", status: "open" });
  await applyLeavePolicyPreset({ source: "PRESET_EG_LAW_12_2003", idPrefix: "p12" }, { policies });
  await employees.upsert({ id: "emp-1", code: "EMP-0001", nameAr: "a", departmentId: null, active: true });

  const gl: JournalPostingDeps = { ledger, accounts, periods, numbering: ledger.numbering, now: () => "2026-08-01T12:00:00.000Z", actor: "tester" };

  let seq = 0;
  const app = createHrLeaveAccrualRoutes({
    batches,
    employees,
    policies,
    gl,
    defaultAccounts: { leaveExpenseAccountId: "5300", accruedLeaveLiabilityAccountId: "2250" },
    dailyRate: async () => Money.fromMajor("100.00"),
    idGen: () => `batch-${++seq}`,
  });
  return { app, batches };
}

describe("hr leave-accrual router", () => {
  it("rejects with no permission", async () => {
    const { app } = await newApp();
    expect((await app.fetch(req("/"))).status).toBe(403);
  });

  it("run-now creates and posts a batch with a real GL journal entry in one call", async () => {
    const { app } = await newApp();
    const res = await app.fetch(
      req("/run-now", { method: "POST", permissions: "hr.leave_accrual.run", body: JSON.stringify({ runDate: "2026-08-01" }) }),
    );
    expect(res.status).toBe(201);
    const body = (await res.json()) as { status: string; journalEntryId: string | null };
    expect(body.status).toBe("posted");
    expect(body.journalEntryId).not.toBeNull();

    const list = await app.fetch(req("/", { permissions: "hr.leave_policy.view" }));
    expect(await list.json()).toHaveLength(1);
  });

  it("rejects a duplicate run for the same period", async () => {
    const { app } = await newApp();
    await app.fetch(req("/run-now", { method: "POST", permissions: "hr.leave_accrual.run", body: JSON.stringify({ runDate: "2026-08-01" }) }));
    const second = await app.fetch(
      req("/run-now", { method: "POST", permissions: "hr.leave_accrual.run", body: JSON.stringify({ runDate: "2026-08-15" }) }),
    );
    expect(second.status).toBe(409);
  });
});
