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
import { convertToBase } from "../exchange-rates/convert.js";
import type { DocumentGlPosting, DocumentGlPostingLine } from "../documents/hooks.js";
import type { SalesInvoice } from "./sales-invoice.js";
import type { SalesInvoiceTotals } from "./totals.js";

/** The rate a foreign-currency invoice confirmed at. Absent = a base-currency invoice. */
export interface SalesInvoiceFxContext {
  readonly rate: string;
}

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
  fx?: SalesInvoiceFxContext,
): DocumentGlPosting {
  const debits: DocumentGlPostingLine[] = [];
  const credits: DocumentGlPostingLine[] = [];

  // Line prices are entered in the DOCUMENT's currency. A foreign invoice is
  // converted here, once, at the rate that applied on its own date, and the AR
  // line keeps the currency and rate so the revaluation can restate the debt
  // later. Without this a `currency: "USD"` invoice debited 1105 with its USD
  // figure as though it were EGP, understating the receivable by the whole
  // rate (D24). The COGS/inventory legs are NOT converted — stock cost already
  // lives in base currency, whatever the sale was priced in.
  const convert = (amount: Money): Money => (fx ? convertToBase(amount, fx.rate) : amount);
  const fxTag = fx ? { currency: invoice.currency, fxRate: fx.rate } : {};

  // --- Revenue side ---
  const revenueByAccount = new Map<string, Money>();
  for (let i = 0; i < invoice.lines.length; i++) {
    const line = invoice.lines[i];
    const lineTotals = totals.lines[i];
    if (!line || !lineTotals) continue;
    sumInto(revenueByAccount, line.revenueAccountId, convert(lineTotals.taxableBase));
  }
  const taxTotal = convert(totals.taxTotal);

  // AR is the SUM of the converted parts, never the conversion of the sum:
  // rounding each component once is what keeps Σ debits == Σ credits exactly.
  let receivable = taxTotal;
  for (const amount of revenueByAccount.values()) receivable = receivable.add(amount);
  debits.push({ accountId: invoice.arAccountId, debit: receivable, credit: Money.zero(), ...fxTag });

  for (const [accountId, amount] of revenueByAccount) {
    if (amount.scaled === 0n) continue;
    credits.push({ accountId, debit: Money.zero(), credit: amount });
  }

  if (taxTotal.scaled !== 0n) {
    credits.push({ accountId: invoice.taxAccountId, debit: Money.zero(), credit: taxTotal });
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
