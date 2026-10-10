import { describe, it, expect } from "vitest";
import { Money, Qty } from "../money/index.js";
import type { SalesInvoice, SalesInvoiceLine } from "../sales-invoices/sales-invoice.js";
import { salesInvoiceTotals } from "../sales-invoices/totals.js";
import type { SalesReturnLine } from "../sales-returns/sales-return-document.js";
import { DEFAULT_ETA_CONFIG, type EtaConfig } from "./config.js";
import { buildEtaReceiptPayload, canonicalizeEtaDocument, etaReceiptDecimal } from "./receipt.js";
import { buildPosReceiptInput, buildRefundReceiptInput, type EtaReceiptLookups } from "./receipt-from-invoice.js";
import { EtaReceiptNotReadyError } from "./errors.js";

const config: EtaConfig = {
  ...DEFAULT_ETA_CONFIG,
  taxRegistrationNumber: "123456789",
  activityCode: "4711",
  address: { governorate: "القاهرة", city: "مدينة نصر", street: "شارع", buildingNumber: "1", postalCode: null },
};

function line(lineId: string, qty: string, unitPrice: string, extra: Partial<SalesInvoiceLine> = {}): SalesInvoiceLine {
  return {
    lineId,
    itemId: `ITEM-${lineId}`,
    itemNameAr: `صنف ${lineId}`,
    isStock: false,
    qty: Qty.fromMajor(qty),
    unitCode: "PCS",
    unitFactor: 1,
    baseQty: Qty.fromMajor(qty),
    unitPrice: Money.fromMajor(unitPrice),
    discountType: "percent",
    discountPercent: 0,
    discountAmount: Money.zero(),
    taxRatePercent: 14,
    revenueAccountId: "4100",
    cogsAccountId: null,
    inventoryAccountId: null,
    taxRateId: null,
    costCenterId: null,
    unitCost: null,
    ...extra,
  };
}

function invoice(lines: SalesInvoiceLine[], extra: Partial<SalesInvoice> = {}): SalesInvoice {
  return {
    id: "inv-1",
    docType: "SALES_INVOICE",
    docNo: "INV-000042",
    status: "confirmed",
    date: "2026-09-01",
    dueDate: "2026-09-01",
    customerId: "WALK-IN",
    customerNameAr: "عميل نقدي",
    customerTaxExempt: false,
    taxInclusive: false,
    warehouseId: "WH1",
    branchId: "BR1",
    salespersonId: null,
    salespersonNameAr: null,
    projectId: null,
    currency: "EGP",
    fxRate: null,
    couponCode: null,
    appliedPromotion: null,
    notes: null,
    internalNotes: null,
    discount: { type: "amount", amount: Money.zero() },
    arAccountId: "1105",
    taxAccountId: "2200",
    lines,
    amountPaid: Money.zero(),
    createdAt: "2026-09-01T09:00:00.000Z",
    confirmedAt: "2026-09-01T10:15:30.123Z",
    journalEntryId: "je-1",
    workflowRequestId: null,
    reversesInvoiceId: null,
    reversedByInvoiceId: null,
    ...extra,
  } as SalesInvoice;
}

const lookups: EtaReceiptLookups = {
  items: new Map([
    ["ITEM-L1", { code: "SKU-1", etaItemCode: "EG-100-1", etaCodeType: "EGS", baseUnitCode: "PCS" }],
    ["ITEM-L2", { code: "SKU-2", etaItemCode: "10000159", etaCodeType: "GPC", baseUnitCode: "PCS" }],
  ]),
  taxRates: [{ id: "VAT14", status: "active", rate: 14, etaSubType: "V009" }],
  unitByCode: new Map([["PCS", "EA"]]),
};

const device = { serial: "POS-0001", branchCode: "1", companyTradeName: "متجر" };

type Payload = {
  itemData: {
    quantity: string;
    unitPrice: string;
    totalSale: string;
    netSale: string;
    total: string;
    commercialDiscountData?: { amount: string }[];
    taxableItems: { amount: string; rate: string }[];
  }[];
  totalSales: string;
  totalCommercialDiscount: string;
  netAmount: string;
  totalAmount: string;
  taxTotals: { amount: string }[];
};

/** The SDK's Main Calculations, each within its ±0.5 tolerance. */
function expectSdkArithmetic(payload: Payload): void {
  const n = Number;
  const near = (a: number, b: number) => expect(Math.abs(a - b)).toBeLessThanOrEqual(0.5);
  let sales = 0;
  let discounts = 0;
  let net = 0;
  let total = 0;
  let tax = 0;
  for (const l of payload.itemData) {
    const discount = (l.commercialDiscountData ?? []).reduce((s, d) => s + n(d.amount), 0);
    near(n(l.totalSale), n(l.quantity) * n(l.unitPrice));
    near(n(l.netSale), n(l.totalSale) - discount);
    const t1 = l.taxableItems[0]!;
    near(n(t1.amount), (n(l.netSale) * n(t1.rate)) / 100);
    near(n(l.total), n(l.netSale) + n(t1.amount));
    sales += n(l.totalSale);
    discounts += discount;
    net += n(l.netSale);
    total += n(l.total);
    tax += n(t1.amount);
  }
  near(n(payload.totalSales), sales);
  near(n(payload.totalCommercialDiscount), discounts);
  near(n(payload.netAmount), net);
  near(n(payload.totalAmount), total);
  near(n(payload.taxTotals[0]!.amount), tax);
}

function payloadOf(inv: SalesInvoice): Payload {
  const input = buildPosReceiptInput({ invoice: inv, issuedAt: inv.confirmedAt!, device, paymentMethod: "cash", lookups });
  return buildEtaReceiptPayload({ ...input, previousUuid: null }, config) as unknown as Payload;
}

describe("buildPosReceiptInput — a consumer sale as the authority's receipt", () => {
  it("files an exclusive-priced sale with the invoice's own figures and the SDK's arithmetic", () => {
    const inv = invoice([
      line("L1", "2", "50.00"),
      line("L2", "3", "10.00", { discountType: "amount", discountAmount: Money.fromMajor("3.00") }),
    ]);
    const payload = payloadOf(inv);
    expectSdkArithmetic(payload);
    expect(payload.totalAmount).toBe(etaReceiptDecimal(salesInvoiceTotals(inv).grandTotal.toString()));
    expect(payload.itemData[1]).toMatchObject({
      totalSale: "30.00000",
      commercialDiscountData: [{ amount: "3.00000" }],
      netSale: "27.00000",
    });
  });

  it("restates a tax-INCLUSIVE sale ex-tax, so netSale is the booked taxable base and the total is the shelf price", () => {
    const inv = invoice([line("L1", "1", "1000.00")], { taxInclusive: true });
    const payload = payloadOf(inv);
    expectSdkArithmetic(payload);
    expect(payload.itemData[0]).toMatchObject({
      unitPrice: "877.19000",
      totalSale: "877.19000",
      netSale: "877.19000",
      total: "1000.00000",
    });
    expect(payload.itemData[0]!.commercialDiscountData).toBeUndefined();
    expect(payload.totalAmount).toBe("1000.00000");
  });

  it("keeps an inclusive sale with discounts inside the SDK's tolerance and equal to the invoice's grand total", () => {
    const inv = invoice(
      [
        line("L1", "3", "99.99", { discountType: "percent", discountPercent: 10 }),
        line("L2", "7", "12.35"),
      ],
      { taxInclusive: true, discount: { type: "amount", amount: Money.fromMajor("15.00") } },
    );
    const payload = payloadOf(inv);
    expectSdkArithmetic(payload);
    const totals = salesInvoiceTotals(inv);
    expect(Number(payload.totalAmount)).toBeCloseTo(Number(totals.grandTotal.toString()), 5);
    expect(Number(payload.netAmount)).toBeCloseTo(Number(totals.taxableTotal.toString()), 5);
  });

  it("files the registered codes: item code, GS1 for a GPC item, the mapped unit and the VAT sub-type", () => {
    const input = buildPosReceiptInput({
      invoice: invoice([line("L1", "1", "10"), line("L2", "1", "10")]),
      issuedAt: "2026-09-01T10:00:00Z",
      device,
      paymentMethod: "card",
      lookups,
    });
    expect(input.lines[0]).toMatchObject({ internalCode: "SKU-1", itemType: "EGS", itemCode: "EG-100-1", unitType: "EA", taxSubType: "V009" });
    expect(input.lines[1]).toMatchObject({ itemType: "GS1", itemCode: "10000159" });
    expect(input.internalId).toBe("INV-000042");
    expect(input.paymentMethod).toBe("card");
    expect(input.seller).toEqual({ deviceSerialNumber: "POS-0001", branchCode: "1", companyTradeName: "متجر" });
    expect(input.buyer).toEqual({ type: "P", id: null, name: null });
  });

  it("is deterministic — the host and an offline till build the byte-identical canonical receipt", () => {
    const make = () => invoice([line("L1", "2", "50.00")], { taxInclusive: true });
    const a = canonicalizeEtaDocument(payloadOf(make()) as unknown as Record<string, unknown>);
    const b = canonicalizeEtaDocument(payloadOf(make()) as unknown as Record<string, unknown>);
    expect(a).toBe(b);
  });
});

function returned(itemId: string, qty: string, taxAmount: string): SalesReturnLine {
  return {
    itemId,
    warehouseId: "WH1",
    customerId: "WALK-IN",
    sourceInvoiceId: "inv-1",
    sourceInvoiceNumber: "INV-000042",
    reason: "DEFECTIVE",
    availableQty: Qty.fromMajor(qty),
    qty: Qty.fromMajor(qty),
    unitPrice: Money.fromMajor("0"),
    unitCost: Money.zero(),
    taxAmount: Money.fromMajor(taxAmount),
    taxRatePercent: 14,
  };
}

describe("buildRefundReceiptInput — a consumer return is a refund receipt (D282)", () => {
  const inv = invoice([line("L1", "4", "100.00", { discountType: "percent", discountPercent: 10 })], { taxInclusive: false });
  const sale = "c".repeat(64);

  it("is a refund receipt that references the sale receipt's UUID", () => {
    const input = buildRefundReceiptInput({
      invoice: inv,
      returnLines: [returned("ITEM-L1", "4", "50.40")],
      receiptNumber: "SR-000007",
      issuedAt: "2026-09-02T09:00:00Z",
      device,
      referenceUuid: sale,
      referenceIssuedAt: "2026-09-01T10:00:00Z",
      paymentMethod: "cash",
      lookups,
    });
    expect(input.receiptType).toBe("refund");
    expect(input.referenceUuid).toBe(sale);
    expect(input.internalId).toBe("SR-000007");
    const header = buildEtaReceiptPayload({ ...input, previousUuid: "d".repeat(64) }, config).header as Record<string, unknown>;
    expect(header.referenceUUID).toBe(sale);
    expect(header.previousUUID).toBe("d".repeat(64));
  });

  it("mirrors the sale line exactly on a full return", () => {
    const refund = buildRefundReceiptInput({
      invoice: inv,
      returnLines: [returned("ITEM-L1", "4", "50.40")],
      receiptNumber: "SR-1",
      issuedAt: "2026-09-02T09:00:00Z",
      device,
      referenceUuid: sale,
      referenceIssuedAt: "2026-09-01T10:00:00Z",
      paymentMethod: "cash",
      lookups,
    });
    const sold = buildPosReceiptInput({ invoice: inv, issuedAt: "2026-09-01T10:00:00Z", device, paymentMethod: "cash", lookups });
    const pick = ({ totalSale, netSale, commercialDiscount, taxAmount, total }: (typeof sold.lines)[number]) => ({
      totalSale,
      netSale,
      commercialDiscount,
      taxAmount,
      total,
    });
    expect(pick(refund.lines[0]!)).toEqual(pick(sold.lines[0]!));
    expect(refund.totalAmount).toBe(sold.totalAmount);
  });

  it("is the returned share on a partial return, with the VAT the return actually reversed", () => {
    const refund = buildRefundReceiptInput({
      invoice: inv,
      returnLines: [returned("ITEM-L1", "1", "12.60")],
      receiptNumber: "SR-2",
      issuedAt: "2026-09-02T09:00:00Z",
      device,
      referenceUuid: sale,
      referenceIssuedAt: "2026-09-01T10:00:00Z",
      paymentMethod: "cash",
      lookups,
    });
    expect(refund.lines[0]).toMatchObject({
      quantity: "1.000000",
      totalSale: "100.000000",
      commercialDiscount: "10.000000",
      netSale: "90.000000",
      taxAmount: "12.600000",
      total: "102.600000",
    });
    const payload = buildEtaReceiptPayload({ ...refund, previousUuid: null }, config) as unknown as Payload;
    expectSdkArithmetic(payload);
  });
});

describe("buildPosReceiptInput — the VAT sub-type comes from the rate each line stored (D79)", () => {
  const zeroRated = {
    ...lookups,
    taxRates: [
      { id: "VAT14", status: "active", rate: 14, etaSubType: "V009" },
      { id: "VAT-EXEMPT", status: "active", rate: 0, etaSubType: "V003" },
      { id: "VAT-EXPORT", status: "active", rate: 0, etaSubType: "V001" },
    ],
  };
  const subTypes = (inv: SalesInvoice): string[] =>
    buildPosReceiptInput({ invoice: inv, issuedAt: inv.confirmedAt!, device, paymentMethod: "cash", lookups: zeroRated }).lines.map((l) => l.taxSubType);

  it("files an exempt line V003 and a zero-rated export line V001, though both are 0%", () => {
    const inv = invoice([
      line("L1", "1", "100.00", { taxRatePercent: 0, taxRateId: "VAT-EXEMPT" }),
      line("L2", "1", "100.00", { taxRatePercent: 0, taxRateId: "VAT-EXPORT" }),
    ]);
    expect(subTypes(inv)).toEqual(["V003", "V001"]);
  });

  it("refuses a receipt for a 0% line with no stored rate while the tenant holds exempt or export — never filed V004 by default, never a guess between the two", () => {
    const unnamed = invoice([line("L1", "1", "100.00", { taxRatePercent: 0, taxRateId: null })]);
    expect(() => subTypes(unnamed)).toThrow(EtaReceiptNotReadyError);
    expect(() => subTypes(unnamed)).toThrow(/ضريبة البند بنسبة 0% غير مسماة \(SKU-1\)/);
  });

  it("files the neutral V004 for that same unnamed 0% line on a tenant with no specific zero classification", () => {
    const inv = invoice([line("L1", "1", "100.00", { taxRatePercent: 0, taxRateId: null })]);
    const unspecific = [
      { id: "VAT14", status: "active", rate: 14, etaSubType: "V009" },
      { id: "ZERO", status: "active", rate: 0, etaSubType: "auto" },
      { id: "NOT-SUBJECT", status: "active", rate: 0, etaSubType: "V004" },
      { id: "OLD-EXEMPT", status: "inactive", rate: 0, etaSubType: "V003" },
    ];
    const receipt = buildPosReceiptInput({ invoice: inv, issuedAt: inv.confirmedAt!, device, paymentMethod: "cash", lookups: { ...lookups, taxRates: unspecific } });
    expect(receipt.lines.map((l) => l.taxSubType)).toEqual(["V004"]);
  });

  it("still matches a legacy taxed line by its percent", () => {
    expect(subTypes(invoice([line("L1", "1", "100.00", { taxRatePercent: 14, taxRateId: null })]))).toEqual(["V009"]);
  });
});

describe("buildRefundReceiptInput — a refund reverses the sale line it names (D79 review round 2)", () => {
  const twoRates = {
    ...lookups,
    taxRates: [
      { id: "VAT14", status: "active", rate: 14, etaSubType: "V009" },
      { id: "VAT-EXEMPT", status: "active", rate: 0, etaSubType: "V003" },
    ],
  };
  const sold = invoice([
    line("L1", "2", "100.00", { itemId: "ITEM-L1", taxRatePercent: 14, taxRateId: "VAT14" }),
    line("L2", "2", "100.00", { itemId: "ITEM-L1", taxRatePercent: 0, taxRateId: "VAT-EXEMPT", discountType: "percent", discountPercent: 50 }),
  ]);
  const refundOf = (ret: SalesReturnLine) =>
    buildRefundReceiptInput({
      invoice: sold,
      returnLines: [ret],
      receiptNumber: "SR-9",
      issuedAt: "2026-09-02T09:00:00Z",
      device,
      referenceUuid: "c".repeat(64),
      referenceIssuedAt: "2026-09-01T10:00:00Z",
      paymentMethod: "cash",
      lookups: twoRates,
    }).lines[0]!;
  const exemptReturn: SalesReturnLine = { ...returned("ITEM-L1", "1", "0.00"), unitPrice: Money.fromMajor("100"), taxRatePercent: 0, taxRateId: null };

  it("files the named exempt line's own classification and discounted base, though the item's first line is taxed at the same price", () => {
    const refund = refundOf({ ...exemptReturn, sourceLineId: "L2" });
    expect(refund).toMatchObject({ taxSubType: "V003", totalSale: "100.000000", commercialDiscount: "50.000000", netSale: "50.000000", taxAmount: "0.000000" });
  });

  it("ignores a named line that belongs to another item rather than borrowing its figures", () => {
    const other = invoice([
      line("L1", "2", "100.00", { itemId: "ITEM-L1", taxRatePercent: 14, taxRateId: "VAT14" }),
      line("L2", "2", "80.00", { itemId: "ITEM-L2", taxRatePercent: 0, taxRateId: "VAT-EXEMPT" }),
    ]);
    const refund = buildRefundReceiptInput({
      invoice: other,
      returnLines: [{ ...returned("ITEM-L1", "1", "14.00"), sourceLineId: "L2" }],
      receiptNumber: "SR-10",
      issuedAt: "2026-09-02T09:00:00Z",
      device,
      referenceUuid: "c".repeat(64),
      referenceIssuedAt: "2026-09-01T10:00:00Z",
      paymentMethod: "cash",
      lookups: twoRates,
    }).lines[0]!;
    expect(refund).toMatchObject({ taxSubType: "V009", netSale: "100.000000", taxAmount: "14.000000" });
  });
});
