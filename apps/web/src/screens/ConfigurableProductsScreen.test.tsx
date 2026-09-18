// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, expect, it } from "vitest";
import { useState, type ReactNode } from "react";
import { screen, fireEvent, waitFor, within } from "@testing-library/react";
import type { ItemDTO } from "@mezan/contracts";
import { ConfigurableProductsScreen } from "./ConfigurableProductsScreen";
import { renderWithProviders, stubTransport, testAdminSession } from "../data/test-support";
import type { ConfigurableProductRecord } from "../data/hooks";
import { NavigationProvider } from "../navigation";

/**
 * The "new configurable product" view is a sub-page addressed via the shell's
 * `useSubPage` (navigation.tsx), which no-ops outside a real `NavigationProvider`.
 * This stands in for the shell's URL-driven one with in-memory segments — enough
 * for the screen under test to open and read its own sub-page.
 */
function TestNavigation({ children }: { children: ReactNode }) {
  const [segments, setSegments] = useState<readonly string[]>([]);
  return (
    <NavigationProvider
      value={{
        navigate: () => {},
        segments,
        openSubPage: setSegments,
        openScreenAt: () => {},
        intent: null,
        clearIntent: () => {},
      }}
    >
      {children}
    </NavigationProvider>
  );
}

/** Type into an EntityPicker combobox and pick the matching option — selection
 * fires on `onMouseDown` (not `click`), so the input's blur never wins the race. */
function pickFromCombobox(container: HTMLElement, label: string, optionLabel: string) {
  const input = within(container).getByLabelText(label);
  fireEvent.focus(input);
  fireEvent.change(input, { target: { value: optionLabel } });
  const option = within(container).getByRole("button", { name: (accessibleName) => accessibleName.startsWith(optionLabel) });
  fireEvent.mouseDown(option);
}

/**
 * `TextField`/`NumberField` (settings/form-controls.tsx) render a `<label>`
 * that is never associated with its input via `for`/`id` — only `SelectField`
 * and `EntityPicker` wire that up. `getByLabelText` can't find these fields,
 * so fall back to the DOM structure the shared `Field` wrapper always uses: a
 * `<label>` immediately followed by its control in the same wrapper `<div>`.
 */
function textFieldInput(container: HTMLElement, labelText: string): HTMLInputElement {
  const label = within(container).getByText(labelText, { selector: "label" });
  const input = label.parentElement?.querySelector<HTMLInputElement>("input, textarea");
  if (!input) throw new Error(`No input control found next to label "${labelText}"`);
  return input;
}

function item(overrides: Partial<ItemDTO> = {}): ItemDTO {
  return {
    id: "item-glass",
    code: "ITM-1",
    nameAr: "زجاج (م²)",
    nameEn: null,
    type: "stock",
    baseUnitCode: "M2",
    alternateUnits: [],
    barcodes: [],
    categoryId: null,
    brandId: null, seasonId: null, description: null, defaultSupplierId: null, specifications: [],
    costingMethod: "WAC",
    salePrice: null,
    costPrice: "85.00",
    taxRatePercent: 0,
    trackInventory: true,
    trackBatches: false,
    trackExpiry: false,
    reorderPoint: null,
    imageAttachmentId: null,
    reorderQty: null,
    revenueAccountId: null,
    cogsAccountId: null,
    inventoryAccountId: null,
    etaCodeType: null,
    etaItemCode: null,
    gpcCode: null,
    status: "active",
    ...overrides,
  };
}

const items: ItemDTO[] = [item(), item({ id: "item-window", code: "ITM-2", nameAr: "نافذة مخصصة", baseUnitCode: "PCS", costPrice: null })];

function product(overrides: Partial<ConfigurableProductRecord> = {}): ConfigurableProductRecord {
  return {
    id: "cp-1",
    code: "WINDOW",
    nameAr: "نافذة قابلة للتهيئة",
    nameEn: "Configurable window",
    outputItemId: "item-window",
    unit: "PCS",
    description: null,
    inputs: [{ id: "width", labelAr: "العرض", labelEn: null, type: "number", min: 30, max: 300 }],
    materials: [{ itemId: "item-glass", qtyFormula: "width/100", wastePercent: 5 }],
    pricingMethod: "manual",
    priceFormula: null,
    laborFormula: null,
    overheadFormula: null,
    itemPolicy: "per_spec",
    status: "active",
    createdBy: "محمد الشهابي",
    createdAt: "2026-07-01T08:00:00.000Z",
    ...overrides,
  };
}

function renderScreen(products: ConfigurableProductRecord[] = [product()]) {
  let current = [...products];
  const transport = stubTransport({
    "GET /manufacturing/configurable-products": () => ({ body: current }),
    "GET /items": () => ({ body: items }),
    "POST /manufacturing/configurable-products": (init) => {
      const body = JSON.parse((init?.body as string) ?? "{}");
      const created: ConfigurableProductRecord = {
        id: body.id,
        code: body.code,
        nameAr: body.nameAr,
        nameEn: body.nameEn,
        outputItemId: body.outputItemId,
        unit: body.unit,
        description: body.description,
        inputs: body.inputs,
        materials: body.materials,
        pricingMethod: body.pricingMethod ?? "manual",
        priceFormula: body.priceFormula ?? null,
        laborFormula: body.laborFormula ?? null,
        overheadFormula: body.overheadFormula ?? null,
        itemPolicy: body.itemPolicy ?? "per_order",
        status: "active",
        createdBy: "USER-ADMIN",
        createdAt: "2026-08-21T00:00:00.000Z",
      };
      current = [...current, created];
      return { status: 201, body: created };
    },
    "POST /manufacturing/configurable-products/*/deactivate": (_init, path) => {
      const id = path.split("/").at(-2);
      const target = current.find((p) => p.id === id);
      if (!target) return { status: 404, body: { error: "NOT_FOUND" } };
      const updated: ConfigurableProductRecord = { ...target, status: "inactive" };
      current = current.map((p) => (p.id === id ? updated : p));
      return { body: updated };
    },
  });
  return renderWithProviders(
    <TestNavigation>
      <ConfigurableProductsScreen />
    </TestNavigation>,
    { transport, initialSession: testAdminSession },
  );
}

describe("ConfigurableProductsScreen", () => {
  it("shows an empty state when there are no configurable products yet", async () => {
    renderScreen([]);
    expect(screen.getByRole("heading", { name: "المنتجات القابلة للتهيئة" })).toBeInTheDocument();
    expect(await screen.findByText("لا توجد منتجات قابلة للتهيئة مطابقة — أضف منتجاً جديداً")).toBeInTheDocument();
  });

  it("lists configurable products from the real backend", async () => {
    renderScreen();
    expect(await screen.findByText("نافذة قابلة للتهيئة")).toBeInTheDocument();
    expect(screen.getByText("WINDOW")).toBeInTheDocument();
  });

  /**
   * Regression guard: the list column used to join multiple input labels with
   * `t("common.notes")` ("ملاحظات") instead of a real separator, rendering
   * "وزن الشاي (كجم)ملاحظاتوزن السكر (كجم)". Fixed by joining with
   * `configProducts.inputLabelSeparator` ("، ").
   */
  it("separates multiple configuration-input labels with a real separator, not «ملاحظات»", async () => {
    renderScreen([
      product({
        inputs: [
          { id: "tea", labelAr: "وزن الشاي (كجم)", labelEn: null, type: "number", min: null, max: null },
          { id: "sugar", labelAr: "وزن السكر (كجم)", labelEn: null, type: "number", min: null, max: null },
        ],
      }),
    ]);
    expect(await screen.findByText("وزن الشاي (كجم)، وزن السكر (كجم)")).toBeInTheDocument();
  });

  it("adds a new configurable product through the create sub-page and round-trips through the stubbed transport", async () => {
    renderScreen();
    await screen.findByText("نافذة قابلة للتهيئة");
    fireEvent.click(screen.getByRole("button", { name: "إضافة منتج قابل للتهيئة" }));

    await screen.findByRole("heading", { name: "منتج قابل للتهيئة جديد" });
    const page = document.body;
    fireEvent.change(textFieldInput(page, "الكود *"), { target: { value: "DOOR" } });
    fireEvent.change(textFieldInput(page, "الاسم بالعربية *"), { target: { value: "باب قابل للتهيئة" } });
    pickFromCombobox(page, "المنتج الناتج *", "نافذة مخصصة");
    fireEvent.change(textFieldInput(page, "المعرف (للمعادلات)"), { target: { value: "width" } });
    fireEvent.change(textFieldInput(page, "التسمية"), { target: { value: "العرض" } });
    pickFromCombobox(page, "الصنف", "زجاج (م²)");
    fireEvent.change(textFieldInput(page, "معادلة الكمية"), { target: { value: "width/100" } });

    fireEvent.click(screen.getByRole("button", { name: "حفظ" }));

    expect(await screen.findByText("باب قابل للتهيئة")).toBeInTheDocument();
  });

  it("opens the product detail and deactivates it from there", async () => {
    renderScreen();
    fireEvent.click(await screen.findByText("نافذة قابلة للتهيئة"));

    expect(screen.getByText("نشط")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "تعطيل" }));
    expect(await screen.findByText("غير نشط")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "رجوع للمنتجات القابلة للتهيئة" }));
    expect(await screen.findByRole("heading", { name: "المنتجات القابلة للتهيئة" })).toBeInTheDocument();
  });

  it("reports failure — not a false success — when deactivating from the row menu is refused by the server", async () => {
    const transport = stubTransport({
      "GET /manufacturing/configurable-products": () => ({ body: [product()] }),
      "GET /items": () => ({ body: items }),
      "POST /manufacturing/configurable-products/cp-1/deactivate": () => ({ status: 409, body: { error: "IN_USE", message: "لا يمكن تعطيل منتج له أوامر تصنيع مخصص مفتوحة" } }),
    });
    renderWithProviders(
      <TestNavigation>
        <ConfigurableProductsScreen />
      </TestNavigation>,
      { transport, initialSession: testAdminSession },
    );
    await screen.findByText("نافذة قابلة للتهيئة");
    fireEvent.click(screen.getByRole("button", { name: "إجراءات نافذة قابلة للتهيئة" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "تعطيل" }));
    // «تعطيل» is destructive (tone: danger), so RowMenu asks for confirmation first.
    const confirmDialog = screen.getByRole("dialog", { name: /تأكيد/ });
    fireEvent.click(within(confirmDialog).getByRole("button", { name: "تعطيل" }));

    // Two independent surfaces must both report the failure: the row menu's
    // own toast (generic "«action» could not be completed"), and the screen's
    // own actionError banner with the server's exact message.
    await screen.findByText("لا يمكن تعطيل منتج له أوامر تصنيع مخصص مفتوحة");
    const alerts = screen.getAllByRole("alert");
    expect(alerts.some((el) => el.textContent?.includes("تعذّر تنفيذ"))).toBe(true);
    expect(screen.queryByRole("status", { name: /تم تنفيذ/ })).not.toBeInTheDocument();
    const row = screen.getByText("نافذة قابلة للتهيئة").closest("tr");
    expect(row).not.toBeNull();
    expect(within(row!).getByText("نشط")).toBeInTheDocument();
  });

  it("shows an error banner with a retry action when configurable products fail to load", async () => {
    const transport = stubTransport({
      "GET /manufacturing/configurable-products": () => ({ status: 500, body: { error: "INTERNAL" } }),
      "GET /items": () => ({ body: items }),
    });
    renderWithProviders(
      <TestNavigation>
        <ConfigurableProductsScreen />
      </TestNavigation>,
      { transport, initialSession: testAdminSession },
    );
    expect(await screen.findByText("تعذّر تحميل المنتجات القابلة للتهيئة. (رمز 500)")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "إعادة المحاولة" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "إعادة المحاولة" }));
  });

  it("adds and removes input/material rows, and only sends the rows the operator actually filled in", async () => {
    let createdBody: Record<string, unknown> | null = null;
    const transport = stubTransport({
      "GET /manufacturing/configurable-products": () => ({ body: [] }),
      "GET /items": () => ({ body: items }),
      "POST /manufacturing/configurable-products": (init) => {
        createdBody = JSON.parse((init?.body as string) ?? "{}");
        return { status: 201, body: { ...product(), id: "cp-2", code: "DOOR" } };
      },
    });
    renderWithProviders(
      <TestNavigation>
        <ConfigurableProductsScreen />
      </TestNavigation>,
      { transport, initialSession: testAdminSession },
    );
    fireEvent.click(await screen.findByRole("button", { name: "إضافة منتج قابل للتهيئة" }));
    await screen.findByRole("heading", { name: "منتج قابل للتهيئة جديد" });
    const page = document.body;

    fireEvent.change(textFieldInput(page, "الكود *"), { target: { value: "DOOR" } });
    fireEvent.change(textFieldInput(page, "الاسم بالعربية *"), { target: { value: "باب قابل للتهيئة" } });
    pickFromCombobox(page, "المنتج الناتج *", "نافذة مخصصة");

    // Two input rows; only the second gets filled in.
    fireEvent.click(screen.getByRole("button", { name: "إضافة مدخل" }));
    const idFields = screen.getAllByText("المعرف (للمعادلات)", { selector: "label" });
    expect(idFields).toHaveLength(2);
    const secondIdInput = idFields[1]!.parentElement!.querySelector("input")!;
    const secondLabelInput = screen.getAllByText("التسمية", { selector: "label" })[1]!.parentElement!.querySelector("input")!;
    fireEvent.change(secondIdInput, { target: { value: "height" } });
    fireEvent.change(secondLabelInput, { target: { value: "الارتفاع" } });
    // Remove the first (blank) input row — only the filled one must remain.
    fireEvent.click(screen.getAllByRole("button", { name: "حذف المدخل" })[0]!);
    expect(screen.getAllByText("المعرف (للمعادلات)", { selector: "label" })).toHaveLength(1);

    // Materials: fill the first row, add a second, then remove the second.
    pickFromCombobox(page, "الصنف", "زجاج (م²)");
    fireEvent.change(textFieldInput(page, "معادلة الكمية"), { target: { value: "height/100" } });
    fireEvent.change(textFieldInput(page, "نسبة الهالك %"), { target: { value: "8" } });
    fireEvent.click(screen.getByRole("button", { name: "إضافة خامة" }));
    expect(screen.getAllByText("معادلة الكمية", { selector: "label" })).toHaveLength(2);
    // Row 0 is the one already filled in — remove the blank row 1 instead.
    fireEvent.click(screen.getAllByRole("button", { name: "حذف الخامة" })[1]!);
    expect(screen.getAllByText("معادلة الكمية", { selector: "label" })).toHaveLength(1);

    fireEvent.click(screen.getByRole("button", { name: "حفظ" }));
    await waitFor(() => expect(createdBody).not.toBeNull());
    expect(createdBody).toMatchObject({
      code: "DOOR",
      inputs: [{ id: "height", labelAr: "الارتفاع", min: null, max: null }],
      materials: [{ itemId: "item-glass", qtyFormula: "height/100", wastePercent: 8 }],
    });
  });

  it("requires a price formula only once pricing is switched to formula, and sends it exactly", async () => {
    let createdBody: Record<string, unknown> | null = null;
    const transport = stubTransport({
      "GET /manufacturing/configurable-products": () => ({ body: [] }),
      "GET /items": () => ({ body: items }),
      "POST /manufacturing/configurable-products": (init) => {
        createdBody = JSON.parse((init?.body as string) ?? "{}");
        return { status: 201, body: { ...product(), id: "cp-2" } };
      },
    });
    renderWithProviders(
      <TestNavigation>
        <ConfigurableProductsScreen />
      </TestNavigation>,
      { transport, initialSession: testAdminSession },
    );
    fireEvent.click(await screen.findByRole("button", { name: "إضافة منتج قابل للتهيئة" }));
    await screen.findByRole("heading", { name: "منتج قابل للتهيئة جديد" });
    const page = document.body;
    fireEvent.change(textFieldInput(page, "الكود *"), { target: { value: "DOOR" } });
    fireEvent.change(textFieldInput(page, "الاسم بالعربية *"), { target: { value: "باب قابل للتهيئة" } });
    pickFromCombobox(page, "المنتج الناتج *", "نافذة مخصصة");
    fireEvent.change(textFieldInput(page, "المعرف (للمعادلات)"), { target: { value: "width" } });
    fireEvent.change(textFieldInput(page, "التسمية"), { target: { value: "العرض" } });
    pickFromCombobox(page, "الصنف", "زجاج (م²)");
    fireEvent.change(textFieldInput(page, "معادلة الكمية"), { target: { value: "width/100" } });

    const save = screen.getByRole("button", { name: "حفظ" });
    expect(screen.queryByText("معادلة السعر (للوحدة) *")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("combobox", { name: "طريقة التسعير" }));
    fireEvent.mouseDown(screen.getByRole("option", { name: "معادلة" }));
    expect(save).toBeDisabled();

    fireEvent.change(textFieldInput(page, "معادلة السعر (للوحدة) *"), { target: { value: "width*height*3.5/100" } });
    expect(save).toBeEnabled();
    fireEvent.click(save);

    await waitFor(() => expect(createdBody).not.toBeNull());
    expect(createdBody).toMatchObject({ pricingMethod: "formula", priceFormula: "width*height*3.5/100" });
  });

  it("filters by status and search, opens the detail from the row menu's «عرض», and rows-per-page is wired through", async () => {
    const inactive = product({ id: "cp-2", code: "DOOR", nameAr: "باب قابل للتهيئة", status: "inactive" });
    renderScreen([product(), inactive]);
    await screen.findByText("نافذة قابلة للتهيئة");

    fireEvent.click(screen.getByRole("tab", { name: /غير نشط/ }));
    expect(await screen.findByText("باب قابل للتهيئة")).toBeInTheDocument();
    // Wait for the active row to LEAVE rather than assuming it already has: the
    // filtered row appearing and the unfiltered one being dropped are two
    // renders, so asserting the removal the instant the other row shows up is a
    // race — green in isolation, red under the full run's scheduler pressure.
    await waitFor(() => expect(screen.queryByText("نافذة قابلة للتهيئة")).not.toBeInTheDocument());

    fireEvent.click(screen.getByRole("tab", { name: /الكل/ }));
    await screen.findByText("نافذة قابلة للتهيئة");
    fireEvent.change(screen.getByPlaceholderText("بحث بالكود أو الاسم…"), { target: { value: "DOOR" } });
    await waitFor(() => expect(screen.queryByText("نافذة قابلة للتهيئة")).not.toBeInTheDocument());
    expect(screen.getByText("باب قابل للتهيئة")).toBeInTheDocument();
    fireEvent.change(screen.getByPlaceholderText("بحث بالكود أو الاسم…"), { target: { value: "" } });
    await screen.findByText("نافذة قابلة للتهيئة");

    fireEvent.click(screen.getByRole("button", { name: "إجراءات نافذة قابلة للتهيئة" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "عرض" }));
    expect(await screen.findByRole("heading", { name: /نافذة قابلة للتهيئة/ })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "رجوع للمنتجات القابلة للتهيئة" }));

    await screen.findByText("نافذة قابلة للتهيئة");
    fireEvent.click(screen.getByRole("combobox", { name: "صفوف لكل صفحة" }));
    fireEvent.mouseDown(await screen.findByRole("option", { name: "50" }));
    await waitFor(() => expect(screen.getByRole("combobox", { name: "صفوف لكل صفحة" })).toHaveTextContent("50"));
  });
});
