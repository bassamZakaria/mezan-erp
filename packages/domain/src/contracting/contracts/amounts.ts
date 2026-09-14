import { Money, Qty } from "../../money/index.js";
import type { BoqLine, BoqLineAdjustment, VariationOrder, VariationOrderLine } from "./contract.js";

/**
 * The contract's arithmetic. Exact scaled-integer only: a BOQ extension is
 * qty × unitRate rounded HALF_UP to the currency minor unit at the
 * LINE_EXTENSION boundary (docs/archive/plan.md §2.3), and every sum of
 * extensions stays exact from there.
 */

const SCALE = 1_000_000n;
const MINOR_STEP = 10_000n; // 1e-6 → 1e-2

function divHalfUp(numerator: bigint, denominator: bigint): bigint {
  const negative = numerator < 0n !== denominator < 0n;
  const n = numerator < 0n ? -numerator : numerator;
  const d = denominator < 0n ? -denominator : denominator;
  const q = n / d;
  const r = n % d;
  const rounded = r * 2n >= d ? q + 1n : q;
  return negative ? -rounded : rounded;
}

/** qty × unitRate, rounded HALF_UP to the minor unit (LINE_EXTENSION). */
export function extendBoqLine(qty: Qty, unitRate: Money): Money {
  const product = qty.scaled * unitRate.scaled; // scale 1e12
  return Money.fromScaled(divHalfUp(divHalfUp(product, SCALE), MINOR_STEP) * MINOR_STEP);
}

/**
 * قيمة العقد — the sum of the BASE bill only. Lines an approved variation
 * added carry `origin: "variation"` and are counted through
 * {@link computeApprovedVariationsValue} instead, so the two never
 * double-count each other.
 */
export function computeContractValue(lines: readonly BoqLine[]): Money {
  return Money.sum(
    lines.filter((l) => l.origin === "base").map((l) => extendBoqLine(l.qty, l.unitRate)),
  );
}

/**
 * The net value of one variation order: Σ(add: qty × rate) + Σ(change:
 * qtyDelta × rate). `qtyDelta` may be negative — an omission is the same
 * entity with the opposite sign (02-terminology.md).
 */
export function computeVariationOrderValue(
  order: Pick<VariationOrder, "lines">,
  boqLines: readonly BoqLine[],
): Money {
  const rateOf = (line: VariationOrderLine): Money | null => {
    if (line.unitRateOverride) return line.unitRateOverride;
    const target = boqLines.find((l) => l.id === line.boqLineId);
    return target?.unitRate ?? null;
  };
  const parts: Money[] = [];
  for (const line of order.lines) {
    if (line.kind === "add") {
      if (line.newLine) parts.push(extendBoqLine(line.newLine.qty, line.newLine.unitRate));
      continue;
    }
    const rate = rateOf(line);
    if (rate && line.qtyDelta) parts.push(extendBoqLine(line.qtyDelta, rate));
  }
  return Money.sum(parts);
}

/** Σ net value over APPROVED orders only; a draft order changes nothing. */
export function computeApprovedVariationsValue(
  orders: readonly VariationOrder[],
  boqLines: readonly BoqLine[],
): Money {
  return Money.sum(
    orders.filter((o) => o.status === "approved").map((o) => computeVariationOrderValue(o, boqLines)),
  );
}

export interface ContractedQtyRow {
  readonly boqLineId: string;
  readonly code: string;
  readonly descriptionAr: string;
  readonly baseQty: Qty;
  readonly adjustmentQty: Qty;
  readonly contractedQty: Qty;
}

export interface ContractedQtyInput {
  readonly lines: readonly BoqLine[];
  readonly adjustments: readonly BoqLineAdjustment[];
  /** Variation order id → its legal approval date. An order absent here is not approved. */
  readonly variationApprovals: ReadonlyMap<string, string>;
}

/**
 * الكمية التعاقدية as of a date — base quantity plus every adjustment approved
 * ON OR BEFORE `asOfDate`, and zero for a line an order approved after that
 * date brought into the bill.
 *
 * INVARIANT slice 2 depends on: a certificate line measured on date D may only
 * use the quantity contracted as of D. Recomputing this from the approval
 * dates is what makes «أمر تغيير اعتُمد بعد التنفيذ» refusable instead of
 * silently accepted (design §06).
 */
export function computeContractedQuantities(
  input: ContractedQtyInput,
  asOfDate: string | null,
): ContractedQtyRow[] {
  const withinDate = (date: string | null | undefined): boolean =>
    date !== null && date !== undefined && (asOfDate === null || date <= asOfDate);

  return input.lines.map((line) => {
    const lineLive =
      line.origin === "base" || withinDate(line.variationOrderId ? input.variationApprovals.get(line.variationOrderId) : null);
    const baseQty = lineLive ? line.qty : Qty.zero();
    const adjustmentQty = Qty.sum(
      input.adjustments
        .filter((a) => a.boqLineId === line.id && withinDate(a.approvedAt))
        .map((a) => a.qtyDelta),
    );
    return {
      boqLineId: line.id,
      code: line.code,
      descriptionAr: line.descriptionAr,
      baseQty,
      adjustmentQty,
      contractedQty: baseQty.add(adjustmentQty),
    };
  });
}

/** The contracted quantity of ONE line as of a date — the function slice 2 calls per certificate line. */
export function contractedQtyOf(
  input: ContractedQtyInput,
  boqLineId: string,
  asOfDate: string | null,
): Qty {
  const row = computeContractedQuantities(input, asOfDate).find((r) => r.boqLineId === boqLineId);
  return row?.contractedQty ?? Qty.zero();
}
