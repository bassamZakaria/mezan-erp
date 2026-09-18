import { describe, expect, it } from "vitest";
import type { TenantSettingsDTO } from "@mezan/contracts";
import { documentPrintModel } from "./document-print";
import { ledgerPrintModel } from "./ledger-print";

/**
 * guards P-6 — nine document types had either no print template at all or a
 * raw `window.print()` over the browser's own view of a list.
 */

const settings = {
  companyName: "شركة سايج",
  address: "القاهرة الجديدة",
  phone: "0100000000",
  email: "info@sage.test",
  taxRegistrationNumber: "123-456-789",
  commercialRegistrationNumber: "CR-1",
} as unknown as TenantSettingsDTO;

const base = {
  documentType: "PURCHASE_ORDER",
  documentTypeLabel: "أمر شراء",
  number: "PO-0001",
  date: "2026-03-01",
  settings,
  currencyLabel: "ج.م",
  vatLabel: "ضريبة القيمة المضافة",
};

describe("documentPrintModel", () => {
  it("carries the legal header an Egyptian document is judged on", () => {
    const model = documentPrintModel({
      ...base,
      lines: [{ description: "قهوة", qty: "1", unitPrice: "100.00", taxRatePercent: 14 }],
    });
    expect(model.company.name).toBe("شركة سايج");
    expect(model.company.taxNumber).toBe("123-456-789");
    expect(model.company.commercialRegister).toBe("CR-1");
    expect(model.number).toBe("PO-0001");
    expect(model.date).toBe("2026-03-01");
  });

  it("breaks VAT out by the rate each line was charged at, never one blended figure", () => {
    const model = documentPrintModel({
      ...base,
      lines: [
        { description: "قهوة", qty: "1", unitPrice: "100.00", taxRatePercent: 14 },
        { description: "خبز", qty: "2", unitPrice: "50.00", taxRatePercent: 5 },
        { description: "دواء", qty: "1", unitPrice: "30.00", taxRatePercent: 0 },
      ],
    });
    expect(model.totals.taxBreakdown).toEqual([
      { label: "ضريبة القيمة المضافة", rate: 5, amount: 5 },
      { label: "ضريبة القيمة المضافة", rate: 14, amount: 14 },
    ]);
    expect(model.totals.subtotal).toBe(230);
    expect(model.totals.grandTotal).toBe(249);
  });

  it("spells the total out in Arabic words", () => {
    const model = documentPrintModel({
      ...base,
      lines: [{ description: "قهوة", qty: "1", unitPrice: "100.00", taxRatePercent: 0 }],
    });
    expect(model.totals.amountInWords).toBeTruthy();
    expect(model.totals.amountInWords).not.toMatch(/^[A-Za-z0-9\s.]*$/);
  });

  it("takes a percentage line discount off before tax", () => {
    const model = documentPrintModel({
      ...base,
      lines: [{ description: "قهوة", qty: "1", unitPrice: "100.00", discountPercent: 10, taxRatePercent: 14 }],
    });
    expect(model.lines[0]?.discount).toBe(10);
    expect(model.totals.subtotal).toBe(90);
    expect(model.totals.grandTotal).toBe(102.6);
  });

  it("uses the tax a return RECORDED rather than recomputing today's rate", () => {
    const model = documentPrintModel({
      ...base,
      documentType: "SALES_RETURN",
      // The source invoice charged 10 on this line; the current rate is 14.
      lines: [{ description: "قهوة", qty: "1", unitPrice: "100.00", taxAmount: "10.00", taxRatePercent: 14 }],
    });
    expect(model.totals.grandTotal).toBe(110);
    expect(model.totals.taxBreakdown?.[0]?.amount).toBe(10);
  });

  it("prints no ETA block for a document the authority has not accepted, and never invents one", () => {
    expect(documentPrintModel({ ...base, lines: [] }).etaUuid).toBeUndefined();
    expect(documentPrintModel({ ...base, lines: [], etaUuid: null }).etaUuid).toBeUndefined();
    expect(documentPrintModel({ ...base, lines: [], etaUuid: "UUID-1" }).etaUuid).toBe("UUID-1");
  });
});

describe("ledgerPrintModel", () => {
  const labels = {
    date: "التاريخ",
    reference: "المرجع",
    description: "البيان",
    debit: "مدين",
    credit: "دائن",
    balance: "الرصيد",
  };

  it("renders a journal entry as debits and credits, not as qty × price", () => {
    const model = ledgerPrintModel({
      documentType: "JOURNAL_ENTRY",
      documentTypeLabel: "قيد محاسبي",
      number: "JE-0001",
      date: "2026-03-01",
      settings,
      currencyLabel: "ج.م",
      labels,
      closingLabel: "إجمالي القيد",
      rows: [
        { key: "1", reference: "1120", label: "العملاء", debit: 114_000_000n, credit: 0n },
        { key: "2", reference: "4100", label: "المبيعات", debit: 0n, credit: 100_000_000n },
        { key: "3", reference: "2200", label: "ضريبة القيمة المضافة", debit: 0n, credit: 14_000_000n },
      ],
    });
    expect(model.lines).toEqual([]);
    expect(model.ledger?.rows).toHaveLength(3);
    // No balance column on an entry — its lines are one document, not a history.
    expect(model.ledger?.columns.map((c) => c.key)).toEqual(["reference", "description", "debit", "credit"]);
    expect(model.ledger?.footer.at(-1)).toEqual({ label: "إجمالي القيد", value: 0, emphasis: true });
    expect(model.company.taxNumber).toBe("123-456-789");
  });

  it("runs a debit-positive balance down a statement and closes on it", () => {
    const model = ledgerPrintModel({
      documentType: "CUSTOMER_STATEMENT",
      documentTypeLabel: "كشف حساب عميل",
      number: "CUST-1",
      date: "2026-03-31",
      settings,
      currencyLabel: "ج.م",
      labels,
      showRunningBalance: true,
      closingLabel: "الرصيد الختامي",
      periodLabel: "عن الفترة من 2026-03-01 إلى 2026-03-31",
      amountInWordsOf: "closing",
      rows: [
        { key: "a", date: "2026-03-01", reference: "INV-1", label: "فاتورة", debit: 300_000_000n, credit: 0n },
        { key: "b", date: "2026-03-10", reference: "CV-1", label: "سند قبض", debit: 0n, credit: 100_000_000n },
      ],
    });
    expect(model.ledger?.columns.map((c) => c.key)).toEqual(["date", "reference", "description", "debit", "credit", "balance"]);
    expect(model.ledger?.rows.map((r) => r.cells.balance)).toEqual([300, 200]);
    expect(model.ledger?.periodLabel).toBe("عن الفترة من 2026-03-01 إلى 2026-03-31");
    expect(model.totals.grandTotal).toBe(200);
    expect(model.totals.amountInWords).toBeTruthy();
  });

  it("prints figures and no words when the customer is in credit — a negative cannot be spelled out", () => {
    const model = ledgerPrintModel({
      documentType: "CUSTOMER_STATEMENT",
      documentTypeLabel: "كشف حساب عميل",
      number: "CUST-1",
      date: "2026-03-31",
      settings,
      currencyLabel: "ج.م",
      labels,
      showRunningBalance: true,
      closingLabel: "الرصيد الختامي",
      amountInWordsOf: "closing",
      rows: [{ key: "a", date: "2026-03-01", reference: "CV-1", label: "سند قبض", debit: 0n, credit: 50_000_000n }],
    });
    expect(model.totals.grandTotal).toBe(-50);
    expect(model.totals.amountInWords).toBeUndefined();
  });
});
