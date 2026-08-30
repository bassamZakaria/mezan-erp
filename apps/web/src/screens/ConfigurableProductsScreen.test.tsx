// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, expect, it } from "vitest";
import { useState, type ReactNode } from "react";
import { screen, fireEvent, within } from "@testing-library/react";
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
    expect(await screen.findByText("تعذّر تحميل المنتجات القابلة للتهيئة.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "إعادة المحاولة" })).toBeInTheDocument();
  });
});
