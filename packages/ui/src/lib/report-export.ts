import ExcelJS from "exceljs";

/**
 * Report export — generic over `Row`, so it works for every report without
 * per-report export code (docs/plan.md §2.4: "Mezan should export
 * everywhere; it is nearly free once one export pipeline exists"). Used by
 * `<ReportRunner>`'s always-on Export button.
 */

export interface ReportExportColumn<Row> {
  readonly key: string;
  readonly header: string;
  readonly value: (row: Row) => string | number | null;
}

export type ReportExportFormat = "xlsx" | "csv";

export interface ReportExportFile {
  readonly filename: string;
  readonly mimeType: string;
  readonly data: ArrayBuffer;
}

/** UTF-8 byte-order mark — what tells Excel the CSV it just opened is UTF-8. */
const BOM = new Uint8Array([0xef, 0xbb, 0xbf]);

const EXPORT_MIME_TYPES: Record<ReportExportFormat, string> = {
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  csv: "text/csv;charset=utf-8",
};

export interface BuildReportExportOptions {
  readonly format: ReportExportFormat;
  readonly baseFilename: string;
  readonly sheetName?: string;
}

/** Builds an in-memory workbook/CSV from a report's already-computed rows. */
export async function buildReportExport<Row>(
  columns: readonly ReportExportColumn<Row>[],
  rows: readonly Row[],
  options: BuildReportExportOptions,
): Promise<ReportExportFile> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet(options.sheetName ?? "Report");
  sheet.columns = columns.map((column) => ({ header: column.header, key: column.key }));
  for (const row of rows) {
    const record: Record<string, string | number | null> = {};
    for (const column of columns) record[column.key] = column.value(row);
    sheet.addRow(record);
  }

  if (options.format === "xlsx") {
    const data = await workbook.xlsx.writeBuffer();
    return { filename: `${options.baseFilename}.xlsx`, mimeType: EXPORT_MIME_TYPES.xlsx, data };
  }

  // Excel reads a BOM-less file as the system codepage, so every Arabic header
  // and name opens as mojibake — which is what a finance user does with a CSV
  // the moment it lands. Three bytes make it readable.
  const body = new Uint8Array(await workbook.csv.writeBuffer());
  const withBom = new Uint8Array(BOM.length + body.length);
  withBom.set(BOM, 0);
  withBom.set(body, BOM.length);
  return { filename: `${options.baseFilename}.csv`, mimeType: EXPORT_MIME_TYPES.csv, data: withBom.buffer };
}

/** Triggers a browser download for an already-built export file. No-op outside a DOM environment (e.g. tests, SSR). */
export function downloadReportExport(file: ReportExportFile): void {
  if (typeof document === "undefined") return;
  const blob = new Blob([file.data], { type: file.mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = file.filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}
