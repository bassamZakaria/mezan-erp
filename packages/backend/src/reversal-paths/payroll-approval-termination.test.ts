import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { INVARIANTS_ZERO, seededWorld, type SeededWorld } from "../test-helpers/seeded-world.js";
import { entry } from "./world.js";

let world: SeededWorld;

beforeAll(async () => {
  world = await seededWorld();
}, 900_000);

afterAll(() => world?.close());

const run = () => world.sqlite.prepare(`SELECT status, journal_entry_id AS entryId, number FROM hr_payroll_run WHERE id = 'PR-DEMO-2'`).get() as { status: string; entryId: string; number: string };
const adjustments = async () =>
  ((await world.request("GET", "/hr/payroll/runs/PR-DEMO-2")).body.payslips as { lines: { source: string }[] }[]).flatMap((slip) => slip.lines).filter((line) => line.source === "termination_adjustment").length;
const unapprove = () => world.request("POST", "/hr/payroll/runs/PR-DEMO-2/reverse-approval", { memo: "اختبار", date: "2026-08-05" });

describe("cancelling the approval of a run that carries a termination adjustment", () => {
  it("is refused while the adjustment stands, and goes through once the termination date is corrected to the last paid day", async () => {
    const approved = run();
    expect(approved.status).toBe("approved");
    expect((await world.request("POST", "/hr/employees/EMP-DEMO-2/terminate", { effectiveDate: "2026-06-12" })).status).toBe(200);
    expect(await adjustments()).toBe(1);
    const entries = world.count("journal_entry");

    const refused = await unapprove();

    expect(`${refused.status} ${String(refused.body.error)}`).toBe("409 PAYROLL_RUN_HAS_TERMINATION_ADJUSTMENT");
    expect(String(refused.body.message)).toContain(approved.number);
    expect(String(refused.body.message)).toContain("تسوية إنهاء خدمة");
    expect(String(refused.body.messageEn)).toContain("termination adjustment");
    expect(run()).toEqual(approved);
    expect(entry(world, approved.entryId).status).toBe("posted");
    expect(world.count("journal_entry")).toBe(entries);

    const corrected = await world.request("POST", "/hr/employees/EMP-DEMO-2/correct-termination-date", { effectiveDate: "2026-07-31" });
    expect(corrected.status, JSON.stringify(corrected.body)).toBe(200);
    expect(await adjustments()).toBe(0);

    const allowed = await unapprove();

    expect(allowed.status, JSON.stringify(allowed.body)).toBe(200);
    expect(run().status).toBe("calculated");
    expect(entry(world, approved.entryId).status).toBe("reversed");
    expect(await world.invariants()).toEqual(INVARIANTS_ZERO);
  });
});
