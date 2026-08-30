import { describe, it, expect } from "vitest";
import { Money, Qty } from "../money/index.js";
import {
  sumRefunds,
  refundDue,
  isAwaitingRefund,
  assertRefundable,
  SalesReturnNotRefundableError,
  type SalesReturnRefund,
} from "./refund.js";
import type { SalesReturnDocument, SalesReturnLine } from "./sales-return-document.js";

function returnLine(overrides: Partial<SalesReturnLine> = {}): SalesReturnLine {
  return {
    itemId: "ITEM1",
    warehouseId: "WH1",
    customerId: "CUST1",
    sourceInvoiceId: "INV1",
    sourceInvoiceNumber: "INV-000014",
    reason: "DEFECTIVE",
    availableQty: Qty.fromMajor("5"),
    qty: Qty.fromMajor("2"),
    unitPrice: Money.fromMajor("100"),
    unitCost: Money.fromMajor("60"),
    taxAmount: Money.fromMajor("28"), // 14% of 200
    ...overrides,
  };
}

function returnDoc(overrides: Partial<SalesReturnDocument> = {}): SalesReturnDocument {
  return {
    id: "SR1",
    docType: "SALES_RETURN",
    docNo: "SRT-000001",
    date: "2026-08-21",
    memo: "",
    status: "confirmed",
    lines: [returnLine()],
    createdAt: "2026-08-21T00:00:00.000Z",
    confirmedAt: "2026-08-21T00:00:00.000Z",
    reversesDocId: null,
    reversedByDocId: null,
    workflowRequestId: null,
    journalEntryId: "j1",
    ...overrides,
  };
}

function refund(overrides: Partial<SalesReturnRefund> = {}): SalesReturnRefund {
  return {
    voucherId: "V1",
    voucherNo: "PMT-000001",
    date: "2026-08-22",
    amount: Money.fromMajor("50"),
    ...overrides,
  };
}

// grandTotal of the fixture doc: revenue 2*100=200, tax 28 → 228.00

describe("sumRefunds", () => {
  it("sums an empty list to zero", () => {
    expect(sumRefunds([]).toString()).toBe("0.000000");
  });

  it("sums several refunds exactly", () => {
    const total = sumRefunds([refund({ amount: Money.fromMajor("50") }), refund({ amount: Money.fromMajor("30.50") })]);
    expect(total.toString()).toBe("80.500000");
  });
});

describe("refundDue", () => {
  it("is the full grand total when the return is confirmed and nothing has been refunded", () => {
    expect(refundDue(returnDoc(), []).toString()).toBe("228.000000");
  });

  it("is zero for a non-confirmed (draft) return regardless of refunds posted", () => {
    expect(refundDue(returnDoc({ status: "draft" }), []).toString()).toBe("0.000000");
  });

  it("subtracts confirmed refunds already posted", () => {
    const due = refundDue(returnDoc(), [refund({ amount: Money.fromMajor("100") })]);
    expect(due.toString()).toBe("128.000000");
  });

  it("is exactly zero, never negative, once refunds equal or exceed the grand total", () => {
    const exact = refundDue(returnDoc(), [refund({ amount: Money.fromMajor("228") })]);
    expect(exact.toString()).toBe("0.000000");
    const over = refundDue(returnDoc(), [refund({ amount: Money.fromMajor("300") })]);
    expect(over.toString()).toBe("0.000000");
  });
});

describe("isAwaitingRefund", () => {
  it("is true for a confirmed return with nothing refunded yet", () => {
    expect(isAwaitingRefund(returnDoc())).toBe(true);
  });

  it("stays true after a partial refund", () => {
    expect(isAwaitingRefund(returnDoc(), [refund({ amount: Money.fromMajor("100") })])).toBe(true);
  });

  it("is false once refunded in full", () => {
    expect(isAwaitingRefund(returnDoc(), [refund({ amount: Money.fromMajor("228") })])).toBe(false);
  });

  it("is false for a draft return", () => {
    expect(isAwaitingRefund(returnDoc({ status: "draft" }))).toBe(false);
  });
});

describe("assertRefundable", () => {
  it("allows a refund up to and including the exact amount due", () => {
    expect(() => assertRefundable(returnDoc(), [], Money.fromMajor("228"))).not.toThrow();
    expect(() => assertRefundable(returnDoc(), [], Money.fromMajor("100"))).not.toThrow();
  });

  it("refuses a refund of one micro-unit more than what's due", () => {
    const due = refundDue(returnDoc(), []); // 228.000000
    const oneOver = Money.fromScaled(due.scaled + 1n);
    expect(() => assertRefundable(returnDoc(), [], oneOver)).toThrow(SalesReturnNotRefundableError);
  });

  it("refuses a second refund that, combined with a prior one, exceeds the grand total", () => {
    const priorRefunds = [refund({ amount: Money.fromMajor("200") })]; // 28.00 left
    expect(() => assertRefundable(returnDoc(), priorRefunds, Money.fromMajor("28"))).not.toThrow();
    expect(() => assertRefundable(returnDoc(), priorRefunds, Money.fromMajor("28.000001"))).toThrow(
      SalesReturnNotRefundableError,
    );
  });

  it("refuses a refund on a non-confirmed return", () => {
    expect(() => assertRefundable(returnDoc({ status: "draft" }), [], Money.fromMajor("10"))).toThrow(
      SalesReturnNotRefundableError,
    );
  });

  it("refuses a zero or negative refund amount", () => {
    expect(() => assertRefundable(returnDoc(), [], Money.zero())).toThrow(SalesReturnNotRefundableError);
    expect(() => assertRefundable(returnDoc(), [], Money.fromMajor("-1"))).toThrow(SalesReturnNotRefundableError);
  });

  it("refuses a refund on a return already refunded in full, with the exact Arabic message", () => {
    const fullyRefunded = [refund({ amount: Money.fromMajor("228") })];
    expect(() => assertRefundable(returnDoc(), fullyRefunded, Money.fromMajor("1"))).toThrow(
      "تم رد كامل قيمة هذا المرتجع بالفعل.",
    );
  });

  it("names the requested and remaining amounts in the over-limit Arabic message", () => {
    expect(() => assertRefundable(returnDoc(), [], Money.fromMajor("300"))).toThrow(
      "قيمة الرد (300.000000) تتجاوز المتبقي على المرتجع (228.000000).",
    );
  });
});
