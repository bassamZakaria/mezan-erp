import { describe, it, expect } from "vitest";
import { journalLineSchema, createJournalEntrySchema } from "./journal.js";

describe("journalLineSchema", () => {
  const line = { accountId: "acc-1", debit: "10000.123456", credit: "0" };

  it("accepts a minimal valid line and preserves every field verbatim", () => {
    const result = journalLineSchema.safeParse(line);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toEqual(line);
  });

  it("rejects a line missing accountId", () => {
    const { accountId, ...rest } = line;
    const result = journalLineSchema.safeParse(rest);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.flatten().fieldErrors).toHaveProperty("accountId");
  });

  it("rejects a line missing debit", () => {
    const { debit, ...rest } = line;
    const result = journalLineSchema.safeParse(rest);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.flatten().fieldErrors).toHaveProperty("debit");
  });

  it("rejects a line missing credit", () => {
    const { credit, ...rest } = line;
    const result = journalLineSchema.safeParse(rest);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.flatten().fieldErrors).toHaveProperty("credit");
  });

  it("never coerces debit to a float — high-precision decimal string survives verbatim", () => {
    const result = journalLineSchema.safeParse({ ...line, debit: "0.100001" });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.debit).toBe("0.100001");
  });

  it("rejects a debit sent as a JS number instead of a string", () => {
    const result = journalLineSchema.safeParse({ ...line, debit: 10000.12 });
    expect(result.success).toBe(false);
  });

  it("rejects a credit sent as a JS number instead of a string", () => {
    const result = journalLineSchema.safeParse({ ...line, credit: 0 });
    expect(result.success).toBe(false);
  });

  it("silently strips an unrecognised costCenterId — a real dimension a caller could lose", () => {
    const result = journalLineSchema.safeParse({ ...line, costCenterId: "cc-1" });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).not.toHaveProperty("costCenterId");
  });
});

describe("createJournalEntrySchema", () => {
  const entry = {
    id: "je-1",
    date: "2026-08-30",
    memo: "opening balances",
    lines: [
      { accountId: "acc-1", debit: "1000.000000", credit: "0" },
      { accountId: "acc-2", debit: "0", credit: "1000.000000" },
    ],
  };

  it("accepts a minimal valid entry and preserves every field verbatim", () => {
    const result = createJournalEntrySchema.safeParse(entry);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toEqual(entry);
  });

  it("rejects an entry missing id", () => {
    const { id, ...rest } = entry;
    const result = createJournalEntrySchema.safeParse(rest);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.flatten().fieldErrors).toHaveProperty("id");
  });

  it("rejects an entry missing date", () => {
    const { date, ...rest } = entry;
    const result = createJournalEntrySchema.safeParse(rest);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.flatten().fieldErrors).toHaveProperty("date");
  });

  it("rejects an entry missing lines", () => {
    const { lines, ...rest } = entry;
    const result = createJournalEntrySchema.safeParse(rest);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.flatten().fieldErrors).toHaveProperty("lines");
  });

  it("rejects an entry with fewer than two lines — a journal entry must have at least a debit and a credit side", () => {
    const result = createJournalEntrySchema.safeParse({ ...entry, lines: [entry.lines[0]] });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.flatten().fieldErrors).toHaveProperty("lines");
  });

  it("rejects an entry with zero lines", () => {
    const result = createJournalEntrySchema.safeParse({ ...entry, lines: [] });
    expect(result.success).toBe(false);
  });

  it("accepts an empty memo string — memo is required but not constrained to non-empty", () => {
    const result = createJournalEntrySchema.safeParse({ ...entry, memo: "" });
    expect(result.success).toBe(true);
  });

  it("silently strips an unrecognised branchId — a real dimension a caller could lose", () => {
    const result = createJournalEntrySchema.safeParse({ ...entry, branchId: "branch-1" });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).not.toHaveProperty("branchId");
  });
});
