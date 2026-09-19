/**
 * إيصال من فاتورة — the pure mapping from a consumer sale (a sales invoice, DEC-24)
 * to the e-receipt the authority expects, and from a return of it to the
 * refund receipt. No I/O, so a browser outbox can build the byte-identical
 * receipt offline (DEC-26) and the host can recompute and compare its UUID.
 *
 * EXTERNAL CONTRACT (SDK, Main Calculations): a receipt line is stated
 * EXCLUSIVE of tax — totalSale = quantity × unitPrice, netSale = totalSale −
 * commercial discounts, T1 = netSale × rate, total = netSale + T1 — every check
 * within ±0.5. A tax-inclusive sale is therefore restated ex-tax here from the
 * invoice's own taxable base, never filed with its shelf prices.
 */
import { Money, Qty } from "../money/index.js";
import type { SalesInvoice } from "../sales-invoices/sales-invoice.js";
import { salesInvoiceTotals, type SalesInvoiceLineTotals, type SalesInvoiceTotals } from "../sales-invoices/totals.js";
import type { SalesReturnLine } from "../sales-returns/sales-return-document.js";
import type { EtaCodeType } from "../items/item.js";
import type {
  EtaReceiptBuyerInput,
  EtaReceiptInput,
  EtaReceiptLineInput,
  EtaReceiptPaymentMethod,
} from "./receipt.js";
import { findLineTaxRate, resolveEtaVatSubType } from "./tax-subtype.js";
import { isEtaUnitCode } from "./mappings.js";
import { EtaReceiptNotReadyError, EtaRefundTooLateError } from "./errors.js";
import { extend, unitCostOf } from "../inventory/wac-math.js";

/** A receipt as the chain receives it — the device's own head supplies previousUUID. */
export type EtaUnchainedReceiptInput = Omit<EtaReceiptInput, "previousUuid">;

export interface EtaReceiptItemCodes {
  readonly code: string;
  readonly etaItemCode: string | null;
  readonly etaCodeType: EtaCodeType | null;
  readonly baseUnitCode: string;
}

/** The registered codes a receipt line needs. All read from master data by the caller. */
export interface EtaReceiptLookups {
  readonly items: ReadonlyMap<string, EtaReceiptItemCodes>;
  readonly taxRates: readonly { readonly status: string; readonly rate: number; readonly etaSubType: string }[];
  /** Tenant unit code → the authority's unit code. */
  readonly unitByCode: ReadonlyMap<string, string>;
}

export interface EtaReceiptDevice {
  readonly serial: string;
  readonly branchCode: string | null;
  readonly companyTradeName?: string | null;
}

export interface PosReceiptBuildArgs {
  readonly invoice: SalesInvoice;
  /** Recomputed from the invoice when omitted; pass it to reuse figures already on hand. */
  readonly totals?: SalesInvoiceTotals;
  /** رقم الإيصال. Defaults to the invoice number. */
  readonly receiptNumber?: string;
  readonly issuedAt: string;
  readonly device: EtaReceiptDevice;
  readonly paymentMethod: EtaReceiptPaymentMethod;
  /** Defaults to an anonymous natural person, the walk-in the regime exists for. */
  readonly buyer?: EtaReceiptBuyerInput;
  readonly lookups: EtaReceiptLookups;
}

const ONE = 1_000_000n;

/** a × b ÷ c on scaled integers, rounded half away from zero. */
function mulDiv(a: bigint, b: bigint, c: bigint): bigint {
  if (c === 0n) return 0n;
  const numerator = a * b;
  const negative = (numerator < 0n) !== (c < 0n);
  const absN = numerator < 0n ? -numerator : numerator;
  const absC = c < 0n ? -c : c;
  const q = (absN + absC / 2n) / absC;
  return negative ? -q : q;
}

interface ExTaxLine {
  readonly totalSale: Money;
  readonly commercialDiscount: Money;
  readonly netSale: Money;
  readonly tax: Money;
}

/** One invoice line stated ex-tax, with netSale equal to the booked taxable base to the micro-unit. */
function exTaxLine(invoice: SalesInvoice, lt: SalesInvoiceLineTotals, taxRatePercent: number): ExTaxLine {
  const discount = lt.lineDiscount.add(lt.promotionDiscount).add(lt.invoiceDiscount);
  if (!invoice.taxInclusive) {
    return { totalSale: lt.gross, commercialDiscount: discount, netSale: lt.taxableBase, tax: lt.tax };
  }
  const netInclusive = lt.gross.scaled - discount.scaled;
  const totalSale =
    netInclusive > 0n
      ? mulDiv(lt.gross.scaled, lt.taxableBase.scaled, netInclusive)
      : mulDiv(lt.gross.scaled, 100n * ONE, BigInt(Math.round((100 + taxRatePercent) * 1_000_000)));
  return {
    totalSale: Money.fromScaled(totalSale),
    commercialDiscount: Money.fromScaled(totalSale - lt.taxableBase.scaled),
    netSale: lt.taxableBase,
    tax: lt.tax,
  };
}

/**
 * EXTERNAL CONTRACT (SDK code validator): every line needs an EGS/GS1 code the
 * taxpayer registered and a unit from the authority's table. Falling back to
 * the shop's own code would print a receipt that is rejected on arrival, so a
 * missing registration is collected into `missing` and the receipt refused.
 */
function lineCodes(
  lookups: EtaReceiptLookups,
  itemId: string,
  unitCode: string,
  taxRatePercent: number,
  missing: Set<string>,
): Pick<EtaReceiptLineInput, "internalCode" | "itemType" | "itemCode" | "unitType" | "taxSubType" | "taxRate"> {
  const item = lookups.items.get(itemId) ?? null;
  const unit = unitCode !== "" ? unitCode : (item?.baseUnitCode ?? "");
  const unitType = lookups.unitByCode.get(unit) ?? unit;
  if (!item?.etaItemCode) missing.add(`كود الصنف لدى المصلحة (${item?.code ?? itemId})`);
  if (!isEtaUnitCode(unitType)) missing.add(`ربط الوحدة (${unit || "—"})`);
  return {
    internalCode: item?.code ?? itemId,
    // EXTERNAL CONTRACT: the authority's coding schemes on a receipt line are
    // "EGS" and "GS1"; a GPC-coded item is the GS1 scheme under its own name.
    itemType: item?.etaCodeType === "GPC" ? "GS1" : "EGS",
    itemCode: item?.etaItemCode ?? item?.code ?? itemId,
    unitType,
    taxSubType: resolveEtaVatSubType(findLineTaxRate(lookups.taxRates, taxRatePercent)?.etaSubType, taxRatePercent),
    taxRate: String(taxRatePercent),
  };
}

function receiptLine(
  codes: ReturnType<typeof lineCodes>,
  description: string,
  quantity: Qty,
  figures: ExTaxLine,
): EtaReceiptLineInput {
  const unitPrice = quantity.scaled === 0n ? 0n : mulDiv(figures.totalSale.scaled, ONE, quantity.scaled);
  return {
    ...codes,
    description,
    quantity: quantity.toString(),
    unitPrice: Money.fromScaled(unitPrice).toString(),
    totalSale: figures.totalSale.toString(),
    netSale: figures.netSale.toString(),
    total: figures.netSale.add(figures.tax).toString(),
    commercialDiscount: figures.commercialDiscount.scaled === 0n ? undefined : figures.commercialDiscount.toString(),
    taxAmount: figures.tax.toString(),
  };
}

/** The receipt totals as sums of its own lines, so header and lines can never disagree. */
function summed(lines: readonly ExTaxLine[]) {
  const totalSales = Money.sum(lines.map((l) => l.totalSale));
  const totalDiscount = Money.sum(lines.map((l) => l.commercialDiscount));
  const netAmount = Money.sum(lines.map((l) => l.netSale));
  const tax = Money.sum(lines.map((l) => l.tax));
  return {
    totalSales: totalSales.toString(),
    totalCommercialDiscount: totalDiscount.scaled === 0n ? undefined : totalDiscount.toString(),
    netAmount: netAmount.toString(),
    totalAmount: netAmount.add(tax).toString(),
    taxTotals: [{ taxType: "T1", amount: tax.toString() }],
  };
}

const ANONYMOUS_BUYER: EtaReceiptBuyerInput = { type: "P", id: null, name: null };

/** A confirmed consumer sale as an e-receipt on `device`'s chain. */
export function buildPosReceiptInput(args: PosReceiptBuildArgs): EtaUnchainedReceiptInput {
  const { invoice, lookups } = args;
  const totals = args.totals ?? salesInvoiceTotals(invoice);
  const byLine = new Map(totals.lines.map((l) => [l.lineId, l]));
  const figures: ExTaxLine[] = [];
  const missing = new Set<string>();
  const lines = invoice.lines.map((line) => {
    const lt = byLine.get(line.lineId);
    const f: ExTaxLine = lt
      ? exTaxLine(invoice, lt, line.taxRatePercent)
      : { totalSale: Money.zero(), commercialDiscount: Money.zero(), netSale: Money.zero(), tax: Money.zero() };
    figures.push(f);
    return receiptLine(
      lineCodes(lookups, line.itemId, line.unitCode, line.taxRatePercent, missing),
      line.itemNameAr,
      line.qty,
      f,
    );
  });
  if (missing.size > 0) throw new EtaReceiptNotReadyError([...missing]);
  return {
    internalId: args.receiptNumber ?? invoice.docNo ?? invoice.id,
    issueDateTime: args.issuedAt,
    receiptType: "sale",
    currency: invoice.currency,
    exchangeRate: invoice.fxRate ?? undefined,
    seller: {
      deviceSerialNumber: args.device.serial,
      branchCode: args.device.branchCode,
      companyTradeName: args.device.companyTradeName ?? null,
    },
    buyer: args.buyer ?? ANONYMOUS_BUYER,
    paymentMethod: args.paymentMethod,
    lines,
    ...summed(figures),
  };
}

/** SDK Receipt Issuance FAQ: "Maximum allowed days to issue a return receipt is 540 days". */
const REFUND_WINDOW_DAYS = 540;
const DAY_MS = 86_400_000;

/**
 * The sale line a return line came from. A return line carries no source line
 * id, only the item and its per-base-unit price, so when one item sits on two
 * lines the price picks the line — the first match by item alone would file
 * one line's base with the other line's VAT.
 */
function soldLineOf(invoice: SalesInvoice, ret: SalesReturnLine) {
  const candidates = invoice.lines.filter((l) => l.itemId === ret.itemId);
  if (candidates.length <= 1) return candidates[0];
  return (
    candidates.find(
      (l) => l.baseQty.scaled !== 0n && unitCostOf(extend(l.qty, l.unitPrice), l.baseQty).scaled === ret.unitPrice.scaled,
    ) ?? candidates[0]
  );
}

export interface RefundReceiptBuildArgs {
  /** The sale being returned — its lines fix the per-unit figures the refund mirrors. */
  readonly invoice: SalesInvoice;
  readonly returnLines: readonly SalesReturnLine[];
  readonly receiptNumber: string;
  readonly issuedAt: string;
  readonly device: EtaReceiptDevice;
  /** header.referenceUUID — the UUID of the sale receipt being returned. */
  readonly referenceUuid: string;
  /** The sale receipt's dateTimeIssued; a refund more than 540 days later is refused. */
  readonly referenceIssuedAt: string;
  readonly paymentMethod: EtaReceiptPaymentMethod;
  readonly buyer?: EtaReceiptBuyerInput;
  readonly lookups: EtaReceiptLookups;
}

/**
 * إيصال مرتجع (D282). Each returned line is the sale line's own ex-tax figures
 * scaled by the returned share of its base quantity, and carries the VAT the
 * return actually reversed — so a full return mirrors the sale receipt exactly
 * and a partial one is its proportion. It lives on the chain of the device
 * that ISSUES the refund, which need not be the one that sold.
 */
export function buildRefundReceiptInput(args: RefundReceiptBuildArgs): EtaUnchainedReceiptInput {
  const { invoice, lookups } = args;
  if (Date.parse(args.issuedAt) - Date.parse(args.referenceIssuedAt) > REFUND_WINDOW_DAYS * DAY_MS) {
    throw new EtaRefundTooLateError(args.referenceIssuedAt);
  }
  const totals = salesInvoiceTotals(invoice);
  const byLine = new Map(totals.lines.map((l) => [l.lineId, l]));
  const figures: ExTaxLine[] = [];
  const missing = new Set<string>();
  const lines = args.returnLines.map((ret) => {
    const sold = soldLineOf(invoice, ret);
    const lt = sold ? byLine.get(sold.lineId) : undefined;
    const rate = ret.taxRatePercent ?? sold?.taxRatePercent ?? 0;
    let f: ExTaxLine;
    if (sold && lt && sold.baseQty.scaled !== 0n) {
      const whole = exTaxLine(invoice, lt, sold.taxRatePercent);
      const totalSale = mulDiv(whole.totalSale.scaled, ret.qty.scaled, sold.baseQty.scaled);
      const netSale = mulDiv(whole.netSale.scaled, ret.qty.scaled, sold.baseQty.scaled);
      f = {
        totalSale: Money.fromScaled(totalSale),
        commercialDiscount: Money.fromScaled(totalSale - netSale),
        netSale: Money.fromScaled(netSale),
        tax: ret.taxAmount,
      };
    } else {
      const net = Money.fromScaled(mulDiv(ret.qty.scaled, ret.unitPrice.scaled, ONE));
      f = { totalSale: net, commercialDiscount: Money.zero(), netSale: net, tax: ret.taxAmount };
    }
    figures.push(f);
    const baseUnit = lookups.items.get(ret.itemId)?.baseUnitCode ?? "";
    return receiptLine(lineCodes(lookups, ret.itemId, baseUnit, rate, missing), sold?.itemNameAr ?? ret.itemId, ret.qty, f);
  });
  if (missing.size > 0) throw new EtaReceiptNotReadyError([...missing]);
  return {
    internalId: args.receiptNumber,
    issueDateTime: args.issuedAt,
    receiptType: "refund",
    referenceUuid: args.referenceUuid,
    currency: invoice.currency,
    exchangeRate: invoice.fxRate ?? undefined,
    seller: {
      deviceSerialNumber: args.device.serial,
      branchCode: args.device.branchCode,
      companyTradeName: args.device.companyTradeName ?? null,
    },
    buyer: args.buyer ?? ANONYMOUS_BUYER,
    paymentMethod: args.paymentMethod,
    lines,
    ...summed(figures),
  };
}
