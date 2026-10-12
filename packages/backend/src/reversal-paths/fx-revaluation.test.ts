import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { FIVE_INVARIANTS_ZERO, seededWorld, type SeededWorld } from "../test-helpers/seeded-world.js";
import { auditRows, entry, expectJournalRouteClosed, expectRefusedInClosedPeriod } from "./world.js";

let world: SeededWorld;

beforeAll(async () => {
  world = await seededWorld();
}, 900_000);

afterAll(() => world?.close());

const usdFinding = async () => {
  const checks = (await world.request("GET", "/period-close/fp-2026-08/checks")).body.checks as { findings: { kind: string; ref: string; passed: boolean }[] }[];
  return checks.flatMap((c) => c.findings).find((f) => f.kind === "foreign_currency" && f.ref === "USD");
};

describe("reversing an FX revaluation that does not reverse itself", () => {
  it("undoes the restatement through the run's own route, and the month's close reads the currency as not revalued", async () => {
    const bankBefore = world.balance("1310-USD");
    const posted = await world.request("POST", "/revaluation/post", { date: "2026-08-31", currencies: ["USD"], autoReverse: false });
    expect(posted.status).toBe(201);
    const entryId = String(posted.body.entryId);
    expect(world.balance("1310-USD")).not.toBe(bankBefore);
    expect((await usdFinding())?.passed).toBe(true);
    await expectJournalRouteClosed(world, entryId);

    const listed = (await world.request("GET", "/revaluation/runs")).body.runs as { entryId: string; status: string; reversible: boolean }[];
    expect(listed.find((r) => r.entryId === entryId)).toMatchObject({ status: "posted", reversible: true });

    await expectRefusedInClosedPeriod(world, "fp-2026-08", () => world.request("POST", `/revaluation/runs/${entryId}/reverse`, {}));
    expect(entry(world, entryId).status).toBe("posted");

    const reversed = await world.request("POST", `/revaluation/runs/${entryId}/reverse`, {});

    expect(reversed.status, JSON.stringify(reversed.body)).toBe(201);
    expect(entry(world, entryId).status).toBe("reversed");
    expect(entry(world, String(reversed.body.reversalEntryId)).date).toBe("2026-08-31");
    expect(world.balance("1310-USD")).toBe(bankBefore);
    expect((await usdFinding())?.passed).toBe(false);
    expect(auditRows(world, "FX_REVALUATION", entryId, "REVERSE")).toBe(1);
    expect(await world.fiveInvariants()).toEqual(FIVE_INVARIANTS_ZERO);

    const again = await world.request("POST", `/revaluation/runs/${entryId}/reverse`, {});
    expect(`${again.status} ${String(again.body.error)}`).toBe("409 JOURNAL_ENTRY_ALREADY_REVERSED");
    expect(String(again.body.messageEn)).toContain("already");
  });

  it("answers 404 in both languages for an entry that is not a revaluation", async () => {
    const res = await world.request("POST", "/revaluation/runs/LC-DEMO-1/reverse", {});
    expect(`${res.status} ${String(res.body.error)}`).toBe("404 FX_REVALUATION_RUN_NOT_FOUND");
    expect(typeof res.body.messageEn).toBe("string");
  });
});
