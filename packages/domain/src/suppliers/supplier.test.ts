import { describe, expect, it } from "vitest";
import { Money } from "../money/index.js";
import { createSupplier, updateSupplier, InvalidSupplierError } from "./supplier.js";

describe("createSupplier", () => {
  it("creates a supplier with the catalog's add-dialog defaults applied", () => {
    const supplier = createSupplier({ id: "s1", code: "S000001", nameAr: "جاري" });
    expect(supplier).toMatchObject({
      id: "s1",
      code: "S000001",
      nameAr: "جاري",
      nameEn: null,
      paymentTermsDays: 30,
      currency: "EGP",
      active: true,
      addressCity: null,
      addressDistrict: null,
      addressStreet: null,
    });
    expect(supplier.openingBalance.equals(Money.zero())).toBe(true);
  });

  it("accepts full field overrides including address", () => {
    const supplier = createSupplier({
      id: "s2",
      code: "S000002",
      nameAr: "مصنع الوادي الأخضر",
      nameEn: "Green Valley Factory",
      phone: "0334567890",
      email: "sales@greenvalley.example",
      contactPerson: "سارة محمود",
      taxNumber: "300987654300001",
      category: "مواد خام",
      notes: "مورد رئيسي",
      paymentTermsDays: 60,
      currency: "USD",
      openingBalance: Money.fromMajor("1250.75"),
      addressCity: "الإسكندرية",
      addressDistrict: "سموحة",
      addressStreet: "شارع فؤاد",
    });
    expect(supplier.paymentTermsDays).toBe(60);
    expect(supplier.currency).toBe("USD");
    expect(supplier.openingBalance.toString()).toBe("1250.750000");
    expect(supplier.addressCity).toBe("الإسكندرية");
  });

  it("rejects an empty Arabic name", () => {
    expect(() => createSupplier({ id: "s1", code: "S1", nameAr: "" })).toThrow(InvalidSupplierError);
  });

  it("rejects a negative payment-terms value", () => {
    expect(() => createSupplier({ id: "s1", code: "S1", nameAr: "مورد", paymentTermsDays: -1 })).toThrow(
      InvalidSupplierError,
    );
  });

  it("rejects an invalid code", () => {
    expect(() => createSupplier({ id: "s1", code: "", nameAr: "مورد" })).toThrow(InvalidSupplierError);
  });
});

describe("updateSupplier", () => {
  it("applies a patch and re-validates", () => {
    const supplier = createSupplier({ id: "s1", code: "S1", nameAr: "مورد" });
    const updated = updateSupplier(supplier, { active: false, addressCity: "القاهرة" });
    expect(updated.active).toBe(false);
    expect(updated.addressCity).toBe("القاهرة");
    expect(updated.id).toBe("s1");
  });

  it("rejects an invalid patch", () => {
    const supplier = createSupplier({ id: "s1", code: "S1", nameAr: "مورد" });
    expect(() => updateSupplier(supplier, { nameAr: "" })).toThrow(InvalidSupplierError);
  });
});
