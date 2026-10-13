import { describe, expect, it } from "vitest";
import { CollectPath, collectPathFor, draftCollectionBody } from "./collect-path";
import { CollectPaymentMethod } from "./enums";

const holding = (...permissions: string[]) => (permission: string) => permissions.includes("*") || permissions.includes(permission);

describe("which way a collection goes for the session that records it", () => {
  it("a cashier who may only write a voucher saves a draft for approval", () => {
    expect(collectPathFor(holding("treasury.cash_voucher.create", "treasury.cash_voucher.view"))).toBe(CollectPath.DraftForApproval);
  });

  it("a session holding write, confirm and allocation keeps the one-call path", () => {
    expect(collectPathFor(holding("treasury.cash_voucher.create", "treasury.cash_voucher.confirm", "treasury.allocation.manage"))).toBe(CollectPath.ConfirmNow);
    expect(collectPathFor(holding("*"))).toBe(CollectPath.ConfirmNow);
  });

  it("write and confirm without the allocation right still saves a draft, because the one call allocates", () => {
    expect(collectPathFor(holding("treasury.cash_voucher.create", "treasury.cash_voucher.confirm"))).toBe(CollectPath.DraftForApproval);
  });

  it("a session that may only confirm is told so, and one holding neither is refused", () => {
    expect(collectPathFor(holding("treasury.cash_voucher.confirm"))).toBe(CollectPath.ConfirmOnly);
    expect(collectPathFor(holding("sales.invoice.view"))).toBe(CollectPath.NotAllowed);
  });
});

describe("the draft a create-only cashier saves", () => {
  it("is a customer collection that names the customer, the drawer and the invoice it is for, and no ledger account", () => {
    const body = draftCollectionBody({
      date: "2026-10-13",
      customerId: "CUST-1",
      branchId: "BR-MAIN",
      treasuryAccountId: "TR-1",
      amount: "150.50",
      referenceNo: "  ",
      invoiceNo: "INV-000123",
      memoPrefix: "تحصيل الفاتورة",
    });
    expect(body).toEqual({
      date: "2026-10-13",
      voucherType: "customer_collection",
      amount: "150.50",
      branchId: "BR-MAIN",
      paymentMethod: CollectPaymentMethod.Cash,
      treasuryAccountId: "TR-1",
      customerId: "CUST-1",
      referenceNo: null,
      memo: "تحصيل الفاتورة INV-000123",
    });
    expect(Object.keys(body)).not.toContain("counterpartyGlAccountId");
    expect(Object.keys(body)).not.toContain("allocations");
  });

  it("carries the invoice it is for as the allocation the confirmer will apply, when the cashier may allocate", () => {
    const base = { date: "2026-10-13", customerId: "CUST-1", branchId: "BR-MAIN", treasuryAccountId: "TR-1", amount: "150.50", referenceNo: "", invoiceNo: "INV-000123", memoPrefix: "تحصيل الفاتورة" };

    expect(draftCollectionBody({ ...base, allocation: { invoiceId: "INV-ID-1", amount: "150.50" } }).allocations).toEqual([{ invoiceId: "INV-ID-1", amount: "150.50" }]);
    expect(draftCollectionBody({ ...base, allocation: { invoiceId: "INV-ID-1", amount: null } }).allocations).toEqual([{ invoiceId: "INV-ID-1" }]);
  });
});
