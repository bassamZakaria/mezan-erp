import { describe, expect, it } from "vitest";
import { Money } from "../money/index.js";
import { mapCsvRows, parseCsv, type CsvTable } from "./csv.js";
import { InvalidStatementFileError } from "./errors.js";
import type { StatementColumnMapping } from "./bank-statement.js";

describe("parseCsv — trailing content without a final newline", () => {
  it("flushes the last field when the file ends mid-field with no trailing newline", () => {
    const table = parseCsv("Date,Amount\n2026-08-01,100");
    expect(table.rows).toEqual([["2026-08-01", "100"]]);
  });

  it("flushes a dangling empty field when the file ends right on a comma with no trailing newline", () => {
    const table = parseCsv("Date,Amount\n2026-08-01,");
    expect(table.rows).toEqual([["2026-08-01", ""]]);
  });
});

describe("parseCsv — blank lines are dropped", () => {
  it("skips a blank line in the middle of the file rather than emitting an empty row", () => {
    const table = parseCsv("Date,Amount\n2026-08-01,100\n\n2026-08-02,50\n");
    expect(table.rows).toEqual([
      ["2026-08-01", "100"],
      ["2026-08-02", "50"],
    ]);
  });
});

describe("parseCsv — invalid dates raise a diagnosable error", () => {
  const SINGLE_AMOUNT_MAPPING: StatementColumnMapping = {
    treasuryAccountId: "ta-1",
    dateColumn: "Date",
    descriptionColumn: "Description",
    amountColumn: "Amount",
    debitColumn: null,
    creditColumn: null,
    referenceColumn: null,
    dateFormat: "YYYY-MM-DD",
    updatedAt: "2026-08-01T00:00:00.000Z",
  };

  it("rejects a date that does not match YYYY-MM-DD", () => {
    const table = parseCsv("Date,Description,Amount\nnot-a-date,x,1\n");
    expect(() => mapCsvRows(table, SINGLE_AMOUNT_MAPPING)).toThrow(InvalidStatementFileError);
  });

  it("rejects a date that does not match DD/MM/YYYY", () => {
    const table = parseCsv("Date,Description,Amount\n2026-08-01,x,1\n");
    expect(() => mapCsvRows(table, { ...SINGLE_AMOUNT_MAPPING, dateFormat: "DD/MM/YYYY" })).toThrow(
      InvalidStatementFileError,
    );
  });
});

describe("mapCsvRows — ragged rows shorter than the header", () => {
  const SINGLE_AMOUNT_MAPPING: StatementColumnMapping = {
    treasuryAccountId: "ta-1",
    dateColumn: "Date",
    descriptionColumn: "Description",
    amountColumn: "Amount",
    debitColumn: null,
    creditColumn: null,
    referenceColumn: "Ref",
    dateFormat: "YYYY-MM-DD",
    updatedAt: "2026-08-01T00:00:00.000Z",
  };

  it("treats a missing amount cell (row shorter than the header) as zero, and a missing description/reference as empty/null", () => {
    const table: CsvTable = { headers: ["Date", "Description", "Amount", "Ref"], rows: [["2026-08-01"]] };
    const rows = mapCsvRows(table, SINGLE_AMOUNT_MAPPING);
    expect(rows).toEqual([{ date: "2026-08-01", description: "", reference: null, amount: Money.zero() }]);
  });

  const DEBIT_CREDIT_MAPPING: StatementColumnMapping = {
    ...SINGLE_AMOUNT_MAPPING,
    amountColumn: null,
    debitColumn: "Debit",
    creditColumn: "Credit",
    referenceColumn: null,
  };

  it("treats missing debit and credit cells (row shorter than the header) as zero", () => {
    const table: CsvTable = { headers: ["Date", "Description", "Debit", "Credit"], rows: [["2026-08-01", "x"]] };
    const rows = mapCsvRows(table, DEBIT_CREDIT_MAPPING);
    expect(rows).toEqual([{ date: "2026-08-01", description: "x", reference: null, amount: Money.zero() }]);
  });

  it("treats a missing date cell (row shorter than the header) as empty, which fails date parsing", () => {
    const table: CsvTable = { headers: ["Description", "Date", "Amount"], rows: [["x"]] };
    const mapping = { ...SINGLE_AMOUNT_MAPPING, dateColumn: "Date", descriptionColumn: "Description", referenceColumn: null };
    expect(() => mapCsvRows(table, mapping)).toThrow(InvalidStatementFileError);
  });

  it("maps an empty (but present) reference cell to null rather than an empty string", () => {
    const table = parseCsv("Date,Description,Amount,Ref\n2026-08-01,x,10,\n");
    const rows = mapCsvRows(table, SINGLE_AMOUNT_MAPPING);
    expect(rows[0]!.reference).toBeNull();
  });
});
