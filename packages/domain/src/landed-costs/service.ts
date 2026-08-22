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
import type { LandedCostLine } from "./landed-cost-document.js";

export class LandedCostService {
  constructor(
    private readonly documents: DocumentService<LandedCostLine>,
    private readonly stock: StockLedgerService,
  ) {}

  async confirm(id: string, opts: ConfirmOptions = {}): Promise<ConfirmResult<LandedCostLine>> {
    const result = await this.documents.confirm(id, opts);
    if (result.held) return result; // pending approval — no revaluation until it actually confirms

    for (const line of result.document.lines) {
      await this.stock.applyLandedCostRevaluation({
        itemId: line.itemId,
        warehouseId: line.warehouseId,
        sourceDocId: line.sourceInvoiceId,
        valueDelta: line.allocatedAmount,
      });
    }
    return result;
  }
}
