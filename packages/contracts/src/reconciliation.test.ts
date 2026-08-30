import { describe, it, expect } from "vitest";
import { reconciliationRowSchema, unlinkedEntryLineSchema, reconciliationReportSchema } from "./reconciliation.js";

describe("reconciliationRowSchema", () => {
  const row = {
    key: "ar",
    label: "العملاء",
    controlAccountId: "acc-1",
    subLedgerBalance: "10000.123456",
    glBalance: "10000.123456",
    difference: "0",
    matched: true,
  };

  it("accepts a minimal valid row and preserves every field verbatim", () => {
    const result = reconciliationRowSchema.safeParse(row);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toEqual(row);
  });

  it("rejects a row missing matched", () => {
    const { matched, ...rest } = row;
    const result = reconciliationRowSchema.safeParse(rest);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.flatten().fieldErrors).toHaveProperty("matched");
  });

  it("never coerces subLedgerBalance to a float — high-precision decimal string survives verbatim", () => {
    const result = reconciliationRowSchema.safeParse({ ...row, subLedgerBalance: "0.100001" });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.subLedgerBalance).toBe("0.100001");
  });

  it("rejects subLedgerBalance sent as a JS number instead of a string", () => {
    const result = reconciliationRowSchema.safeParse({ ...row, subLedgerBalance: 10000.12 });
    expect(result.success).toBe(false);
  });

  it("allows matched:true alongside a non-zero difference — the schema itself does not enforce that invariant", () => {
    const result = reconciliationRowSchema.safeParse({ ...row, matched: true, difference: "50.00" });
    expect(result.success).toBe(true);
  });
});

describe("unlinkedEntryLineSchema", () => {
  const line = {
    entryId: "je-1",
    entryNo: "JE-001",
    date: "2026-08-30",
    accountId: "acc-1",
    memo: "misc",
    debit: "1000.000000",
    credit: "0",
  };

  it("accepts a minimal valid line and preserves every field verbatim", () => {
    const result = unlinkedEntryLineSchema.safeParse(line);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toEqual(line);
  });

  it("accepts null entryNo and memo", () => {
    const result = unlinkedEntryLineSchema.safeParse({ ...line, entryNo: null, memo: null });
    expect(result.success).toBe(true);
  });

  it("rejects a line missing debit", () => {
    const { debit, ...rest } = line;
    const result = unlinkedEntryLineSchema.safeParse(rest);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.flatten().fieldErrors).toHaveProperty("debit");
  });

  it("rejects debit sent as a JS number instead of a string", () => {
    const result = unlinkedEntryLineSchema.safeParse({ ...line, debit: 1000 });
    expect(result.success).toBe(false);
  });
});

describe("reconciliationReportSchema", () => {
  const report = {
    rows: [
      {
        key: "ar",
        label: "العملاء",
        controlAccountId: "acc-1",
        subLedgerBalance: "10000.000000",
        glBalance: "10000.000000",
        difference: "0",
        matched: true,
      },
    ],
    allMatched: true,
    unlinked: [],
  };

  it("accepts a minimal valid report and preserves every field verbatim", () => {
    const result = reconciliationReportSchema.safeParse(report);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toEqual(report);
  });

  it("rejects a report missing allMatched", () => {
    const { allMatched, ...rest } = report;
    const result = reconciliationReportSchema.safeParse(rest);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.flatten().fieldErrors).toHaveProperty("allMatched");
  });

  it("silently strips an unrecognised branchId — a real dimension a caller could lose", () => {
    const result = reconciliationReportSchema.safeParse({ ...report, branchId: "branch-1" });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).not.toHaveProperty("branchId");
  });
});
