import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { INVARIANTS_ZERO, seededWorld, type SeededWorld } from "../test-helpers/seeded-world.js";
import { auditRows, entry, expectJournalRouteClosed } from "./world.js";

let world: SeededWorld;

beforeAll(async () => {
  world = await seededWorld();
}, 900_000);

afterAll(() => world?.close());

interface RunRow {
  status: string;
  entryId: string | null;
  voucherId: string | null;
  net: bigint;
}
const run = (id: string) =>
  world.sqlite.prepare(`SELECT status, journal_entry_id AS entryId, disbursement_voucher_id AS voucherId, total_net AS net FROM hr_payroll_run WHERE id = ?`).safeIntegers().get(id) as RunRow;
const runEntries = (id: string) =>
  world.sqlite.prepare(`SELECT status FROM journal_entry WHERE source_doc_type = 'PAYROLL_RUN' AND source_doc_id = ? AND reverses_entry_id IS NULL ORDER BY created_at, id`).all(id) as { status: string }[];
const recovered = (advanceId: string) =>
  (world.sqlite.prepare(`SELECT installments_json AS j FROM hr_employee_advance WHERE id = ?`).get(advanceId) as { j: string }).j;
const unapprove = (id: string, body: Record<string, unknown> = {}) => world.request("POST", `/hr/payroll/runs/${id}/reverse-approval`, body);

describe("cancelling the approval of a payroll run", () => {
  it("reverses the approval entry of an approved run not yet paid out, gives the advances their recoveries back, and returns the run to calculated", async () => {
    const before = run("PR-DEMO-2");
    expect(before.status).toBe("approved");
    const entryId = before.entryId as string;
    await expectJournalRouteClosed(world, entryId);
    const payableBefore = world.balance("2170");
    const advancesBefore = world.balance("1160");
    const entryAdvanceCredit = world.sqlite.prepare(`SELECT COALESCE(SUM(credit - debit), 0) AS n FROM journal_line WHERE entry_id = ? AND account_id = '1160'`).safeIntegers().get(entryId) as { n: bigint };
    const scheduleBefore = recovered("ADV-DEMO-1");

    const closedMonth = await unapprove("PR-DEMO-2");
    expect(`${closedMonth.status} ${String(closedMonth.body.error)}`).toBe("422 PERIOD_NOT_OPEN_FOR_POSTING");
    expect(typeof closedMonth.body.messageEn).toBe("string");
    expect(run("PR-DEMO-2").status).toBe("approved");

    const reversed = await unapprove("PR-DEMO-2", { date: "2026-08-03" });

    expect(reversed.status, JSON.stringify(reversed.body)).toBe(200);
    expect(reversed.body).toMatchObject({ id: "PR-DEMO-2", status: "calculated", journalEntryId: null });
    expect(entry(world, entryId).status).toBe("reversed");
    expect(world.balance("2170") - payableBefore).toBe(before.net);
    expect(world.balance("1160") - advancesBefore).toBe(entryAdvanceCredit.n);
    if (entryAdvanceCredit.n > 0n) expect(recovered("ADV-DEMO-1")).not.toBe(scheduleBefore);
    expect(auditRows(world, "PAYROLL_RUN", "PR-DEMO-2", "REVERSE_APPROVAL")).toBe(1);
    expect(await world.invariants()).toEqual(INVARIANTS_ZERO);

    const again = await unapprove("PR-DEMO-2", { date: "2026-08-03" });
    expect(`${again.status} ${String(again.body.error)}`).toBe("409 PAYROLL_RUN_NOT_APPROVED");
    expect(typeof again.body.messageEn).toBe("string");
  });

  it("a run approved again after its approval was reversed posts a fresh entry", async () => {
    expect((await world.request("POST", "/hr/payroll/runs/PR-DEMO-3/approve", {})).status).toBe(200);
    expect((await unapprove("PR-DEMO-3")).status).toBe(200);
    const approvedAgain = await world.request("POST", "/hr/payroll/runs/PR-DEMO-3/approve", {});
    expect(approvedAgain.status, JSON.stringify(approvedAgain.body)).toBe(200);
    expect(runEntries("PR-DEMO-3").map((e) => e.status)).toEqual(["reversed", "posted"]);
    expect(await world.invariants()).toEqual(INVARIANTS_ZERO);
  });

  it("refuses a run already paid out until its disbursement voucher is reversed, then lets it go", async () => {
    const paid = run("PR-DEMO-1");
    expect(paid.status).toBe("disbursed");
    const refused = await unapprove("PR-DEMO-1", { date: "2026-08-04" });
    expect(`${refused.status} ${String(refused.body.error)}`).toBe("409 PAYROLL_RUN_DISBURSED");
    expect(String(refused.body.messageEn)).toContain("disbursement voucher");
    expect(refused.body.disbursementVoucherId).toBe(paid.voucherId);

    const voucherReversed = await world.request("POST", `/vouchers/${paid.voucherId}/reverse`, { date: "2026-08-04" });
    expect(voucherReversed.status, JSON.stringify(voucherReversed.body)).toBeLessThan(300);
    expect(run("PR-DEMO-1")).toMatchObject({ status: "approved", voucherId: null });

    expect((await unapprove("PR-DEMO-1", { date: "2026-08-04" })).status).toBe(200);
    expect(run("PR-DEMO-1").status).toBe("calculated");
    expect(await world.invariants()).toEqual(INVARIANTS_ZERO);
  });
});
