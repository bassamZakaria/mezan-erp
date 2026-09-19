import ExcelJS from "exceljs";
import type { ReportExportFile } from "./report-export";
import { DEFAULT_LOCALE, translate, uiCatalogs, type TranslationParams, type UiTranslationKey } from "../i18n";

/**
 * Narrowed to the UI catalogue's keys on purpose: the app's own translator is
 * typed to a WIDER key union, and a function taking the wider union is only
 * assignable here because this parameter takes the narrower one.
 */
type ImportTranslate = (key: UiTranslationKey, params?: TranslationParams) => string;

const defaultT: ImportTranslate = (key, params) => translate(uiCatalogs, DEFAULT_LOCALE, key, params);

/**
 * File I/O for the نقل البيانات (Data Migration) go-live wizard
 * (docs/archive/catalog/09 §"نقل البيانات") — ONE generic Excel template
 * builder/parser, driven by a per-step column spec, reused across all 13
 * steps (9 master-data steps + the 4 historical-document steps, which share
 * the same row-per-line-item shape as the existing purchase-only
 * `historical-import-file.ts`, just generalized to any party-id column
 * name). Pure I/O: every value stays a raw string — no @mezan/domain
 * dependency, same rule as `historical-import-file.ts`. Field-level/business
 * validation is entirely the API's job (dry-run preview), not this module's.
 */

export interface DataMigrationColumn {
  /** Wire field name, matches the API step's expected row key exactly. */
  readonly key: string;
  /** Arabic column header shown in the downloaded template. */
  readonly header: string;
  /** Example value for the template's one filled sample row. */
  readonly example?: string;
}

export interface DataMigrationStepSpec {
  readonly id: string;
  readonly sheetName: string;
  readonly columns: readonly DataMigrationColumn[];
}

export interface DataMigrationParseError {
  readonly rowNumber: number;
  readonly reason: string;
}

export interface DataMigrationParseResult {
  readonly rows: readonly Record<string, string>[];
  readonly errors: readonly DataMigrationParseError[];
}

/** Builds the downloadable Excel template for one step — a header row + one filled example row. */
export async function buildDataMigrationTemplate(spec: DataMigrationStepSpec): Promise<ReportExportFile> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet(spec.sheetName);
  sheet.addRow(spec.columns.map((c) => c.header));
  sheet.addRow(spec.columns.map((c) => c.example ?? ""));
  sheet.columns.forEach((column) => {
    column.width = 22;
  });

  const data = await workbook.xlsx.writeBuffer();
  return {
    filename: `${spec.id}-template.xlsx`,
    mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    data,
  };
}

function cellText(value: ExcelJS.CellValue): string {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === "object") {
    const withText = value as { text?: unknown; result?: unknown };
    if ("text" in withText && withText.text != null) return String(withText.text).trim();
    if ("result" in withText && withText.result != null) return String(withText.result).trim();
    return "";
  }
  return String(value).trim();
}

/**
 * Parses an uploaded file (matching {@link buildDataMigrationTemplate}'s
 * column layout for the same spec) into raw `{ [columnKey]: string }` rows.
 * Fully blank rows are skipped silently. `rowNumber` is the actual sheet row
 * (header = row 1, so the first data row is 2), matching
 * `historical-import-file.ts`'s convention for error-reporting consistency.
 */
export async function parseDataMigrationFile(
  buffer: ArrayBuffer,
  spec: DataMigrationStepSpec,
  t: ImportTranslate = defaultT,
): Promise<DataMigrationParseResult> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  const sheet = workbook.worksheets[0];
  const rows: Record<string, string>[] = [];
  const errors: DataMigrationParseError[] = [];
  if (!sheet) {
    return { rows, errors: [{ rowNumber: 0, reason: t("import.noSheet") }] };
  }

  sheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return; // header row
    const values = row.values as ExcelJS.CellValue[]; // 1-indexed; values[0] is unused
    const record: Record<string, string> = {};
    let isBlank = true;
    spec.columns.forEach((col, i) => {
      const value = cellText(values[i + 1]);
      if (value !== "") isBlank = false;
      record[col.key] = value;
    });
    if (isBlank) return;
    record.rowNumber = String(rowNumber);
    rows.push(record);
  });

  return { rows, errors };
}

function csvCell(value: string): string {
  return /[",\n\r]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

/**
 * The first worksheet of an Excel file as CSV text, header row included, so a
 * bank's Excel export goes through the same column mapping as its CSV. Dates
 * become YYYY-MM-DD; every other cell keeps its displayed text.
 */
export async function readSpreadsheetAsCsv(buffer: ArrayBuffer): Promise<string> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  const sheet = workbook.worksheets[0];
  if (!sheet) return "";
  const lines: string[] = [];
  let width = 0;
  sheet.eachRow((row) => {
    width = Math.max(width, row.cellCount);
  });
  sheet.eachRow({ includeEmpty: false }, (row) => {
    const values = row.values as ExcelJS.CellValue[];
    const cells: string[] = [];
    for (let i = 1; i <= width; i += 1) cells.push(csvCell(cellText(values[i])));
    if (cells.some((c) => c !== "")) lines.push(cells.join(","));
  });
  return lines.join("\n");
}
