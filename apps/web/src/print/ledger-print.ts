import { amountInWords } from "@mezan/domain";
import type { PrintDocumentModel, PrintLedgerRow, PrintPartyInfo } from "@mezan/ui";
import type { DisplaySettingsDTO } from "../data/hooks";
import { toMajorNumber } from "../lib/money";
import { companyOf } from "./document-print";

/**
 * The printable documents that have no goods lines: the journal entry, the
 * treasury voucher and the customer/supplier statement (P-6).
 *
 * They share the invoice's legal chrome — company name, tax registration,
 * document number and date, total in words — and replace the qty × price
 * table with a debit/credit ledger (`PrintLedgerBody` in @mezan/ui). Amounts
 * arrive as scaled bigints so the running balance is added in integers and
 * converted once per printed figure.
 */

export interface LedgerPrintRowInput {
  readonly key: string;
  readonly date?: string | null;
  readonly reference?: string | null;
  readonly label: string;
  readonly note?: string | null;
  readonly debit: bigint;
  readonly credit: bigint;
}

export interface LedgerPrintLabels {
  readonly date: string;
  readonly reference: string;
  readonly description: string;
  readonly debit: string;
  readonly credit: string;
  readonly balance: string;
}

export interface LedgerPrintInput {
  readonly documentType: string;
  readonly documentTypeLabel: string;
  readonly number: string;
  readonly date: string;
  readonly statusLabel?: string;
  readonly settings: DisplaySettingsDTO | null;
  readonly branchName?: string;
  readonly party?: PrintPartyInfo;
  readonly notes?: string | null;
  readonly currencyLabel: string;
  readonly labels: LedgerPrintLabels;
  readonly rows: readonly LedgerPrintRowInput[];
  /** «من 2026‑01‑01 إلى 2026‑01‑31» — stated above the table on a statement. */
  readonly periodLabel?: string;
  /**
   * Draws the third money column, a debit-positive running balance. Off for a
   * journal entry, whose lines are one balanced document rather than a
   * movement history.
   */
  readonly showRunningBalance?: boolean;
  /** What the closing figure is called: «الرصيد الختامي», «صافي الحركة». */
  readonly closingLabel: string;
  /**
   * Spells the closing figure out in Arabic. A voucher must carry it (it is a
   * payable instrument); a statement's closing balance may be negative, and
   * `amountInWords` refuses a negative rather than printing nonsense.
   */
  readonly amountInWordsOf?: "closing" | "none";
}

export function ledgerPrintModel(input: LedgerPrintInput): PrintDocumentModel {
  const columns = [
    ...(input.rows.some((row) => row.date) ? [{ key: "date", label: input.labels.date }] : []),
    { key: "reference", label: input.labels.reference },
    { key: "description", label: input.labels.description },
    { key: "debit", label: input.labels.debit, align: "end" as const, money: true },
    { key: "credit", label: input.labels.credit, align: "end" as const, money: true },
    ...(input.showRunningBalance ? [{ key: "balance", label: input.labels.balance, align: "end" as const, money: true }] : []),
  ];

  let running = 0n;
  const rows: PrintLedgerRow[] = input.rows.map((row) => {
    running += row.debit - row.credit;
    return {
      key: row.key,
      cells: {
        date: row.date ?? "",
        reference: row.reference ?? "",
        description: row.note ? `${row.label} — ${row.note}` : row.label,
        debit: row.debit === 0n ? null : toMajorNumber(row.debit),
        credit: row.credit === 0n ? null : toMajorNumber(row.credit),
        balance: toMajorNumber(running),
      },
    };
  });

  const debitTotal = input.rows.reduce<bigint>((total, row) => total + row.debit, 0n);
  const creditTotal = input.rows.reduce<bigint>((total, row) => total + row.credit, 0n);
  const closing = debitTotal - creditTotal;

  const footer = [
    { label: input.labels.debit, value: toMajorNumber(debitTotal) },
    { label: input.labels.credit, value: toMajorNumber(creditTotal) },
    { label: input.closingLabel, value: toMajorNumber(closing), emphasis: true },
  ];

  const closingMajor = toMajorNumber(closing);
  const spelled = input.amountInWordsOf === "closing" && closingMajor >= 0 ? amountInWords(closingMajor) : undefined;

  return {
    documentType: input.documentType,
    documentTypeLabel: input.documentTypeLabel,
    number: input.number,
    date: input.date,
    statusLabel: input.statusLabel,
    company: companyOf(input.settings),
    branchName: input.branchName,
    party: input.party,
    notes: input.notes ?? undefined,
    lines: [],
    ledger: { columns, rows, footer, periodLabel: input.periodLabel },
    totals: {
      subtotal: toMajorNumber(debitTotal),
      grandTotal: closingMajor,
      currencyLabel: input.currencyLabel,
      amountInWords: spelled,
    },
  };
}
