// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, expect, it } from "vitest";
import { screen, fireEvent, within } from "@testing-library/react";
import type { CustomerDTO, ItemDTO, WarehouseDTO } from "@mezan/contracts";
import { ConfigInstancesScreen } from "./ConfigInstancesScreen";
import { renderWithProviders, stubTransport, testAdminSession } from "../data/test-support";
import type { ConfigInstanceRecord, ConfigInstancePreviewResult, ConfigurableProductRecord } from "../data/hooks";

/** Type into an EntityPicker combobox and pick the matching option — selection
 * fires on `onMouseDown` (not `click`), so the input's blur never wins the race. */
function pickFromCombobox(dialog: HTMLElement, label: string, optionLabel: string) {
  const input = within(dialog).getByLabelText(label);
  fireEvent.focus(input);
  fireEvent.change(input, { target: { value: optionLabel } });
  const option = within(dialog).getByRole("button", { name: (accessibleName) => accessibleName.startsWith(optionLabel) });
  fireEvent.mouseDown(option);
}

const items: ItemDTO[] = [
  {
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
  },
];

const customers: CustomerDTO[] = [
  {
    id: "cust-1",
    code: "C1",
    nameAr: "شركة الأمل للتجارة",
    nameEn: null,
    phone: null,
    email: null,
    contactPerson: null,
    taxNumber: null,
    category: null,
    notes: null,
    paymentTermsDays: 30,
    currency: "EGP",
    openingBalance: "0",
    active: true,
    priceListId: null,
    creditLimit: "0",
    taxExempt: false,
    etaBuyerType: "auto",
    commercialRegistrationNumber: null,
    address: null,
    logoAttachmentId: null,
    nationalId: null,
  },
];

const warehouses: WarehouseDTO[] = [
  { id: "wh-raw", code: "RAW-WH", name: "مستودع الخامات", branchId: "MAIN", type: "MAIN", isDefault: false, active: true },
  { id: "wh-fg", code: "FG-WH", name: "مستودع المنتجات التامة", branchId: "MAIN", type: "MAIN", isDefault: false, active: true },
];

const products: ConfigurableProductRecord[] = [
  {
    id: "cp-1",
    code: "WINDOW",
    nameAr: "نافذة قابلة للتهيئة",
    nameEn: null,
    outputItemId: "item-glass",
    unit: "PCS",
    description: null,
    inputs: [{ id: "width", labelAr: "العرض", labelEn: null, type: "number", min: null, max: null }],
    materials: [{ itemId: "item-glass", qtyFormula: "width/100", wastePercent: 5 }],
    pricingMethod: "manual",
    priceFormula: null,
    laborFormula: null,
    overheadFormula: null,
    itemPolicy: "per_spec",
    status: "active",
    createdBy: "محمد الشهابي",
    createdAt: "2026-07-01T08:00:00.000Z",
  },
];

function instance(overrides: Partial<ConfigInstanceRecord> = {}): ConfigInstanceRecord {
  return {
    id: "ci-1",
    number: "CM-000001",
    configurableProductId: "cp-1",
    productNameAr: "نافذة قابلة للتهيئة",
    outputItemId: "item-glass",
    spec: { width: "120" },
    qty: "2",
    customerId: "cust-1",
    sellUnitPrice: "630.00",
    sellTotal: "1260.00",
    notes: null,
    status: "configured",
    bomId: "ci-1:bom",
    workOrderId: "ci-1:wo",
    materials: [{ itemId: "item-glass", qtyPerUnit: "1.2", wastePercent: 5, lineCost: "102.00" }],
    materialCostPerUnit: "102.00",
    laborCostPerUnit: "0",
    overheadCostPerUnit: "0",
    estimatedUnitCost: "102.00",
    actualCost: null,
    createdBy: "محمد الشهابي",
    createdAt: "2026-08-12T08:00:00.000Z",
    ...overrides,
  };
}

const previewResult: ConfigInstancePreviewResult = {
  materials: [{ itemId: "item-glass", qtyPerUnit: "1.5", effectiveQtyPerUnit: "1.575", wastePercent: 5, unitCost: "85.00", lineCost: "133.88" }],
  materialCostPerUnit: "133.88",
  laborCostPerUnit: "0",
  overheadCostPerUnit: "0",
  unitPrice: null,
};

function renderScreen(instances: ConfigInstanceRecord[] = [instance()]) {
  let current = [...instances];
  const transport = stubTransport({
    "GET /manufacturing/config-instances": () => ({ body: current }),
    "GET /manufacturing/configurable-products": () => ({ body: products }),
    "GET /items": () => ({ body: items }),
    "GET /customers": () => ({ body: customers }),
    "GET /warehouses": () => ({ body: warehouses }),
    "POST /manufacturing/config-instances/preview": () => ({ body: previewResult }),
    "POST /manufacturing/config-instances": (init) => {
      const body = JSON.parse((init?.body as string) ?? "{}");
      const created: ConfigInstanceRecord = {
        id: body.id,
        number: "CM-000002",
        configurableProductId: body.configurableProductId,
        productNameAr: "نافذة قابلة للتهيئة",
        outputItemId: "item-glass",
        spec: body.spec,
        qty: body.qty,
        customerId: body.customerId ?? null,
        sellUnitPrice: body.sellUnitPrice ?? null,
        sellTotal: "0.00",
        notes: body.notes ?? null,
        status: "configured",
        bomId: "ci-2:bom",
        workOrderId: "ci-2:wo",
        materials: [],
        materialCostPerUnit: "0",
        laborCostPerUnit: "0",
        overheadCostPerUnit: "0",
        estimatedUnitCost: "0",
        actualCost: null,
        createdBy: "USER-ADMIN",
        createdAt: "2026-08-21T00:00:00.000Z",
      };
      current = [...current, created];
      return { status: 201, body: created };
    },
  });
  return renderWithProviders(<ConfigInstancesScreen />, { transport, initialSession: testAdminSession });
}

describe("ConfigInstancesScreen", () => {
  it("shows an empty state when there are no custom manufacturing orders yet", async () => {
    renderScreen([]);
    expect(screen.getByRole("heading", { name: "التصنيع المخصص" })).toBeInTheDocument();
    expect(await screen.findByText("لا توجد أوامر تصنيع مخصص — أنشئ أمراً جديداً")).toBeInTheDocument();
  });

  it("lists custom manufacturing orders from the real backend", async () => {
    renderScreen();
    expect(await screen.findByText("CM-000001")).toBeInTheDocument();
    expect(screen.getByText("نافذة قابلة للتهيئة")).toBeInTheDocument();
    expect(screen.getByText("شركة الأمل للتجارة")).toBeInTheDocument();
  });

  it("previews materials/cost and creates a new order through the side panel, round-tripping through the stubbed transport", async () => {
    renderScreen();
    await screen.findByText("CM-000001");
    fireEvent.click(screen.getByRole("button", { name: "أمر تصنيع مخصص جديد" }));

    const dialog = screen.getByRole("dialog", { name: "أمر تصنيع مخصص جديد" });
    pickFromCombobox(dialog, "المنتج *", "نافذة قابلة للتهيئة");
    fireEvent.change(within(dialog).getByLabelText("العرض"), { target: { value: "150" } });

    expect(await within(dialog).findByText("زجاج (م²)")).toBeInTheDocument();

    pickFromCombobox(dialog, "مستودع الخامات *", "مستودع الخامات");
    pickFromCombobox(dialog, "مستودع المنتجات *", "مستودع المنتجات التامة");
    fireEvent.click(within(dialog).getByRole("button", { name: "حفظ" }));

    expect(await screen.findByText("CM-000002")).toBeInTheDocument();
  });
});
