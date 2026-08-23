// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, expect, it, vi } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import type { ItemDTO, PhysicalCountDTO, StockAdjustmentDocumentDTO, StockBalanceRowDTO, WarehouseDTO } from "@mezan/contracts";
import { PhysicalCountsScreen } from "./PhysicalCountsScreen";
import { renderWithProviders, stubTransport, testAdminSession } from "../data/test-support";

const warehouses: WarehouseDTO[] = [{ id: "WH-MAIN", code: "WH-MAIN", name: "المستودع الرئيسي", branchId: "b1", type: "MAIN", isDefault: true, active: true }];

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

const balanceRows: StockBalanceRowDTO[] = [{ itemId: "itm-1", onHand: "90.000000", totalValue: "900.000000", averageCost: "10.000000", warehouseCount: 1 }];

describe("PhysicalCountsScreen — empty seeded state", () => {
  it("matches the real empty state (zero counts)", async () => {
    const transport = stubTransport({
      "GET /inventory/physical-counts": () => ({ body: [] }),
      "GET /warehouses": () => ({ body: warehouses }),
      "GET /items": () => ({ body: items }),
    });
    renderWithProviders(<PhysicalCountsScreen />, { transport, initialSession: testAdminSession });
    expect(screen.getByRole("heading", { name: "الجرد الفعلي" })).toBeInTheDocument();
    expect(
      await screen.findByText("لا توجد عمليات جرد — أنشئ عملية جرد فعلي لمطابقة المخزون الفعلي مع النظام"),
    ).toBeInTheDocument();
  });
});

describe("PhysicalCountsScreen — count → variance → adjustment flow", () => {
  it("starts a count, records a variance, completes it, and generates the reconciling adjustment", async () => {
    const countId = "cnt-0001-0000-0000-000000000000";
    vi.spyOn(crypto, "randomUUID").mockReturnValue(countId as ReturnType<typeof crypto.randomUUID>);

    let counts: PhysicalCountDTO[] = [];
    let generatedAdjustment: StockAdjustmentDocumentDTO | null = null;

    const transport = stubTransport({
      "GET /inventory/physical-counts": () => ({ body: counts }),
      "GET /warehouses": () => ({ body: warehouses }),
      "GET /items": () => ({ body: items }),
      "GET /inventory/stock-balance": () => ({ body: { rows: balanceRows } }),
      "POST /inventory/physical-counts": (init) => {
        const body = JSON.parse((init?.body as string) ?? "{}");
        const created: PhysicalCountDTO = {
          id: body.id,
          countNo: "CNT-000001",
          warehouseId: body.warehouseId,
          date: body.date,
          memo: body.memo ?? "",
          status: "IN_PROGRESS",
          lines: (body.itemIds as string[]).map((itemId) => ({ itemId, systemQty: "90.000000", countedQty: null })),
          createdAt: "2026-08-22T10:00:00.000Z",
          completedAt: null,
          generatedAdjustmentId: null,
        };
        counts = [...counts, created];
        return { status: 201, body: created };
      },
      [`POST /inventory/physical-counts/${countId}/counts`]: (init) => {
        const body = JSON.parse((init?.body as string) ?? "{}") as { entries: Array<{ itemId: string; countedQty: string }> };
        counts = counts.map((c) =>
          c.id === countId
            ? { ...c, lines: c.lines.map((l) => ({ ...l, countedQty: body.entries.find((e) => e.itemId === l.itemId)?.countedQty ?? l.countedQty })) }
            : c,
        );
        return { body: counts.find((c) => c.id === countId) };
      },
      [`POST /inventory/physical-counts/${countId}/complete`]: () => {
        counts = counts.map((c) => (c.id === countId ? { ...c, status: "COMPLETED", completedAt: "2026-08-22T10:05:00.000Z" } : c));
        return { body: counts.find((c) => c.id === countId) };
      },
      [`POST /inventory/physical-counts/${countId}/generate-adjustment`]: () => {
        const count = counts.find((c) => c.id === countId)!;
        generatedAdjustment = {
          id: "adj-generated-1",
          docType: "STOCK_ADJUSTMENT",
          docNo: "ADJ-000010",
          date: count.date,
          memo: "تسوية من جرد",
          status: "confirmed",
          lines: [{ itemId: "itm-1", warehouseId: "WH-MAIN", reason: "PHYSICAL_COUNT", direction: "OUT", qty: "5.000000", unitCost: null }],
          createdAt: "2026-08-22T10:06:00.000Z",
          confirmedAt: "2026-08-22T10:06:00.000Z",
          journalEntryId: null,
        };
        counts = counts.map((c) => (c.id === countId ? { ...c, status: "ADJUSTMENT_GENERATED", generatedAdjustmentId: generatedAdjustment!.id } : c));
        return { body: { count: counts.find((c) => c.id === countId), adjustment: generatedAdjustment } };
      },
    });
    renderWithProviders(<PhysicalCountsScreen />, { transport, initialSession: testAdminSession });

    fireEvent.click(await screen.findByRole("button", { name: "جرد جديد" }));
    expect(screen.getByRole("heading", { name: "جرد جديد" })).toBeInTheDocument();

    // Wait for the real stock-balance rollup to load (async) so the item count is non-zero.
    const addButton = screen.getByRole("button", { name: "إضافة" });
    await waitFor(() => expect(addButton).toBeEnabled());

    fireEvent.click(addButton);

    // Now on the count-entry grid for the newly started (IN_PROGRESS) count.
    await waitFor(() => expect(screen.getByRole("button", { name: "إنهاء الجرد" })).toBeInTheDocument());
    expect(screen.getByText("أرز أبيض مصري 5 كجم (ITM-000001)")).toBeInTheDocument();

    // itm-1's system qty is 90 — count it short by 5.
    const countedInput = screen.getByLabelText("الكمية المعدودة لصنف أرز أبيض مصري 5 كجم (ITM-000001)");
    fireEvent.change(countedInput, { target: { value: "85" } });
    expect(screen.getByText("-5")).toBeInTheDocument();

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
    expect(screen.getByText("-5.000000")).toBeInTheDocument();
  });
});
