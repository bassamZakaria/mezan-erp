import { describe, it, expect } from "vitest";
import { Money } from "../money/index.js";
import { validatePartnerBase, type PartnerBase } from "./partner-base.js";

function base(overrides: Partial<PartnerBase> = {}): PartnerBase {
  return {
    id: "p1",
    code: "P000001",
    nameAr: "شريك",
    nameEn: null,
    phone: null,
    email: null,
    contactPerson: null,
    taxNumber: null,
    category: null,
    notes: null,
    paymentTermsDays: 30,
    currency: "EGP",
    openingBalance: Money.zero(),
    branchId: null,
    active: true,
    ...overrides,
  };
}

describe("validatePartnerBase", () => {
  it("passes for a well-formed partner", () => {
    expect(validatePartnerBase(base())).toEqual([]);
  });

  it("rejects a blank id", () => {
    expect(validatePartnerBase(base({ id: "  " }))).toContain("المعرف مطلوب");
  });

  it("rejects a code with disallowed characters", () => {
    expect(validatePartnerBase(base({ code: "بادئة عربية" }))).toContain(
      "الكود يجب أن يتكون من 1 إلى 30 حرفًا/رقمًا أو - أو _",
    );
  });

  it("rejects a code over 30 characters", () => {
    expect(validatePartnerBase(base({ code: "A".repeat(31) }))).toContain(
      "الكود يجب أن يتكون من 1 إلى 30 حرفًا/رقمًا أو - أو _",
    );
  });

  it("accepts a code with hyphens and underscores at the 30-character boundary", () => {
    expect(validatePartnerBase(base({ code: "A".repeat(28) + "-_" }))).toEqual([]);
  });

  it("rejects a blank Arabic name", () => {
    expect(validatePartnerBase(base({ nameAr: "" }))).toContain("الاسم بالعربية مطلوب");
  });

  it("rejects a fractional paymentTermsDays", () => {
    expect(validatePartnerBase(base({ paymentTermsDays: 30.5 }))).toContain(
      "مدة السداد يجب أن تكون رقمًا صحيحًا غير سالب",
    );
  });

  it("rejects a negative paymentTermsDays", () => {
    expect(validatePartnerBase(base({ paymentTermsDays: -1 }))).toContain(
      "مدة السداد يجب أن تكون رقمًا صحيحًا غير سالب",
    );
  });

  it("accepts zero payment-terms days (cash on delivery)", () => {
    expect(validatePartnerBase(base({ paymentTermsDays: 0 }))).toEqual([]);
  });

  it("rejects a blank currency", () => {
    expect(validatePartnerBase(base({ currency: " " }))).toContain("العملة مطلوبة");
  });

  it("rejects an opening balance too large to round-trip through the SQLite writer, instead of throwing there as a 500", () => {
    expect(validatePartnerBase(base({ openingBalance: Money.fromMajor("1000000012000000") }))).toContain(
      "الرصيد الافتتاحي أكبر من أن يُسجَّل — راجع الرقم المُدخل",
    );
  });

  it("rejects an opening balance too negative to round-trip", () => {
    expect(validatePartnerBase(base({ openingBalance: Money.fromMajor("-1000000012000000") }))).toContain(
      "الرصيد الافتتاحي أكبر من أن يُسجَّل — راجع الرقم المُدخل",
    );
  });

  it("accumulates every violation, not just the first", () => {
    const reasons = validatePartnerBase(base({ id: "", nameAr: "", currency: "" }));
    expect(reasons.length).toBeGreaterThanOrEqual(3);
  });
});
