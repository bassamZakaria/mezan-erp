import { describe, expect, it } from "vitest";
import type { SalesInvoiceDTO, SalesInvoiceLineRowDTO } from "../data/hooks";
import type { TenantSettingsDTO } from "@mezan/contracts";
import { salesInvoicePrintModel, type SalesInvoicePrintContext } from "./sales-invoice-print";

function line(overrides: Partial<SalesInvoiceLineRowDTO>): SalesInvoiceLineRowDTO {
  return {
    unitFactor: 1, discountAmount: "0.000000", costCenterId: null, baseQty: "1", lineId: "L1",
    itemId: "I1",
    itemNameAr: "قهوة عربية",
    isStock: true,
    qty: "1",
    unitCode: "PCS",
    unitPrice: "100.00",
    discountType: "percent",
    discountPercent: 0,
    taxRatePercent: 14,
    revenueAccountId: "A1",
    cogsAccountId: null,
    ...overrides,
  } as SalesInvoiceLineRowDTO;
}

function invoice(lines: SalesInvoiceLineRowDTO[], overrides: Partial<SalesInvoiceDTO> = {}): SalesInvoiceDTO {
  return {
    id: "SI-1",
    docType: "sales_invoice",
    docNo: "INV-0001",
    status: "confirmed",
    date: "2026-03-01",
    dueDate: "2026-03-31",
    customerId: "C1",
    customerNameAr: "عميل تجريبي",
    branchId: "B1",
    warehouseId: "W1",
    currency: "EGP",
    couponCode: null,
    appliedPromotion: null,
    notes: null,
    internalNotes: null,
    discount: { type: "percent", value: 0 },
    arAccountId: "AR1",
    taxAccountId: "TAX1",
    amountPaid: "0.00",
    returnedCredit: "0.00",
    remainingBalance: "0.00",
    journalEntryId: null,
    workflowRequestId: null,
    createdAt: "2026-03-01T00:00:00.000Z",
    confirmedAt: "2026-03-01T00:00:00.000Z",
    lines,
    totals: {
      taxInclusive: false, grossTotal: "0.00",
      lineDiscountTotal: "0.00",
      promotionDiscountTotal: "0.00",
      invoiceDiscountTotal: "0.00",
      subtotal: "0.00",
      taxableTotal: "0.00",
      taxTotal: "0.00",
      grandTotal: "0.00",
      ...overrides.totals,
    },
    ...overrides,
  } as SalesInvoiceDTO;
}

const fullSettings: TenantSettingsDTO = {
  companyName: "شركة سايج",
  address: "القاهرة الجديدة",
  phone: "0223456789",
  email: "info@cyag.example",
  taxRegistrationNumber: "123-456-789",
  commercialRegistrationNumber: "98765",
} as TenantSettingsDTO;

function ctx(overrides: Partial<SalesInvoicePrintContext> = {}): SalesInvoicePrintContext {
  return {
    invoice: invoice([line({})]),
    settings: fullSettings,
    currencyLabel: "ج.م",
    documentTypeLabel: "فاتورة مبيعات",
    customerRoleLabel: "العميل",
    vatLabel: "ضريبة القيمة المضافة",
    ...overrides,
  };
}

describe("salesInvoicePrintModel", () => {
  it("converts line qty/unitPrice/tax to correctly scaled MAJOR-unit numbers, not the raw wire strings", () => {
    const model = salesInvoicePrintModel(
      ctx({ invoice: invoice([line({ qty: "3", unitPrice: "10.50", taxRatePercent: 14 })]) }),
    );
    const printedLine = model.lines[0]!;
    expect(printedLine.qty).toBe(3);
    expect(printedLine.unitPrice).toBe(10.5);
    // net = 3 * 10.50 = 31.50, tax = 31.50 * 14% = 4.41
    expect(printedLine.taxAmount).toBeCloseTo(4.41, 6);
    expect(printedLine.lineTotal).toBeCloseTo(35.91, 6);
  });

  it("computes a percent discount from the line's gross before tax", () => {
    const model = salesInvoicePrintModel(
      ctx({ invoice: invoice([line({ qty: "1", unitPrice: "100", discountType: "percent", discountPercent: 10, taxRatePercent: 0 })]) }),
    );
    expect(model.lines[0]?.discount).toBeCloseTo(10, 6);
    expect(model.lines[0]?.lineTotal).toBeCloseTo(90, 6);
  });

  it("uses a fixed-amount discount instead of the percent when discountType is 'amount'", () => {
    const model = salesInvoicePrintModel(
      ctx({
        invoice: invoice([
          line({ qty: "1", unitPrice: "100", discountType: "amount", discountAmount: "15.00", discountPercent: 50, taxRatePercent: 0 }),
        ]),
      }),
    );
    expect(model.lines[0]?.discount).toBeCloseTo(15, 6);
    expect(model.lines[0]?.lineTotal).toBeCloseTo(85, 6);
  });

  it("groups the tax breakdown BY RATE — two lines at the same rate combine into one row", () => {
    const model = salesInvoicePrintModel(
      ctx({
        invoice: invoice([
          line({ lineId: "L1", qty: "1", unitPrice: "100", taxRatePercent: 14 }),
          line({ lineId: "L2", qty: "1", unitPrice: "50", taxRatePercent: 14 }),
        ]),
      }),
    );
    expect(model.totals.taxBreakdown!.length!).toBe(1);
    expect(model.totals.taxBreakdown![0]?.rate!).toBe(14);
    // (100 + 50) * 14% = 21.00
    expect(model.totals.taxBreakdown![0]?.amount!).toBeCloseTo(21, 6);
  });

  it("a 0%-tax line contributes NO breakdown row at all", () => {
    const model = salesInvoicePrintModel(
      ctx({ invoice: invoice([line({ qty: "1", unitPrice: "100", taxRatePercent: 0 })]) }),
    );
    expect(model.totals.taxBreakdown!).toEqual([]);
  });

  it("keeps a 14% line and a 0% line as two separate rows (a blended rate would be wrong)", () => {
    const model = salesInvoicePrintModel(
      ctx({
        invoice: invoice([
          line({ lineId: "L1", qty: "1", unitPrice: "100", taxRatePercent: 14 }),
          line({ lineId: "L2", qty: "1", unitPrice: "50", taxRatePercent: 0 }),
        ]),
      }),
    );
    const rates = model.totals.taxBreakdown!.map((b) => b.rate)!;
    expect(rates).toEqual([14]);
  });

  it("sorts multiple tax rates ascending", () => {
    const model = salesInvoicePrintModel(
      ctx({
        invoice: invoice([
          line({ lineId: "L1", qty: "1", unitPrice: "100", taxRatePercent: 14 }),
          line({ lineId: "L2", qty: "1", unitPrice: "100", taxRatePercent: 5 }),
        ]),
      }),
    );
    expect(model.totals.taxBreakdown!.map((b) => b.rate)!).toEqual([5, 14]);
  });

  it("computes amountInWords for a non-negative grand total and omits it for a negative one (credit note)", () => {
    const positive = salesInvoicePrintModel(
      ctx({ invoice: invoice([line({})], { totals: { grandTotal: "150.00" } as never }) }),
    );
    expect(positive.totals.amountInWords).toBeTruthy();

    const negative = salesInvoicePrintModel(
      ctx({ invoice: invoice([line({})], { totals: { grandTotal: "-150.00" } as never }) }),
    );
    expect(negative.totals.amountInWords).toBeUndefined();
  });

  it("carries every Egyptian-tax-invoice-required field when the context supplies it", () => {
    const model = salesInvoicePrintModel(
      ctx({
        customerTaxNumber: "999-888-777",
        customerCode: "CUST-1",
        etaUuid: "ETA-UUID-1",
      }),
    );
    expect(model.company.taxNumber).toBe("123-456-789");
    expect(model.company.name).toBe("شركة سايج");
    expect(model.party!.taxNumber!).toBe("999-888-777");
    expect(model.party!.name!).toBe("عميل تجريبي");
    expect(model.party!.code!).toBe("CUST-1");
    expect(model.number).toBe("INV-0001");
    expect(model.date).toBe("2026-03-01");
    expect(model.etaUuid).toBe("ETA-UUID-1");
  });

  it("falls back to blank/undefined company fields — not empty strings that would print oddly — when settings is null", () => {
    const model = salesInvoicePrintModel(ctx({ settings: null }));
    expect(model.company.name).toBe("");
    expect(model.company.address).toBeUndefined();
    expect(model.company.taxNumber).toBeUndefined();
  });

  it("falls back to the raw invoice id when docNo is null (a draft never printed before confirmation)", () => {
    const model = salesInvoicePrintModel(ctx({ invoice: invoice([line({})], { docNo: null }) }));
    expect(model.number).toBe("SI-1");
  });

  it("passes etaUuid through as undefined (not null) when the context gives null", () => {
    const model = salesInvoicePrintModel(ctx({ etaUuid: null }));
    expect(model.etaUuid).toBeUndefined();
  });
});
