import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { seededWorld, type SeededWorld } from "./test-helpers/seeded-world.js";

let world: SeededWorld;

beforeAll(async () => {
  world = await seededWorld();
}, 900_000);

afterAll(() => world?.close());

interface Line {
  kind: string;
  source: string;
  amount: string;
  glAccountId: string | null;
}
const scaled = (major: string) => BigInt(major.replace(".", ""));

describe("a termination adjustment on an approved payslip", () => {
  it("is its own kind of line, so the payslip's deductions by account still equal what the approval entry credited", async () => {
    const terminated = await world.request("POST", "/hr/employees/EMP-DEMO-2/terminate", { effectiveDate: "2026-06-12" });
    expect(terminated.status, JSON.stringify(terminated.body)).toBe(200);

    const run = (await world.request("GET", "/hr/payroll/runs/PR-DEMO-2")).body as { totalDeductions: string; totalNet: string; totalGross: string; journalEntryId: string; payslips: { employeeId: string; totalDeductions: string; netPay: string; grossEarnings: string; lines: Line[] }[] };
    const slip = run.payslips.find((p) => p.employeeId === "EMP-DEMO-2")!;
    const adjustment = slip.lines.filter((l) => l.source === "termination_adjustment");
    expect(adjustment.map((l) => l.kind)).toEqual(["termination_adjustment"]);
    const deductions = slip.lines.filter((l) => l.kind === "deduction").reduce((sum, l) => sum + scaled(l.amount), 0n);
    expect(scaled(slip.totalDeductions)).toBe(deductions);
    expect(scaled(slip.netPay)).toBe(scaled(slip.grossEarnings) - deductions - scaled(adjustment[0]!.amount));

    const byAccount = new Map<string, bigint>();
    for (const payslip of run.payslips) {
      for (const line of payslip.lines) {
        if (line.kind !== "deduction" || line.source === "advance_recovery") continue;
        const account = line.glAccountId ?? "2190";
        byAccount.set(account, (byAccount.get(account) ?? 0n) + scaled(line.amount));
      }
    }
    const credited = world.sqlite
      .prepare(`SELECT account_id AS account, SUM(credit - debit) AS net FROM journal_line WHERE entry_id = ? AND account_id NOT IN ('2170', '1160') GROUP BY account_id HAVING SUM(credit - debit) > 0`)
      .safeIntegers()
      .all(run.journalEntryId) as { account: string; net: bigint }[];
    const employeeShare = credited.filter((row) => byAccount.has(row.account));
    expect(byAccount.has("2170")).toBe(false);
    expect(employeeShare.length).toBe(byAccount.size);
    for (const row of employeeShare) expect(row.net >= (byAccount.get(row.account) ?? 0n), row.account).toBe(true);

    const register = (await world.request("GET", "/reports/hr/payroll-register?year=2026&month=7")).body as { rows?: { employeeId: string; totalDeductions: number; terminationAdjustment: number; netPay: number; gross: number }[] };
    const row = register.rows?.find((r) => r.employeeId === "EMP-DEMO-2");
    expect(row, JSON.stringify(register).slice(0, 300)).toBeDefined();
    expect(row!.terminationAdjustment).toBeGreaterThan(0);
    expect(Math.round((row!.gross - row!.totalDeductions - row!.terminationAdjustment) * 100)).toBe(Math.round(row!.netPay * 100));
  });
});
