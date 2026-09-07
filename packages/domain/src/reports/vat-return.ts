import { z } from "zod";
import { type GlReportContext, isLedgerEffective, moneyToNumber } from "./gl-shared.js";
import { Money } from "../money/index.js";
import type { JournalEntry } from "../journal.js";
import type { ReportDefinition } from "./types.js";
import { diffOf, sumRows } from "./kpi.js";

/**
 * إقرار ضريبة القيمة المضافة — VAT Return (docs/archive/catalog/08-reports.md).
 * Output tax (sales) vs input tax (purchases), broken down by rate. Journal
 * entries carry no rate metadata, so each rate is derived per entry from the
 * VAT line against its taxable base: for a sales entry the base is the revenue
 * credited alongside the output-VAT credit; for a purchase entry the base is
 * the expense/inventory debited alongside the input-VAT debit. Revenue entries
 * with no VAT line fall into the 0% (zero-rated) bucket.
 */

export interface VatReturnContext extends GlReportContext {
  readonly outputVatAccountId: string;
  readonly inputVatAccountId: string;
}

export interface VatReturnParams {
  readonly periodFrom: string;
  readonly periodTo: string;
}

export type VatSide = "output" | "input";

export interface VatReturnRow {
  readonly rowId: string;
  readonly side: VatSide;
  readonly sideLabel: string;
  /** Rate as a percentage, e.g. 14 or 0. */
  readonly rate: number;
  readonly base: number;
  readonly tax: number;
}

const DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "تاريخ غير صالح — استخدم الصيغة YYYY-MM-DD");
const paramsSchema = z
  .object({ periodFrom: DATE, periodTo: DATE })
  .refine((p) => p.periodFrom <= p.periodTo, {
    message: "تاريخ البداية يجب أن يسبق تاريخ النهاية",
    path: ["periodFrom"],
  });

const SIDE_LABELS: Record<VatSide, string> = {
  output: "ضريبة المخرجات (المبيعات)",
  input: "ضريبة المدخلات (المشتريات)",
};

/**
 * EVERY figure below is accumulated in `Money` (exact bigint at 1e-6) and
 * converted to a number ONCE, where the row crosses into the report's output
 * shape (C-10). This is the statutory VAT return: a float sum of a few thousand
 * lines drifts, and the number that drifts is the one filed with the authority.
 */
interface Bucket {
  base: Money;
  tax: Money;
}

function lineNet(entry: JournalEntry, accountId: string): { debit: Money; credit: Money } {
  let debit = Money.zero();
  let credit = Money.zero();
  for (const line of entry.lines) {
    if (line.accountId !== accountId) continue;
    debit = debit.add(line.debit);
    credit = credit.add(line.credit);
  }
  return { debit, credit };
}

function creditsToTypes(entry: JournalEntry, accountsByType: (id: string) => boolean): Money {
  let total = Money.zero();
  for (const line of entry.lines) if (accountsByType(line.accountId)) total = total.add(line.credit);
  return total;
}

function debitsToTypes(entry: JournalEntry, accountsByType: (id: string) => boolean): Money {
  let total = Money.zero();
  for (const line of entry.lines) if (accountsByType(line.accountId)) total = total.add(line.debit);
  return total;
}

function bump(map: Map<number, Bucket>, rate: number, base: Money, tax: Money): void {
  const bucket = map.get(rate) ?? { base: Money.zero(), tax: Money.zero() };
  map.set(rate, { base: bucket.base.add(base), tax: bucket.tax.add(tax) });
}

/**
 * The rate an untagged entry implies: tax ÷ base as a whole percent, rounded
 * half-up in bigint. Only reached for entries posted before `taxRatePercent`
 * existed (D28) — a tagged entry reports the rate it recorded.
 */
function derivedRatePercent(tax: Money, base: Money): number {
  if (base.scaled === 0n) return 0;
  const scaled = (tax.scaled * 200n) / base.scaled; // percent × 2, truncated
  return Number((scaled + 1n) / 2n);
}

/** Output tax − input tax = net VAT payable (positive) or refundable (negative). */
export function vatNetPayable(rows: readonly VatReturnRow[]): number {
  const output = sumRows(rows, (r) => (r.side === "output" ? r.tax : 0));
  const input = sumRows(rows, (r) => (r.side === "input" ? r.tax : 0));
  return diffOf(output, input);
}


/**
 * Per-rate (base, tax) pairs read straight off an entry's tagged lines.
 *
 * Returns [] when no line of this entry carries a rate, which is the signal to
 * fall back to the per-entry division. `side` is the direction the VAT and its
 * base both move in: credit for output (revenue), debit for input (purchases).
 */
function ratedBuckets(
  entry: JournalEntry,
  vatAccountId: string,
  isBaseAccount: (accountId: string) => boolean,
  side: "debit" | "credit",
): { rate: number; base: Money; tax: Money }[] {
  const byRate = new Map<number, { base: Money; tax: Money }>();
  let sawRate = false;
  for (const line of entry.lines) {
    const rate = line.taxRatePercent;
    if (rate === null || rate === undefined) continue;
    const amount =
      side === "credit" ? line.credit.add(line.debit.negate()) : line.debit.add(line.credit.negate());
    if (amount.scaled === 0n) continue;
    const slot = byRate.get(rate) ?? { base: Money.zero(), tax: Money.zero() };
    if (line.accountId === vatAccountId) {
      sawRate = true;
      byRate.set(rate, { base: slot.base, tax: slot.tax.add(amount) });
    } else if (isBaseAccount(line.accountId)) {
      sawRate = true;
      byRate.set(rate, { base: slot.base.add(amount), tax: slot.tax });
    }
  }
  if (!sawRate) return [];
  return [...byRate.entries()]
    .map(([rate, v]) => ({ rate, base: v.base, tax: v.tax }))
    .filter((b) => b.base.scaled !== 0n || b.tax.scaled !== 0n);
}

export function createVatReturnReport(
  defaultParams: VatReturnParams,
): ReportDefinition<VatReturnParams, VatReturnRow, VatReturnContext> {
  return {
    id: "accounting.vat-return",
    titleAr: "إقرار ضريبة القيمة المضافة",
    descriptionAr: "ضريبة المخرجات مقابل المدخلات مصنّفة حسب النسبة، وصافي الضريبة المستحقة عن الفترة.",
    paramsSchema,
    defaultParams,
    paramFields: [{ kind: "dateRange", fromKey: "periodFrom", toKey: "periodTo", label: "الفترة" }],
    rowKey: (row) => row.rowId,
    columns: [
      { key: "rate", header: "نسبة الضريبة", format: "percent", align: "end", value: (row) => row.rate },
      {
        key: "base",
        header: "الوعاء الخاضع",
        format: "money",
        align: "end",
        total: true,
        value: (row) => row.base,
        grandTotal: (rows) =>
          sumRows(rows, (r) => (r.side === "output" ? r.base : -r.base)),
      },
      {
        key: "tax",
        header: "مبلغ الضريبة",
        format: "money",
        align: "end",
        total: true,
        value: (row) => row.tax,
        // Output and input rows point in opposite directions, so the grand
        // total of this column is the NET, never the sum.
        grandTotal: (rows) => vatNetPayable(rows),
      },
    ],
    group: {
      key: (row) => row.side,
      label: (row) => row.sideLabel,
    },
    kpis: [
      { key: "outputTax", labelAr: "ضريبة المخرجات", format: "money", value: (rows) => sumRows(rows, (r) => (r.side === "output" ? r.tax : 0)) },
      { key: "inputTax", labelAr: "ضريبة المدخلات", format: "money", value: (rows) => sumRows(rows, (r) => (r.side === "input" ? r.tax : 0)) },
      { key: "netPayable", labelAr: "صافي الضريبة", hintAr: "الموجب مستحق للمصلحة، والسالب قابل للاسترداد", format: "money", value: (rows) => vatNetPayable(rows), tone: (value) => (value > 0 ? "danger" : "success") },
      { key: "taxableBase", labelAr: "الوعاء الخاضع", format: "money", value: (rows) => sumRows(rows, (r) => (r.side === "output" ? r.base : 0)) },
    ],
    chart: {
      source: "groups",
      valueColumn: "tax",
      captionAr: "ضريبة المخرجات مقابل ضريبة المدخلات — الفرق بينهما هو صافي الإقرار.",
    },
    run: (params, ctx) => {
      const typeOf = new Map(ctx.accounts.map((a) => [a.id, a.type]));
      const isRevenue = (id: string): boolean => typeOf.get(id) === "revenue";
      const isPurchaseBase = (id: string): boolean => typeOf.get(id) === "expense" || typeOf.get(id) === "asset";

      const outputBuckets = new Map<number, Bucket>();
      const inputBuckets = new Map<number, Bucket>();

      for (const entry of ctx.journalEntries) {
        if (!isLedgerEffective(entry)) continue;
        if (entry.date < params.periodFrom || entry.date > params.periodTo) continue;

        const outVat = lineNet(entry, ctx.outputVatAccountId);
        const outputTax = outVat.credit.add(outVat.debit.negate());
        const revenueBase = creditsToTypes(entry, isRevenue);

        // The rates the LINES recorded, when they recorded any. Dividing tax by
        // base per entry — which is all this report could do before the ledger
        // carried a rate — reports a 14%/5%/zero-rated invoice as a single
        // ~6.3% bucket that was never charged to anyone (D28). Entries posted
        // before the dimension existed carry none, and still fall back to the
        // old derivation so history keeps reporting.
        const outputTagged = ratedBuckets(entry, ctx.outputVatAccountId, isRevenue, "credit");
        if (outputTagged.length > 0) {
          for (const b of outputTagged) bump(outputBuckets, b.rate, b.base, b.tax);
        } else if (revenueBase.scaled > 0n) {
          const rate = outputTax.scaled > 0n ? derivedRatePercent(outputTax, revenueBase) : 0;
          bump(outputBuckets, rate, revenueBase, outputTax.scaled > 0n ? outputTax : Money.zero());
        }

        const inVat = lineNet(entry, ctx.inputVatAccountId);
        const inputTax = inVat.debit.add(inVat.credit.negate());
        const inputTagged = ratedBuckets(entry, ctx.inputVatAccountId, (id) => id !== ctx.inputVatAccountId && isPurchaseBase(id), "debit");
        if (inputTagged.length > 0) {
          for (const b of inputTagged) bump(inputBuckets, b.rate, b.base, b.tax);
        } else if (inputTax.scaled > 0n) {
          // Exclude the input-VAT account itself from the base (it's an asset too).
          const purchaseBase = debitsToTypes(entry, (id) => id !== ctx.inputVatAccountId && isPurchaseBase(id));
          const rate = purchaseBase.scaled > 0n ? derivedRatePercent(inputTax, purchaseBase) : 0;
          bump(inputBuckets, rate, purchaseBase, inputTax);
        }
      }

      const rows: VatReturnRow[] = [];
      const emit = (side: VatSide, buckets: Map<number, Bucket>): void => {
        for (const rate of [...buckets.keys()].sort((a, b) => b - a)) {
          const bucket = buckets.get(rate);
          if (!bucket) continue;
          // The serialisation boundary — the ONE conversion per figure.
          rows.push({
            rowId: `${side}-${rate}`,
            side,
            sideLabel: SIDE_LABELS[side],
            rate,
            base: moneyToNumber(bucket.base),
            tax: moneyToNumber(bucket.tax),
          });
        }
      };
      emit("output", outputBuckets);
      emit("input", inputBuckets);
      return rows;
    },
  };
}
