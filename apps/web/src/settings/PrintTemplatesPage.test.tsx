// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, expect, it } from "vitest";
import { screen, fireEvent, waitFor, within } from "@testing-library/react";
import { DEFAULT_PRINT_TEMPLATE_CONFIG, type PrintTemplateConfig } from "@mezan/ui";
import { renderWithProviders, stubTransport, testAdminSession } from "../data/test-support";
import { PrintTemplatesPage } from "./PrintTemplatesPage";

/** `TextField`/`NumberField` render a plain `<label>`, so `getByLabelText` cannot find their
 * `<input>` — locate it by DOM adjacency instead (form-controls.tsx's label-then-control layout). */
function textboxByLabel(label: string, container: HTMLElement = document.body): HTMLInputElement {
  const labelNode = within(container).getByText(label);
  const input = labelNode.parentElement?.querySelector("input, textarea");
  if (!input) throw new Error(`no text input associated with label "${label}"`);
  return input as HTMLInputElement;
}

function selectOption(comboboxLabel: string, optionLabel: string): void {
  fireEvent.click(screen.getByRole("combobox", { name: comboboxLabel }));
  fireEvent.mouseDown(screen.getByRole("option", { name: optionLabel }));
}

function renderPage(overrides?: Partial<PrintTemplateConfig>) {
  let saved: PrintTemplateConfig | null = null;
  const config = { ...DEFAULT_PRINT_TEMPLATE_CONFIG, ...overrides };
  const transport = stubTransport({
    "GET /print-template-config": () => ({ body: config }),
    "PUT /print-template-config": (init) => {
      saved = JSON.parse(init?.body as string);
      return { body: saved };
    },
  });
  const result = renderWithProviders(<PrintTemplatesPage />, { transport, initialSession: testAdminSession });
  return { ...result, getSaved: () => saved };
}

describe("PrintTemplatesPage", () => {
  it("loads the saved config, renders the live preview with a real amount-in-words, and shows every one of the 9 tabs", async () => {
    const transport = stubTransport({
      "GET /print-template-config": () => ({ body: DEFAULT_PRINT_TEMPLATE_CONFIG }),
    });
    renderWithProviders(<PrintTemplatesPage />, { transport, initialSession: testAdminSession });

    await waitFor(() => expect(screen.getByText("فاتورة مبيعات")).toBeInTheDocument());
    expect(screen.getByRole("heading", { name: "قوالب الطباعة" })).toBeInTheDocument();
    expect(screen.getByText("INV-000123")).toBeInTheDocument();
    expect(
      screen.getByText("ألف ومائة وتسعة وخمسون جنيه مصري وخمسة وتسعون قرش فقط لا غير"),
    ).toBeInTheDocument();

    for (const label of ["الهوية", "الترويسة", "المحتوى", "أعمدة الأصناف", "الإجماليات", "التذييل", "العلامة المائية", "إيصال نقطة البيع", "تخصيص حسب الوثيقة"]) {
      expect(screen.getByRole("tab", { name: label })).toBeInTheDocument();
    }
  });

  it("toggling a field marks the page dirty and PUTs the full config on save", async () => {
    let saved: unknown = null;
    const transport = stubTransport({
      "GET /print-template-config": () => ({ body: DEFAULT_PRINT_TEMPLATE_CONFIG }),
      "PUT /print-template-config": (init) => {
        saved = JSON.parse(init?.body as string);
        return { body: saved };
      },
    });
    renderWithProviders(<PrintTemplatesPage />, { transport, initialSession: testAdminSession });
    await waitFor(() => expect(screen.getByText("فاتورة مبيعات")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("tab", { name: "الترويسة" }));
    fireEvent.click(screen.getByRole("switch", { name: "العنوان" }));
    expect(screen.getByText("تغييرات غير محفوظة")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "حفظ القالب" }));
    await waitFor(() => expect(saved).not.toBeNull());
    expect((saved as { header: { showAddress: boolean } }).header.showAddress).toBe(false);
    await waitFor(() => expect(screen.queryByText("تغييرات غير محفوظة")).not.toBeInTheDocument());
  });

  it("switching tabs preserves an unsaved edit on the tab you left, and saving carries that tab's field through while every other section keeps its default", async () => {
    const { getSaved } = renderPage();
    await screen.findByText("فاتورة مبيعات");

    fireEvent.click(screen.getByRole("tab", { name: "الهوية" }));
    fireEvent.change(textboxByLabel("رابط الشعار"), { target: { value: "https://cyag.example/logo.png" } });

    // Leave for another tab, then a third, then come back — the identity
    // edit must still be in the field, not reset by the intervening renders.
    fireEvent.click(screen.getByRole("tab", { name: "الترويسة" }));
    fireEvent.click(screen.getByRole("tab", { name: "الإجماليات" }));
    fireEvent.click(screen.getByRole("tab", { name: "الهوية" }));
    expect(textboxByLabel("رابط الشعار")).toHaveValue("https://cyag.example/logo.png");

    fireEvent.click(screen.getByRole("button", { name: "حفظ القالب" }));
    await waitFor(() => expect(getSaved()).not.toBeNull());
    const saved = getSaved()!;
    expect(saved.identity.logoUrl).toBe("https://cyag.example/logo.png");
    // Nothing on the other 8 tabs moved just from visiting them.
    expect(saved.header).toEqual(DEFAULT_PRINT_TEMPLATE_CONFIG.header);
    expect(saved.totals).toEqual(DEFAULT_PRINT_TEMPLATE_CONFIG.totals);
    expect(saved.columns).toEqual(DEFAULT_PRINT_TEMPLATE_CONFIG.columns);
  });

  it("drives every field on الهوية (identity) — text, both selects and the shared colour field — and PUTs the exact values", async () => {
    const { getSaved } = renderPage();
    await screen.findByText("فاتورة مبيعات");
    fireEvent.click(screen.getByRole("tab", { name: "الهوية" }));

    fireEvent.change(textboxByLabel("رابط الشعار"), { target: { value: "https://cyag.example/logo.png" } });
    selectOption("موضع الشعار", "الوسط");
    selectOption("حجم الشعار", "كبير");
    // The colour field has TWO inputs (a native colour swatch and a text
    // input) bound to the SAME value — take the text one specifically.
    const colourInputs = screen.getAllByDisplayValue("#1f2937");
    const colourText = colourInputs.find((el) => (el as HTMLInputElement).type === "text")!;
    fireEvent.change(colourText, { target: { value: "#0f766e" } });
    fireEvent.change(textboxByLabel("الوصف الفرعي (Tagline)"), { target: { value: "خدمات محاسبية" } });
    selectOption("مقاس الصفحة", "A5");

    fireEvent.click(screen.getByRole("button", { name: "حفظ القالب" }));
    await waitFor(() => expect(getSaved()).not.toBeNull());
    const saved = getSaved()!;
    expect(saved.identity.logoUrl).toBe("https://cyag.example/logo.png");
    expect(saved.identity.logoPosition).toBe("center");
    expect(saved.identity.logoSize).toBe("large");
    expect(saved.identity.primaryColor).toBe("#0f766e");
    expect(saved.identity.subtitle).toBe("خدمات محاسبية");
    expect(saved.pageSize).toBe("A5");
  });

  it("drives every toggle on المحتوى، أعمدة الأصناف والإجماليات and PUTs the exact resulting flags", async () => {
    const { getSaved } = renderPage();
    await screen.findByText("فاتورة مبيعات");

    fireEvent.click(screen.getByRole("tab", { name: "المحتوى" }));
    fireEvent.click(screen.getByRole("switch", { name: "اسم الفرع" }));
    fireEvent.click(screen.getByRole("switch", { name: "اسم المستودع" }));
    fireEvent.click(screen.getByRole("switch", { name: "الرقم الضريبي للعميل/المورد" }));
    fireEvent.click(screen.getByRole("switch", { name: "شروط الدفع" }));
    fireEvent.click(screen.getByRole("switch", { name: "ملاحظات" }));

    fireEvent.click(screen.getByRole("tab", { name: "أعمدة الأصناف" }));
    fireEvent.click(screen.getByRole("switch", { name: "كود الصنف" }));
    fireEvent.click(screen.getByRole("switch", { name: "الوحدة" }));
    fireEvent.click(screen.getByRole("switch", { name: "الوصف" }));

    fireEvent.click(screen.getByRole("tab", { name: "الإجماليات" }));
    fireEvent.click(screen.getByRole("switch", { name: "المجموع الفرعي" }));
    fireEvent.click(screen.getByRole("switch", { name: "كتابة المبلغ بالحروف" }));

    fireEvent.click(screen.getByRole("button", { name: "حفظ القالب" }));
    await waitFor(() => expect(getSaved()).not.toBeNull());
    const saved = getSaved()!;
    expect(saved.content).toEqual({
      showBranchName: false,
      showWarehouseName: true,
      showPartyTaxNumber: false,
      showPaymentTerms: false,
      showNotes: false,
    });
    expect(saved.columns).toEqual({
      showItemCode: true,
      showUnit: false,
      showDescription: false,
      showLineDiscount: true,
      showLineTaxPercent: false,
      showLineTaxAmount: false,
    });
    expect(saved.totals).toEqual({
      showSubtotal: false,
      showTotalDiscount: true,
      showTaxBreakdown: true,
      showAmountInWords: false,
    });
  });

  it("footer: raising the signature count reveals new (empty) label fields, editing one, and lowering the count drops the extra labels — the surviving one is untouched", async () => {
    const { getSaved } = renderPage();
    await screen.findByText("فاتورة مبيعات");
    fireEvent.click(screen.getByRole("tab", { name: "التذييل" }));

    fireEvent.change(textboxByLabel("نص التذييل"), { target: { value: "شكراً لتعاملكم معنا" } });
    expect(screen.getByRole("switch", { name: "إظهار التوقيعات" })).toBeChecked();

    // Default is 2 signatures ("أعده", "اعتمده") — raise to 3.
    fireEvent.change(textboxByLabel("عدد التوقيعات"), { target: { value: "3" } });
    expect(textboxByLabel("تسمية التوقيع 1")).toHaveValue("أعده");
    expect(textboxByLabel("تسمية التوقيع 2")).toHaveValue("اعتمده");
    expect(textboxByLabel("تسمية التوقيع 3")).toHaveValue("");
    fireEvent.change(textboxByLabel("تسمية التوقيع 3"), { target: { value: "استلمه" } });

    // Now drop to 1 — the second and third labels must not survive.
    fireEvent.change(textboxByLabel("عدد التوقيعات"), { target: { value: "1" } });
    expect(screen.queryByText("تسمية التوقيع 2")).not.toBeInTheDocument();
    expect(textboxByLabel("تسمية التوقيع 1")).toHaveValue("أعده");

    fireEvent.click(screen.getByRole("button", { name: "حفظ القالب" }));
    await waitFor(() => expect(getSaved()).not.toBeNull());
    const saved = getSaved()!;
    expect(saved.footer.text).toBe("شكراً لتعاملكم معنا");
    expect(saved.footer.signatureCount).toBe(1);
    expect(saved.footer.signatureLabels).toEqual(["أعده"]);
  });

  it("watermark: text and opacity save exactly, and the POS-receipt tab's toggles and thank-you text save independently", async () => {
    const { getSaved } = renderPage();
    await screen.findByText("فاتورة مبيعات");

    fireEvent.click(screen.getByRole("tab", { name: "العلامة المائية" }));
    fireEvent.change(textboxByLabel("نص العلامة المائية"), { target: { value: "مسودة" } });
    fireEvent.change(textboxByLabel("الشفافية (0-1)"), { target: { value: "0.25" } });

    fireEvent.click(screen.getByRole("tab", { name: "إيصال نقطة البيع" }));
    fireEvent.click(screen.getByRole("switch", { name: "إظهار عنوان المستند" }));
    fireEvent.click(screen.getByRole("switch", { name: "إظهار اسم العميل" }));
    fireEvent.change(textboxByLabel("نص الشكر"), { target: { value: "نتشرف بزيارتكم مجدداً" } });

    fireEvent.click(screen.getByRole("button", { name: "حفظ القالب" }));
    await waitFor(() => expect(getSaved()).not.toBeNull());
    const saved = getSaved()!;
    expect(saved.watermark.text).toBe("مسودة");
    expect(saved.watermark.opacity).toBe(0.25);
    expect(saved.posReceipt.showTitle).toBe(false);
    expect(saved.posReceipt.showCustomerName).toBe(true);
    expect(saved.posReceipt.showTaxNumber).toBe(true);
    expect(saved.posReceipt.thankYouText).toBe("نتشرف بزيارتكم مجدداً");
  });

  it("per-document overrides: setting a tri-state field for one document type does not leak into another, and 'default' clears the override key entirely", async () => {
    const { getSaved } = renderPage();
    await screen.findByText("فاتورة مبيعات");
    fireEvent.click(screen.getByRole("tab", { name: "تخصيص حسب الوثيقة" }));

    // Default document type is فاتورة مبيعات (SALES_INVOICE) — hide the address.
    selectOption("نوع المستند", "فاتورة مبيعات");
    selectOption("العنوان", "إخفاء");

    // Switch to a different document type — its override must start clean (لم يُخصص).
    selectOption("نوع المستند", "فاتورة مشتريات");
    expect(screen.getByRole("combobox", { name: "العنوان" })).toHaveTextContent("افتراضي (بدون تخصيص)");
    selectOption("العنوان", "إظهار");

    fireEvent.click(screen.getByRole("button", { name: "حفظ القالب" }));
    await waitFor(() => expect(getSaved()).not.toBeNull());
    const saved = getSaved()!;
    expect(saved.perDocumentOverrides.SALES_INVOICE?.header?.showAddress).toBe(false);
    expect(saved.perDocumentOverrides.PURCHASE_INVOICE?.header?.showAddress).toBe(true);

    // Now return SALES_INVOICE's override to "default" — the key is deleted,
    // not left behind as `{ showAddress: undefined }`.
    selectOption("نوع المستند", "فاتورة مبيعات");
    selectOption("العنوان", "افتراضي (بدون تخصيص)");
    fireEvent.click(screen.getByRole("button", { name: "حفظ القالب" }));
    await waitFor(() => expect(getSaved()!.perDocumentOverrides.SALES_INVOICE?.header?.showAddress).toBeUndefined());
    expect(Object.prototype.hasOwnProperty.call(getSaved()!.perDocumentOverrides.SALES_INVOICE?.header ?? {}, "showAddress")).toBe(false);
  });

  it("discard reverts every unsaved edit back to the loaded config and clears the dirty flag — nothing is sent to the server", async () => {
    let putCalled = false;
    const transport = stubTransport({
      "GET /print-template-config": () => ({ body: DEFAULT_PRINT_TEMPLATE_CONFIG }),
      "PUT /print-template-config": () => {
        putCalled = true;
        return { body: DEFAULT_PRINT_TEMPLATE_CONFIG };
      },
    });
    renderWithProviders(<PrintTemplatesPage />, { transport, initialSession: testAdminSession });
    await screen.findByText("فاتورة مبيعات");

    fireEvent.click(screen.getByRole("tab", { name: "الهوية" }));
    fireEvent.change(textboxByLabel("رابط الشعار"), { target: { value: "https://discard-me.example/x.png" } });
    expect(screen.getByText("تغييرات غير محفوظة")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "تراجع" }));
    expect(screen.queryByText("تغييرات غير محفوظة")).not.toBeInTheDocument();
    expect(textboxByLabel("رابط الشعار")).toHaveValue("");
    expect(putCalled).toBe(false);
  });

  it("shows the loading state while the config is still fetching, and the Arabic error copy when it fails", async () => {
    const loadingTransport = stubTransport({ "GET /print-template-config": () => new Promise(() => {}) as never });
    renderWithProviders(<PrintTemplatesPage />, { transport: loadingTransport, initialSession: testAdminSession });
    expect(screen.getByText("جارِ تحميل قالب الطباعة…")).toBeInTheDocument();

    const errorTransport = stubTransport({ "GET /print-template-config": () => ({ status: 500, body: { error: "INTERNAL" } }) });
    renderWithProviders(<PrintTemplatesPage />, { transport: errorTransport, initialSession: testAdminSession });
    expect(await screen.findByText(/تعذّر تحميل قالب الطباعة\./)).toBeInTheDocument();
  });
});
