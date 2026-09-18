/**
 * Adapters binding the REAL engines behind the sales-invoice hook ports — the
 * document layer never imports the engines directly (docs/archive/plan.md §3.2).
 *
 * - the GL hook posts a document-driven journal entry through the GL posting
 *   engine (source = "system"), and reverses one for corrections;
 * - the stock hook issues stock OUT through the stock-ledger engine's
 *   `postIssue`, returning the moving-average cost of goods sold so the service
 *   can fold COGS into the same journal entry.
 */

import { postJournalEntry, reverseJournalEntry, type JournalPostingDeps } from "../gl/index.js";
import type { DocumentGlHook } from "../documents/hooks.js";
import type { StockLedgerService } from "../inventory/index.js";
import { Money, type Qty } from "../money/index.js";
import { salesInvoiceBaseGrandTotal, salesInvoiceTotals } from "./totals.js";
import type { SalesInvoiceRepository, SalesInvoiceStockHook, SalesInvoiceCustomerExposureHook } from "./ports.js";

/** Bind the GL posting engine behind the framework's GL hook, posting as a system document. */
export function createSalesInvoiceGlHook(deps: JournalPostingDeps): DocumentGlHook {
  return {
    async post(posting) {
      const entry = await postJournalEntry(
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
            memo: l.memo ?? null,
            // A dimension dropped here is gone for good: the posted line is
            // all the cost-centre P&L and the FX revaluation ever see, and a
            // converted amount with no currency on it is indistinguishable
            // from a base-currency one (D24, D26).
            costCenterId: l.costCenterId ?? null,
            taxRatePercent: l.taxRatePercent ?? null,
            currency: l.currency ?? null,
            fxRate: l.fxRate ?? null,
            projectId: l.projectId ?? null,
            costCategory: l.costCategory ?? null,
            branchId: l.branchId ?? null,
          })),
        },
        deps,
      );
      return { journalEntryId: entry.id, journalEntryNo: entry.entryNo ?? null };
    },
    async reverse(journalEntryId, opts) {
      const { reversal } = await reverseJournalEntry(journalEntryId, deps, {
        reversalId: opts.reversalId,
        date: opts.date,
        memo: opts.memo,
      });
      return { journalEntryId: reversal.id, journalEntryNo: reversal.entryNo ?? null };
    },
  };
}

/**
 * Settings §"سياسة المخزون" → `allowCrossWarehouseSales`. Asked once per line
 * whose item the document's warehouse holds NONE of, it names another warehouse
 * that can cover the whole line, or null to leave the line where it was. Whole
 * lines only: splitting one line across warehouses would give it two costs, and
 * an invoice line records exactly one.
 */
export type CrossWarehouseSourceResolver = (input: {
  itemId: string;
  qty: Qty;
  warehouseId: string;
}) => Promise<string | null>;

/** Bind the stock-ledger engine's `postIssue` behind the sales-invoice stock hook. */
export function createSalesInvoiceStockHook(
  service: StockLedgerService,
  resolveCrossWarehouseSource?: CrossWarehouseSourceResolver,
): SalesInvoiceStockHook {
  return {
    async issue(plan) {
      const lines: { itemId: string; qty: Qty; warehouseId?: string }[] = [];
      for (const l of plan.lines) {
        const source = resolveCrossWarehouseSource
          ? await resolveCrossWarehouseSource({ itemId: l.itemId, qty: l.qty, warehouseId: plan.warehouseId })
          : null;
        lines.push(source ? { itemId: l.itemId, qty: l.qty, warehouseId: source } : { itemId: l.itemId, qty: l.qty });
      }
      const result = await service.postIssue({
        issueId: plan.issueId,
        sourceDocType: "SALES_INVOICE",
        sourceDocId: plan.sourceDocId,
        sourceDocNumber: plan.sourceDocNumber,
        warehouseId: plan.warehouseId,
        occurredAt: plan.occurredAt,
        projectId: plan.projectId ?? null,
        lines,
      });
      return {
        totalCost: result.totalCost,
        lines: result.lines.map((l) => ({ itemId: l.itemId, unitCost: l.unitCost, cost: l.cost })),
      };
    },
  };
}

/**
 * Bind the customer-exposure hook to the sales-invoice repository itself: sums
 * (base grand total − amountPaid, both in base currency) across the customer's live invoices, excluding the
 * invoice currently being confirmed (its own exposure is passed separately by
 * the caller — see {@link SalesInvoiceService.confirm}).
 */
export function createSalesInvoiceCustomerExposureHook(
  repo: SalesInvoiceRepository,
): SalesInvoiceCustomerExposureHook {
  return {
    async currentBalance(customerId, excludeInvoiceId) {
      // The two unsettled statuses reach the repository (Q-10): every other
      // status contributes nothing, so re-reading the customer's whole invoice
      // history on every confirm was O(history) to answer a question about the
      // open receivable. The JS guard stays for a repository that cannot
      // express the set.
      const invoices = await repo.list({ customerId, statusIn: ["confirmed", "partially_paid"] });
      let total = 0n;
      for (const inv of invoices) {
        if (inv.id === excludeInvoiceId) continue;
        if (inv.status !== "confirmed" && inv.status !== "partially_paid") continue;
        total += salesInvoiceBaseGrandTotal(salesInvoiceTotals(inv), inv.fxRate).scaled - inv.amountPaid.scaled;
      }
      return Money.fromScaled(total);
    },
  };
}
