// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, expect, it } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { renderWithProviders, stubTransport, testAdminSession } from "../../data/test-support";
import { EtaFindingClassifyAction } from "./EtaFindingClassifyAction";

const TAX_RATES = [
  { id: "VAT-EXEMPT", code: "VAT-EXEMPT", name: "معفى من الضريبة", rate: 0, calculationType: "exclusive", isDefault: false, outputTaxAccountId: null, inputTaxAccountId: null, etaSubType: "V003", status: "active", isSystem: false },
];
const INVOICE = {
  id: "INV-ID-1", docNo: "INV-000700", status: "confirmed", documentKind: "standard",
  lines: [
    { lineId: "L1", itemNameAr: "خدمة توصيل", taxRatePercent: 0, taxRateId: null },
    { lineId: "L2", itemNameAr: "أسمنت", taxRatePercent: 14, taxRateId: "VAT14" },
  ],
};

function renderFinding() {
  const requested: string[] = [];
  const sent: { path: string; body: unknown }[] = [];
  const transport = stubTransport({
    "GET /sales-invoices/*": (_init: RequestInit | undefined, path: string) => {
      requested.push(path);
      return { body: INVOICE };
    },
    "GET /tax-rates": () => ({ body: TAX_RATES }),
    "POST /sales-invoices/*/lines/*/classify-tax": (init: RequestInit | undefined, path: string) => {
      sent.push({ path, body: JSON.parse((init?.body as string) ?? "{}") });
      return { body: { documentId: "INV-ID-1", documentNumber: "INV-000700", lineIds: ["L1"], taxRateId: "VAT-EXEMPT", taxRateName: "معفى من الضريبة", taxRatePercent: 0, journalLinesNamed: 1, filing: "requeued" } };
    },
  });
  renderWithProviders(<EtaFindingClassifyAction documentNumber="INV-000700" lineId="L1" />, { transport, initialSession: testAdminSession });
  return { requested, sent };
}

describe("«تصنيف ضريبة البند» from a blocked e-invoice's finding (D79)", () => {
  it("carries the same label as the document's action and reads nothing until it is pressed", () => {
    const { requested } = renderFinding();
    expect(screen.getByRole("button", { name: "تصنيف ضريبة البند" })).toBeInTheDocument();
    expect(requested).toEqual([]);
  });

  it("opens the document's own classify dialog on the finding's line and classifies through the same route", async () => {
    const { sent } = renderFinding();
    fireEvent.click(screen.getByRole("button", { name: "تصنيف ضريبة البند" }));
    const dialog = await screen.findByRole("dialog", { name: "تصنيف ضريبة البند" });
    expect(dialog).toHaveTextContent("خدمة توصيل");
    fireEvent.click(screen.getByLabelText("الضريبة"));
    fireEvent.mouseDown(screen.getByRole("option", { name: "معفى من الضريبة · 0٪" }));
    fireEvent.click(screen.getByRole("button", { name: "تصنيف" }));
    await waitFor(() => expect(sent).toEqual([{ path: "/sales-invoices/INV-ID-1/lines/L1/classify-tax", body: { taxRateId: "VAT-EXEMPT" } }]));
  });
});
