import { describe, expect, it } from "vitest";
import { defaultNotificationBody, defaultNotificationTitle, renderTemplate } from "./template.js";
import { getEventDefinition } from "../events/catalog.js";

describe("renderTemplate", () => {
  it("substitutes known tokens", () => {
    const rendered = renderTemplate("تم إنشاء الفاتورة {{documentNumber}} بقيمة {{amount}} للعميل {{customerName}}.", {
      documentNumber: "INV-000123",
      amount: "1150.00",
      customerName: "شركة الأمل للتجارة",
    });
    expect(rendered).toBe("تم إنشاء الفاتورة INV-000123 بقيمة 1150.00 للعميل شركة الأمل للتجارة.");
  });

  it("renders a missing token as an empty string, never the literal placeholder", () => {
    const rendered = renderTemplate("العميل: {{customerName}}", {});
    expect(rendered).toBe("العميل: ");
    expect(rendered).not.toContain("{{");
  });

  it("ignores tokens not present in the template", () => {
    expect(renderTemplate("رسالة ثابتة بدون متغيرات", { amount: 1 })).toBe("رسالة ثابتة بدون متغيرات");
  });
});

describe("default title/body", () => {
  const def = getEventDefinition("SALES_INVOICE_CONFIRMED");

  it("defaults the title to the catalog's Arabic label", () => {
    expect(defaultNotificationTitle(def)).toBe(def.labelAr);
  });

  it("assembles the body from documentNumber/customerName/amount when present", () => {
    const body = defaultNotificationBody(def, {
      documentNumber: "INV-000123",
      customerName: "شركة الأمل للتجارة",
      amount: "1150.00",
    });
    expect(body).toContain("INV-000123");
    expect(body).toContain("شركة الأمل للتجارة");
    expect(body).toContain("1150.00");
  });

  it("falls back to the label alone when the payload has none of the known fields", () => {
    expect(defaultNotificationBody(def, {})).toBe(def.labelAr);
  });
});

/**
 * Event payloads carry money as `Money.toString()` — six decimals, no
 * grouping — and it was pasted into the notification as it stood: «تم تأكيد
 * فاتورة مبيعات بقيمة 11.400000 ج.م», where the catalog's own preview reads
 * «بقيمة 1,150.00 ج.م».
 */
describe("money in a notification reads as money, not as the wire format", () => {
  const def = getEventDefinition("SALES_INVOICE_CONFIRMED");

  it("groups thousands and drops the wire's trailing zeros down to two places", () => {
    expect(renderTemplate("بقيمة {{amount}} ج.م", { amount: "11.400000" })).toBe("بقيمة 11.40 ج.م");
    expect(renderTemplate("بقيمة {{amount}} ج.م", { amount: "1150.000000" })).toBe("بقيمة 1,150.00 ج.م");
    expect(renderTemplate("بقيمة {{amount}} ج.م", { amount: "4765094.010000" })).toBe("بقيمة 4,765,094.01 ج.م");
    expect(renderTemplate("{{amount}}", { amount: "-2500.500000" })).toBe("-2,500.50");
    expect(renderTemplate("{{amount}}", { amount: "0.000000" })).toBe("0.00");
  });

  it("never rounds: digits past the second place that are not zero are kept", () => {
    expect(renderTemplate("{{amount}}", { amount: "28.128266" })).toBe("28.128266");
    expect(renderTemplate("{{amount}}", { amount: "1000.125000" })).toBe("1,000.125");
  });

  it("leaves everything that is not the money wire format exactly as it was", () => {
    expect(renderTemplate("{{documentNumber}} · {{amount}} · {{qty}}", { documentNumber: "INV-000123", amount: "1150.00", qty: 3 })).toBe(
      "INV-000123 · 1150.00 · 3",
    );
  });

  it("formats the default body's amount the same way", () => {
    expect(defaultNotificationBody(def, { amount: "1150.000000" })).toBe("المبلغ: 1,150.00");
  });
});
