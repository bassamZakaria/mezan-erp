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
