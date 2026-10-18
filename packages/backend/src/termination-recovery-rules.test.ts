import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { INVARIANTS_ZERO, seededWorld, type SeededWorld } from "./test-helpers/seeded-world.js";

let world: SeededWorld;

beforeAll(async () => {
  world = await seededWorld();
}, 120_000);

afterAll(() => world?.close());

const EGP = 1_000_000n;
const PIASTRE = 10_000n;

interface Recovery {
  readonly advanceId: string | null;
  readonly days: number;
  readonly gross: string;
  readonly amount: string;
  readonly payableReduced: string;
  readonly taxRelief: string;
  readonly journalEntryId: string;
}

function entryLines(entryId: string) {
  return world.sqlite
    .prepare(`SELECT jl.account_id AS accountId, jl.debit, jl.credit FROM journal_line jl WHERE jl.entry_id = ? ORDER BY jl.line_no`)
    .safeIntegers()
    .all(entryId) as { accountId: string; debit: bigint; credit: bigint }[];
}
const memoOf = (entryId: string) => (world.sqlite.prepare(`SELECT memo FROM journal_entry WHERE id = ?`).get(entryId) as { memo: string }).memo;
const slip = (employeeId: string, year: number, month: number) =>
  world.sqlite
    .prepare(`SELECT p.id, p.net_pay AS net, p.total_deductions AS deductions, p.lines_json AS lines, r.total_net AS runNet, r.id AS runId FROM hr_payslip p JOIN hr_payroll_run r ON r.id = p.run_id WHERE p.employee_id = ? AND r.year = ? AND r.month = ?`)
    .safeIntegers()
    .get(employeeId, year, month) as { id: string; net: bigint; deductions: bigint; lines: string; runNet: bigint; runId: string };

describe("pay for days after the last day, on a month that is approved and not yet paid out", () => {
  it("is taken off what is owed to the employee — no receivable — in piastres that add up, and the payslip and its run pay the lower net", async () => {
    const before = slip("EMP-DEMO-1", 2026, 7);
    expect(before.net).toBe(8_150n * EGP);
    const balances = { payable: world.balance("2170"), advances: world.balance("1160"), basic: world.balance("5120"), allowances: world.balance("5121") };

    const answer = await world.request("POST", "/hr/employees/EMP-DEMO-1/terminate", { effectiveDate: "2026-07-10" });

    expect(answer.status).toBe(200);
    const recovery = answer.body.payRecovery as Recovery;
    expect(recovery).toMatchObject({ advanceId: null, days: 20, gross: "6666.670000", amount: "0.000000", payableReduced: "6666.670000", taxRelief: "0.000000" });
    expect(entryLines(recovery.journalEntryId)).toEqual([
      { accountId: "2170", debit: 666_667n * PIASTRE, credit: 0n },
      { accountId: "5120", debit: 0n, credit: 6_000n * EGP },
      { accountId: "5121", debit: 0n, credit: 66_667n * PIASTRE },
    ]);
    expect(memoOf(recovery.journalEntryId)).toContain("20 يومًا على أساس شهر 30 يومًا");
    expect(world.balance("1160")).toBe(balances.advances);
    expect(world.balance("2170") - balances.payable).toBe(666_667n * PIASTRE);

    const after = slip("EMP-DEMO-1", 2026, 7);
    expect(after.net).toBe(before.net - 666_667n * PIASTRE);
    expect(after.runNet).toBe(before.runNet - 666_667n * PIASTRE);
    expect((JSON.parse(after.lines) as { source: string; kind: string }[]).filter((l) => l.source === "termination_adjustment")).toHaveLength(1);

    const paid = await world.request("POST", `/hr/payroll/runs/${after.runId}/disburse`, { treasuryAccountId: "TR-DEMO-BANK", branchId: "BR-MAIN", date: "2026-10-05" });
    expect(paid.status, JSON.stringify(paid.body)).toBe(200);
    expect(world.balance("2170") - balances.payable).toBe(before.runNet);
    expect(await world.invariants()).toEqual(INVARIANTS_ZERO);
  });
});

describe("pay for days after the last day, on a month already paid out with tax withheld", () => {
  it("the employee owes back what they received — gross less the income tax withheld on those days — and the tax share comes back off the tax payable: advance + tax relief = gross credited", async () => {
    expect((await world.request("PUT", "/hr/payroll/statutory-flag", { enabled: true, acknowledged: true })).status).toBe(200);
    expect((await world.request("POST", "/hr/employees", { id: "trr-paid", firstName: "موظف", lastName: "مدفوع", branchId: "BR-MAIN", hireDate: "2026-01-01" })).status).toBe(201);
    expect((await world.request("POST", "/hr/contracts", { id: "ct-trr-paid", employeeId: "trr-paid", type: "indefinite", startDate: "2026-01-01", monthlySalary: "9000", currency: "EGP" })).status).toBe(201);
    expect((await world.request("POST", "/hr/payroll/runs", { id: "TRR-RUN", year: 2026, month: 9 })).status).toBe(201);
    expect((await world.request("POST", "/hr/payroll/runs/TRR-RUN/calculate", {})).status).toBe(200);
    expect((await world.request("POST", "/hr/payroll/runs/TRR-RUN/approve", {})).status).toBe(200);
    expect((await world.request("POST", "/hr/payroll/runs/TRR-RUN/disburse", { treasuryAccountId: "TR-DEMO-BANK", branchId: "BR-MAIN", date: "2026-09-30" })).status).toBe(200);
    const taxLine = (JSON.parse(slip("trr-paid", 2026, 9).lines) as { source: string; amount: number; glAccountId: string | null }[]).find((l) => l.source === "income_tax");
    expect(taxLine?.amount).toBe(414_500_000);
    const taxAccount = taxLine?.glAccountId ?? "2191";
    const before = { advances: world.balance("1160"), tax: world.balance(taxAccount), expense: world.balance("5120"), payable: world.balance("2170") };

    const answer = await world.request("POST", "/hr/employees/trr-paid/terminate", { effectiveDate: "2026-09-10" });

    expect(answer.status).toBe(200);
    const recovery = answer.body.payRecovery as Recovery;
    expect(recovery).toMatchObject({ days: 20, gross: "6000.000000", amount: "5723.670000", payableReduced: "0.000000", taxRelief: "276.330000" });
    expect(recovery.advanceId).not.toBeNull();
    expect(world.balance("1160") - before.advances).toBe(572_367n * PIASTRE);
    expect(world.balance(taxAccount) - before.tax).toBe(27_633n * PIASTRE);
    expect(world.balance("5120") - before.expense).toBe(-6_000n * EGP);
    expect(world.balance("2170")).toBe(before.payable);
    expect(572_367n + 27_633n).toBe(600_000n);
    const advance = (await world.request("GET", `/hr/advances/${recovery.advanceId}`)).body;
    expect(advance).toMatchObject({ status: "disbursed", amount: "5723.670000", outstanding: "5723.670000" });
    expect(await world.invariants()).toEqual(INVARIANTS_ZERO);
  });
});
