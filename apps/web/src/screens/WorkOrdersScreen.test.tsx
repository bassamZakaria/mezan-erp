// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, expect, it } from "vitest";
import { screen, fireEvent } from "@testing-library/react";
import type { ItemDTO, WarehouseDTO } from "@mezan/contracts";
import { WorkOrdersScreen } from "./WorkOrdersScreen";
import { renderWithProviders, stubTransport, testAdminSession } from "../data/test-support";
import type { BomRecord, WorkOrderRecord } from "../data/hooks";

const items: ItemDTO[] = [
  {
    id: "item-table",
    code: "ITM-2",
    nameAr: "طاولة خشبية",
    nameEn: null,
    type: "stock",
    baseUnitCode: "PCS",
    alternateUnits: [],
    barcodes: [],
    categoryId: null,
    brandId: null, seasonId: null, specifications: [],
    costingMethod: "WAC",
    salePrice: null,
    costPrice: null,
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

const warehouses: WarehouseDTO[] = [
  { id: "wh-raw", code: "RAW-WH", name: "مستودع الخامات", branchId: "MAIN", type: "MAIN", isDefault: false, active: true },
  { id: "wh-fg", code: "FG-WH", name: "مستودع المنتجات التامة", branchId: "MAIN", type: "MAIN", isDefault: false, active: true },
];

const boms: BomRecord[] = [
  {
    id: "bom-1",
    number: "BOM-0001",
    productItemId: "item-table",
    version: 1,
    standardQty: "1",
    unit: "PCS",
    laborCost: "50",
    overheadCost: "30",
    versionNotes: null,
    lines: [{ itemId: "item-table", qty: "1", wastePercent: 0, optional: false, notes: null }],
    status: "active",
    custom: false,
    createdBy: "محمد الشهابي",
    createdAt: "2026-08-01T08:00:00.000Z",
  },
];

function workOrder(overrides: Partial<WorkOrderRecord> = {}): WorkOrderRecord {
  return {
    id: "wo-1",
    number: "WO-0001",
    bomId: "bom-1",
    bomVersion: 1,
    productItemId: "item-table",
    plannedQty: "10",
    producedQty: "0",
    sourceWarehouseId: "wh-raw",
    destinationWarehouseId: "wh-fg",
    priority: "normal",
    scheduledStartDate: "2026-08-10",
    scheduledEndDate: "2026-08-28",
    notes: null,
    status: "planned",
    stage: "not_started",
    materials: [
      { itemId: "item-table", requiredQty: "40", wastePercent: 5, optional: false, issuedQty: "0", returnedQty: "0", netQty: "0", issuedUnitCost: "0" },
    ],
    materialCost: "0",
    laborCost: "50",
    overheadCost: "30",
    extraCost: "0",
    wipTotal: "0",
    unitCost: "0",
    progress: 0,
    costLog: [],
    wasteLog: [],
    configInstanceId: null,
    glPosted: false,
    createdBy: "محمد الشهابي",
    createdAt: "2026-08-10T08:00:00.000Z",
    startedAt: null,
    issuedAt: null,
    receivedAt: null,
    completedAt: null,
    ...overrides,
  };
}

function renderScreen(orders: WorkOrderRecord[] = [workOrder()]) {
  let current = [...orders];
  const transport = stubTransport({
    "GET /manufacturing/work-orders": () => ({ body: current }),
    "GET /manufacturing/boms": () => ({ body: boms }),
    "GET /items": () => ({ body: items }),
    "GET /warehouses": () => ({ body: warehouses }),
    "POST /manufacturing/work-orders/wo-1/start": () => {
      const updated: WorkOrderRecord = { ...current[0]!, status: "in_progress", stage: "started", startedAt: "2026-08-21T09:00:00.000Z" };
      current = [updated, ...current.slice(1)];
      return { body: updated };
    },
  });
  return renderWithProviders(<WorkOrdersScreen />, { transport, initialSession: testAdminSession });
}

describe("WorkOrdersScreen", () => {
  it("shows an empty state when there are no work orders yet", async () => {
    renderScreen([]);
    expect(screen.getByRole("heading", { name: "أوامر التصنيع" })).toBeInTheDocument();
    expect(await screen.findByText("لا توجد أوامر تصنيع مطابقة — أنشئ أمراً جديداً")).toBeInTheDocument();
  });

  it("lists work orders from the real backend", async () => {
    renderScreen();
    expect(await screen.findByText("WO-0001")).toBeInTheDocument();
    expect(screen.getByText("طاولة خشبية")).toBeInTheDocument();
    expect(screen.getAllByText("مخطط").length).toBeGreaterThan(0);
  });

  it("starts a work order (not_started → started) through the stubbed transport", async () => {
    renderScreen();
    fireEvent.click(await screen.findByText("WO-0001"));
    fireEvent.click(screen.getByRole("button", { name: "بدء العمل" }));

    expect(await screen.findByRole("button", { name: "صرف المواد" })).toBeInTheDocument();
    expect(screen.getByText("قيد التنفيذ")).toBeInTheDocument();
  });
});
