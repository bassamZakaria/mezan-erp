// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, expect, it } from "vitest";
import { screen, fireEvent, within } from "@testing-library/react";
import type { ItemDTO } from "@mezan/contracts";
import { BomsScreen } from "./BomsScreen";
import { renderWithProviders, stubTransport, testAdminSession } from "../data/test-support";
import type { BomRecord } from "../data/hooks";

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
    id: "item-wood",
    code: "ITM-1",
    nameAr: "لوح خشب",
    nameEn: null,
    type: "stock",
    baseUnitCode: "PCS",
    alternateUnits: [],
    barcodes: [],
    categoryId: null,
    brandId: null, seasonId: null, specifications: [],
    costingMethod: "WAC",
    salePrice: null,
    costPrice: "120.00",
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

const items: ItemDTO[] = [item(), item({ id: "item-table", code: "ITM-2", nameAr: "طاولة خشبية", costPrice: null })];

function bom(overrides: Partial<BomRecord> = {}): BomRecord {
  return {
    id: "bom-1",
    number: "BOM-0001",
    productItemId: "item-table",
    version: 1,
    standardQty: "1",
    unit: "PCS",
    laborCost: "50",
    overheadCost: "30",
    versionNotes: null,
    lines: [{ itemId: "item-wood", qty: "4", wastePercent: 5, optional: false, notes: null }],
    status: "active",
    custom: false,
    createdBy: "محمد الشهابي",
    createdAt: "2026-08-01T08:00:00.000Z",
    estimate: { materialCost: "504.00", laborCost: "50.00", overheadCost: "30.00", totalCost: "584.00", unitCost: "584.00" },
    ...overrides,
  };
}

function renderScreen(boms: BomRecord[] = [bom()]) {
  let current = [...boms];
  const transport = stubTransport({
    "GET /manufacturing/boms": () => ({ body: current }),
    "GET /items": () => ({ body: items }),
    "POST /manufacturing/boms": (init) => {
      const body = JSON.parse((init?.body as string) ?? "{}");
      const created: BomRecord = {
        id: body.id,
        number: "BOM-0002",
        productItemId: body.productItemId,
        version: 1,
        standardQty: body.standardQty,
        unit: body.unit,
        laborCost: body.laborCost,
        overheadCost: body.overheadCost,
        versionNotes: body.versionNotes ?? null,
        lines: body.lines.map((l: { itemId: string; qty: string; wastePercent?: number }) => ({
          itemId: l.itemId,
          qty: l.qty,
          wastePercent: l.wastePercent ?? 0,
          optional: false,
          notes: null,
        })),
        status: "active",
        custom: false,
        createdBy: "USER-ADMIN",
        createdAt: "2026-08-21T00:00:00.000Z",
      };
      current = [...current, created];
      return { status: 201, body: created };
    },
  });
  return renderWithProviders(<BomsScreen />, { transport, initialSession: testAdminSession });
}

describe("BomsScreen", () => {
  it("shows an empty state when there are no BOMs yet", async () => {
    renderScreen([]);
    expect(screen.getByRole("heading", { name: "قوائم المواد" })).toBeInTheDocument();
    expect(await screen.findByText("لا توجد قوائم مواد مطابقة — أنشئ قائمة جديدة")).toBeInTheDocument();
  });

  it("lists BOMs from the real backend", async () => {
    renderScreen();
    expect(await screen.findByText("BOM-0001")).toBeInTheDocument();
    expect(screen.getByText("طاولة خشبية")).toBeInTheDocument();
  });

  it("creates a new BOM through the side panel and round-trips through the stubbed transport", async () => {
    renderScreen();
    await screen.findByText("BOM-0001");
    fireEvent.click(screen.getByRole("button", { name: "قائمة مواد جديدة" }));

    const dialog = screen.getByRole("dialog", { name: "قائمة مواد جديدة" });
    pickFromCombobox(dialog, "المنتج النهائي *", "طاولة خشبية");
    pickFromCombobox(dialog, "الصنف", "لوح خشب");
    fireEvent.click(within(dialog).getByRole("button", { name: "حفظ قائمة المواد" }));

    expect(await screen.findByText("BOM-0002")).toBeInTheDocument();
  });
});
