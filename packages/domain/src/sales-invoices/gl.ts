/**
 * Builds the balanced journal entry a confirmed sales invoice posts, reusing the
 * document framework's `DocumentGlPosting` hook contract (the service hands it to
 * the same GL adapter journal entries use). Perpetual-inventory sale, one entry:
 *
 *   Dr  المدينون (AR)                 = الإجمالي الكلي (grand total, incl. VAT)
 *     Cr  إيرادات المبيعات (revenue)  = صافي الخاضع للضريبة (per revenue account)
 *     Cr  ضريبة القيمة المضافة (VAT)  = إجمالي الضريبة (when any)
 *   Dr  تكلفة البضاعة المباعة (COGS)  = تكلفة المخزون المنصرف (per COGS account)
 *     Cr  المخزون (inventory)          = the same cost (per inventory account)
 *
 * Σ debit = grandTotal + cost = (taxable + tax) + cost = Σ credit, so it is
 * always balanced; the GL engine re-checks balance when it posts.
 */

import { Money } from "../money/index.js";
import type { DocumentGlPosting, DocumentGlPostingLine } from "../documents/hooks.js";
import type { SalesInvoice } from "./sales-invoice.js";
import type { SalesInvoiceTotals } from "./totals.js";

/** COGS contribution of one stock line, resolved after the issue. */
export interface SalesInvoiceCogsLine {
  readonly cogsAccountId: string;
  readonly inventoryAccountId: string;
  readonly cost: Money;
}

function sumInto(map: Map<string, Money>, accountId: string, amount: Money): void {
  map.set(accountId, (map.get(accountId) ?? Money.zero()).add(amount));
}

export function buildSalesInvoiceGlPosting(
  invoice: SalesInvoice,
  totals: SalesInvoiceTotals,
  cogsLines: readonly SalesInvoiceCogsLine[],
): DocumentGlPosting {
  const debits: DocumentGlPostingLine[] = [];
  const credits: DocumentGlPostingLine[] = [];

  // --- Revenue side ---
  debits.push({ accountId: invoice.arAccountId, debit: totals.grandTotal, credit: Money.zero() });

  const revenueByAccount = new Map<string, Money>();
  for (let i = 0; i < invoice.lines.length; i++) {
    const line = invoice.lines[i];
    const lineTotals = totals.lines[i];
    if (!line || !lineTotals) continue;
    sumInto(revenueByAccount, line.revenueAccountId, lineTotals.taxableBase);
  }
  for (const [accountId, amount] of revenueByAccount) {
    if (amount.scaled === 0n) continue;
    credits.push({ accountId, debit: Money.zero(), credit: amount });
  }

  if (totals.taxTotal.scaled !== 0n) {
    credits.push({ accountId: invoice.taxAccountId, debit: Money.zero(), credit: totals.taxTotal });
  }

  // --- COGS side ---
  const cogsByAccount = new Map<string, Money>();
  const inventoryByAccount = new Map<string, Money>();
  for (const c of cogsLines) {
    if (c.cost.scaled === 0n) continue;
    sumInto(cogsByAccount, c.cogsAccountId, c.cost);
    sumInto(inventoryByAccount, c.inventoryAccountId, c.cost);
  }
  for (const [accountId, amount] of cogsByAccount) {
    debits.push({ accountId, debit: amount, credit: Money.zero() });
  }
  for (const [accountId, amount] of inventoryByAccount) {
    credits.push({ accountId, debit: Money.zero(), credit: amount });
  }

  return {
    sourceDocType: "SALES_INVOICE",
    sourceDocId: invoice.id,
    sourceDocNumber: invoice.docNo,
    date: invoice.date,
    memo: `فاتورة مبيعات ${invoice.docNo ?? invoice.id} — ${invoice.customerNameAr}`,
    lines: [...debits, ...credits],
  };
}
