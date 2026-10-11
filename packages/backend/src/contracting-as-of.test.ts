import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { seededWorld, type SeededWorld } from "./test-helpers/seeded-world.js";

let world: SeededWorld;

beforeAll(async () => {
  world = await seededWorld();
}, 120_000);

afterAll(() => world?.close());

async function contractingTies(periodId: string): Promise<Record<string, string>> {
  const checks = (await world.request("GET", `/period-close/${periodId}/checks`)).body.checks as { code: string; findings?: { ref: string; amount: string }[] }[];
  const findings = (checks.find((c) => c.code === "subledger_ties")?.findings ?? []).filter((f) => f.ref.startsWith("contracting_"));
  return Object.fromEntries(findings.map((f) => [f.ref, f.amount]));
}
const allZero = (ties: Record<string, string>) => Object.values(ties).every((amount) => amount === "0.000000");

describe("a recognition run reversed later", () => {
  it("is reversed on its own period end, so that month's reading and every later one still tie", async () => {
    const before = { august: await contractingTies("fp-2026-08"), september: await contractingTies("fp-2026-09") };
    expect(Object.keys(before.august).length).toBeGreaterThan(0);
    expect(allZero(before.august)).toBe(true);
    expect(allZero(before.september)).toBe(true);

    const reversed = await world.request("POST", "/contracting/recognition/runs/RR-DEMO-VILLAS-2026-08-31/reverse", {});
    expect(`${reversed.status} ${String(reversed.body.status ?? reversed.body.error)}`).toBe("200 reversed");

    expect(world.sqlite.prepare(`SELECT date FROM journal_entry WHERE id LIKE '%REVERSE:RR-DEMO-VILLAS-2026-08-31'`).all()).toEqual([{ date: "2026-08-31" }]);
    expect(allZero(await contractingTies("fp-2026-08"))).toBe(true);
    expect(allZero(await contractingTies("fp-2026-09"))).toBe(true);
  });
});
