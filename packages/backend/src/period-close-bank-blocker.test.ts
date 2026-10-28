import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { INVARIANTS_ZERO, seededWorld, type SeededWorld } from "./test-helpers/seeded-world.js";

let world: SeededWorld;

beforeAll(async () => {
  world = await seededWorld();
}, 900_000);

afterAll(() => world?.close());

interface Finding {
  kind: string;
  ref: string;
  state: string;
  passed: boolean;
  count: number | null;
}
interface Line {
  id: string;
  description: string;
  reference: string | null;
  amount: string;
  status: string;
  matchedEntryId: string | null;
}

const AUGUST = "BSTMT-DEMO-1";
const bankCheck = async (periodId: string) => {
  const checks = (await world.request("GET", `/period-close/${periodId}/checks`)).body.checks as { code: string; status: string; findings: Finding[] }[];
  return checks.find((check) => check.code === "bank_statements")!;
};
const statementFinding = async (statementId: string) => (await bankCheck("fp-2026-08")).findings.find((finding) => finding.ref === statementId);
const linesOf = async (statementId: string) => (await world.request("GET", `/bank-statements/${statementId}`)).body.lines as Line[];

describe("the bank statements the demo ships with", () => {
  it("January to July: each month's statement is finalized, every line matched, in the bank's own wording and quoting the transfer reference the books hold", async () => {
    for (const month of ["01", "02", "03", "04", "05", "06", "07"]) {
      const statementId = `BSTMT-DEMO-2026-${month}`;
      const statement = (await world.request("GET", `/bank-statements/${statementId}`)).body as { status: string; finalizeOverrideReason: string | null; lines: Line[] };
      expect(`${statementId} ${statement.status} ${String(statement.finalizeOverrideReason)}`).toBe(`${statementId} completed null`);
      expect(statement.lines.length).toBeGreaterThan(0);
      expect(statement.lines.filter((line) => line.status !== "matched")).toEqual([]);
      expect([...new Set(statement.lines.map((line) => line.description))].sort()).toEqual(expect.arrayContaining(["إيداع نقدي بالفرع", "تحويل صادر"]));
      for (const line of statement.lines) {
        const voucher = world.sqlite
          .prepare(`SELECT v.reference_no AS referenceNo FROM journal_entry je JOIN voucher v ON v.id = je.source_doc_id WHERE je.id = ?`)
          .get(line.matchedEntryId) as { referenceNo: string | null } | undefined;
        if (voucher?.referenceNo) expect(`${line.id} ${String(line.reference)}`).toBe(`${line.id} ${voucher.referenceNo}`);
      }
      expect((await bankCheck(`fp-2026-${month}`)).status).toBe("pass");
    }
  });

  it("August's statement opens on the balance July's closed on, so the two tell one story of the account", async () => {
    const july = (await world.request("GET", "/bank-statements/BSTMT-DEMO-2026-07")).body as { closingBalance: string };
    const august = (await world.request("GET", `/bank-statements/${AUGUST}`)).body as { openingBalance: string };
    expect(august.openingBalance).toBe(july.closingBalance);
  });

  it("August is blocked by a statement with lines nobody has matched yet, and the checklist says how many", async () => {
    const unmatched = (await linesOf(AUGUST)).filter((line) => line.status !== "matched");
    expect(unmatched.length).toBe(12);
    expect(await statementFinding(AUGUST)).toMatchObject({ kind: "bank_statement", state: "unreconciled", passed: false, count: 12 });
    expect((await bankCheck("fp-2026-08")).status).toBe("fail");
  });

  it("matching the lines clears the unreconciled blocker, and finalizing the statement with no override passes it", async () => {
    for (const line of (await linesOf(AUGUST)).filter((each) => each.status !== "matched")) {
      const linePath = `/bank-statements/${AUGUST}/lines/${encodeURIComponent(line.id)}`;
      const candidates = (await world.request("GET", `/bank-statements/${AUGUST}/candidates?lineId=${encodeURIComponent(line.id)}`)).body as unknown as { entryId: string; amount: string }[];
      const entry = candidates.find((candidate) => candidate.amount === line.amount);
      const done = entry ? await world.request("POST", `${linePath}/match`, { entryId: entry.entryId }) : await world.request("POST", `${linePath}/create-entry`, {});
      expect(done.status, `${line.id} ${line.description} ${JSON.stringify(done.body)}`).toBeLessThan(300);
    }
    expect((await linesOf(AUGUST)).filter((line) => line.status !== "matched")).toEqual([]);
    expect(await statementFinding(AUGUST)).toMatchObject({ state: "not_finalized", passed: false, count: null });

    const finalized = await world.request("POST", `/bank-statements/${AUGUST}/finalize`, {});

    expect(finalized.status, JSON.stringify(finalized.body)).toBe(200);
    expect(finalized.body.finalizeOverrideReason).toBeNull();
    expect(await statementFinding(AUGUST)).toMatchObject({ state: "ok", passed: true });
    const { position } = (await world.request("GET", `/bank-statements/${AUGUST}/review`)).body as { position: { difference: string; unexplainedBookDifference: string; outstandingBook: { count: number } } };
    expect(position).toMatchObject({ difference: "0.000000", unexplainedBookDifference: "0.000000", outstandingBook: { count: 1 } });
    expect(await world.invariants()).toEqual(INVARIANTS_ZERO);
  });
});
