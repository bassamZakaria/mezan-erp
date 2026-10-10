import { z } from "zod";
import { isoDateParamSchema } from "./iso-date.js";
import { type GlReportContext, isLedgerEffective, moneyToNumber } from "./gl-shared.js";
import { Money } from "../money/index.js";
import type { JournalEntry } from "../journal.js";
import type { ReportDefinition } from "./types.js";
import { diffOf, sumRows } from "./kpi.js";
import type { TaxRate } from "../tax-rates/tax-rate.js";

/**
 * إقرار ضريبة القيمة المضافة — VAT Return (docs/archive/catalog/08-reports.md).
 * Output tax (sales) vs input tax (purchases), broken down by the tax rate each
 * posted line recorded. A line that stored its `taxRateId` is grouped under
 * that rate, which is what keeps an exempt sale and a zero-rated export — both
 * 0% — on separate rows (D79). A line with a percent and no id stands on an
 * unnamed row for that percent and is never assigned to a rate at report time:
 * which rates are active changes, and a reprinted period must not. An entry
 * whose lines carry neither falls back to dividing its VAT by its base.
 */

export type VatReturnTaxRate = Pick<TaxRate, "id" | "name">;

export interface VatReturnContext extends GlReportContext {
  readonly outputVatAccountId: string;
  readonly inputVatAccountId: string;
  readonly taxRates?: readonly VatReturnTaxRate[];
  /**
   * Accounts a purchase's taxable base is debited to that are neither expense
   * nor asset: the «بضاعة واردة لم تُفوتر» liability an invoice raised from a
   * goods receipt clears instead of debiting inventory a second time (D53).
   * Left out, such an invoice reports input tax against no base at all.
   */
  readonly inputBaseAccountIds?: readonly string[];
  /**
   * Accounts a sale's taxable base is credited to that are not revenue: the
   * «فواتير مستخلصات على العقود» liability a progress-certificate invoice
   * credits when the contract recognises revenue by percentage of completion.
   * Left out, such an invoice reports output tax against no base at all.
   */
  readonly outputBaseAccountIds?: readonly string[];
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
  readonly taxRateId: string | null;
  readonly taxRateName: string | null;
  readonly base: number;
  readonly tax: number;
}

const DATE = isoDateParamSchema;
const paramsSchema = z
  .object({ periodFrom: DATE, periodTo: DATE })
  .refine((p) => p.periodFrom <= p.periodTo, {
    message: "تاريخ البداية يجب أن يسبق تاريخ النهاية",
    path: ["periodFrom"],
  });

const PURCHASE_SOURCE_DOC_TYPES: ReadonlySet<string> = new Set(["PURCHASE_INVOICE", "PURCHASE_RETURN"]);

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
  rate: number;
  taxRateId: string | null;
  base: Money;
  tax: Money;
}

function bucketKey(rate: number, taxRateId: string | null): string {
  return `${rate}|${taxRateId ?? ""}`;
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

function bump(map: Map<string, Bucket>, rate: number, taxRateId: string | null, base: Money, tax: Money): void {
  const key = bucketKey(rate, taxRateId);
  const bucket = map.get(key) ?? { rate, taxRateId, base: Money.zero(), tax: Money.zero() };
  map.set(key, { ...bucket, base: bucket.base.add(base), tax: bucket.tax.add(tax) });
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
): Bucket[] {
  const byRate = new Map<string, Bucket>();
  let sawRate = false;
  for (const line of entry.lines) {
    const rate = line.taxRatePercent;
    if (rate === null || rate === undefined) continue;
    const amount =
      side === "credit" ? line.credit.add(line.debit.negate()) : line.debit.add(line.credit.negate());
    if (amount.scaled === 0n) continue;
    const taxRateId = line.taxRateId ?? null;
    const key = bucketKey(rate, taxRateId);
    const slot = byRate.get(key) ?? { rate, taxRateId, base: Money.zero(), tax: Money.zero() };
    if (line.accountId === vatAccountId) {
      sawRate = true;
      byRate.set(key, { ...slot, tax: slot.tax.add(amount) });
    } else if (isBaseAccount(line.accountId)) {
      sawRate = true;
      byRate.set(key, { ...slot, base: slot.base.add(amount) });
    }
  }
  if (!sawRate) return [];
  return [...byRate.values()].filter((b) => b.base.scaled !== 0n || b.tax.scaled !== 0n);
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
      { key: "taxRateName", header: "الضريبة", format: "text", value: (row) => row.taxRateName },
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
      const extraOutputBase = new Set(ctx.outputBaseAccountIds ?? []);
      const isOutputBase = (id: string): boolean => isRevenue(id) || extraOutputBase.has(id);
      const extraInputBase = new Set(ctx.inputBaseAccountIds ?? []);
      const isPurchaseBase = (id: string): boolean =>
        typeOf.get(id) === "expense" || typeOf.get(id) === "asset" || extraInputBase.has(id);

      const nameOf = new Map((ctx.taxRates ?? []).map((r) => [r.id, r.name]));

      const outputBuckets = new Map<string, Bucket>();
      const inputBuckets = new Map<string, Bucket>();

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
        const outputTagged = ratedBuckets(entry, ctx.outputVatAccountId, isOutputBase, "credit");
        if (outputTagged.length > 0) {
          for (const b of outputTagged) bump(outputBuckets, b.rate, b.taxRateId, b.base, b.tax);
        } else if (revenueBase.scaled > 0n) {
          const rate = outputTax.scaled > 0n ? derivedRatePercent(outputTax, revenueBase) : 0;
          bump(outputBuckets, rate, null, revenueBase, outputTax.scaled > 0n ? outputTax : Money.zero());
        }

        const inVat = lineNet(entry, ctx.inputVatAccountId);
        const inputTax = inVat.debit.add(inVat.credit.negate());
        // INVARIANT: only a purchase-side entry has an input base. A sale that
        // credits an asset — a retention release crediting «محتجزات ضمان
        // مدينة» at 0% — would otherwise read as a negative purchase.
        const purchaseSide =
          inVat.debit.scaled !== 0n || inVat.credit.scaled !== 0n || PURCHASE_SOURCE_DOC_TYPES.has(entry.sourceDocType ?? "");
        const inputTagged = purchaseSide
          ? ratedBuckets(entry, ctx.inputVatAccountId, (id) => id !== ctx.inputVatAccountId && isPurchaseBase(id), "debit")
          : [];
        if (inputTagged.length > 0) {
          for (const b of inputTagged) bump(inputBuckets, b.rate, b.taxRateId, b.base, b.tax);
        } else if (inputTax.scaled > 0n) {
          // Exclude the input-VAT account itself from the base (it's an asset too).
          const purchaseBase = debitsToTypes(entry, (id) => id !== ctx.inputVatAccountId && isPurchaseBase(id));
          const rate = purchaseBase.scaled > 0n ? derivedRatePercent(inputTax, purchaseBase) : 0;
          bump(inputBuckets, rate, null, purchaseBase, inputTax);
        }
      }

      const rows: VatReturnRow[] = [];
      const emit = (side: VatSide, buckets: Map<string, Bucket>): void => {
        const ordered = [...buckets.values()].sort(
          (a, b) => b.rate - a.rate || (a.taxRateId ?? "").localeCompare(b.taxRateId ?? ""),
        );
        for (const bucket of ordered) {
          const { rate, taxRateId } = bucket;
          // The serialisation boundary — the ONE conversion per figure.
          rows.push({
            rowId: taxRateId === null ? `${side}-${rate}` : `${side}-${rate}-${taxRateId}`,
            side,
            sideLabel: SIDE_LABELS[side],
            rate,
            taxRateId,
            taxRateName: taxRateId === null ? null : (nameOf.get(taxRateId) ?? null),
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

/** دفتر ملخص الضريبة — the tax-summary book required by قرار وزير المالية 420 لسنة 2025، المادة 3. */
export const createDecree420TaxSummaryBook = createVatReturnReport;
