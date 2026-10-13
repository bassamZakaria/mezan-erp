import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { seededWorld, type SeededWorld } from "./test-helpers/seeded-world.js";

let world: SeededWorld;

beforeAll(async () => {
  world = await seededWorld();
}, 900_000);

afterAll(() => world?.close());

const SUB_PIASTRE = 10_000n;

describe("the demo tenant's bank moves in piastres, as a bank does", () => {
  it("no seeded statement opens or closes on a fraction of a piastre", () => {
    const statements = world.sqlite.prepare(`SELECT id, opening_balance AS opening, closing_balance AS closing FROM bank_statement`).safeIntegers().all() as { id: string; opening: bigint; closing: bigint }[];
    expect(statements.length).toBeGreaterThan(5);
    expect(statements.filter((row) => row.opening % SUB_PIASTRE !== 0n || row.closing % SUB_PIASTRE !== 0n).map((row) => row.id)).toEqual([]);
  });

  it("no line posted to a treasury account carries a fraction of a piastre", () => {
    const lines = world.sqlite
      .prepare(`SELECT l.entry_id AS entryId FROM journal_line l WHERE l.account_id IN (SELECT gl_account_id FROM treasury_account WHERE gl_account_id IS NOT NULL) AND l.currency IS NULL AND ((l.debit % 10000) <> 0 OR (l.credit % 10000) <> 0) LIMIT 5`)
      .all() as { entryId: string }[];
    expect(lines).toEqual([]);
  });
});
