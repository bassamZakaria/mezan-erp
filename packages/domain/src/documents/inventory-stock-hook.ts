/**
 * Binds the costing + stock-ledger engine (../inventory/) behind the document
 * framework's generic {@link DocumentStockHook} (docs/archive/plan.md §3). Mirrors how
 * `journal-document.ts` binds the GL engine behind `DocumentGlHook` — this file
 * is the "impure", engine-binding half of the framework (the framework core in
 * document.ts/hooks.ts/effects.ts/service.ts never imports a concrete engine).
 *
 * Unlike the GL hook (one per document type, since a journal entry IS its own
 * GL entry), this ONE adapter is reusable by every document type that declares
 * a `buildStockPlan` — sales/purchase returns, stock transfers, POS sales, work
 * orders — because `StockLedgerService.applyDocumentStockPlan` takes the plan
 * shape generically; it never posts to the GL itself (a document's own
 * `buildGlPosting` owns that).
 */

import { stockPlanOccurredAt, type StockLedgerService, type StockSourceDocType } from "../inventory/index.js";
import { mirrorStockPlan } from "./hooks.js";
import type { DocumentStockHook, DocumentStockPlan, DocumentStockResult } from "./hooks.js";
import { Money } from "../money/index.js";

export function createInventoryStockHook(service: StockLedgerService): DocumentStockHook {
  return {
    async apply(plan: DocumentStockPlan): Promise<DocumentStockResult> {
      // The framework's plan carries a plain `string` sourceDocType (it must
      // stay decoupled from the inventory engine's closed union); every
      // concrete document type that ships a `buildStockPlan` is required to use
      // one of `STOCK_SOURCE_DOC_TYPES` (movement.ts) as its own doc-type code.
      return await service.applyDocumentStockPlan({
        sourceDocType: plan.sourceDocType as StockSourceDocType,
        sourceDocId: plan.sourceDocId,
        sourceDocNumber: plan.sourceDocNumber,
        warehouseId: plan.warehouseId,
        lines: plan.lines,
        // The document's own date, not the wall clock, so a replay of the
        // ledger can order these against every other document-dated movement.
        occurredAt: stockPlanOccurredAt(plan),
      });
    },

    async reverse(plan: DocumentStockPlan, reversesDocId: string): Promise<DocumentStockResult> {
      const mirrored = mirrorStockPlan(plan, await service.getMovementsOfDocument(reversesDocId));
      if (!mirrored) return { valueMoved: Money.zero() };
      return await service.applyDocumentStockPlan({
        sourceDocType: mirrored.sourceDocType as StockSourceDocType,
        sourceDocId: mirrored.sourceDocId,
        sourceDocNumber: mirrored.sourceDocNumber,
        warehouseId: mirrored.warehouseId,
        lines: mirrored.lines,
        occurredAt: stockPlanOccurredAt(mirrored),
      });
    },
  };
}
