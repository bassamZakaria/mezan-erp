import { describe, expect, it } from "vitest";
import { Money } from "../money/index.js";
import { mapCsvRows, parseCsv } from "./csv.js";
import { ColumnNotFoundError, InvalidColumnMappingError, InvalidStatementFileError } from "./errors.js";
import type { StatementColumnMapping } from "./bank-statement.js";

describe("parseCsv", () => {
  it("parses a simple comma-separated file", () => {
    const table = parseCsv("Date,Description,Amount\n2026-08-01,Deposit,100.00\n2026-08-02,Withdrawal,-50.00\n");
    expect(table.headers).toEqual(["Date", "Description", "Amount"]);
    expect(table.rows).toEqual([
      ["2026-08-01", "Deposit", "100.00"],
      ["2026-08-02", "Withdrawal", "-50.00"],
    ]);
  });

  it("handles quoted fields with embedded commas and escaped quotes", () => {
    const table = parseCsv('Date,Description,Amount\n2026-08-01,"Payment, ""urgent""",100.00\n');
    expect(table.rows).toEqual([["2026-08-01", 'Payment, "urgent"', "100.00"]]);
  });

  it("tolerates a trailing newline and CRLF line endings", () => {
    const table = parseCsv("Date,Amount\r\n2026-08-01,100\r\n");
    expect(table.rows).toEqual([["2026-08-01", "100"]]);
  });

  it("throws on an empty file", () => {
    expect(() => parseCsv("")).toThrow(InvalidStatementFileError);
  });
});

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

describe("mapCsvRows — single signed amount column", () => {
  it("maps rows using the mapping's columns", () => {
    const table = parseCsv("Date,Description,Amount,Ref\n2026-08-01,Deposit,100.00,TX1\n2026-08-02,Withdrawal,-50.00,TX2\n");
    const rows = mapCsvRows(table, SINGLE_AMOUNT_MAPPING);
    expect(rows).toEqual([
      { date: "2026-08-01", description: "Deposit", reference: "TX1", amount: Money.fromMajor("100") },
      { date: "2026-08-02", description: "Withdrawal", reference: "TX2", amount: Money.fromMajor("-50") },
    ]);
  });

  it("throws ColumnNotFoundError when a mapped column is missing from the header", () => {
    const table = parseCsv("Date,Description,Amount\n2026-08-01,x,1\n");
    expect(() => mapCsvRows(table, SINGLE_AMOUNT_MAPPING)).toThrow(ColumnNotFoundError);
  });
});

describe("mapCsvRows — debit/credit column pair", () => {
  const mapping: StatementColumnMapping = {
    ...SINGLE_AMOUNT_MAPPING,
    amountColumn: null,
    debitColumn: "Debit",
    creditColumn: "Credit",
    referenceColumn: null,
  };

  it("computes signed amount as credit − debit", () => {
    const table = parseCsv("Date,Description,Debit,Credit\n2026-08-01,Deposit,,100.00\n2026-08-02,Withdrawal,50.00,\n");
    const rows = mapCsvRows(table, mapping);
    expect(rows[0]!.amount).toEqual(Money.fromMajor("100"));
    expect(rows[1]!.amount).toEqual(Money.fromMajor("-50"));
  });

  it("rejects a mapping with neither strategy set", () => {
    const table = parseCsv("Date,Description\n2026-08-01,x\n");
    const bad: StatementColumnMapping = { ...mapping, debitColumn: null, creditColumn: null };
    expect(() => mapCsvRows(table, bad)).toThrow(InvalidColumnMappingError);
  });

  it("rejects a mapping with both strategies set", () => {
    const table = parseCsv("Date,Description,Amount,Debit,Credit\n2026-08-01,x,1,1,1\n");
    const bad: StatementColumnMapping = { ...mapping, amountColumn: "Amount" };
    expect(() => mapCsvRows(table, bad)).toThrow(InvalidColumnMappingError);
  });
});

describe("mapCsvRows — date formats", () => {
  it("parses DD/MM/YYYY", () => {
    const table = parseCsv("Date,Description,Amount\n21/08/2026,x,10\n");
    const rows = mapCsvRows(table, { ...SINGLE_AMOUNT_MAPPING, referenceColumn: null, dateFormat: "DD/MM/YYYY" });
    expect(rows[0]!.date).toBe("2026-08-21");
  });

  it("parses MM/DD/YYYY", () => {
    const table = parseCsv("Date,Description,Amount\n08/21/2026,x,10\n");
    const rows = mapCsvRows(table, { ...SINGLE_AMOUNT_MAPPING, referenceColumn: null, dateFormat: "MM/DD/YYYY" });
    expect(rows[0]!.date).toBe("2026-08-21");
  });

  it("strips thousands separators and currency-style parens on amounts", () => {
    const table = parseCsv("Date,Description,Amount\n2026-08-01,x,\"1,250.50\"\n2026-08-02,y,(75.00)\n");
    const rows = mapCsvRows(table, { ...SINGLE_AMOUNT_MAPPING, referenceColumn: null });
    expect(rows[0]!.amount).toEqual(Money.fromMajor("1250.50"));
    expect(rows[1]!.amount).toEqual(Money.fromMajor("-75.00"));
  });
});
