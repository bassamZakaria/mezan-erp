import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { INVARIANTS_ZERO, seededWorld, type SeededWorld } from "../test-helpers/seeded-world.js";
import { auditRows, entry, expectJournalRouteClosed, expectRefusedInClosedPeriod } from "./world.js";

let world: SeededWorld;

beforeAll(async () => {
  world = await seededWorld();
}, 900_000);

afterAll(() => world?.close());

interface RunRow {
  id: string;
  status: string;
  entryId: string;
  total: bigint;
}
const augustRun = () =>
  world.sqlite.prepare(`SELECT id, status, journal_entry_id AS entryId, total_amount AS total FROM writedown_run WHERE period = '2026-08' ORDER BY created_at LIMIT 1`).safeIntegers().get() as RunRow;

describe("reversing an inventory write-down run", () => {
  it("takes the provision back out of the ledger, cancels the run, and frees the month for a new run", async () => {
    const run = augustRun();
    expect(run.status).toBe("posted");
    const provisionBefore = world.balance("1190");
    await expectJournalRouteClosed(world, run.entryId);
    await expectRefusedInClosedPeriod(world, "fp-2026-08", () => world.request("POST", `/inventory/writedown-runs/${run.id}/reverse`, { memo: "سبب العكس" }));
    expect(augustRun().status).toBe("posted");

    const reversed = await world.request("POST", `/inventory/writedown-runs/${run.id}/reverse`, { memo: "سبب العكس" });

    expect(reversed.status, JSON.stringify(reversed.body)).toBe(200);
    expect(reversed.body).toMatchObject({ id: run.id, status: "cancelled" });
    expect(entry(world, run.entryId).status).toBe("reversed");
    expect(world.balance("1190") - provisionBefore).toBe(run.total);
    expect(auditRows(world, "WRITEDOWN_RUN", run.id, "REVERSE")).toBe(1);
    expect(await world.invariants()).toEqual(INVARIANTS_ZERO);

    const again = await world.request("POST", `/inventory/writedown-runs/${run.id}/reverse`, { memo: "سبب العكس" });
    expect(`${again.status} ${String(again.body.error)}`).toBe("409 WRITEDOWN_RUN_NOT_POSTED");
    expect(String(again.body.messageEn)).toContain("posted");

    const redrafted = await world.request("POST", "/inventory/writedown-runs", { period: "2026-08" });
    expect(redrafted.status, JSON.stringify(redrafted.body)).toBe(201);
    const duplicate = await world.request("POST", "/inventory/writedown-runs", { period: "2026-08" });
    expect(duplicate.status).toBe(409);
  });
});
