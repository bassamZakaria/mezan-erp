import { z } from "zod";
import { isoDateParamSchema } from "./iso-date.js";
import { type GlReportContext, isLedgerEffective, isYearEndClose, moneyToNumber } from "./gl-shared.js";
import { Money, allocate } from "../money/index.js";
import { journalSourceModule, JournalSourceModuleCode, type JournalEntry } from "../journal.js";
import { RECOGNITION_DOC_TYPE } from "../contracting/recognition/recognition.js";
import type { ReportDefinition } from "./types.js";
import { diffOf, sumRows } from "./kpi.js";
import { ReportParamKind } from "./types.js";
import type { TaxRate } from "../tax-rates/tax-rate.js";

export type VatReturnTaxRate = Pick<TaxRate, "id" | "name">;

export interface VatReturnContext extends GlReportContext {
  readonly outputVatAccountId: string;
  readonly inputVatAccountId: string;
  readonly taxRates?: readonly VatReturnTaxRate[];
  // EXTERNAL CONTRACT: the composition root names every account a taxable
  // base is posted to that the account TYPE cannot find — the received-not-
  // invoiced liability a purchase debits, the contract-billings liability a
  // certificate invoice credits. One left out reports its tax against no base.
  readonly inputBaseAccountIds?: readonly string[];
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

enum PostingSide {
  Debit = "debit",
  Credit = "credit",
}

function sideAmount(line: JournalEntry["lines"][number], side: PostingSide): Money {
  return side === PostingSide.Credit ? line.credit.add(line.debit.negate()) : line.debit.add(line.credit.negate());
}

function netOn(entry: JournalEntry, isAccount: (id: string) => boolean, side: PostingSide): Money {
  let total = Money.zero();
  for (const line of entry.lines) if (isAccount(line.accountId)) total = total.add(sideAmount(line, side));
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
  const magnitude = (value: bigint): bigint => (value < 0n ? -value : value);
  const scaled = (magnitude(tax.scaled) * 200n) / magnitude(base.scaled); // percent × 2, truncated
  return Number((scaled + 1n) / 2n);
}

/** Output tax − input tax = net VAT payable (positive) or refundable (negative). */
export function vatNetPayable(rows: readonly VatReturnRow[]): number {
  const output = sumRows(rows, (r) => (r.side === "output" ? r.tax : 0));
  const input = sumRows(rows, (r) => (r.side === "input" ? r.tax : 0));
  return diffOf(output, input);
}


function hasRate(line: JournalEntry["lines"][number]): boolean {
  return line.taxRatePercent !== null && line.taxRatePercent !== undefined;
}

// INVARIANT: an entry posted when only its VAT line carried a rate still has
// a base — on its untagged lines. It is read one way only (debits for a
// purchase, credits for its return), because such an entry may settle in the
// same breath and the payment leg sits on a base-typed account too.
function withUntaggedBase(
  entry: JournalEntry,
  buckets: readonly Bucket[],
  isBaseAccount: (accountId: string) => boolean,
  side: PostingSide,
): Bucket[] {
  const orphans = buckets.filter((b) => b.tax.scaled !== 0n && b.base.scaled === 0n);
  if (orphans.length === 0) return [...buckets];
  const reversing = Money.sum(orphans.map((b) => b.tax)).scaled < 0n;
  let untagged = Money.zero();
  for (const line of entry.lines) {
    if (hasRate(line) || !isBaseAccount(line.accountId)) continue;
    const forward = side === PostingSide.Credit ? line.credit : line.debit;
    const backward = side === PostingSide.Credit ? line.debit : line.credit;
    untagged = untagged.add(reversing ? backward.negate() : forward);
  }
  if (untagged.scaled === 0n) return [...buckets];
  const magnitude = (value: bigint): bigint => (value < 0n ? -value : value);
  const weights = orphans.map((b) => (b.rate > 0 ? (magnitude(b.tax.scaled) * 10_000n) / BigInt(Math.round(b.rate * 100)) : 0n));
  const shares = weights.some((w) => w > 0n) ? allocate(untagged, weights) : orphans.map((_, i) => (i === 0 ? untagged : Money.zero()));
  return buckets.map((b) => {
    const index = orphans.indexOf(b);
    return index < 0 ? b : { ...b, base: shares[index] as Money };
  });
}

function ratedBuckets(
  entry: JournalEntry,
  vatAccountId: string,
  isBaseAccount: (accountId: string) => boolean,
  side: PostingSide,
): Bucket[] {
  const byRate = new Map<string, Bucket>();
  let sawRate = false;
  for (const line of entry.lines) {
    if (!hasRate(line)) continue;
    const rate = line.taxRatePercent as number;
    const amount = sideAmount(line, side);
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
  return withUntaggedBase(entry, [...byRate.values()], (id) => id !== vatAccountId && isBaseAccount(id), side).filter(
    (b) => b.base.scaled !== 0n || b.tax.scaled !== 0n,
  );
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
    paramFields: [{ kind: ReportParamKind.DateRange, fromKey: "periodFrom", toKey: "periodTo", label: "الفترة" }],
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

      // INVARIANT: the recognition run moves revenue and the billings
      // liability between themselves and the contract asset; the supply was
      // the certificate invoice, already counted. The year-end close empties
      // revenue. Neither is a sale, so neither reaches the untagged fallback.
      const isReclassification = (entry: JournalEntry): boolean =>
        entry.sourceDocType === RECOGNITION_DOC_TYPE || isYearEndClose(entry);

      // INVARIANT: only a purchase-side entry has an input base. A sale that
      // credits an asset — a retention release crediting «محتجزات ضمان
      // مدينة» at 0% — would otherwise read as a negative purchase. Excluded
      // by what makes it a sale, so a 0% purchase with no source document
      // (a manual journal) is still a purchase.
      const moved = (net: { debit: Money; credit: Money }): boolean => net.debit.scaled !== 0n || net.credit.scaled !== 0n;
      const isPurchaseSide = (
        entry: JournalEntry,
        inVat: { debit: Money; credit: Money },
        outVat: { debit: Money; credit: Money },
      ): boolean => {
        const module = journalSourceModule(entry.sourceDocType, entry.source);
        if (moved(inVat) || module === JournalSourceModuleCode.Purchases) return true;
        return !(module === JournalSourceModuleCode.Sales || moved(outVat) || netOn(entry, isRevenue, PostingSide.Credit).scaled !== 0n);
      };

      const nameOf = new Map((ctx.taxRates ?? []).map((r) => [r.id, r.name]));

      const outputBuckets = new Map<string, Bucket>();
      const inputBuckets = new Map<string, Bucket>();

      for (const entry of ctx.journalEntries) {
        if (!isLedgerEffective(entry)) continue;
        if (entry.date < params.periodFrom || entry.date > params.periodTo) continue;

        const outVat = lineNet(entry, ctx.outputVatAccountId);
        const outputTax = outVat.credit.add(outVat.debit.negate());
        const outputTagged = ratedBuckets(entry, ctx.outputVatAccountId, isOutputBase, PostingSide.Credit);
        if (outputTagged.length > 0) {
          for (const b of outputTagged) bump(outputBuckets, b.rate, b.taxRateId, b.base, b.tax);
        } else if (!isReclassification(entry)) {
          const untaggedBase = netOn(entry, isOutputBase, PostingSide.Credit);
          if (untaggedBase.scaled !== 0n) {
            const charged = outputTax.scaled !== 0n && outputTax.scaled > 0n === untaggedBase.scaled > 0n;
            bump(outputBuckets, charged ? derivedRatePercent(outputTax, untaggedBase) : 0, null, untaggedBase, charged ? outputTax : Money.zero());
          }
        }

        const inVat = lineNet(entry, ctx.inputVatAccountId);
        const inputTax = inVat.debit.add(inVat.credit.negate());
        const inputTagged = isPurchaseSide(entry, inVat, outVat)
          ? ratedBuckets(entry, ctx.inputVatAccountId, (id) => id !== ctx.inputVatAccountId && isPurchaseBase(id), PostingSide.Debit)
          : [];
        if (inputTagged.length > 0) {
          for (const b of inputTagged) bump(inputBuckets, b.rate, b.taxRateId, b.base, b.tax);
        } else if (inputTax.scaled > 0n) {
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
          if (bucket.base.scaled === 0n && bucket.tax.scaled === 0n) continue;
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
