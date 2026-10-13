import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { INVARIANTS_ZERO, seededWorld, type SeededWorld } from "../test-helpers/seeded-world.js";
import { auditRows, entry, expectJournalRouteClosed } from "./world.js";

let world: SeededWorld;

beforeAll(async () => {
  world = await seededWorld();
}, 900_000);

afterAll(() => world?.close());

interface AdvanceRow {
  status: string;
  voucherId: string | null;
  entryId: string | null;
  amount: bigint;
}
const advance = (id: string) =>
  world.sqlite
    .prepare(`SELECT status, disbursement_voucher_id AS voucherId, disbursement_journal_entry_id AS entryId, amount FROM hr_employee_advance WHERE id = ?`)
    .safeIntegers()
    .get(id) as AdvanceRow;
const cancel = (id: string, body: Record<string, unknown> = {}) => world.request("POST", `/hr/advances/${encodeURIComponent(id)}/cancel`, body);

describe("cancelling an employee advance", () => {
  it("cancels an approved advance that was never paid out, with no ledger movement", async () => {
    const before = world.balance("1160");
    const res = await cancel("ADV-DEMO-3");
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(advance("ADV-DEMO-3").status).toBe("cancelled");
    expect(world.balance("1160")).toBe(before);
    expect(auditRows(world, "EMPLOYEE_ADVANCE", "ADV-DEMO-3", "CANCEL")).toBe(1);
  });

  it("refuses a paid-out advance part of which has been repaid, and says how to go on", async () => {
    const refused = await cancel("ADV-DEMO-1", { date: "2026-08-10" });
    expect(`${refused.status} ${String(refused.body.error)}`).toBe("409 ADVANCE_PARTLY_REPAID");
    expect(String(refused.body.message)).toMatch(/[؀-ۿ]/);
    expect(String(refused.body.messageEn)).toContain("repaid");
    expect(advance("ADV-DEMO-1").status).toBe("disbursed");
  });

  it("cancels a paid-out advance nothing was repaid on by reversing its disbursement voucher", async () => {
    world.sqlite.prepare(`UPDATE hr_employee_advance SET status = 'approved' WHERE id = 'ADV-DEMO-4'`).run();
    const paid = await world.request("POST", "/hr/advances/ADV-DEMO-4/disburse", { treasuryAccountId: "TR-DEMO-BANK", branchId: "BR-MAIN", date: "2026-08-12", paymentMethod: "bank" });
    expect(paid.status, JSON.stringify(paid.body)).toBe(200);
    const disbursed = advance("ADV-DEMO-4");
    const receivableBefore = world.balance("1160");
    const bankBefore = world.balance("1310");
    await expectJournalRouteClosed(world, disbursed.entryId as string);

    const res = await cancel("ADV-DEMO-4", { date: "2026-08-14" });

    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(advance("ADV-DEMO-4")).toMatchObject({ status: "cancelled", voucherId: null });
    expect(entry(world, disbursed.entryId as string).status).toBe("reversed");
    expect(receivableBefore - world.balance("1160")).toBe(disbursed.amount);
    expect(world.balance("1310") - bankBefore).toBe(disbursed.amount);
    expect(auditRows(world, "EMPLOYEE_ADVANCE", "ADV-DEMO-4", "CANCEL")).toBe(1);
    expect(await world.invariants()).toEqual(INVARIANTS_ZERO);

    const again = await cancel("ADV-DEMO-4");
    expect(`${again.status} ${String(again.body.error)}`).toBe("422 INVALID_EMPLOYEE_ADVANCE_TRANSITION");
  });

  it("cancels the advance a termination raised for pay after the last day, taking the whole recovery back", async () => {
    const before = { advances: world.balance("1160"), basic: world.balance("5120"), allowances: world.balance("5121"), payable: world.balance("2170") };
    const terminated = await world.request("POST", "/hr/employees/EMP-DEMO-2/terminate", { effectiveDate: "2026-06-12" });
    expect(terminated.status, JSON.stringify(terminated.body)).toBe(200);
    const recovery = terminated.body.payRecovery as { advanceId: string; journalEntryId: string };
    expect(recovery.advanceId).toBeTruthy();
    expect(world.balance("1160")).not.toBe(before.advances);
    await expectJournalRouteClosed(world, recovery.journalEntryId);

    const res = await cancel(recovery.advanceId);

    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(advance(recovery.advanceId).status).toBe("cancelled");
    expect(entry(world, recovery.journalEntryId).status).toBe("reversed");
    expect({ advances: world.balance("1160"), basic: world.balance("5120"), allowances: world.balance("5121"), payable: world.balance("2170") }).toEqual(before);
    expect(await world.invariants()).toEqual(INVARIANTS_ZERO);
  });
});
