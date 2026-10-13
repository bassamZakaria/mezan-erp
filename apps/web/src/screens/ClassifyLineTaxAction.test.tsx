// @vitest-environment jsdom
import { MemoryRouter } from "react-router";
import { AppProviders } from "../data/AppProviders";
import "@testing-library/jest-dom/vitest";
import { describe, expect, it } from "vitest";
import { act, fireEvent, screen, waitFor } from "@testing-library/react";
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

  it("offers the system's «غير خاضع» rate only on a sale of a tenant whose VAT is off — never while VAT is on, and never on a purchase", async () => {
    const system = taxRate({ id: "SYS-NOT-SUBJECT", code: "SYS-NOT-SUBJECT", name: "غير خاضع", rate: 0, isDefault: false, etaSubType: "V004", isSystem: true });
    const withSystem = [...TAX_RATES, system];
    const optionsFor = async (document: ClassifiableDocument, vatEnabled: boolean) => {
      let policyServed = false;
      const transport = stubTransport({
        "GET /tax-rates/policy": () => {
          policyServed = true;
          return { body: { vatEnabled } };
        },
      });
      const { unmount } = renderWithProviders(
        <ClassifyLineTaxAction document={document} documentId="INV-1" posted line={LINES[0]!} lines={LINES} taxRates={withSystem} />,
        { transport, initialSession: testAdminSession },
      );
      await waitFor(() => expect(policyServed).toBe(true));
      await act(async () => {
        await Promise.resolve();
      });
      fireEvent.click(screen.getByRole("button", { name: "تصنيف ضريبة البند «خدمة توصيل»" }));
      await screen.findByRole("dialog", { name: "تصنيف ضريبة البند" });
      fireEvent.click(screen.getByLabelText("الضريبة"));
      const options = screen.getAllByRole("option").map((o) => o.textContent);
      unmount();
      return options;
    };
    expect(await optionsFor(ClassifiableDocument.SalesInvoice, true)).not.toContain("غير خاضع · 0٪");
    expect(await optionsFor(ClassifiableDocument.PurchaseInvoice, true)).not.toContain("غير خاضع · 0٪");
    expect(await optionsFor(ClassifiableDocument.PurchaseInvoice, false)).not.toContain("غير خاضع · 0٪");
    expect(await optionsFor(ClassifiableDocument.SalesInvoice, false)).toContain("غير خاضع · 0٪");
  });

  it("says what became of a rejected e-receipt instead of closing silently", async () => {
    renderAction(LINES[0]!, {
      respond: () => ({ body: { documentId: "INV-1", documentNumber: "INV-000001", lineIds: ["L1"], taxRateId: "VAT-EXEMPT", taxRateName: "معفى من الضريبة", taxRatePercent: 0, journalLinesNamed: 1, filing: "reissue_refused", filingMessage: "لا يمكن إعادة إصدار الإيصال المرفوض بعد مرور 96 ساعة على إصداره." } }),
    });
    fireEvent.click(screen.getByRole("button", { name: /تصنيف ضريبة البند/ }));
    pick("معفى من الضريبة · 0٪");
    fireEvent.click(screen.getByRole("button", { name: "تصنيف" }));
    expect(await screen.findByText(/تعذّر إعادة إصدار الإيصال الإلكتروني المرفوض: لا يمكن إعادة إصدار الإيصال المرفوض بعد مرور 96 ساعة/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "تم" }));
    await waitFor(() => expect(screen.queryByText(/تعذّر إعادة إصدار/)).toBeNull());
  });

  it("says the reissue failed, in Arabic, and retries it from the same panel until it lands (finding 12)", async () => {
    const retried: string[] = [];
    let attempts = 0;
    const classified = { documentId: "INV-1", documentNumber: "INV-000001", lineIds: ["L1"], taxRateId: "VAT-EXEMPT", taxRateName: "معفى من الضريبة", taxRatePercent: 0, journalLinesNamed: 1 };
    const transport = stubTransport({
      "POST /sales-invoices/*/lines/*/classify-tax": () => ({ body: { ...classified, filing: "reissue_failed", filingMessage: "تعذّر الاتصال بجهاز الإيصالات." } }),
      "POST /sales-invoices/*/eta-receipt/retry": (_init, path) => {
        retried.push(path);
        attempts += 1;
        return attempts === 1
          ? { body: { documentId: "INV-1", filing: "reissue_failed", filingMessage: "تعذّر الاتصال بجهاز الإيصالات." } }
          : { body: { documentId: "INV-1", filing: "reissued" } };
      },
    });
    renderWithProviders(
      <ClassifyLineTaxAction document={ClassifiableDocument.SalesInvoice} documentId="INV-1" posted line={LINES[0]!} lines={LINES} taxRates={TAX_RATES} />,
      { transport, initialSession: testAdminSession },
    );
    fireEvent.click(screen.getByRole("button", { name: /تصنيف ضريبة البند/ }));
    pick("معفى من الضريبة · 0٪");
    fireEvent.click(screen.getByRole("button", { name: "تصنيف" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("لم يُصدر الإيصال الإلكتروني بعد التصنيف: تعذّر الاتصال بجهاز الإيصالات.");
    fireEvent.click(screen.getByRole("button", { name: "إعادة المحاولة" }));
    await waitFor(() => expect(retried).toHaveLength(1));
    expect(await screen.findByRole("alert")).toHaveTextContent("تعذّر الاتصال بجهاز الإيصالات.");
    fireEvent.click(screen.getByRole("button", { name: "إعادة المحاولة" }));
    expect(await screen.findByText(/أُعيد إصدار الإيصال الإلكتروني المرفوض بالتصنيف الجديد/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "إعادة المحاولة" })).toBeNull();
    expect(retried).toEqual(["/sales-invoices/INV-1/eta-receipt/retry", "/sales-invoices/INV-1/eta-receipt/retry"]);
  });

  it("says the e-receipt was issued when a retry issues it for the first time, and offers no further retry", async () => {
    const classified = { documentId: "INV-1", documentNumber: "INV-000001", lineIds: ["L1"], taxRateId: "VAT-EXEMPT", taxRateName: "معفى من الضريبة", taxRatePercent: 0, journalLinesNamed: 1 };
    const transport = stubTransport({
      "POST /sales-invoices/*/lines/*/classify-tax": () => ({ body: { ...classified, filing: "reissue_failed", filingMessage: "تعذّر الاتصال بجهاز الإيصالات." } }),
      "POST /sales-invoices/*/eta-receipt/retry": () => ({ body: { documentId: "INV-1", filing: "issued" } }),
    });
    renderWithProviders(
      <ClassifyLineTaxAction document={ClassifiableDocument.SalesInvoice} documentId="INV-1" posted line={LINES[0]!} lines={LINES} taxRates={TAX_RATES} />,
      { transport, initialSession: testAdminSession },
    );
    fireEvent.click(screen.getByRole("button", { name: /تصنيف ضريبة البند/ }));
    pick("معفى من الضريبة · 0٪");
    fireEvent.click(screen.getByRole("button", { name: "تصنيف" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("لم يُصدر الإيصال الإلكتروني بعد التصنيف");
    fireEvent.click(screen.getByRole("button", { name: "إعادة المحاولة" }));
    expect(await screen.findByText("صدر الإيصال الإلكتروني للفاتورة وهو في طابور الإرسال إلى المصلحة.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "إعادة المحاولة" })).toBeNull();
    expect(screen.queryByText(/لا يوجد إيصال ينتظر الإصدار/)).toBeNull();
  });

  it("keeps the failed-issue report and its retry on screen when the document reloads with the line now classified", async () => {
    const classified = { documentId: "INV-1", documentNumber: "INV-000001", lineIds: ["L1"], taxRateId: "VAT-EXEMPT", taxRateName: "معفى من الضريبة", taxRatePercent: 0, journalLinesNamed: 1 };
    const transport = stubTransport({
      "POST /sales-invoices/*/lines/*/classify-tax": () => ({ body: { ...classified, filing: "reissue_failed", filingMessage: "تعذّر الاتصال بجهاز الإيصالات." } }),
      "POST /sales-invoices/*/eta-receipt/retry": () => ({ body: { documentId: "INV-1", filing: "reissued" } }),
    });
    const action = (target: ClassifiableLine) => (
      <ClassifyLineTaxAction document={ClassifiableDocument.SalesInvoice} documentId="INV-1" posted line={target} lines={LINES} taxRates={TAX_RATES} />
    );
    const view = renderWithProviders(action(LINES[0]!), { transport, initialSession: testAdminSession });
    fireEvent.click(screen.getByRole("button", { name: /تصنيف ضريبة البند/ }));
    pick("معفى من الضريبة · 0٪");
    fireEvent.click(screen.getByRole("button", { name: "تصنيف" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("لم يُصدر الإيصال الإلكتروني بعد التصنيف");

    view.rerender(
      <AppProviders transport={transport} initialSession={testAdminSession}>
        <MemoryRouter>{action({ ...LINES[0]!, taxRateId: "VAT-EXEMPT" })}</MemoryRouter>
      </AppProviders>,
    );
    expect(screen.getByRole("alert")).toHaveTextContent("لم يُصدر الإيصال الإلكتروني بعد التصنيف");
    fireEvent.click(screen.getByRole("button", { name: "إعادة المحاولة" }));
    expect(await screen.findByText(/أُعيد إصدار الإيصال الإلكتروني المرفوض بالتصنيف الجديد/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "تم" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(screen.queryByRole("button", { name: /تصنيف ضريبة البند/ })).toBeNull();
  });

  it("tells a tenant with no 0% rate of its own to create one, and offers the Tax Rates screen to whoever may manage them", async () => {
    renderWithProviders(
      <ClassifyLineTaxAction document={ClassifiableDocument.SalesInvoice} documentId="INV-1" posted line={LINES[0]!} lines={LINES} taxRates={TAX_RATES.filter((rate) => rate.rate !== 0)} />,
      { transport: stubTransport({ "GET /tax-rates/policy": () => ({ body: { vatEnabled: true } }) }), initialSession: testAdminSession },
    );
    fireEvent.click(screen.getByRole("button", { name: /تصنيف ضريبة البند/ }));
    expect(await screen.findByText(/أنشئ ضريبة بنسبة 0٪ بتصنيف «غير خاضع»/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "فتح شاشة الضرائب" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "تصنيف" })).toBeDisabled();
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
