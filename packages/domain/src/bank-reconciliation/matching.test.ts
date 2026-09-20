import { describe, expect, it } from "vitest";
import { Money } from "../money/index.js";
import { suggestMatches, type TreasuryLedgerCandidate } from "./matching.js";
import type { StatementLine } from "./bank-statement.js";

/**
 * `suggestMatches` returns only what may be applied WITHOUT a human, which the
 * engine gates at a score of 90. Amount (50) and a same-day date (25) reach 75
 * and a date even a day off reaches 73, so every fixture here also carries the
 * reference (15) and the counterparty (10) a real bank line carries — matching
 * on two coincidences is exactly what the threshold refuses.
 */
function line(overrides: Partial<StatementLine> = {}): StatementLine {
  return {
    id: "L1",
    statementId: "s1",
    date: "2026-08-10",
    description: "ALPHA TRADING transfer",
    reference: "TX-1",
    counterparty: "ALPHA TRADING",
    amount: Money.fromMajor("100"),
    status: "unmatched",
    matchedEntryId: null,
    matchedAt: null,
    ...overrides,
  };
}

function candidate(overrides: Partial<TreasuryLedgerCandidate> = {}): TreasuryLedgerCandidate {
  return {
    entryId: "je-1",
    entryNo: "JE-1",
    date: "2026-08-10",
    amount: Money.fromMajor("100"),
    description: "voucher",
    reference: "TX-1",
    counterparty: "ALPHA TRADING",
    ...overrides,
  };
}

describe("suggestMatches", () => {
  it("matches an exact amount on the same date", () => {
    const result = suggestMatches([line()], [candidate()]);
    expect(result).toEqual([{ lineId: "L1", entryId: "je-1", dateDeltaDays: 0 }]);
  });

  it("does not match a different amount", () => {
    const result = suggestMatches([line({ amount: Money.fromMajor("100") })], [candidate({ amount: Money.fromMajor("99") })]);
    expect(result).toEqual([]);
  });

  it("matches within the date tolerance but not beyond it", () => {
    const near = suggestMatches([line({ date: "2026-08-10" })], [candidate({ date: "2026-08-13" })], { dateToleranceDays: 5 });
    expect(near).toHaveLength(1);
    const far = suggestMatches([line({ date: "2026-08-10" })], [candidate({ date: "2026-08-20" })], { dateToleranceDays: 5 });
    expect(far).toEqual([]);
  });

  it("refuses to apply a match resting on amount and date alone — 75 is below the 90 an unattended match needs", () => {
    const result = suggestMatches([line({ reference: null })], [candidate({ reference: null })]);
    expect(result).toEqual([]);
  });

  it("skips lines already matched", () => {
    const result = suggestMatches([line({ status: "matched", matchedEntryId: "je-old" })], [candidate()]);
    expect(result).toEqual([]);
  });

  it("applies a candidate to NEITHER line when two lines both fit it — a contested entry waits for a human", () => {
    const lines = [line({ id: "L1", date: "2026-08-10" }), line({ id: "L2", date: "2026-08-12" })];
    const candidates = [candidate({ entryId: "je-a", date: "2026-08-11" })];
    // Both lines are one day away and score identically. Booking it against
    // either would be a coin toss, so the engine offers it for review instead.
    expect(suggestMatches(lines, candidates)).toEqual([]);
  });

  it("prefers the closest-date candidate among several exact-amount matches", () => {
    const candidates = [candidate({ entryId: "je-far", date: "2026-08-15" }), candidate({ entryId: "je-near", date: "2026-08-11" })];
    const result = suggestMatches([line({ date: "2026-08-10" })], candidates);
    expect(result).toEqual([{ lineId: "L1", entryId: "je-near", dateDeltaDays: 1 }]);
  });
});
