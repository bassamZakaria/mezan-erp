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
  // Grouped by revenue account AND by the rate the line was taxed at, so a
  // 14% / 5% / zero-rated invoice posts one base line per rate instead of one
  // blended line. The VAT return reports the rates actually charged, and it can
  // only do that if the ledger recorded them (D28).
  const revenueByAccountAndRate = new Map<string, { accountId: string; rate: number; amount: Money }>();
  const taxByRate = new Map<number, Money>();
  for (let i = 0; i < invoice.lines.length; i++) {
    const line = invoice.lines[i];
    const lineTotals = totals.lines[i];
    if (!line || !lineTotals) continue;
    const rate = line.taxRatePercent;
    const key = `${line.revenueAccountId}|${rate}`;
    const bucket = revenueByAccountAndRate.get(key);
    const base = convert(lineTotals.taxableBase);
    if (bucket) revenueByAccountAndRate.set(key, { ...bucket, amount: bucket.amount.add(base) });
    else revenueByAccountAndRate.set(key, { accountId: line.revenueAccountId, rate, amount: base });
    const lineTax = convert(lineTotals.tax);
    if (lineTax.scaled !== 0n) taxByRate.set(rate, (taxByRate.get(rate) ?? Money.zero()).add(lineTax));
  }

  // AR is the SUM of the converted parts, never the conversion of the sum:
  // rounding each component once is what keeps Σ debits == Σ credits exactly.
  let receivable = Money.zero();
  for (const amount of taxByRate.values()) receivable = receivable.add(amount);
  for (const bucket of revenueByAccountAndRate.values()) receivable = receivable.add(bucket.amount);
  debits.push({ accountId: invoice.arAccountId, debit: receivable, credit: Money.zero(), ...fxTag });

  for (const { accountId, rate, amount } of revenueByAccountAndRate.values()) {
    if (amount.scaled === 0n) continue;
    credits.push({ accountId, debit: Money.zero(), credit: amount, taxRatePercent: rate });
  }

  for (const [rate, amount] of taxByRate) {
    if (amount.scaled === 0n) continue;
    credits.push({ accountId: invoice.taxAccountId, debit: Money.zero(), credit: amount, taxRatePercent: rate });
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
