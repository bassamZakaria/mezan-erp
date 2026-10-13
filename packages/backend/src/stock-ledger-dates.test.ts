import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { INVARIANTS_ZERO, seededWorld, type SeededWorld } from "./test-helpers/seeded-world.js";

let world: SeededWorld;

beforeAll(async () => {
  world = await seededWorld();
}, 900_000);

afterAll(() => world?.close());

interface DatesRow {
  readonly count: number;
  readonly rows: { docType: string; docId: string; docNo: string | null; movedOn: string; postedOn: string[] }[];
}

const dates = async () => (await world.request("GET", "/reconciliation")).body.stockLedgerDates as unknown as DatesRow;
const tieFindings = async (periodId: string) => {
  const checks = (await world.request("GET", `/period-close/${periodId}/checks`)).body.checks as { code: string; status: string; findings: { kind: string; ref: string; passed: boolean; asOfDate: string | null; items: string[] }[] }[];
  const ties = checks.find((check) => check.code === "subledger_ties")!;
  return { status: ties.status, dated: ties.findings.filter((finding) => finding.kind === "stock_ledger_date") };
};

describe("every stock movement sits in the same month as the entry its document posted", () => {
  it("holds across the whole seeded tenant, and is one of the invariants every scenario is held to", async () => {
    expect(await dates()).toEqual({ count: 0, rows: [] });
    expect(INVARIANTS_ZERO.stockLedgerDates).toBe("0");
    expect(await world.invariants()).toEqual(INVARIANTS_ZERO);
    expect((await tieFindings("fp-2026-08")).dated).toEqual([]);
  });

  it("an entry dated into the month after its stock moved is counted and listed on the reconciliation, and fails that month's and the next month's close check by name", async () => {
    const posted = await world.request("POST", "/inventory/adjustments", { adjustmentId: "SLD-ADJ", warehouseId: "WH-MAIN", reason: "DAMAGE", occurredAt: "2026-08-28", lines: [{ itemId: "ITEM-DEMO-1", direction: "OUT", qty: "1" }] });
    expect(posted.status, JSON.stringify(posted.body)).toBe(201);
    expect((await dates()).count).toBe(0);

    expect(world.sqlite.prepare(`UPDATE journal_entry SET date = '2026-09-01' WHERE id = 'SLD-ADJ' OR source_doc_id = 'SLD-ADJ'`).run().changes).toBeGreaterThan(0);

    expect(await dates()).toEqual({ count: 1, rows: [{ docType: "ADJUSTMENT", docId: "SLD-ADJ", docNo: null, movedOn: "2026-08-28", postedOn: ["2026-09-01"] }] });
    expect((await world.invariants()).stockLedgerDates).toBe("1");
    for (const periodId of ["fp-2026-08", "fp-2026-09"]) {
      const ties = await tieFindings(periodId);
      expect(`${periodId} ${ties.status}`).toBe(`${periodId} fail`);
      expect(ties.dated).toEqual([expect.objectContaining({ passed: false, asOfDate: "2026-08-28", items: ["2026-09-01"] })]);
    }
    expect((await tieFindings("fp-2026-07")).dated).toEqual([]);
  });
});
