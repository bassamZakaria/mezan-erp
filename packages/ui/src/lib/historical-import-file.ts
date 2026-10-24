import type ExcelJS from "exceljs";
import { loadExcelJS, type ReportExportFile } from "./report-export";
import { DEFAULT_LOCALE, translate, uiCatalogs, type TranslationParams, type UiTranslationKey } from "../i18n";

/**
 * Narrowed to the UI catalogue's keys on purpose: the app's own translator is
 * typed to a WIDER key union, and a function taking the wider union is only
 * assignable here because this parameter takes the narrower one.
 */
type ImportTranslate = (key: UiTranslationKey, params?: TranslationParams) => string;

const defaultT: ImportTranslate = (key, params) => translate(uiCatalogs, DEFAULT_LOCALE, key, params);

/**
 * File I/O for the historical purchase-document import (docs/archive/catalog/02
 * §"استيراد فواتير سابقة" / §"استيراد مرتجعات سابقة"): builds the
 * downloadable Excel template and parses an uploaded file back into raw rows
 * — one row per item line, header fields (document number, supplier, date…)
 * repeating on every line belonging to the same document, matching the
 * template layout exactly.
 *
 * Pure I/O parsing only — field-level/business validation (required fields,
 * qty > 0, duplicate detection…) is the domain layer's job
 * (`previewHistoricalImport` in @mezan/domain), not this module's. `@mezan/ui`
 * has no dependency on `@mezan/domain`, so every value here is a raw string;
 * the caller (apps/web) converts qty/unitCost/amountPaid into Qty/Money
 * before handing rows to the domain.
 */

export type HistoricalImportFileDocType = "PURCHASE_INVOICE" | "PURCHASE_RETURN";

/** One parsed row, still as raw strings — matches `HistoricalImportRowInput` shape 1:1 before Money/Qty conversion. */
export interface ParsedHistoricalImportRow {
  readonly rowNumber: number;
  readonly docType: HistoricalImportFileDocType;
  readonly documentNumber: string;
  readonly supplierId: string;
  readonly date: string;
  readonly dueDate: string | null;
  readonly itemId: string | null;
  readonly description: string | null;
  readonly qty: string;
  readonly unitCost: string;
  readonly amountPaid: string;
}

export interface HistoricalImportParseError {
  readonly rowNumber: number;
  readonly reason: string;
}

export interface HistoricalImportParseResult {
  readonly rows: readonly ParsedHistoricalImportRow[];
  readonly errors: readonly HistoricalImportParseError[];
}

const TEMPLATE_HEADER_KEYS = [
  "import.historical.col.docType",
  "import.historical.col.docNumber",
  "import.historical.col.supplierId",
  "import.historical.col.date",
  "import.historical.col.dueDate",
  "import.historical.col.itemId",
  "import.historical.col.description",
  "import.historical.col.qty",
  "import.historical.col.unitCost",
  "import.historical.col.paidAmount",
] as const;

/**
 * Accepted spellings for the document-type column, in EVERY locale the
 * template can be produced in — a workbook downloaded in English and uploaded
 * with the UI back in Arabic must still parse.
 */
const DOC_TYPE_BY_LABEL: Record<string, HistoricalImportFileDocType> = {
  "فاتورة مشتريات": "PURCHASE_INVOICE",
  "فاتورة": "PURCHASE_INVOICE",
  "Purchase invoice": "PURCHASE_INVOICE",
  PURCHASE_INVOICE: "PURCHASE_INVOICE",
  "مرتجع مشتريات": "PURCHASE_RETURN",
  "مرتجع": "PURCHASE_RETURN",
  "Purchase return": "PURCHASE_RETURN",
  PURCHASE_RETURN: "PURCHASE_RETURN",
};

/** Builds the downloadable "تحميل النموذج" Excel template — a header row + one filled example row. */
export async function buildHistoricalImportTemplate(t: ImportTranslate = defaultT): Promise<ReportExportFile> {
  const workbook = new (await loadExcelJS()).Workbook();
  const sheet = workbook.addWorksheet(t("import.historical.sheetName"));
  sheet.addRow(TEMPLATE_HEADER_KEYS.map((key) => t(key)));
  sheet.addRow([
    t("import.historical.docType.purchaseInvoice"),
    "INV-1001",
    "sup-1",
    "2026-01-15",
    "2026-02-15",
    "item-cement",
    "",
    "10",
    "85.00",
    "500.00",
  ]);
  sheet.columns.forEach((column) => {
    column.width = 22;
  });

  const data = await workbook.xlsx.writeBuffer();
  return {
    filename: "historical-purchase-invoices-template.xlsx",
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
 * Parses an uploaded historical-import Excel file (matching
 * {@link buildHistoricalImportTemplate}'s column layout) into raw rows. Fully
 * blank rows are skipped silently; a row with an unrecognized "نوع المستند"
 * value is reported in `errors` and excluded from `rows` (field-level
 * validation of everything else is left to the domain's dry-run preview).
 */
export async function parseHistoricalImportFile(buffer: ArrayBuffer, t: ImportTranslate = defaultT): Promise<HistoricalImportParseResult> {
  const workbook = new (await loadExcelJS()).Workbook();
  await workbook.xlsx.load(buffer);
  const sheet = workbook.worksheets[0];
  const rows: ParsedHistoricalImportRow[] = [];
  const errors: HistoricalImportParseError[] = [];
  if (!sheet) {
    return { rows, errors: [{ rowNumber: 0, reason: t("import.noSheet") }] };
  }

  sheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return; // header row
    const values = row.values as ExcelJS.CellValue[]; // 1-indexed; values[0] is unused
    const get = (col: number) => cellText(values[col]);

    const docTypeLabel = get(1);
    const documentNumber = get(2);
    if (docTypeLabel === "" && documentNumber === "") return; // fully blank row

    const docType = DOC_TYPE_BY_LABEL[docTypeLabel];
    if (!docType) {
      errors.push({ rowNumber, reason: t("import.unknownDocType", { value: docTypeLabel }) });
      return;
    }

    rows.push({
      rowNumber,
      docType,
      documentNumber,
      supplierId: get(3),
      date: get(4),
      dueDate: get(5) === "" ? null : get(5),
      itemId: get(6) === "" ? null : get(6),
      description: get(7) === "" ? null : get(7),
      qty: get(8),
      unitCost: get(9),
      amountPaid: get(10),
    });
  });

  return { rows, errors };
}
