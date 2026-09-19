import { Money } from "../money/index.js";
import type { StatementColumnMapping } from "./bank-statement.js";
import { ColumnNotFoundError, InvalidColumnMappingError, InvalidStatementFileError } from "./errors.js";

/** A parsed CSV file: the header row + every data row, both as raw strings. */
export interface CsvTable {
  readonly headers: readonly string[];
  readonly rows: readonly (readonly string[])[];
}

/**
 * Parse raw CSV text (RFC4180-ish: comma-separated, double-quote quoting,
 * `""` as an escaped quote, quoted fields may embed commas/newlines). Pure —
 * no I/O; the caller reads the uploaded file into a string first.
 */
export function parseCsv(raw: string): CsvTable {
  const text = raw.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  let i = 0;

  function endField() {
    row.push(field);
    field = "";
  }
  function endRow() {
    endField();
    rows.push(row);
    row = [];
  }

  while (i < text.length) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i += 1;
        continue;
      }
      field += ch;
      i += 1;
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
      i += 1;
      continue;
    }
    if (ch === ",") {
      endField();
      i += 1;
      continue;
    }
    if (ch === "\n") {
      endRow();
      i += 1;
      continue;
    }
    field += ch;
    i += 1;
  }
  // Flush the final field/row unless the file ended cleanly on a newline.
  if (field.length > 0 || row.length > 0) endRow();

  const nonEmpty = rows.filter((r) => !(r.length === 1 && r[0] === ""));
  if (nonEmpty.length === 0) {
    throw new InvalidStatementFileError("ملف الكشف فارغ.", "The statement file is empty.");
  }
  const [headers, ...dataRows] = nonEmpty;
  return { headers: headers!, rows: dataRows };
}

function columnIndex(headers: readonly string[], column: string): number {
  const idx = headers.indexOf(column);
  if (idx === -1) throw new ColumnNotFoundError(column);
  return idx;
}

function parseAmountCell(raw: string): Money {
  const cleaned = raw.replace(/[,\s]/g, "").replace(/^\((.*)\)$/, "-$1");
  if (cleaned === "" || cleaned === "-") return Money.zero();
  return Money.fromMajor(cleaned);
}

function parseDateCell(raw: string, format: StatementColumnMapping["dateFormat"]): string {
  const trimmed = raw.trim();
  if (format === "YYYY-MM-DD") {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(trimmed);
    if (!m)
      throw new InvalidStatementFileError(
        `تاريخ غير صالح "${raw}" للصيغة YYYY-MM-DD.`,
        `Invalid date "${raw}" for format YYYY-MM-DD.`,
      );
    return `${m[1]}-${m[2]}-${m[3]}`;
  }
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(trimmed);
  if (!m)
    throw new InvalidStatementFileError(`تاريخ غير صالح "${raw}" للصيغة ${format}.`, `Invalid date "${raw}" for format ${format}.`);
  const [, a, b, year] = m;
  const [month, day] = format === "DD/MM/YYYY" ? [b, a] : [a, b];
  return `${year}-${month!.padStart(2, "0")}-${day!.padStart(2, "0")}`;
}

/** One statement row's fields, still detached from a statement id (the caller/service stamps that + the line id). */
export interface MappedStatementRow {
  readonly date: string;
  readonly description: string;
  readonly reference: string | null;
  readonly amount: Money;
}

/** Apply a persisted column mapping to a parsed CSV table, producing statement-line inputs. Pure. */
export function mapCsvRows(table: CsvTable, mapping: StatementColumnMapping): readonly MappedStatementRow[] {
  const hasAmountColumn = mapping.amountColumn != null;
  const hasDebitCredit = mapping.debitColumn != null && mapping.creditColumn != null;
  if (hasAmountColumn === hasDebitCredit) {
    throw new InvalidColumnMappingError(
      "يجب أن يحدد تخطيط الأعمدة `amountColumn` وحده أو `debitColumn`+`creditColumn` معاً، وليس الاثنين ولا لا شيء.",
      "A column mapping must set exactly one of `amountColumn` or both `debitColumn`+`creditColumn`.",
    );
  }

  const dateIdx = columnIndex(table.headers, mapping.dateColumn);
  const descIdx = columnIndex(table.headers, mapping.descriptionColumn);
  const refIdx = mapping.referenceColumn ? columnIndex(table.headers, mapping.referenceColumn) : null;
  const amountIdx = mapping.amountColumn ? columnIndex(table.headers, mapping.amountColumn) : null;
  const debitIdx = mapping.debitColumn ? columnIndex(table.headers, mapping.debitColumn) : null;
  const creditIdx = mapping.creditColumn ? columnIndex(table.headers, mapping.creditColumn) : null;

  return table.rows.map((row) => {
    const amount =
      amountIdx !== null
        ? parseAmountCell(row[amountIdx] ?? "")
        : parseAmountCell(row[creditIdx!] ?? "0").add(parseAmountCell(row[debitIdx!] ?? "0").negate());
    return {
      date: parseDateCell(row[dateIdx] ?? "", mapping.dateFormat),
      description: (row[descIdx] ?? "").trim(),
      reference: refIdx !== null ? (row[refIdx]?.trim() || null) : null,
      amount,
    };
  });
}
