/**
 * Data-migration import — دليل الحسابات (P-5).
 *
 * A go-live that cannot bring the customer's own chart across begins by
 * re-typing several hundred accounts, which is where the migration stops being
 * the sale. Pure validation only: resolving a parent CODE to its
 * id and writing the rows is I/O and belongs to the API layer.
 */
import type { AccountType, NaturalBalance } from "../accounts/account.js";
import type { ImportRowError } from "./row-errors.js";

export interface ChartOfAccountsImportRowInput {
  readonly rowNumber: number;
  readonly code: string;
  readonly nameAr: string;
  readonly nameEn?: string | null;
  /** Raw text from the file — validated against the five account types here. */
  readonly type: string;
  readonly parentCode?: string | null;
  /** Raw text; blank means "derive it from the type". */
  readonly naturalBalance?: string | null;
  /** Raw text; blank means "header if another row names this one as its parent". */
  readonly isHeader?: string | null;
}

export interface ChartOfAccountsImportRow {
  readonly rowNumber: number;
  readonly code: string;
  readonly nameAr: string;
  readonly nameEn: string | null;
  readonly type: AccountType;
  readonly naturalBalance: NaturalBalance;
  readonly parentCode: string | null;
  readonly isHeader: boolean;
}

export interface ChartOfAccountsImportPreview {
  readonly valid: readonly ChartOfAccountsImportRow[];
  readonly errors: readonly ImportRowError[];
}

const TYPE_BY_TEXT: Readonly<Record<string, AccountType>> = {
  asset: "asset",
  liability: "liability",
  equity: "equity",
  revenue: "revenue",
  expense: "expense",
  "أصول": "asset",
  "التزامات": "liability",
  "خصوم": "liability",
  "حقوق ملكية": "equity",
  "إيرادات": "revenue",
  "مصروفات": "expense",
};

/** Which side increases the account when the file does not say. */
const NATURAL_BY_TYPE: Readonly<Record<AccountType, NaturalBalance>> = {
  asset: "debit",
  expense: "debit",
  liability: "credit",
  equity: "credit",
  revenue: "credit",
  // حسابات نظامية — the memorandum pair (9100 debit / 9200 credit) nets to
  // zero, so an import that names no side follows the template's own header.
  memorandum: "debit",
};

const NATURAL_BY_TEXT: Readonly<Record<string, NaturalBalance>> = {
  debit: "debit",
  credit: "credit",
  "مدين": "debit",
  "دائن": "credit",
};

const TRUE_TEXT = new Set(["1", "true", "yes", "y", "نعم", "رئيسي"]);
const FALSE_TEXT = new Set(["0", "false", "no", "n", "لا", "تفصيلي"]);

/**
 * @param existingCodes codes already in the tenant's chart — a re-import must
 * not silently rewrite an account the books already post to.
 * @param existingHeaderCodes of those, the ones that may own children.
 */
export function previewChartOfAccountsImport(
  rows: readonly ChartOfAccountsImportRowInput[],
  existingCodes: ReadonlySet<string> = new Set(),
  existingHeaderCodes: ReadonlySet<string> = new Set(),
): ChartOfAccountsImportPreview {
  const errors: ImportRowError[] = [];
  const valid: ChartOfAccountsImportRow[] = [];
  const seen = new Set<string>();

  const parentedCodes = new Set(
    rows.map((r) => (r.parentCode ?? "").trim()).filter((code) => code !== ""),
  );

  for (const row of rows) {
    const reasons: string[] = [];
    const code = row.code.trim();
    const nameAr = row.nameAr.trim();
    const typeText = row.type.trim();
    const parentCode = (row.parentCode ?? "").trim();
    const naturalText = (row.naturalBalance ?? "").trim();
    const headerText = (row.isHeader ?? "").trim().toLowerCase();

    if (code === "") reasons.push("كود الحساب مطلوب");
    else if (seen.has(code)) reasons.push(`كود الحساب "${code}" مكرر داخل الملف`);
    else if (existingCodes.has(code)) reasons.push(`الحساب بالكود "${code}" مسجل بالفعل`);

    if (nameAr === "") reasons.push("اسم الحساب مطلوب");

    const type = TYPE_BY_TEXT[typeText] ?? TYPE_BY_TEXT[typeText.toLowerCase()];
    if (typeText === "") reasons.push("نوع الحساب مطلوب");
    else if (!type) reasons.push(`نوع الحساب "${typeText}" غير معروف — استخدم: أصول، التزامات، حقوق ملكية، إيرادات، مصروفات`);

    let naturalBalance: NaturalBalance | undefined;
    if (naturalText !== "") {
      naturalBalance = NATURAL_BY_TEXT[naturalText] ?? NATURAL_BY_TEXT[naturalText.toLowerCase()];
      if (!naturalBalance) reasons.push(`الرصيد الطبيعي "${naturalText}" غير معروف — استخدم: مدين أو دائن`);
    } else if (type) {
      naturalBalance = NATURAL_BY_TYPE[type];
    }

    if (parentCode !== "") {
      if (parentCode === code) reasons.push("لا يمكن أن يكون الحساب أباً لنفسه");
      else {
        const inFile = rows.some((r) => r.code.trim() === parentCode);
        const inChart = existingCodes.has(parentCode);
        if (!inFile && !inChart) reasons.push(`الحساب الأب "${parentCode}" غير موجود في الملف ولا في دليل الحسابات`);
        else if (!inFile && !existingHeaderCodes.has(parentCode)) {
          reasons.push(`الحساب الأب "${parentCode}" حساب تفصيلي ولا يقبل حسابات فرعية`);
        }
      }
    }

    let isHeader: boolean;
    if (headerText === "") isHeader = parentedCodes.has(code);
    else if (TRUE_TEXT.has(headerText)) isHeader = true;
    else if (FALSE_TEXT.has(headerText)) isHeader = false;
    else {
      isHeader = false;
      reasons.push(`قيمة "رئيسي" غير مفهومة: "${row.isHeader}" — استخدم نعم أو لا`);
    }
    // A parent inside the same file that is declared as a detail account would
    // be rejected by the chart the moment its child is written.
    if (!isHeader && parentedCodes.has(code)) {
      reasons.push(`الحساب "${code}" له حسابات فرعية في الملف، فيجب أن يكون حساباً رئيسياً`);
    }

    if (reasons.length > 0 || !type || !naturalBalance) {
      errors.push({ rowNumber: row.rowNumber, reasons: reasons.length > 0 ? reasons : ["صف غير صالح"] });
      continue;
    }
    seen.add(code);
    valid.push({
      rowNumber: row.rowNumber,
      code,
      nameAr,
      nameEn: (row.nameEn ?? "").trim() || null,
      type,
      naturalBalance,
      parentCode: parentCode === "" ? null : parentCode,
      isHeader,
    });
  }

  return { valid, errors };
}

/**
 * Parents before children, so every row can be written in one pass and a
 * parent id always exists by the time its child needs it. Rows whose parent is
 * not in the batch (it is already in the chart) come first.
 */
export function orderChartOfAccountsRows(
  rows: readonly ChartOfAccountsImportRow[],
): readonly ChartOfAccountsImportRow[] {
  const byCode = new Map(rows.map((r) => [r.code, r]));
  const ordered: ChartOfAccountsImportRow[] = [];
  const placed = new Set<string>();

  const place = (row: ChartOfAccountsImportRow, guard: Set<string>): void => {
    if (placed.has(row.code) || guard.has(row.code)) return;
    guard.add(row.code);
    const parent = row.parentCode ? byCode.get(row.parentCode) : undefined;
    if (parent) place(parent, guard);
    if (placed.has(row.code)) return;
    placed.add(row.code);
    ordered.push(row);
  };

  for (const row of rows) place(row, new Set());
  return ordered;
}
