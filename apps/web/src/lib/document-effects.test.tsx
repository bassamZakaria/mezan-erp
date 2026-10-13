// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import type { DocumentEffect } from "@mezan/domain";
import { renderWithProviders, stubTransport, testAdminSession } from "../data/test-support";
import { useDocumentEffectText } from "./document-effects";

const warehouses = [
  { id: "WH-MAIN", name: "المستودع الرئيسي", nameEn: "Main warehouse" },
  { id: "WH-VAN", name: "سيارة التوزيع", nameEn: null },
];

const stockEffect: DocumentEffect = {
  kind: "stock",
  description: 'يعدّل رصيد 3 صنف في المستودع "WH-MAIN" (جرد)',
  key: "docEffects.stockAdjustment.stock",
  params: { count: 3, warehouseId: "WH-MAIN", reasonAr: "جرد", reasonEn: "Stock count" },
  detail: "بندان زيادة",
  detailKey: "docEffects.stockAdjustment.linesIn",
  detailParams: { inCount: 2 },
} as DocumentEffect;

const glEffect: DocumentEffect = {
  kind: "gl",
  description: "يُنشئ قيداً محاسبياً موازناً",
  key: "docEffects.stockAdjustment.gl",
  detail: "1250.500000",
  detailKey: "docEffects.stockAdjustment.glDetail",
  detailParams: { value: "1250.500000" },
} as DocumentEffect;

const unkeyedEffect: DocumentEffect = {
  kind: "stock",
  description: "جملة عربية من الدومين بلا مفتاح",
  detail: "تفصيل عربي",
} as DocumentEffect;

function Harness({ effect }: { effect: DocumentEffect }) {
  const describe_ = useDocumentEffectText();
  const { text, detail } = describe_(effect);
  return (
    <>
      <output data-testid="text">{text}</output>
      <output data-testid="detail">{detail ?? "—"}</output>
    </>
  );
}

function renderEffect(effect: DocumentEffect) {
  const transport = stubTransport({ "GET /warehouses": () => ({ body: warehouses }) });
  return renderWithProviders(<Harness effect={effect} />, { transport, initialSession: testAdminSession });
}

describe("useDocumentEffectText", () => {
  it("names the warehouse instead of printing its id", async () => {
    renderEffect(stockEffect);
    await waitFor(() => expect(screen.getByTestId("text").textContent).toContain("المستودع الرئيسي"));
    expect(screen.getByTestId("text").textContent).not.toContain("WH-MAIN");
  });

  it("shows the warehouse id honestly while the list is still loading", () => {
    renderEffect(stockEffect);
    expect(screen.getByTestId("text").textContent).toContain("WH-MAIN");
  });

  it("keeps the id for a warehouse that is not in the tenant's list", async () => {
    const transport = stubTransport({ "GET /warehouses": () => ({ body: [] }) });
    renderWithProviders(<Harness effect={stockEffect} />, { transport, initialSession: testAdminSession });
    await waitFor(() => expect(screen.getByTestId("text").textContent).toContain("WH-MAIN"));
  });

  it("renders the reason in the reader's language rather than both", async () => {
    renderEffect(stockEffect);
    await waitFor(() => expect(screen.getByTestId("text").textContent).toContain("جرد"));
    expect(screen.getByTestId("text").textContent).not.toContain("Stock count");
  });

  it("formats a money parameter for a person instead of showing the scaled string", () => {
    renderEffect(glEffect);
    const detail = screen.getByTestId("detail").textContent ?? "";
    expect(detail).not.toContain("1250.500000");
    expect(detail).toMatch(/1[,٬]?250/);
  });

  it("carries the count through untouched", async () => {
    renderEffect(stockEffect);
    await waitFor(() => expect(screen.getByTestId("text").textContent).toContain("3"));
    expect(screen.getByTestId("detail").textContent).toContain("2");
  });

  it("falls back to the domain's own sentence for an effect with no catalogue key", () => {
    renderEffect(unkeyedEffect);
    expect(screen.getByTestId("text").textContent).toBe("جملة عربية من الدومين بلا مفتاح");
    expect(screen.getByTestId("detail").textContent).toBe("تفصيل عربي");
  });

  it("reports no detail rather than an empty line when an effect has none", () => {
    renderEffect({ kind: "stock", description: "بلا تفصيل" } as DocumentEffect);
    expect(screen.getByTestId("detail").textContent).toBe("—");
  });
});

describe("a voucher's journal effect", () => {
  const voucherEffect = (currency?: string): DocumentEffect =>
    ({
      kind: "gl",
      description: "يُنشئ قيداً محاسبياً متوازناً بقيمة 300.00 EGP (تحصيل من عميل)",
      key: "docEffects.voucher.gl",
      params: { amount: "300.000000", ...(currency ? { currency } : {}), reasonAr: "تحصيل من عميل", reasonEn: "Customer collection" },
    }) as DocumentEffect;

  it("reads the amount through the money formatter with the tenant's currency label — two decimals, never six", async () => {
    renderEffect(voucherEffect());
    await waitFor(() => expect(screen.getByTestId("text")).toHaveTextContent("يُنشئ قيداً محاسبياً متوازناً بقيمة 300.00 ج.م (تحصيل من عميل)"));
  });

  it("carries the voucher's own currency when it is foreign", async () => {
    renderEffect(voucherEffect("USD"));
    await waitFor(() => expect(screen.getByTestId("text")).toHaveTextContent("بقيمة 300.00 USD (تحصيل من عميل)"));
  });
});
