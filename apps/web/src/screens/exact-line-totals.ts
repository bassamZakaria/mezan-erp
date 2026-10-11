import { Money, Qty, extend, purchaseInvoiceLineBase, purchaseInvoiceLineTax } from "@mezan/domain";
import { toMajorNumber } from "../lib/money";

export function purchaseInvoiceLineTotal(line: { readonly qty: string; readonly unitCost: string; readonly taxRatePercent: number }): number {
  const priced = { qty: Qty.fromMajor(line.qty), unitCost: Money.fromMajor(line.unitCost), taxRatePercent: line.taxRatePercent };
  return toMajorNumber(purchaseInvoiceLineBase(priced).add(purchaseInvoiceLineTax(priced)).scaled);
}

export interface ReturnLineAmounts {
  readonly qty: string;
  readonly unitPrice: string;
  readonly taxAmount: string;
}

function returnLineMoney(line: ReturnLineAmounts): Money {
  return extend(Qty.fromMajor(line.qty), Money.fromMajor(line.unitPrice)).add(Money.fromMajor(line.taxAmount));
}

export function returnLineTotal(line: ReturnLineAmounts): number {
  return toMajorNumber(returnLineMoney(line).scaled);
}

export function returnLinesTotal(lines: readonly ReturnLineAmounts[]): number {
  return toMajorNumber(Money.sum(lines.map(returnLineMoney)).scaled);
}
