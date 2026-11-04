/**
 * Data-migration import — القيود اليومية (historical journal entries).
 *
 * The opening trial balance carries the books' state on ONE day. A business
 * moving its history in month by month needs the entries themselves, each on
 * its own date, so the monthly reports of those past months are real. This is
 * that import: one row per journal line, grouped into entries by a reference.
 *
 * Rules enforced here, all pure:
 *   - every row names an entry reference, a date, an account code, and a debit
 *     OR a credit (never both, never neither, never negative);
 *   - every row of one entry carries the same date;
 *   - an entry has at least two lines and balances to the cent.
 *
 * An entry with ANY bad row is not postable at all: posting the good half of
 * an entry would post something that never happened. Resolving account codes,
 * the period gate and duplicate references are I/O and belong to the API.
 */
import type { BilingualReason } from "../collections/errors.js";
import { Money } from "../money/index.js";
import { importRowError, type ImportRowError } from "./row-errors.js";

export interface JournalEntryImportRowInput {
  readonly rowNumber: number;
  readonly entryRef: string;
  readonly date: string;
  readonly accountCode: string;
  /** Raw text from the file — parsed here so a bad amount is a row error, not a crash. */
  readonly debit: string;
  readonly credit: string;
  readonly description: string;
}

export interface JournalEntryImportLine {
  readonly rowNumber: number;
  readonly accountCode: string;
  readonly debit: Money;
  readonly credit: Money;
  readonly description: string | null;
}

export interface JournalEntryImportEntry {
  readonly entryRef: string;
  readonly date: string;
  /** The first line's description, else the reference — what the register shows. */
  readonly memo: string;
  readonly lines: readonly JournalEntryImportLine[];
  readonly totalDebit: Money;
}

export interface JournalEntryImportPreview {
  readonly entries: readonly JournalEntryImportEntry[];
  readonly errors: readonly ImportRowError[];
  /** Over the valid entries only — what a commit would post. */
  readonly totalDebit: Money;
  readonly totalCredit: Money;
}

const AMOUNT = /^\d{1,18}(\.\d{1,6})?$/;
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Accepts `1,250.50` the way Excel shows it; refuses anything else that is not a plain decimal. */
function parseAmount(raw: string): Money | null {
  const text = raw.trim().replace(/,/g, "");
  if (text === "") return Money.zero();
  if (!AMOUNT.test(text)) return null;
  return Money.fromMajor(text);
}

function isRealDate(text: string): boolean {
  const match = ISO_DATE.exec(text);
  if (!match) return false;
  const [, y, m, d] = match.map(Number) as [number, number, number, number];
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

export function previewJournalEntriesImport(rows: readonly JournalEntryImportRowInput[]): JournalEntryImportPreview {
  const errors: ImportRowError[] = [];
  const groups = new Map<string, { rows: JournalEntryImportLine[]; dates: Set<string>; firstRow: number; bad: boolean }>();

  for (const row of rows) {
    const reasons: BilingualReason[] = [];
    const entryRef = row.entryRef.trim();
    const date = row.date.trim();
    const accountCode = row.accountCode.trim();
    if (entryRef === "") reasons.push({ ar: "رقم القيد مطلوب", en: "The entry reference is required" });
    if (date === "") reasons.push({ ar: "التاريخ مطلوب", en: "The date is required" });
    else if (!isRealDate(date)) reasons.push({ ar: `التاريخ "${date}" غير صحيح — استخدم الصيغة YYYY-MM-DD`, en: `The date "${date}" is not valid; use YYYY-MM-DD` });
    if (accountCode === "") reasons.push({ ar: "كود الحساب مطلوب", en: "The account code is required" });
    const debit = parseAmount(row.debit);
    const credit = parseAmount(row.credit);
    if (!debit) reasons.push({ ar: `المبلغ المدين "${row.debit}" ليس رقماً صحيحاً موجباً`, en: `The debit "${row.debit}" is not a valid non-negative amount` });
    if (!credit) reasons.push({ ar: `المبلغ الدائن "${row.credit}" ليس رقماً صحيحاً موجباً`, en: `The credit "${row.credit}" is not a valid non-negative amount` });
    if (debit && credit) {
      if (debit.scaled !== 0n && credit.scaled !== 0n) reasons.push({ ar: "أدخل مبلغاً مديناً أو دائناً — لا الاثنين معاً", en: "Enter a debit or a credit — not both" });
      if (debit.scaled === 0n && credit.scaled === 0n) reasons.push({ ar: "أدخل مبلغاً مديناً أو دائناً", en: "Enter a debit or a credit amount" });
    }

    if (entryRef === "") {
      errors.push(importRowError(row.rowNumber, reasons));
      continue;
    }
    const group = groups.get(entryRef) ?? { rows: [], dates: new Set<string>(), firstRow: row.rowNumber, bad: false };
    groups.set(entryRef, group);
    if (date !== "") group.dates.add(date);
    if (reasons.length > 0) {
      group.bad = true;
      errors.push(importRowError(row.rowNumber, reasons));
      continue;
    }
    const description = row.description.trim();
    group.rows.push({ rowNumber: row.rowNumber, accountCode, debit: debit!, credit: credit!, description: description === "" ? null : description });
  }

  const entries: JournalEntryImportEntry[] = [];
  for (const [entryRef, group] of groups) {
    const reasons: BilingualReason[] = [];
    if (group.dates.size > 1) {
      const dates = [...group.dates].sort().join("، ");
      reasons.push({ ar: `القيد "${entryRef}" يحمل أكثر من تاريخ (${dates}) — كل سطور القيد بتاريخ واحد`, en: `Entry "${entryRef}" carries more than one date (${dates}); every line of an entry has one date` });
    }
    if (!group.bad) {
      if (group.rows.length < 2) reasons.push({ ar: `القيد "${entryRef}" يحتاج سطرين على الأقل`, en: `Entry "${entryRef}" needs at least two lines` });
      const debit = Money.sum(group.rows.map((l) => l.debit));
      const credit = Money.sum(group.rows.map((l) => l.credit));
      if (debit.scaled !== credit.scaled) {
        reasons.push({
          ar: `القيد "${entryRef}" غير متوازن: المدين ${debit.toString()} والدائن ${credit.toString()}`,
          en: `Entry "${entryRef}" does not balance: debit ${debit.toString()}, credit ${credit.toString()}`,
        });
      }
    }
    if (reasons.length > 0) {
      errors.push(importRowError(group.firstRow, reasons));
      continue;
    }
    if (group.bad) continue;
    const [date] = group.dates;
    entries.push({
      entryRef,
      date: date!,
      memo: group.rows.find((l) => l.description !== null)?.description ?? entryRef,
      lines: group.rows,
      totalDebit: Money.sum(group.rows.map((l) => l.debit)),
    });
  }

  errors.sort((a, b) => a.rowNumber - b.rowNumber);
  const totalDebit = Money.sum(entries.map((e) => e.totalDebit));
  return { entries, errors, totalDebit, totalCredit: totalDebit };
}
