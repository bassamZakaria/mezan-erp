import { describe, expect, it } from "vitest";
import { Money } from "../money/index.js";
import { createCustomer, updateCustomer, InvalidCustomerError } from "./customer.js";

describe("createCustomer", () => {
  it("creates a customer with the catalog's add-dialog defaults applied", () => {
    const customer = createCustomer({ id: "c1", code: "C000001", nameAr: "شركة الأمل للتجارة" });
    expect(customer).toMatchObject({
      id: "c1",
      code: "C000001",
      nameAr: "شركة الأمل للتجارة",
      nameEn: null,
      paymentTermsDays: 30,
      currency: "EGP",
      active: true,
      priceListId: null,
      taxExempt: false,
      etaBuyerType: "auto",
      nationalId: null,
    });
    expect(customer.creditLimit.equals(Money.zero())).toBe(true);
    expect(customer.openingBalance.equals(Money.zero())).toBe(true);
  });

  it("accepts full field overrides", () => {
    const customer = createCustomer({
      id: "c2",
      code: "C000002",
      nameAr: "مؤسسة النور للمقاولات",
      nameEn: "Al Nour Contracting",
      phone: "01012345678",
      email: "info@alnour.example",
      contactPerson: "أحمد علي",
      taxNumber: "300123456700003",
      category: "جملة",
      notes: "عميل مميز",
      paymentTermsDays: 45,
      currency: "USD",
      openingBalance: Money.fromMajor("500.00"),
      priceListId: "pl-vip",
      creditLimit: Money.fromMajor("10000.00"),
      taxExempt: true,
      etaBuyerType: "business",
      nationalId: "29001011234567",
    });
    expect(customer.paymentTermsDays).toBe(45);
    expect(customer.currency).toBe("USD");
    expect(customer.creditLimit.toString()).toBe("10000.000000");
    expect(customer.taxExempt).toBe(true);
    expect(customer.etaBuyerType).toBe("business");
  });

  it("rejects an empty Arabic name", () => {
    expect(() => createCustomer({ id: "c1", code: "C1", nameAr: "" })).toThrow(InvalidCustomerError);
  });

  it("rejects a negative credit limit", () => {
    expect(() =>
      createCustomer({ id: "c1", code: "C1", nameAr: "عميل", creditLimit: Money.fromMajor("-1.00") }),
    ).toThrow(InvalidCustomerError);
  });

  it("rejects a negative payment-terms value", () => {
    expect(() => createCustomer({ id: "c1", code: "C1", nameAr: "عميل", paymentTermsDays: -5 })).toThrow(
      InvalidCustomerError,
    );
  });

  it("rejects an invalid code", () => {
    expect(() => createCustomer({ id: "c1", code: "بدون كود صالح!", nameAr: "عميل" })).toThrow(InvalidCustomerError);
  });
});

describe("updateCustomer", () => {
  it("applies a patch and re-validates", () => {
    const customer = createCustomer({ id: "c1", code: "C1", nameAr: "عميل" });
    const updated = updateCustomer(customer, { active: false, phone: "0100000000", creditLimit: Money.fromMajor("2000") });
    expect(updated.active).toBe(false);
    expect(updated.phone).toBe("0100000000");
    expect(updated.creditLimit.toString()).toBe("2000.000000");
    expect(updated.id).toBe("c1");
  });

  it("rejects an invalid patch", () => {
    const customer = createCustomer({ id: "c1", code: "C1", nameAr: "عميل" });
    expect(() => updateCustomer(customer, { nameAr: "" })).toThrow(InvalidCustomerError);
  });

  it("rejects flipping to a negative credit limit via patch", () => {
    const customer = createCustomer({ id: "c1", code: "C1", nameAr: "عميل" });
    expect(() => updateCustomer(customer, { creditLimit: Money.fromMajor("-1") })).toThrow(InvalidCustomerError);
  });
});
