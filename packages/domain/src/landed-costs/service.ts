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

import type { DocumentService, ConfirmOptions, ConfirmResult, ReverseOptions } from "../documents/service.js";
import type { FrameworkDocument } from "../documents/document.js";
import { LandedCostDateBeforeStockMovementError, LandedCostGoodsIssuedError } from "./errors.js";
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
 * Reclassifies the part of a landed cost the stock could not absorb.
 *
 * `buildGlPosting` debits the inventory control account for the WHOLE document
 * because it is pure over the document and cannot know what is still on hand.
 * Whatever the revaluation could not capitalise belongs to units already sold,
 * so it is a PERIOD cost: the caller moves it out of inventory and into cost of
 * sales in a second, balanced entry. Without that GL inventory exceeded the
 * stock valuation report by exactly the unabsorbed figure, forever (D84).
 *
 * The amount is stated here; which accounts it lands in is the composition
 * root's decision, as it is for every other posting this module makes.
 */
export interface LandedCostUnabsorbedGlPort {
  postUnabsorbed(posting: {
    readonly entryId: string;
    readonly date: string;
    readonly memo: string;
    readonly sourceDocId: string;
    readonly sourceDocNumber: string | null;
    readonly amount: Money;
  }): Promise<void>;
  /** Mirrors the reclassification entry of a landed cost being reversed; a no-op when that entry was never posted. */
  reverseUnabsorbed?(entryId: string, opts: { readonly reversalId: string; readonly date: string }): Promise<void>;
}

export interface LandedCostServiceOptions {
  /** The document whose cost layers a target's goods sit in: an invoice raised from a receipt names the receipt. Absent = the target document itself. */
  readonly layerOwnerOf?: (sourceDocId: string) => Promise<string>;
}

export interface LandedCostConfirmResult extends ConfirmResult<LandedCostLine> {
  readonly unabsorbed: readonly UnabsorbedLandedCost[];
  readonly unabsorbedTotal: Money;
  /** The reclassification entry, when there was an unabsorbed remainder and a GL port to post it through. */
  readonly unabsorbedJournalEntryId: string | null;
}

export class LandedCostService {
  constructor(
    private readonly documents: DocumentService<LandedCostLine>,
    private readonly stock: StockLedgerService,
    private readonly gl?: LandedCostUnabsorbedGlPort,
    private readonly options: LandedCostServiceOptions = {},
  ) {}

  private async layerOwnerOf(sourceDocId: string): Promise<string> {
    return (await this.options.layerOwnerOf?.(sourceDocId)) ?? sourceDocId;
  }

  private async assertNotBeforeStock(date: string, lines: readonly LandedCostLine[]): Promise<void> {
    await this.stock.assertMovementDateOpen(occurredAtFromDocumentDate(date));
    for (const line of lines) {
      const latest = await this.stock.latestMovementDay(line.itemId, line.warehouseId);
      if (latest !== null && latest > date) throw new LandedCostDateBeforeStockMovementError(date, line.itemId, latest);
    }
  }

  /** Confirmed landed costs still standing on a purchase document, by document number. */
  async standingOn(sourceDocId: string): Promise<string[]> {
    return (await this.documents.list({ status: "confirmed" }))
      .filter((doc) => !doc.reversesDocId && doc.lines.some((line) => line.sourceInvoiceId === sourceDocId))
      .map((doc) => doc.docNo ?? doc.id);
  }

  /**
   * Reverses a confirmed landed cost: the ledger entry is mirrored and each
   * position gives the cost back. Refused once goods have left a targeted
   * position since — part of the cost is then in cost of sales, and a mirror
   * would take it out of stock that never carried it.
   */
  async reverse(id: string, opts: ReverseOptions & { readonly date: string }): Promise<{ original: FrameworkDocument<LandedCostLine>; reversal: FrameworkDocument<LandedCostLine> }> {
    const existing = await this.documents.findById(id);
    if (existing && existing.status === "confirmed" && !existing.reversesDocId) {
      for (const line of existing.lines) {
        const state = await this.stock.landedCostRevaluationState({ itemId: line.itemId, warehouseId: line.warehouseId, landedCostDocId: existing.id });
        if (state.issuedSince) throw new LandedCostGoodsIssuedError(existing.docNo ?? existing.id, line.itemId);
      }
      await this.assertNotBeforeStock(opts.date, existing.lines);
    }
    const result = await this.documents.reverse(id, opts);
    for (const line of result.original.lines) {
      await this.stock.reverseLandedCostRevaluation({
        itemId: line.itemId,
        warehouseId: line.warehouseId,
        landedCostDocId: result.original.id,
        reversalDocId: result.reversal.id,
        occurredAt: occurredAtFromDocumentDate(opts.date),
      });
    }
    await this.gl?.reverseUnabsorbed?.(`${result.original.id}:UNABSORBED`, { reversalId: `${result.reversal.id}:UNABSORBED`, date: opts.date });
    return result;
  }

  async confirm(id: string, opts: ConfirmOptions = {}): Promise<LandedCostConfirmResult> {
    const draft = await this.documents.findById(id);
    if (draft && draft.status === "draft") await this.assertNotBeforeStock(draft.date, draft.lines);
    const result = await this.documents.confirm(id, opts);
    if (result.held) {
      return { ...result, unabsorbed: [], unabsorbedTotal: Money.zero(), unabsorbedJournalEntryId: null };
    }

    const unabsorbed: UnabsorbedLandedCost[] = [];
    for (const line of result.document.lines) {
      const absorption = await this.stock.applyLandedCostRevaluation({
        itemId: line.itemId,
        warehouseId: line.warehouseId,
        sourceDocId: await this.layerOwnerOf(line.sourceInvoiceId),
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
    const unabsorbedTotal = Money.sum(unabsorbed.map((u) => u.amount));
    let unabsorbedJournalEntryId: string | null = null;
    if (unabsorbedTotal.scaled !== 0n && this.gl) {
      unabsorbedJournalEntryId = `${result.document.id}:UNABSORBED`;
      await this.gl.postUnabsorbed({
        entryId: unabsorbedJournalEntryId,
        date: result.document.date,
        memo: `تكلفة إضافية غير مُحمَّلة على المخزون — ${result.document.docNo ?? result.document.id}`,
        sourceDocId: result.document.id,
        sourceDocNumber: result.document.docNo,
        amount: unabsorbedTotal,
      });
    }
    return { ...result, unabsorbed, unabsorbedTotal, unabsorbedJournalEntryId };
  }
}
