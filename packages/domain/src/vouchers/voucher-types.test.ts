import { describe, it, expect } from "vitest";
import {
  VOUCHER_TYPE_DEFINITIONS,
  VOUCHER_PAYMENT_METHODS,
  getVoucherTypeDefinition,
  getVoucherPaymentMethodLabel,
  isVoucherType,
  isAllocatableType,
  type VoucherType,
} from "./voucher-types.js";

describe("VOUCHER_TYPE_DEFINITIONS", () => {
  it("has the 11 catalog voucher types with unique codes", () => {
    expect(VOUCHER_TYPE_DEFINITIONS).toHaveLength(11);
    const codes = VOUCHER_TYPE_DEFINITIONS.map((d) => d.code);
    expect(new Set(codes).size).toBe(11);
  });

  it("only the allocatable types (customer collection, supplier payment) carry an allocationKind", () => {
    for (const def of VOUCHER_TYPE_DEFINITIONS) {
      if (def.allocatable) {
        expect(def.allocationKind).not.toBeNull();
      } else {
        expect(def.allocationKind).toBeNull();
      }
    }
    expect(getVoucherTypeDefinition("customer_collection").allocationKind).toBe("sales");
    expect(getVoucherTypeDefinition("supplier_payment").allocationKind).toBe("purchase");
  });

  it("fixed-account types (capital, tax) carry counterpartAccountFixed=true with a non-null account", () => {
    for (const code of ["customer_advance", "capital_injection", "capital_withdrawal", "tax_payment"] as const) {
      const def = getVoucherTypeDefinition(code);
      expect(def.counterpartAccountFixed).toBe(true);
      expect(def.counterpartAccountId).not.toBeNull();
    }
  });

  it("counterparty-resolved types (customer collection, supplier payment, transfer) leave the account null", () => {
    for (const code of ["customer_collection", "supplier_payment", "customer_refund", "supplier_refund", "inter_treasury_transfer"] as const) {
      expect(getVoucherTypeDefinition(code).counterpartAccountId).toBeNull();
    }
  });
});

describe("getVoucherTypeDefinition", () => {
  it("returns the definition for a known type", () => {
    const def = getVoucherTypeDefinition("customer_collection");
    expect(def.direction).toBe("receipt");
    expect(def.requiresCustomer).toBe(true);
    expect(def.requiresSupplier).toBe(false);
    expect(def.labelAr).toBe("تحصيل من عميل");
  });

  it("throws RangeError for an unknown type", () => {
    expect(() => getVoucherTypeDefinition("bogus")).toThrow(RangeError);
    expect(() => getVoucherTypeDefinition("bogus")).toThrow('Unknown voucher type: "bogus"');
  });
});

describe("isVoucherType", () => {
  it("is true for every defined code", () => {
    for (const def of VOUCHER_TYPE_DEFINITIONS) {
      expect(isVoucherType(def.code)).toBe(true);
    }
  });

  it("is false for an unknown string", () => {
    expect(isVoucherType("bogus")).toBe(false);
  });
});

describe("isAllocatableType", () => {
  it("is true for customer_collection and supplier_payment", () => {
    expect(isAllocatableType("customer_collection")).toBe(true);
    expect(isAllocatableType("supplier_payment")).toBe(true);
  });

  it("is false for a non-allocatable type", () => {
    expect(isAllocatableType("other_income" as VoucherType)).toBe(false);
    expect(isAllocatableType("inter_treasury_transfer" as VoucherType)).toBe(false);
  });
});

describe("VOUCHER_PAYMENT_METHODS / getVoucherPaymentMethodLabel", () => {
  it("has the 5 payment methods with Arabic and English labels", () => {
    expect(VOUCHER_PAYMENT_METHODS).toHaveLength(5);
    for (const method of VOUCHER_PAYMENT_METHODS) {
      expect(method.labelAr.length).toBeGreaterThan(0);
      expect(method.labelEn.length).toBeGreaterThan(0);
    }
  });

  it("returns the Arabic label for a known method", () => {
    expect(getVoucherPaymentMethodLabel("cash")).toBe("نقدي");
    expect(getVoucherPaymentMethodLabel("cheque")).toBe("شيك");
    expect(getVoucherPaymentMethodLabel("wallet")).toBe("محفظة إلكترونية");
  });

  it("falls back to the raw code for an unknown method", () => {
    // @ts-expect-error — deliberately probing an out-of-union value
    expect(getVoucherPaymentMethodLabel("bogus")).toBe("bogus");
  });
});
