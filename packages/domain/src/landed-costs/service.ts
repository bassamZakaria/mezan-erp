/**
 * LandedCostService — wraps the generic `DocumentService` with the one extra
 * step landed cost needs that no document hook covers: revaluing the target
 * positions' cost basis (see `landed-cost-document.ts`'s doc-comment for why
 * this can't be a `buildStockPlan`).
 *
 * KNOWN LIMITATION (documented, not hidden): `DocumentService.confirm()`
 * posts the GL entry + persists the document inside ITS OWN transaction; the
 * revaluation step below runs AFTER that transaction commits, as a second
 * step against the stock-ledger engine's own connection. The two are not
 * atomic with each other — if the revaluation throws, the document is left
 * confirmed with its GL posted but its layers not yet revalued. This mirrors
 * the framework's current single-connection assumption (the generic stock
 * hook has the same property when the document repo and the stock-ledger
 * store are different connections); resolving it needs shared-transaction
 * plumbing across engines, tracked as a follow-up, not attempted here.
 */

import type { DocumentService, ConfirmOptions, ConfirmResult } from "../documents/service.js";
import type { StockLedgerService } from "../inventory/stock-ledger-service.js";
import { occurredAtFromDocumentDate } from "../inventory/movement.js";
import { Money } from "../money/index.js";
import type { LandedCostLine } from "./landed-cost-document.js";

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
}

export class LandedCostService {
  constructor(
    private readonly documents: DocumentService<LandedCostLine>,
    private readonly stock: StockLedgerService,
  ) {}

  async confirm(id: string, opts: ConfirmOptions = {}): Promise<LandedCostConfirmResult> {
    const result = await this.documents.confirm(id, opts);
    if (result.held) return { ...result, unabsorbed: [], unabsorbedTotal: Money.zero() };

    const unabsorbed: UnabsorbedLandedCost[] = [];
    for (const line of result.document.lines) {
      const absorption = await this.stock.applyLandedCostRevaluation({
        itemId: line.itemId,
        warehouseId: line.warehouseId,
        sourceDocId: line.sourceInvoiceId,
        valueDelta: line.allocatedAmount,
        landedCostDocId: result.document.id,
        landedCostDocNumber: result.document.docNo,
        occurredAt: occurredAtFromDocumentDate(result.document.date),
      });
      if (absorption.unabsorbed.scaled !== 0n) {
        unabsorbed.push({
          itemId: line.itemId,
          warehouseId: line.warehouseId,
          sourceInvoiceId: line.sourceInvoiceId,
          amount: absorption.unabsorbed,
        });
      }
    }
    return { ...result, unabsorbed, unabsorbedTotal: Money.sum(unabsorbed.map((u) => u.amount)) };
  }
}
