import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { DEFAULT_TIME_ZONE, toTenantDay } from "@mezan/domain";
import { INVARIANTS_ZERO, seededWorld, type SeededWorld } from "./test-helpers/seeded-world.js";

let world: SeededWorld;

beforeAll(async () => {
  world = await seededWorld();
}, 120_000);

afterAll(() => world?.close());

const SCALE = 1_000_000n;
const employee = (id: string) => world.sqlite.prepare(`SELECT status, terminated_at AS terminatedAt FROM hr_employee WHERE id = ?`).get(id) as { status: string; terminatedAt: string | null };
const today = () => toTenantDay(new Date().toISOString(), DEFAULT_TIME_ZONE);
const terminate = (id: string, body?: unknown) => world.request("POST", `/hr/employees/${id}/terminate`, body);

interface Recovery {
  readonly advanceId: string | null;
  readonly advanceNumber: string | null;
  readonly days: number;
  readonly gross: string;
  readonly amount: string;
  readonly payableReduced: string;
  readonly taxRelief: string;
  readonly journalEntryId: string;
  readonly paidThrough: string;
}

function entryLines(entryId: string) {
  return world.sqlite
    .prepare(`SELECT jl.account_id AS accountId, jl.debit, jl.credit, je.date FROM journal_line jl JOIN journal_entry je ON je.id = jl.entry_id WHERE je.id = ? ORDER BY jl.debit DESC`)
    .safeIntegers()
    .all(entryId) as { accountId: string; debit: bigint; credit: bigint; date: string }[];
}

describe("ending service against payroll that is already approved", () => {
  it("the seed pays EMP-DEMO-2 for June (disbursed) and July (approved), and August is only calculated", () => {
    const runs = world.sqlite
      .prepare(`SELECT r.month, r.status FROM hr_payslip p JOIN hr_payroll_run r ON r.id = p.run_id WHERE p.employee_id = 'EMP-DEMO-2' AND r.month >= 6 ORDER BY r.month`)
      .all();
    expect(runs).toEqual([
      { month: 6, status: "disbursed" },
      { month: 7, status: "approved" },
      { month: 8, status: "calculated" },
    ]);
  });

  it("a last day of 12 June is accepted: June was paid out, so its 18 days become an advance; July is approved and unpaid, so its 30 come off what is owed — one entry, dated today", async () => {
    const advancesBefore = world.balance("1160");
    const expenseBefore = world.balance("5120");

    const answer = await terminate("EMP-DEMO-2", { effectiveDate: "2026-06-12" });

    expect(answer.status).toBe(200);
    expect(answer.body).toMatchObject({ status: "terminated", terminatedAt: "2026-06-12" });
    const recovery = answer.body.payRecovery as Recovery;
    expect(recovery).toMatchObject({ days: 48, gross: "13440.000000", amount: "5040.000000", payableReduced: "8400.000000", taxRelief: "0.000000", paidThrough: "2026-07-31" });
    expect(recovery.advanceNumber).toMatch(/^ADV-/);

    expect(entryLines(recovery.journalEntryId)).toEqual([
      { accountId: "2170", debit: 8_400n * SCALE, credit: 0n, date: today() },
      { accountId: "1160", debit: 5_040n * SCALE, credit: 0n, date: today() },
      { accountId: "5120", debit: 0n, credit: 12_480n * SCALE, date: today() },
      { accountId: "5121", debit: 0n, credit: 960n * SCALE, date: today() },
    ]);
    expect(world.balance("1160") - advancesBefore).toBe(5_040n * SCALE);
    expect(world.balance("5120") - expenseBefore).toBe(-12_480n * SCALE);
    expect(await world.invariants()).toEqual(INVARIANTS_ZERO);

    const advance = (await world.request("GET", `/hr/advances/${recovery.advanceId}`)).body;
    expect(advance).toMatchObject({ employeeId: "EMP-DEMO-2", status: "disbursed", amount: "5040.000000", outstanding: "5040.000000", disbursementVoucherId: null, disbursementJournalEntryId: recovery.journalEntryId });
  });

  it("the end-of-service statement deducts the recorded overpayment", async () => {
    await world.request("PUT", "/hr/payroll/statutory-flag", { enabled: true, acknowledged: true });
    const statement = await world.request("GET", "/hr/employees/EMP-DEMO-2/end-of-service");
    expect(`${statement.status} ${String(statement.body.outstandingAdvances)}`).toBe("200 5040.000000");
  });

  it("a last day on the thirtieth of a 31-day month owes nothing back on a 30-day divisor, and records no advance", async () => {
    const before = world.balance("1160");
    const answer = await terminate("EMP-DEMO-3", { effectiveDate: "2026-07-30" });
    expect(answer.status).toBe(200);
    expect(answer.body).toMatchObject({ status: "terminated", terminatedAt: "2026-07-30", payRecovery: null });
    expect(world.balance("1160")).toBe(before);
  });

  it("the last day of the last approved month is accepted with nothing to recover; a month that is only calculated is not a paid month", async () => {
    const onPeriodEnd = await terminate("EMP-DEMO-1", { effectiveDate: "2026-07-31" });
    expect(onPeriodEnd.body).toMatchObject({ terminatedAt: "2026-07-31", payRecovery: null });

    const insideCalculated = await terminate("EMP-DEMO-5", { effectiveDate: "2026-08-10" });
    expect(insideCalculated.body).toMatchObject({ terminatedAt: "2026-08-10", payRecovery: null });
  });
});

describe("ending service between this month's payroll approval and the month end", () => {
  const day = "2026-10-20";
  const [year, month] = [2026, 10];
  const monthEnd = "2026-10-31";
  const dayAfterMonthEnd = "2026-11-01";

  beforeAll(async () => {
    vi.useFakeTimers({ toFake: ["Date"], now: new Date(`${day}T10:00:00.000Z`) });
    expect((await world.request("POST", "/hr/payroll/runs", { id: "TERM-RUN", year, month })).status).toBe(201);
    expect((await world.request("POST", "/hr/payroll/runs/TERM-RUN/calculate", {})).status).toBe(200);
    expect((await world.request("POST", "/hr/payroll/runs/TERM-RUN/approve", {})).status).toBe(200);
  });

  afterAll(() => vi.useRealTimers());

  it("the request the screen used to send, with no body, ends service today; the ten days the approved month still pays for come off its unpaid net, less the income tax withheld on them", async () => {
    const answer = await terminate("EMP-DEMO-6");

    expect(answer.status).toBe(200);
    expect(answer.body).toMatchObject({ status: "terminated", terminatedAt: day });
    expect(answer.body.payRecovery).toMatchObject({ advanceId: null, days: 10, gross: "2416.670000", amount: "0.000000", payableReduced: "2364.880000", taxRelief: "51.790000", paidThrough: monthEnd });
    expect(await world.invariants()).toEqual(INVARIANTS_ZERO);
  });

  it("a day past both today and the last paid day is refused, naming the latest day allowed", async () => {
    const refused = await terminate("EMP-DEMO-4", { effectiveDate: dayAfterMonthEnd });
    expect(refused.status).toBe(422);
    expect(refused.body).toMatchObject({ error: "INVALID_EMPLOYEE", message: `تاريخ إنهاء الخدمة لا يمكن أن يكون بعد ${monthEnd}` });
    expect(employee("EMP-DEMO-4")).toMatchObject({ terminatedAt: null });
  });

  it("the month end the payroll already paid to is accepted even though it is still to come", async () => {
    const answer = await terminate("EMP-DEMO-4", { effectiveDate: monthEnd });
    expect(`${answer.status} ${String(answer.body.message ?? "")}`).toBe("200 ");
    expect(answer.body).toMatchObject({ status: "terminated", terminatedAt: monthEnd, payRecovery: null });
  });
});
