// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, expect, it } from "vitest";
import { screen } from "@testing-library/react";
import type { SalesInvoiceDTO } from "../data/hooks";
import { renderWithProviders, stubTransport, testAdminSession } from "../data/test-support";
import { ConfirmRecalculationNotice, confirmAcknowledgementOf } from "./ConfirmRecalculationNotice";

const draft = (confirmPreview?: SalesInvoiceDTO["confirmPreview"]) =>
  ({ id: "INV-1", status: "draft", totals: { grandTotal: "100.000000" }, lines: [], confirmPreview }) as unknown as SalesInvoiceDTO;

const RERATED: NonNullable<SalesInvoiceDTO["confirmPreview"]> = {
  taxRecalculated: true,
  message: "أُعيد احتساب الضريبة على بنود الفاتورة وفق إعداد ضريبة القيمة المضافة الحالي — راجع الإجمالي قبل تسليمها للعميل.",
  lines: [{ lineId: "A", taxRatePercent: 14, taxRateId: "VAT14" }],
  totals: { taxableTotal: "100.000000", taxTotal: "14.000000", grandTotal: "114.000000" },
};

describe("ConfirmRecalculationNotice — what confirming a draft would post", () => {
  it("states, before the confirm button is pressed, that the tax was recalculated and the total that will post", () => {
    renderWithProviders(<ConfirmRecalculationNotice invoice={draft(RERATED)} />, { transport: stubTransport({}), initialSession: testAdminSession });
    const notice = screen.getByRole("status");
    expect(notice).toHaveTextContent("أُعيد احتساب الضريبة");
    expect(notice).toHaveTextContent("الإجمالي الذي سيُرحَّل: 114.00");
    expect(notice).toHaveTextContent("المعروض حالياً: 100.00");
  });

  it("says nothing on a draft that posts as it stands, and acknowledges only what was shown", () => {
    renderWithProviders(<ConfirmRecalculationNotice invoice={draft()} />, { transport: stubTransport({}), initialSession: testAdminSession });
    expect(screen.queryByRole("status")).toBeNull();
    expect(confirmAcknowledgementOf(draft())).toEqual({});
    expect(confirmAcknowledgementOf(draft(RERATED))).toEqual({ acknowledgeTaxRecalculation: true });
  });
});
