import { describe, expect, it } from "vitest";
import { Money } from "../money/index.js";
import { approvalLabel, displayAmount } from "./approval-label.js";

describe("the amount an approval label states", () => {
  it("rounds half up to two places instead of cutting the third off", () => {
    expect(displayAmount(Money.fromMajor("341.995"))).toBe("342.00");
    expect(displayAmount(Money.fromMajor("341.994999"))).toBe("341.99");
    expect(displayAmount(Money.fromMajor("-0.005"))).toBe("-0.01");
  });

  it("groups thousands", () => {
    expect(displayAmount(Money.fromMajor("5200"))).toBe("5,200.00");
    expect(displayAmount(Money.fromMajor("1234567.5"))).toBe("1,234,567.50");
    expect(displayAmount(Money.fromMajor("999.999"))).toBe("1,000.00");
    expect(displayAmount(Money.fromMajor("-18500"))).toBe("-18,500.00");
  });
});

describe("an approval label", () => {
  it("names the amount with its currency and the party", () => {
    expect(approvalLabel({ type: "فاتورة مبيعات", amount: Money.fromMajor("5200"), party: "مجموعة الفجر التجارية" })).toBe("فاتورة مبيعات بقيمة 5,200.00 ج.م — مجموعة الفجر التجارية");
  });

  it("names the document a return is raised on, so two held returns of one customer and amount are told apart", () => {
    const held = (reference: string) => approvalLabel({ type: "مرتجع مبيعات", reference, amount: Money.fromMajor("114"), party: "عميل" });
    expect(held("INV-000532")).toBe("مرتجع مبيعات على INV-000532 بقيمة 114.00 ج.م — عميل");
    expect(held("INV-000533")).not.toBe(held("INV-000532"));
  });

  it("states another currency by its own symbol, and nothing where there is no amount", () => {
    expect(approvalLabel({ type: "سند صرف", amount: Money.fromMajor("120"), currency: "USD", party: "مورد" })).toBe("سند صرف بقيمة 120.00 $ — مورد");
    expect(approvalLabel({ type: "تحويل مخزون", party: " " })).toBe("تحويل مخزون");
  });
});
