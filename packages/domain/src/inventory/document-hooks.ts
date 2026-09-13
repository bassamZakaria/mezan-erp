/**
 * Adapters binding the REAL stock-ledger engine (and, through it, the REAL GL
 * posting engine) behind the document framework's `DocumentStockHook` port —
 * the inventory-module counterpart to `journal-document.ts`'s
 * `createJournalGlHook`/`createDocumentWorkflowGate`.
 *
 * One stock hook covers BOTH inventory document types: a plan carrying
 * `toWarehouseId` is a transfer (routed to `StockLedgerService.postTransfer`,
 * never GL-posting); a plan without it is an adjustment (routed to
 * `StockLedgerService.postAdjustment`, which — reusing the engine wholesale —
 * both applies the movements AND posts the balancing GL entry in the SAME
 * call, since only the engine knows the moving-average cost an OUT line
 * resolves to at posting time — `describeEffects` (a pure function of the
 * document) cannot know it ahead of posting).
 */

import { postJournalEntry, type JournalPostingDeps } from "../gl/index.js";
import type { DocumentStockHook, DocumentStockPlan, DocumentStockResult } from "../documents/hooks.js";
import type { InventoryGlPosting, InventoryGlPostingPort } from "./ports.js";
import { occurredAtFromDocumentDate } from "./movement.js";
import { Money } from "../money/index.js";
import type { AdjustmentReason } from "./reasons.js";
import type { StockLedgerService } from "./stock-ledger-service.js";

/** GL account mapping for one adjustment reason's balancing journal entry. */
export interface AdjustmentGlAccounts {
  readonly inventoryAccountId: string;
  readonly counterpartAccountId: string;
}

/**
 * Bind the stock-ledger engine behind the framework's stock hook. `glAccountsForReason`
 * resolves the Dr/Cr account pair for an adjustment reason (e.g. INITIAL_STOCK →
 * owner's-capital counterpart, DAMAGE → a loss account) — return `null` to post
 * the movements without a GL entry (e.g. no account mapping configured for that
 * reason yet).
 */
export function createInventoryOpsStockHook(
  service: StockLedgerService,
  /**
   * Async so the caller can consult the tenant's account-routing table (R6.1)
   * rather than a constant compiled into the binary.
   */
  glAccountsForReason: (reason: AdjustmentReason) => Promise<AdjustmentGlAccounts | null> | AdjustmentGlAccounts | null = () => null,
): DocumentStockHook {
  return {
    async apply(plan: DocumentStockPlan): Promise<DocumentStockResult> {
      if (plan.toWarehouseId) {
        await service.postTransfer({
          transferId: plan.sourceDocId,
          transferNumber: plan.sourceDocNumber,
          fromWarehouseId: plan.warehouseId,
          toWarehouseId: plan.toWarehouseId,
          occurredAt: plan.date ? occurredAtFromDocumentDate(plan.date) : undefined,
          lines: plan.lines.map((l) => ({ itemId: l.itemId, qty: l.qty })),
        });
        // A transfer moves value between warehouses; the total is unchanged.
        return { valueMoved: Money.zero() };
      }

      const reason = plan.reason as AdjustmentReason;
      await service.postAdjustment({
        adjustmentId: plan.sourceDocId,
        adjustmentNumber: plan.sourceDocNumber,
        warehouseId: plan.warehouseId,
        reason,
        occurredAt: plan.date ? occurredAtFromDocumentDate(plan.date) : undefined,
        lines: plan.lines.map((l) => ({
          itemId: l.itemId,
          direction: l.direction,
          qty: l.qty,
          unitCost: l.unitCost,
        })),
        gl: (await glAccountsForReason(reason)) ?? undefined,
      });
      // postAdjustment posts its own balanced entry, so the caller has nothing
      // further to book.
      return { valueMoved: Money.zero() };
    },
  };
}

/**
 * Bind the REAL GL posting engine behind `InventoryGlPostingPort` (ports.ts) —
 * the port `StockLedgerService.postAdjustment` calls internally when a
 * document's stock hook passes `gl` account ids. Reuses the adjustment's own
 * document id as the journal-entry id (same trick `createJournalGlHook` uses
 * for manual journals), so the "المحاسبة" GL tab can look the entry up
 * directly via `GET /gl/journal-entries/:adjustmentId` with no extra linkage
 * to persist.
 */
export function createInventoryGlPostingHook(deps: JournalPostingDeps): InventoryGlPostingPort {
  return {
    async post(posting: InventoryGlPosting): Promise<void> {
      await postJournalEntry(
        {
          id: posting.sourceDocId,
          date: posting.date,
          memo: posting.memo,
          source: "system",
          sourceDocType: posting.sourceDocType,
          sourceDocId: posting.sourceDocId,
          sourceDocNumber: posting.sourceDocNumber,
          lines: posting.lines.map((l) => ({
            accountId: l.accountId,
            debit: l.debit,
            credit: l.credit,
            projectId: l.projectId ?? null,
            costCategory: l.costCategory ?? null,
          })),
        },
        deps,
      );
    },
  };
}
