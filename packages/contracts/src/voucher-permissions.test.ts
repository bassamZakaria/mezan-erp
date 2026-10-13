import { describe, expect, it } from "vitest";
import { ReversalPermission } from "./document-reversal.js";
import { VoucherPermissionAction, mayReverseVoucher, voucherActionPermissions } from "./voucher-permissions.js";

const holding = (...codes: string[]) => (permission: string) => codes.includes(permission);

describe("who may reverse a voucher", () => {
  it("needs the reversal permission and a void permission that covers the voucher's type — neither alone is enough", () => {
    expect(mayReverseVoucher(holding(ReversalPermission.Voucher), "customer_collection")).toBe(false);
    expect(mayReverseVoucher(holding("treasury.cash_voucher.void"), "customer_collection")).toBe(false);
    expect(mayReverseVoucher(holding(ReversalPermission.Voucher, "treasury.cash_voucher.void"), "customer_collection")).toBe(true);
  });

  it("a type with a permission of its own is covered by that one or by the general one, and by no other type's", () => {
    expect(mayReverseVoucher(holding(ReversalPermission.Voucher, "treasury.customer_refund.void"), "customer_refund")).toBe(true);
    expect(mayReverseVoucher(holding(ReversalPermission.Voucher, "treasury.cash_voucher.void"), "customer_refund")).toBe(true);
    expect(mayReverseVoucher(holding(ReversalPermission.Voucher, "treasury.transfer.void"), "customer_refund")).toBe(false);
    expect(mayReverseVoucher(holding(ReversalPermission.Voucher, "treasury.customer_refund.void"), "customer_collection")).toBe(false);
  });

  it("the codes an action on a type answers to are the general one and the type's own", () => {
    expect(voucherActionPermissions(VoucherPermissionAction.Void, "inter_treasury_transfer")).toEqual(["treasury.cash_voucher.void", "treasury.transfer.void"]);
    expect(voucherActionPermissions(VoucherPermissionAction.Create, "supplier_payment")).toEqual(["treasury.cash_voucher.create"]);
    expect(voucherActionPermissions(VoucherPermissionAction.Confirm, null)).toEqual(["treasury.cash_voucher.confirm"]);
  });
});
