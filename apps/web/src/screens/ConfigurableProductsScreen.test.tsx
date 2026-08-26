// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, expect, it } from "vitest";
import { screen, fireEvent, within } from "@testing-library/react";
import type { ItemDTO } from "@mezan/contracts";
import { ConfigurableProductsScreen } from "./ConfigurableProductsScreen";
import { renderWithProviders, stubTransport, testAdminSession } from "../data/test-support";
import type { ConfigurableProductRecord } from "../data/hooks";

/** Type into an EntityPicker combobox and pick the matching option — selection
 * fires on `onMouseDown` (not `click`), so the input's blur never wins the race. */
function pickFromCombobox(dialog: HTMLElement, label: string, optionLabel: string) {
  const input = within(dialog).getByLabelText(label);
  fireEvent.focus(input);
  fireEvent.change(input, { target: { value: optionLabel } });
  const option = within(dialog).getByRole("button", { name: (accessibleName) => accessibleName.startsWith(optionLabel) });
  fireEvent.mouseDown(option);
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
  });
  return renderWithProviders(<ConfigurableProductsScreen />, { transport, initialSession: testAdminSession });
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

  it("adds a new configurable product through the side panel and round-trips through the stubbed transport", async () => {
    renderScreen();
    await screen.findByText("نافذة قابلة للتهيئة");
    fireEvent.click(screen.getByRole("button", { name: "إضافة منتج قابل للتهيئة" }));

    const dialog = screen.getByRole("dialog", { name: "منتج قابل للتهيئة جديد" });
    fireEvent.change(within(dialog).getByLabelText("الكود *"), { target: { value: "DOOR" } });
    fireEvent.change(within(dialog).getByLabelText("الاسم بالعربية *"), { target: { value: "باب قابل للتهيئة" } });
    pickFromCombobox(dialog, "المنتج الناتج *", "نافذة مخصصة");
    fireEvent.change(within(dialog).getByLabelText("المعرف (للمعادلات)"), { target: { value: "width" } });
    fireEvent.change(within(dialog).getByLabelText("التسمية"), { target: { value: "العرض" } });
    pickFromCombobox(dialog, "الصنف", "زجاج (م²)");
    fireEvent.change(within(dialog).getByLabelText("معادلة الكمية"), { target: { value: "width/100" } });

    fireEvent.click(within(dialog).getByRole("button", { name: "حفظ" }));

    expect(await screen.findByText("باب قابل للتهيئة")).toBeInTheDocument();
  });
});
