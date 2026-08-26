// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, expect, it } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import type { ItemDTO, PhysicalCountDTO, StockBalanceRowDTO, WarehouseDTO } from "@mezan/contracts";
import { PhysicalCountsScreen } from "./PhysicalCountsScreen";
import { renderWithProviders, stubTransport, testAdminSession } from "../data/test-support";

const warehouses: WarehouseDTO[] = [
  { id: "WH-MAIN", code: "WH-MAIN", name: "المستودع الرئيسي", branchId: "b1", type: "MAIN", isDefault: true, active: true },
];

function item(overrides: Partial<ItemDTO> = {}): ItemDTO {
  return {
    id: "itm-1",
    code: "ITM-000001",
    nameAr: "أرز أبيض مصري 5 كجم",
    nameEn: null,
    type: "stock",
    baseUnitCode: "PCS",
    alternateUnits: [],
    barcodes: [],
    categoryId: null,
    brand: null,
    costingMethod: "WAC",
    salePrice: "0",
    costPrice: "0",
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

const items: ItemDTO[] = [item()];

const stockBalance: StockBalanceRowDTO[] = [
  { itemId: "itm-1", onHand: "90.000000", totalValue: "900.000000", averageCost: "10.000000", warehouseCount: 1, reserved: "0.000000", available: "90.000000", warehouses: [] },
];

function baseHandlers(current: PhysicalCountDTO[]) {
  return {
    "GET /warehouses": () => ({ body: warehouses }),
    "GET /items": () => ({ body: items }),
    "GET /inventory/stock-balance": () => ({ body: { rows: stockBalance } }),
    "GET /inventory/physical-counts": () => ({ body: current }),
  };
}

function renderEmptyScreen() {
  const transport = stubTransport(baseHandlers([]));
  return renderWithProviders(<PhysicalCountsScreen />, { transport, initialSession: testAdminSession });
}

describe("PhysicalCountsScreen — empty seeded state", () => {
  it("matches the catalog's real empty state (zero counts in the demo tenant)", async () => {
    renderEmptyScreen();
    expect(screen.getByRole("heading", { name: "الجرد الفعلي" })).toBeInTheDocument();
    expect(
      await screen.findByText("لا توجد عمليات جرد — أنشئ عملية جرد فعلي لمطابقة المخزون الفعلي مع النظام"),
    ).toBeInTheDocument();
  });
});

describe("PhysicalCountsScreen — count → variance → adjustment flow", () => {
  it("starts a count, records a variance, completes it, and generates the reconciling adjustment", async () => {
    let current: PhysicalCountDTO[] = [];
    const transport = stubTransport({
      ...baseHandlers(current),
      "GET /inventory/physical-counts": () => ({ body: current }),
      "POST /inventory/physical-counts": (init) => {
        const body = JSON.parse((init?.body as string) ?? "{}");
        const created: PhysicalCountDTO = {
          id: body.id,
          countNo: `CNT-${String(current.length + 1).padStart(6, "0")}`,
          warehouseId: body.warehouseId,
          date: body.date,
          memo: body.memo ?? "",
          status: "IN_PROGRESS",
          blind: body.blind ?? false,
          lines: (body.itemIds as string[]).map((itemId) => ({
            itemId,
            systemQty: "90.000000",
            unitCost: "10.000000",
            countedQty: null,
            varianceQty: null,
            varianceValue: null,
          })),
          variance: null,
          createdAt: "2026-08-22T10:00:00.000Z",
          completedAt: null,
          generatedAdjustmentId: null,
        };
        current = [...current, created];
        return { status: 201, body: created };
      },
      "POST /inventory/physical-counts/*/counts": (init, path) => {
        const id = path.split("/")[3];
        const body = JSON.parse((init?.body as string) ?? "{}") as { entries: { itemId: string; countedQty: string }[] };
        current = current.map((count) => {
          if (count.id !== id) return count;
          const lines = count.lines.map((line) => {
            const entry = body.entries.find((e) => e.itemId === line.itemId);
            if (!entry) return line;
            const system = Number(line.systemQty ?? "0");
            const counted = Number(entry.countedQty);
            const varianceQty = (counted - system).toFixed(6);
            const unitCost = Number(line.unitCost ?? "0");
            const varianceValue = ((counted - system) * unitCost).toFixed(6);
            return { ...line, countedQty: entry.countedQty, varianceQty, varianceValue };
          });
          return { ...count, lines };
        });
        return { body: current.find((c) => c.id === id) };
      },
      "POST /inventory/physical-counts/*/complete": (_init, path) => {
        const id = path.split("/")[3];
        current = current.map((count) => {
          if (count.id !== id) return count;
          const overLines = count.lines.filter((l) => Number(l.varianceQty ?? "0") > 0).length;
          const shortLines = count.lines.filter((l) => Number(l.varianceQty ?? "0") < 0).length;
          const overValue = count.lines.reduce((sum, l) => sum + Math.max(0, Number(l.varianceValue ?? "0")), 0);
          const shortValue = count.lines.reduce((sum, l) => sum + Math.max(0, -Number(l.varianceValue ?? "0")), 0);
          return {
            ...count,
            status: "COMPLETED",
            completedAt: "2026-08-22T10:05:00.000Z",
            variance: {
              totalLines: count.lines.length,
              countedLines: count.lines.length,
              uncountedLines: 0,
              matchedLines: count.lines.length - overLines - shortLines,
              overLines,
              shortLines,
              overQty: "0.000000",
              shortQty: "0.000000",
              netQty: "0.000000",
              overValue: overValue.toFixed(6),
              shortValue: shortValue.toFixed(6),
              netValue: (overValue - shortValue).toFixed(6),
              absValue: (overValue + shortValue).toFixed(6),
            },
          };
        });
        return { body: current.find((c) => c.id === id) };
      },
      "POST /inventory/physical-counts/*/generate-adjustment": (_init, path) => {
        const id = path.split("/")[3];
        current = current.map((count) =>
          count.id === id ? { ...count, status: "ADJUSTMENT_GENERATED", generatedAdjustmentId: "adj-from-count-1" } : count,
        );
        return { body: { count: current.find((c) => c.id === id), adjustment: null } };
      },
    });
    renderWithProviders(<PhysicalCountsScreen />, { transport, initialSession: testAdminSession });

    // Wait for the list's own data (warehouses/items included) to settle before opening the dialog.
    await screen.findByText("لا توجد عمليات جرد — أنشئ عملية جرد فعلي لمطابقة المخزون الفعلي مع النظام");
    fireEvent.click(screen.getByRole("button", { name: "جرد جديد" }));
    expect(screen.getByRole("heading", { name: "جرد جديد" })).toBeInTheDocument();

    // Wait for the seeded stock-balance rollup to load (async) so the item count is non-zero.
    const addButton = screen.getByRole("button", { name: "إضافة" });
    await waitFor(() => expect(addButton).toBeEnabled());

    fireEvent.click(addButton);

    // Now on the count-entry grid for the newly started (IN_PROGRESS) count.
    await waitFor(() => expect(screen.getByRole("button", { name: "إنهاء الجرد" })).toBeInTheDocument());
    expect(screen.getByText("أرز أبيض مصري 5 كجم (ITM-000001)")).toBeInTheDocument();

    // itm-1's system qty at MAIN-WH is 90 — count it short by 5.
    const countedInput = screen.getByLabelText("الكمية المعدودة لصنف أرز أبيض مصري 5 كجم (ITM-000001)");
    fireEvent.change(countedInput, { target: { value: "85" } });
    expect(screen.getByText("-5.00")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "إنهاء الجرد" }));

    // Completing routes back to the list — the new count now shows "مكتمل".
    await waitFor(() => expect(screen.getByRole("heading", { name: "الجرد الفعلي" })).toBeInTheDocument());
    const countNo = await screen.findByText("CNT-000001");
    fireEvent.click(countNo);

    // Detail view: generate the reconciling adjustment.
    expect(await screen.findByText("مكتمل")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "توليد تسوية" }));

    await screen.findByText("تم إنشاء التسوية");
    expect(screen.getByText("تم إنشاؤها")).toBeInTheDocument();
    // The OUT variance line (-5) for itm-1 is visible in the lines tab.
    expect(screen.getByText("-5.00")).toBeInTheDocument();
  });
});
