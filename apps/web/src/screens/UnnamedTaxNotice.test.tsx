// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, expect, it } from "vitest";
import { screen } from "@testing-library/react";
import { InvoiceDocumentKind } from "@mezan/contracts";
import { ClassifiableDocument } from "../data/hooks";
import { renderWithProviders, stubTransport, testAdminSession } from "../data/test-support";
import { UnnamedTaxNotice } from "./UnnamedTaxNotice";

const LINES = [
  { lineId: "L1", label: "خدمة توصيل", taxRatePercent: 0, taxRateId: null },
  { lineId: "L2", label: "أسمنت", taxRatePercent: 14, taxRateId: "VAT14" },
  { lineId: "L3", label: "طوب", taxRatePercent: 14, taxRateId: null },
];

function renderNotice(props: Partial<Parameters<typeof UnnamedTaxNotice>[0]> = {}) {
  renderWithProviders(<UnnamedTaxNotice document={ClassifiableDocument.SalesInvoice} posted lines={LINES} {...props} />, {
    transport: stubTransport({}),
    initialSession: testAdminSession,
  });
}

describe("the warning a posted document shows for lines that name no tax rate (D79)", () => {
  it("names the 0% lines and says how they will be filed, pointing at «تصنيف ضريبة البند»", () => {
    renderNotice();
    const notice = screen.getByRole("status");
    expect(notice).toHaveTextContent("خدمة توصيل");
    expect(notice).not.toHaveTextContent("أسمنت");
    expect(notice).toHaveTextContent("غير خاضع");
    expect(notice).toHaveTextContent("تصنيف ضريبة البند");
  });

  it("says where a purchase's unnamed lines show on the VAT return", () => {
    renderNotice({ document: ClassifiableDocument.PurchaseInvoice });
    expect(screen.getByRole("status")).toHaveTextContent("إقرار ضريبة القيمة المضافة");
  });

  it("is absent on a draft, on a retention release and when every 0% line names a rate", () => {
    renderNotice({ posted: false });
    renderNotice({ documentKind: InvoiceDocumentKind.RetentionRelease });
    renderNotice({ lines: [{ lineId: "L1", label: "خدمة", taxRatePercent: 0, taxRateId: "VAT-EXEMPT" }] });
    expect(screen.queryByRole("status")).toBeNull();
  });
});
