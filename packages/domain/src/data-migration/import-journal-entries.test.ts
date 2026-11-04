import { describe, expect, it } from "vitest";
import { previewJournalEntriesImport, type JournalEntryImportRowInput } from "./import-journal-entries.js";

function row(rowNumber: number, entryRef: string, accountCode: string, debit: string, credit: string, date = "2025-07-31"): JournalEntryImportRowInput {
  return { rowNumber, entryRef, date, accountCode, debit, credit, description: `سطر ${rowNumber}` };
}

describe("previewJournalEntriesImport", () => {
  it("groups rows by reference into balanced entries, each on its own date", () => {
    const preview = previewJournalEntriesImport([
      row(2, "JE-1", "5950", "7000", ""),
      row(3, "JE-1", "3300", "", "7000"),
      row(4, "JE-2", "1510", "1,250.50", "", "2025-08-31"),
      row(5, "JE-2", "3300", "", "1250.50", "2025-08-31"),
    ]);
    expect(preview.errors).toEqual([]);
    expect(preview.entries.map((e) => [e.entryRef, e.date, e.lines.length, e.totalDebit.toString()])).toEqual([
      ["JE-1", "2025-07-31", 2, "7000.000000"],
      ["JE-2", "2025-08-31", 2, "1250.500000"],
    ]);
    expect(preview.totalDebit.toString()).toBe("8250.500000");
    expect(preview.entries[0]!.memo).toBe("سطر 2");
  });

  it("refuses an unbalanced entry whole, and keeps the balanced one", () => {
    const preview = previewJournalEntriesImport([
      row(2, "JE-1", "5950", "7000", ""),
      row(3, "JE-1", "3300", "", "6999.99"),
      row(4, "JE-2", "5950", "10", ""),
      row(5, "JE-2", "3300", "", "10"),
    ]);
    expect(preview.entries.map((e) => e.entryRef)).toEqual(["JE-2"]);
    expect(preview.errors).toHaveLength(1);
    expect(preview.errors[0]!.rowNumber).toBe(2);
    expect(preview.errors[0]!.reasonsEn![0]).toContain("does not balance");
  });

  it("does not post the good half of an entry whose other line is bad", () => {
    const preview = previewJournalEntriesImport([row(2, "JE-1", "5950", "7000", ""), row(3, "JE-1", "3300", "abc", "")]);
    expect(preview.entries).toEqual([]);
    expect(preview.errors.map((e) => e.rowNumber)).toEqual([3]);
  });

  it("refuses an entry spread over two dates", () => {
    const preview = previewJournalEntriesImport([row(2, "JE-1", "5950", "5", "", "2025-07-31"), row(3, "JE-1", "3300", "", "5", "2025-08-31")]);
    expect(preview.entries).toEqual([]);
    expect(preview.errors[0]!.reasonsEn![0]).toContain("more than one date");
  });

  it("refuses both or neither amount, negative amounts, impossible dates and single-line entries", () => {
    const preview = previewJournalEntriesImport([
      row(2, "A", "5950", "5", "5"),
      row(3, "B", "5950", "", ""),
      row(4, "C", "5950", "-5", ""),
      row(5, "D", "5950", "5", "", "2025-02-30"),
      row(6, "E", "5950", "5", ""),
      row(7, "", "5950", "5", ""),
    ]);
    expect(preview.entries).toEqual([]);
    expect(preview.errors.map((e) => e.rowNumber)).toEqual([2, 3, 4, 5, 6, 7]);
    expect(preview.errors.find((e) => e.rowNumber === 6)!.reasonsEn![0]).toContain("at least two lines");
  });
});
