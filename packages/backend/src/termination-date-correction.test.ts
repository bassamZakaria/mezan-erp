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

describe("correcting a wrong termination date", () => {
  it("undoes what the first date booked and books the right date afresh; the journal's own reverse stays closed", async () => {
    const before = { payable: world.balance("2170"), advances: world.balance("1160"), basic: world.balance("5120"), allowances: world.balance("5121") };
    const julyBefore = slip("EMP-DEMO-2", 2026, 7);
    const first = await world.request("POST", "/hr/employees/EMP-DEMO-2/terminate", { effectiveDate: "2026-06-12" });
    expect(first.status).toBe(200);
    const firstRecovery = first.body.payRecovery as Recovery;
    expect(firstRecovery).toMatchObject({ days: 48, amount: "5040.000000", payableReduced: "8400.000000" });

    const viaJournal = await world.request("POST", `/gl/journal-entries/${encodeURIComponent(firstRecovery.journalEntryId)}/reverse`, {});
    expect(`${viaJournal.status} ${String(viaJournal.body.error)}`).toBe("422 JOURNAL_ENTRY_OWNED_BY_DOCUMENT");

    const corrected = await world.request("POST", "/hr/employees/EMP-DEMO-2/correct-termination-date", { effectiveDate: "2026-07-15" });

    expect(corrected.status, JSON.stringify(corrected.body)).toBe(200);
    expect(corrected.body).toMatchObject({ status: "terminated", terminatedAt: "2026-07-15" });
    const second = corrected.body.payRecovery as Recovery;
    expect(second).toMatchObject({ advanceId: null, days: 15, gross: "4200.000000", amount: "0.000000", payableReduced: "4200.000000" });
    expect((await world.request("GET", `/hr/advances/${firstRecovery.advanceId}`)).body).toMatchObject({ status: "cancelled" });
    expect(world.balance("1160")).toBe(before.advances);
    expect(world.balance("2170") - before.payable).toBe(4_200n * EGP);
    expect(world.balance("5120") + world.balance("5121") - before.basic - before.allowances).toBe(-4_200n * EGP);
    expect(slip("EMP-DEMO-2", 2026, 7).net).toBe(julyBefore.net - 4_200n * EGP);
    expect(slip("EMP-DEMO-2", 2026, 7).runNet).toBe(julyBefore.runNet - 4_200n * EGP);
    expect(await world.invariants()).toEqual(INVARIANTS_ZERO);

    const back = await world.request("POST", "/hr/employees/EMP-DEMO-2/correct-termination-date", { effectiveDate: "2026-07-31" });
    expect(back.status).toBe(200);
    expect(back.body.payRecovery).toBeNull();
    expect(world.balance("2170")).toBe(before.payable);
    expect(slip("EMP-DEMO-2", 2026, 7).net).toBe(julyBefore.net);
  });

  it("refuses an employee who is still in service, and a missing date", async () => {
    const active = await world.request("POST", "/hr/employees/EMP-DEMO-3/correct-termination-date", { effectiveDate: "2026-07-15" });
    expect(`${active.status} ${String(active.body.error)}`).toBe("422 EMPLOYEE_NOT_TERMINATED");
    expect(String(active.body.messageEn)).toContain("EMP-DEMO-3");
    expect((await world.request("POST", "/hr/employees/EMP-DEMO-2/correct-termination-date", {})).status).toBe(400);
  });
});
