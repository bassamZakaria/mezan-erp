import type { BilingualReason } from "../collections/errors.js";
/**
 * Data-migration import — ميزان المراجعة الافتتاحي (P-5).
 *
 * The opening trial balance is ONE journal entry, not a pile of them: it is
 * the single fact "this is what the books looked like the day before we
 * started". Two consequences the validation below enforces:
 *
 *   - It must balance to the cent. An unbalanced opening entry cannot be
 *     posted at all, and an opening balance that is "close" is a trial balance
 *     that never ties again.
 *   - A row carries a debit OR a credit, never both and never neither. A row
 *     with both is an operator entering a net figure they have not worked out.
 *
 * Pure: resolving an account CODE to its id is I/O and belongs to the API.
 */
import { Money } from "../money/index.js";
import { importRowError, type ImportRowError } from "./row-errors.js";

export interface OpeningTrialBalanceRowInput {
  readonly rowNumber: number;
  readonly accountCode: string;
  readonly debit: Money;
  readonly credit: Money;
}

export interface OpeningTrialBalancePreview {
  readonly valid: readonly OpeningTrialBalanceRowInput[];
  readonly errors: readonly ImportRowError[];
  readonly totalDebit: Money;
  readonly totalCredit: Money;
  /** True only when the two totals are EQUAL — not "within a rounding tolerance". */
  readonly balanced: boolean;
  readonly difference: Money;
}

export function previewOpeningTrialBalanceImport(
  rows: readonly OpeningTrialBalanceRowInput[],
): OpeningTrialBalancePreview {
  const errors: ImportRowError[] = [];
  const valid: OpeningTrialBalanceRowInput[] = [];
  const seen = new Set<string>();

  for (const row of rows) {
    const reasons: BilingualReason[] = [];
    const accountCode = row.accountCode.trim();
    if (accountCode === "") reasons.push({ ar: "كود الحساب مطلوب", en: "The account code is required" });
    else if (seen.has(accountCode)) reasons.push({ ar: `كود الحساب "${accountCode}" مكرر داخل الملف`, en: `Account code "${accountCode}" is duplicated in the file` });
    if (row.debit.scaled < 0n) reasons.push({ ar: "الرصيد المدين لا يمكن أن يكون سالبًا", en: "The debit balance cannot be negative" });
    if (row.credit.scaled < 0n) reasons.push({ ar: "الرصيد الدائن لا يمكن أن يكون سالبًا", en: "The credit balance cannot be negative" });
    if (row.debit.scaled !== 0n && row.credit.scaled !== 0n) {
      reasons.push({ ar: "أدخل رصيداً مديناً أو دائناً — لا الاثنين معاً", en: "Enter a debit or a credit balance — not both" });
    }
    if (row.debit.scaled === 0n && row.credit.scaled === 0n) {
      reasons.push({ ar: "أدخل رصيداً مديناً أو دائناً", en: "Enter a debit or a credit balance" });
    }
    if (reasons.length > 0) {
      errors.push(importRowError(row.rowNumber, reasons));
      continue;
    }
    seen.add(accountCode);
    valid.push({ ...row, accountCode });
  }

  const totalDebit = Money.sum(valid.map((r) => r.debit));
  const totalCredit = Money.sum(valid.map((r) => r.credit));
  const difference = Money.fromScaled(totalDebit.scaled - totalCredit.scaled);
  return {
    valid,
    errors,
    totalDebit,
    totalCredit,
    balanced: totalDebit.scaled === totalCredit.scaled,
    difference,
  };
}

/**
 * The day the opening entry is dated: the day BEFORE the earliest open period
 * starts, because the opening balance is the state the books were in before
 * the first period the shop will post into.
 */
export function dayBefore(isoDate: string): string {
  const [year, month, day] = isoDate.split("-").map((part) => Number(part));
  const date = new Date(Date.UTC(year ?? 1970, (month ?? 1) - 1, day ?? 1));
  date.setUTCDate(date.getUTCDate() - 1);
  return date.toISOString().slice(0, 10);
}
