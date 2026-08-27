import { describe, expect, it } from "vitest";
import { Money } from "../money/index.js";
import { suggestMatches, type TreasuryLedgerCandidate } from "./matching.js";
import type { StatementLine } from "./bank-statement.js";

function line(overrides: Partial<StatementLine> = {}): StatementLine {
  return {
    id: "L1",
    statementId: "s1",
    date: "2026-08-10",
    description: "x",
    reference: null,
    amount: Money.fromMajor("100"),
    status: "unmatched",
    matchedEntryId: null,
    matchedAt: null,
    ...overrides,
  };
}

function candidate(overrides: Partial<TreasuryLedgerCandidate> = {}): TreasuryLedgerCandidate {
  return { entryId: "je-1", entryNo: "JE-1", date: "2026-08-10", amount: Money.fromMajor("100"), description: "voucher", ...overrides };
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

  it("skips lines already matched", () => {
    const result = suggestMatches([line({ status: "matched", matchedEntryId: "je-old" })], [candidate()]);
    expect(result).toEqual([]);
  });

  it("uses each candidate at most once, preferring the closest date per line", () => {
    const lines = [line({ id: "L1", date: "2026-08-10" }), line({ id: "L2", date: "2026-08-12" })];
    const candidates = [candidate({ entryId: "je-a", date: "2026-08-11" })];
    const result = suggestMatches(lines, candidates);
    // L1 is 1 day away, L2 is 1 day away too — greedy picks in line order, so L1 claims it, L2 gets nothing.
    expect(result).toEqual([{ lineId: "L1", entryId: "je-a", dateDeltaDays: 1 }]);
  });

  it("prefers the closest-date candidate among several exact-amount matches", () => {
    const candidates = [candidate({ entryId: "je-far", date: "2026-08-15" }), candidate({ entryId: "je-near", date: "2026-08-11" })];
    const result = suggestMatches([line({ date: "2026-08-10" })], candidates);
    expect(result).toEqual([{ lineId: "L1", entryId: "je-near", dateDeltaDays: 1 }]);
  });
});
