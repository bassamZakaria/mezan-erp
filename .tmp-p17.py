p = "packages/domain/src/landed-costs/service.ts"
s = open(p).read()
o = """import type { LandedCostLine } from \"./landed-cost-document.js\";"""
n = """import { Money } from \"../money/index.js\";
import type { LandedCostLine } from \"./landed-cost-document.js\";

/**
 * One landed-cost line the stock could not absorb: the goods it attaches to
 * had already been issued when the cost was booked (D84, D135).
 */
export interface UnabsorbedLandedCost {
  readonly itemId: string;
  readonly warehouseId: string;
  readonly sourceInvoiceId: string;
  readonly amount: Money;
}

/**
 * DECISION PENDING — the GL half of D135.
 *
 * `buildGlPosting` debits the inventory control account for the WHOLE document
 * because it is pure over the document and cannot know what is still on hand.
 * When `unabsorbedTotal` is nonzero that debit is wrong by exactly that amount:
 * the stock valuation report will be lower than GL inventory until the
 * remainder is posted to an expense account instead.
 *
 * Closing it needs a mapping decision nobody has made: cost of sales
 * (`item_type.cogs`, 5100 in the standard chart) or a dedicated landed-cost /
 * purchase-price-variance account. Until then this figure is returned so the
 * caller can surface it rather than have it disappear.
 */
export interface LandedCostConfirmResult extends ConfirmResult<LandedCostLine> {
  readonly unabsorbed: readonly UnabsorbedLandedCost[];
  readonly unabsorbedTotal: Money;
}"""
assert o in s
s = s.replace(o, n, 1)
open(p, "w").write(s)
print("ok")
