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
import type { StockLedgerService } from "../inventory/stock-ledger-service.js";
import { occurredAtFromDocumentDate } from "../inventory/movement.js";
import { Money } from "../money/index.js";
import { landedCostAbsorptionDate, type LandedCostLine } from "./landed-cost-document.js";

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
export interface LandedCostGlPosting {
  readonly entryId: string;
  readonly date: string;
  readonly memo: string;
  readonly sourceDocId: string;
  readonly sourceDocNumber: string | null;
  readonly amount: Money;
}

export interface LandedCostUnabsorbedGlPort {
  postUnabsorbed(posting: LandedCostGlPosting): Promise<void>;
  postAbsorbed(posting: LandedCostGlPosting): Promise<void>;
  postAbsorbedFromClearing(posting: LandedCostGlPosting): Promise<void>;
  postIssuedFromClearing(posting: LandedCostGlPosting): Promise<void>;
  reverseSideEntry(entryId: string, opts: { readonly reversalId: string; readonly date: string }): Promise<Money | null>;
}

export interface LandedCostServiceOptions {
  readonly transaction?: <T>(fn: () => Promise<T>) => Promise<T>;
  readonly layerOwnerOf?: (sourceDocId: string) => Promise<string>;
}

export interface LandedCostConfirmResult extends ConfirmResult<LandedCostLine> {
  readonly unabsorbed: readonly UnabsorbedLandedCost[];
  readonly unabsorbedTotal: Money;
  /** The reclassification entry, when there was an unabsorbed remainder and a GL port to post it through. */
  readonly unabsorbedJournalEntryId: string | null;
  readonly absorbedTotal: Money;
  readonly absorptionJournalEntryId: string | null;
}

export interface LandedCostConfirmOptions extends ConfirmOptions {
  readonly today?: string;
  readonly absorptionDate?: string;
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

  /** INVARIANT: a value movement is never stamped before the position's last movement — the replay would re-cost issues the ledger has already posted. */
  private async earliestAbsorptionDay(wanted: string, lines: readonly LandedCostLine[]): Promise<string> {
    let day = wanted;
    for (const line of lines) {
      const latest = await this.stock.latestMovementDay(line.itemId, line.warehouseId);
      if (latest !== null && latest > day) day = latest;
    }
    return day;
  }

  async standingOn(sourceDocId: string): Promise<string[]> {
    return (await this.documents.list({ status: "confirmed" }))
      .filter((doc) => !doc.reversesDocId && doc.lines.some((line) => line.sourceInvoiceId === sourceDocId))
      .map((doc) => doc.docNo ?? doc.id);
  }

  /**
   * عكس التكلفة الإضافية، حتى بعد صرف جزء من البضاعة. What the goods still on
   * hand carry comes off the stock; what left with issued goods has already
   * reached cost of sales through their average, so it is credited back there.
   * INVARIANT: every entry and every stock movement of the reversal share one
   * day, so stock and GL 1200 tie at every month end.
   */
  reverse(id: string, opts: ReverseOptions & { readonly date: string }): Promise<{ original: FrameworkDocument<LandedCostLine>; reversal: FrameworkDocument<LandedCostLine> }> {
    return this.atomically(() => this.reverseWithin(id, opts));
  }

  confirm(id: string, opts: LandedCostConfirmOptions = {}): Promise<LandedCostConfirmResult> {
    return this.atomically(() => this.confirmWithin(id, opts));
  }

  private atomically<T>(fn: () => Promise<T>): Promise<T> {
    return this.options.transaction ? this.options.transaction(fn) : fn();
  }

  private async reverseWithin(id: string, opts: ReverseOptions & { readonly date: string }): Promise<{ original: FrameworkDocument<LandedCostLine>; reversal: FrameworkDocument<LandedCostLine> }> {
    const existing = await this.documents.findById(id);
    const live = existing !== null && existing.status === "confirmed" && !existing.reversesDocId;
    const date = live ? await this.earliestAbsorptionDay(opts.date, existing.lines) : opts.date;
    if (live) await this.stock.assertMovementDateOpen(occurredAtFromDocumentDate(date));
    const result = await this.documents.reverse(id, { ...opts, date });
    const original = result.original;
    let removed = Money.zero();
    for (const line of original.lines) {
      removed = removed.add(
        await this.stock.reverseLandedCostRevaluation({
          itemId: line.itemId,
          warehouseId: line.warehouseId,
          landedCostDocId: original.id,
          reversalDocId: result.reversal.id,
          occurredAt: occurredAtFromDocumentDate(date),
        }),
      );
    }
    if (this.gl) {
      const total = Money.sum(original.lines.map((line) => line.allocatedAmount));
      const absorbedLater = await this.gl.reverseSideEntry(absorptionEntryId(original.id), { reversalId: absorptionEntryId(result.reversal.id), date });
      const expensed = await this.gl.reverseSideEntry(unabsorbedEntryId(original.id), { reversalId: unabsorbedEntryId(result.reversal.id), date });
      const twoDates = landedCostAbsorptionDate(original) !== original.date;
      const absorbed = twoDates ? (absorbedLater ?? Money.zero()) : Money.fromScaled(total.scaled - (expensed?.scaled ?? 0n));
      const leftWithGoods = Money.fromScaled(absorbed.scaled - removed.scaled);
      if (leftWithGoods.scaled > 0n) {
        await this.gl.postAbsorbed({
          entryId: `${result.reversal.id}:ISSUED`,
          date,
          memo: `عكس تكلفة إضافية — نصيب بضاعة صُرفت يُرد من تكلفة المبيعات — ${original.docNo ?? original.id}`,
          sourceDocId: result.reversal.id,
          sourceDocNumber: original.docNo,
          amount: leftWithGoods,
        });
      }
    }
    return result;
  }

  private async confirmWithin(id: string, opts: LandedCostConfirmOptions): Promise<LandedCostConfirmResult> {
    const draft = await this.documents.findById(id);
    if (draft && draft.status === "draft") {
      const wanted = opts.absorptionDate ?? opts.today ?? draft.date;
      const absorptionDate = await this.earliestAbsorptionDay(wanted > draft.date ? wanted : draft.date, draft.lines);
      await this.stock.assertMovementDateOpen(occurredAtFromDocumentDate(absorptionDate));
      await this.documents.amendDraftLines(id, draft.lines.map((line) => ({ ...line, absorptionDate: absorptionDate === draft.date ? null : absorptionDate })));
    }
    const result = await this.documents.confirm(id, opts);
    if (result.held) {
      return { ...result, unabsorbed: [], unabsorbedTotal: Money.zero(), absorbedTotal: Money.zero(), unabsorbedJournalEntryId: null, absorptionJournalEntryId: null };
    }
    const document = result.document;
    const absorptionDate = landedCostAbsorptionDate(document);

    const unabsorbed: UnabsorbedLandedCost[] = [];
    for (const line of document.lines) {
      const absorption = await this.stock.applyLandedCostRevaluation({
        itemId: line.itemId,
        warehouseId: line.warehouseId,
        sourceDocId: await this.layerOwnerOf(line.sourceInvoiceId),
        valueDelta: line.allocatedAmount,
        landedCostDocId: document.id,
        landedCostDocNumber: document.docNo,
        occurredAt: occurredAtFromDocumentDate(absorptionDate),
      });
      if (absorption.unabsorbed.scaled !== 0n) {
        unabsorbed.push({ itemId: line.itemId, warehouseId: line.warehouseId, sourceInvoiceId: line.sourceInvoiceId, amount: absorption.unabsorbed });
      }
    }
    const unabsorbedTotal = Money.sum(unabsorbed.map((u) => u.amount));
    const absorbedTotal = Money.fromScaled(Money.sum(document.lines.map((line) => line.allocatedAmount)).scaled - unabsorbedTotal.scaled);
    let unabsorbedJournalEntryId: string | null = null;
    let absorptionJournalEntryId: string | null = null;
    const label = document.docNo ?? document.id;
    if (this.gl && absorptionDate !== document.date) {
      if (absorbedTotal.scaled !== 0n) {
        absorptionJournalEntryId = absorptionEntryId(document.id);
        await this.gl.postAbsorbedFromClearing({
          entryId: absorptionJournalEntryId,
          date: absorptionDate,
          memo: `تحميل التكلفة الإضافية على المخزون القائم — ${label}`,
          sourceDocId: document.id,
          sourceDocNumber: document.docNo,
          amount: absorbedTotal,
        });
      }
      if (unabsorbedTotal.scaled !== 0n) {
        unabsorbedJournalEntryId = unabsorbedEntryId(document.id);
        await this.gl.postIssuedFromClearing({
          entryId: unabsorbedJournalEntryId,
          date: absorptionDate,
          memo: `نصيب بضاعة صُرفت من التكلفة الإضافية — ${label}`,
          sourceDocId: document.id,
          sourceDocNumber: document.docNo,
          amount: unabsorbedTotal,
        });
      }
    } else if (this.gl && unabsorbedTotal.scaled !== 0n) {
      unabsorbedJournalEntryId = unabsorbedEntryId(document.id);
      await this.gl.postUnabsorbed({
        entryId: unabsorbedJournalEntryId,
        date: document.date,
        memo: `تكلفة إضافية غير مُحمَّلة على المخزون — ${label}`,
        sourceDocId: document.id,
        sourceDocNumber: document.docNo,
        amount: unabsorbedTotal,
      });
    }
    return { ...result, unabsorbed, unabsorbedTotal, absorbedTotal, unabsorbedJournalEntryId, absorptionJournalEntryId };
  }
}

function unabsorbedEntryId(docId: string): string {
  return `${docId}:UNABSORBED`;
}

function absorptionEntryId(docId: string): string {
  return `${docId}:ABSORPTION`;
}
