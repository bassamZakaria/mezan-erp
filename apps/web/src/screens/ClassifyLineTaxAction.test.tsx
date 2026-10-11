// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, expect, it } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { InvoiceDocumentKind, type SessionDTO, type TaxRateDTO } from "@mezan/contracts";
import { ClassifiableDocument } from "../data/hooks";
import { renderWithProviders, stubTransport, testAdminSession } from "../data/test-support";
import { ClassifyLineTaxAction, type ClassifiableLine } from "./ClassifyLineTaxAction";

const taxRate = (overrides: Partial<TaxRateDTO>): TaxRateDTO => ({
  id: "VAT14", code: "VAT14", name: "ضريبة القيمة المضافة", rate: 14, calculationType: "exclusive", isDefault: true,
  outputTaxAccountId: null, inputTaxAccountId: null, etaSubType: "auto", status: "active", isSystem: false, ...overrides,
});
const TAX_RATES = [
  taxRate({}),
  taxRate({ id: "VAT-EXEMPT", code: "VAT-EXEMPT", name: "معفى من الضريبة", rate: 0, isDefault: false, etaSubType: "V003" }),
  taxRate({ id: "VAT-EXPORT", code: "VAT-EXPORT", name: "تصدير — نسبة صفر", rate: 0, isDefault: false, etaSubType: "V001" }),
  taxRate({ id: "OLD-ZERO", code: "OLD-ZERO", name: "صفر قديمة", rate: 0, isDefault: false, etaSubType: "V003", status: "inactive" }),
];

const line = (lineId: string, label: string, taxRatePercent: number, taxRateId: string | null = null): ClassifiableLine => ({ lineId, label, taxRatePercent, taxRateId });
const LINES = [line("L1", "خدمة توصيل", 0), line("L2", "خدمة تركيب", 0), line("L3", "أسمنت", 14, "VAT14"), line("L4", "طوب", 14)];

interface Sent {
  readonly path: string;
  readonly body: Record<string, unknown>;
}

function renderAction(
  target: ClassifiableLine,
  opts: { posted?: boolean; documentKind?: InvoiceDocumentKind; session?: SessionDTO; respond?: () => { status?: number; body: unknown }; document?: ClassifiableDocument; lines?: ClassifiableLine[] } = {},
) {
  const sent: Sent[] = [];
  const document = opts.document ?? ClassifiableDocument.SalesInvoice;
  const respond = opts.respond ?? (() => ({ body: { documentId: "INV-1", documentNumber: "INV-000001", lineIds: [target.lineId], taxRateId: "VAT-EXEMPT", taxRateName: "معفى من الضريبة", taxRatePercent: 0, journalLinesNamed: 1, filing: "requeued" } }));
  const handler = (init: RequestInit | undefined, path: string) => {
    sent.push({ path, body: JSON.parse((init?.body as string) ?? "{}") });
    return respond();
  };
  const transport = stubTransport({
    "POST /sales-invoices/*/lines/*/classify-tax": handler,
    "POST /purchases/invoices/*/lines/*/classify-tax": handler,
  });
  renderWithProviders(
    <ClassifyLineTaxAction document={document} documentId="INV-1" posted={opts.posted ?? true} documentKind={opts.documentKind} line={target} lines={opts.lines ?? LINES} taxRates={TAX_RATES} />,
    { transport, initialSession: opts.session ?? testAdminSession },
  );
  return sent;
}

function pick(optionLabel: string) {
  fireEvent.click(screen.getByLabelText("الضريبة"));
  fireEvent.mouseDown(screen.getByRole("option", { name: optionLabel }));
}

describe("ClassifyLineTaxAction — «تصنيف ضريبة البند» on a posted line that names no rate (D79)", () => {
  it("offers only ACTIVE rates at the line's own percent, and sends the picked rate's id with the lines classified alongside it", async () => {
    const sent = renderAction(LINES[0]!);
    fireEvent.click(screen.getByRole("button", { name: "تصنيف ضريبة البند «خدمة توصيل»" }));
    const dialog = await screen.findByRole("dialog", { name: "تصنيف ضريبة البند" });
    expect(dialog).toHaveTextContent("خدمة تركيب");

    fireEvent.click(screen.getByLabelText("الضريبة"));
    expect(screen.getAllByRole("option").map((o) => o.textContent)).toEqual(["اختر ضريبة بالنسبة نفسها", "معفى من الضريبة · 0٪", "تصدير — نسبة صفر · 0٪"]);
    fireEvent.mouseDown(screen.getByRole("option", { name: "معفى من الضريبة · 0٪" }));
    fireEvent.click(screen.getByRole("button", { name: "تصنيف" }));

    await waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0]).toEqual({ path: "/sales-invoices/INV-1/lines/L1/classify-tax", body: { taxRateId: "VAT-EXEMPT", withLineIds: ["L2"] } });
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "تصنيف ضريبة البند" })).toBeNull());
  });

  it("offers a 14% line only the 14% rate, and names no companion when it is the only unnamed line at that percent", async () => {
    const sent = renderAction(LINES[3]!);
    fireEvent.click(screen.getByRole("button", { name: "تصنيف ضريبة البند «طوب»" }));
    await screen.findByRole("dialog", { name: "تصنيف ضريبة البند" });
    fireEvent.click(screen.getByLabelText("الضريبة"));
    expect(screen.getAllByRole("option").map((o) => o.textContent)).toEqual(["اختر ضريبة بالنسبة نفسها", "ضريبة القيمة المضافة · 14٪"]);
    fireEvent.mouseDown(screen.getByRole("option", { name: "ضريبة القيمة المضافة · 14٪" }));
    fireEvent.click(screen.getByRole("button", { name: "تصنيف" }));
    await waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0]!.body).toEqual({ taxRateId: "VAT14" });
  });

  it("addresses a purchase invoice line by its position, on the purchase route", async () => {
    const sent = renderAction(line("0", "خدمة", 0), { document: ClassifiableDocument.PurchaseInvoice, lines: [line("0", "خدمة", 0)] });
    fireEvent.click(screen.getByRole("button", { name: "تصنيف ضريبة البند «خدمة»" }));
    await screen.findByRole("dialog", { name: "تصنيف ضريبة البند" });
    pick("تصدير — نسبة صفر · 0٪");
    fireEvent.click(screen.getByRole("button", { name: "تصنيف" }));
    await waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0]).toEqual({ path: "/purchases/invoices/INV-1/lines/0/classify-tax", body: { taxRateId: "VAT-EXPORT" } });
  });

  it("shows the server's Arabic refusal and keeps the panel open", async () => {
    renderAction(LINES[0]!, { respond: () => ({ status: 422, body: { error: "VAT_PERIOD_ALREADY_FILED", message: "لا يمكن الترحيل: إقرار ضريبة القيمة المضافة عن هذه الفترة قد قُدّم بالفعل." } }) });
    fireEvent.click(screen.getByRole("button", { name: "تصنيف ضريبة البند «خدمة توصيل»" }));
    await screen.findByRole("dialog", { name: "تصنيف ضريبة البند" });
    pick("معفى من الضريبة · 0٪");
    fireEvent.click(screen.getByRole("button", { name: "تصنيف" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("إقرار ضريبة القيمة المضافة عن هذه الفترة قد قُدّم بالفعل");
    expect(screen.getByRole("dialog", { name: "تصنيف ضريبة البند" })).toBeInTheDocument();
  });

  it("asks for a rate before sending anything", async () => {
    const sent = renderAction(LINES[0]!);
    fireEvent.click(screen.getByRole("button", { name: "تصنيف ضريبة البند «خدمة توصيل»" }));
    await screen.findByRole("dialog", { name: "تصنيف ضريبة البند" });
    fireEvent.click(screen.getByRole("button", { name: "تصنيف" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("اختر الضريبة أولاً.");
    expect(sent).toHaveLength(0);
  });

  it("is absent on a line that already names a rate", () => {
    renderAction(LINES[2]!);
    expect(screen.queryByRole("button", { name: /تصنيف ضريبة البند/ })).toBeNull();
  });

  it("is absent on a retention release, which is not a supply and has no tax to classify", () => {
    renderAction(LINES[0]!, { documentKind: InvoiceDocumentKind.RetentionRelease });
    expect(screen.queryByRole("button", { name: /تصنيف ضريبة البند/ })).not.toBeInTheDocument();
  });

  it("is absent on a draft", () => {
    renderAction(LINES[0]!, { posted: false });
    expect(screen.queryByRole("button", { name: /تصنيف ضريبة البند/ })).toBeNull();
  });

  it("is absent for a user who may view and confirm invoices but not classify", () => {
    renderAction(LINES[0]!, { session: { ...testAdminSession, permissions: ["sales.invoice.view", "sales.invoice.confirm"] } });
    expect(screen.queryByRole("button", { name: /تصنيف ضريبة البند/ })).toBeNull();
  });

  it("is present for a user holding exactly the classify permission", () => {
    renderAction(LINES[0]!, { session: { ...testAdminSession, permissions: ["sales.invoice.classify_tax"] } });
    expect(screen.getByRole("button", { name: "تصنيف ضريبة البند «خدمة توصيل»" })).toBeInTheDocument();
  });
});
