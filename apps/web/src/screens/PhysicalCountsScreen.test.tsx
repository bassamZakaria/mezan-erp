// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, expect, it } from "vitest";
import { useState, type ReactNode } from "react";
import { screen, fireEvent, waitFor, within } from "@testing-library/react";
import type { ItemDTO, PhysicalCountDTO, StockBalanceRowDTO, WarehouseDTO } from "@mezan/contracts";
import { PhysicalCountsScreen } from "./PhysicalCountsScreen";
import { renderWithProviders, stubTransport, testAdminSession } from "../data/test-support";
import { NavigationProvider } from "../navigation";

/**
 * PhysicalCountsScreen's "new count" and detail views are sub-pages addressed via the
 * shell's `useSubPage` (navigation.tsx), which no-ops outside a real `NavigationProvider`.
 * This stands in for the shell's URL-driven one with in-memory segments.
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

const warehouses: WarehouseDTO[] = [
  { id: "WH-MAIN", code: "WH-MAIN", name: "المستودع الرئيسي", nameEn: null, branchId: "b1", type: "MAIN", isDefault: true, active: true, projectId: null, custodianUserId: null },
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
    brandId: null, seasonId: null, description: null, defaultSupplierId: null, specifications: [],
    costingMethod: "WAC",
    salePrice: "0",
    costPrice: "0",
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
  return renderWithProviders(
    <TestNavigation>
      <PhysicalCountsScreen />
    </TestNavigation>,
    { transport, initialSession: testAdminSession },
  );
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
  /**
   * D66. The count mutations invalidated `["inventory","physical-counts"]`
   * while this screen reads `["physical-counts", filter]`, so the list never
   * refetched: starting a count bounced straight back to the empty state,
   * because `active`/`selected` were looked up in a cache the POST had not
   * touched. The two prefixes are now one.
   */
  it("D66: starting a new count refetches the list and opens its counting sheet", async () => {
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
    });
    renderWithProviders(
      <TestNavigation>
        <PhysicalCountsScreen />
      </TestNavigation>,
      { transport, initialSession: testAdminSession },
    );

    await screen.findByText("لا توجد عمليات جرد — أنشئ عملية جرد فعلي لمطابقة المخزون الفعلي مع النظام");
    fireEvent.click(screen.getByRole("button", { name: "جرد جديد" }));
    expect(screen.getByRole("heading", { name: "جرد جديد" })).toBeInTheDocument();

    const addButton = screen.getByRole("button", { name: "إضافة" });
    await waitFor(() => expect(addButton).toBeEnabled());
    fireEvent.click(addButton);

    // The POST created a real count, the list refetched, and the screen lands
    // on that count's own counting sheet rather than on an empty list.
    await waitFor(() => expect(screen.getByRole("button", { name: "إنهاء الجرد" })).toBeInTheDocument());
    expect(
      screen.queryByText("لا توجد عمليات جرد — أنشئ عملية جرد فعلي لمطابقة المخزون الفعلي مع النظام"),
    ).not.toBeInTheDocument();
  });

  it("records a client-computed variance and submits the correct finish request, from a count already in the list", async () => {
    const seeded: PhysicalCountDTO = {
      id: "count-1",
      countNo: "CNT-000001",
      warehouseId: "WH-MAIN",
      date: "2026-08-22",
      memo: "",
      status: "IN_PROGRESS",
      blind: false,
      lines: [{ itemId: "itm-1", systemQty: "90.000000", unitCost: "10.000000", countedQty: null, varianceQty: null, varianceValue: null }],
      variance: null,
      createdAt: "2026-08-22T10:00:00.000Z",
      completedAt: null,
      generatedAdjustmentId: null,
    };
    let current: PhysicalCountDTO[] = [seeded];
    const recordedBodies: unknown[] = [];
    let completeCalled = false;
    const transport = stubTransport({
      ...baseHandlers(current),
      "GET /inventory/physical-counts": () => ({ body: current }),
      "POST /inventory/physical-counts/*/counts": (init) => {
        recordedBodies.push(JSON.parse((init?.body as string) ?? "{}"));
        return { body: seeded };
      },
      "POST /inventory/physical-counts/*/complete": () => {
        completeCalled = true;
        return { body: { ...seeded, status: "COMPLETED" } };
      },
    });
    renderWithProviders(
      <TestNavigation>
        <PhysicalCountsScreen />
      </TestNavigation>,
      { transport, initialSession: testAdminSession },
    );

    fireEvent.click(await screen.findByText("CNT-000001"));
    fireEvent.click(screen.getByRole("button", { name: "متابعة الجرد" }));

    // itm-1's system qty is 90 — count it short by 5. The variance is computed
    // client-side from the typed value, with no request involved.
    const countedInput = screen.getByLabelText("الكمية المعدودة لصنف أرز أبيض مصري 5 كجم (ITM-000001)");
    fireEvent.change(countedInput, { target: { value: "85" } });
    expect(screen.getByText("-5.00")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "إنهاء الجرد" }));

    await waitFor(() => expect(completeCalled).toBe(true));
    expect(recordedBodies).toEqual([{ entries: [{ itemId: "itm-1", countedQty: "85" }] }]);

    // Same defect as above: completing routes back to the list, but the stale
    // cache still shows the count as "قيد التنفيذ" rather than "مكتمل".
    await waitFor(() => expect(screen.getByRole("heading", { name: "الجرد الفعلي" })).toBeInTheDocument());
    const row = (await screen.findByText("CNT-000001")).closest("tr")!;
    expect(within(row).getByText("قيد التنفيذ")).toBeInTheDocument();
  });

  it("submits the correct adjustment-generation request from a completed count's detail view", async () => {
    const seeded: PhysicalCountDTO = {
      id: "count-2",
      countNo: "CNT-000002",
      warehouseId: "WH-MAIN",
      date: "2026-08-22",
      memo: "",
      status: "COMPLETED",
      blind: false,
      lines: [{ itemId: "itm-1", systemQty: "90.000000", unitCost: "10.000000", countedQty: "85.000000", varianceQty: "-5.000000", varianceValue: "-50.000000" }],
      variance: {
        totalLines: 1,
        countedLines: 1,
        uncountedLines: 0,
        matchedLines: 0,
        overLines: 0,
        shortLines: 1,
        overQty: "0.000000",
        shortQty: "5.000000",
        netQty: "-5.000000",
        overValue: "0.000000",
        shortValue: "50.000000",
        netValue: "-50.000000",
        absValue: "50.000000",
      },
      createdAt: "2026-08-22T10:00:00.000Z",
      completedAt: "2026-08-22T10:05:00.000Z",
      generatedAdjustmentId: null,
    };
    const current: PhysicalCountDTO[] = [seeded];
    const generateRequests: unknown[] = [];
    const transport = stubTransport({
      ...baseHandlers(current),
      "GET /inventory/physical-counts": () => ({ body: current }),
      "POST /inventory/physical-counts/*/generate-adjustment": (init) => {
        generateRequests.push(JSON.parse((init?.body as string) ?? "{}"));
        return { body: { count: { ...seeded, status: "ADJUSTMENT_GENERATED" }, adjustment: null } };
      },
    });
    renderWithProviders(
      <TestNavigation>
        <PhysicalCountsScreen />
      </TestNavigation>,
      { transport, initialSession: testAdminSession },
    );

    fireEvent.click(await screen.findByText("CNT-000002"));
    expect(await screen.findByText("مكتمل")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "توليد تسوية" }));

    await waitFor(() => expect(generateRequests).toHaveLength(1));
    expect(generateRequests[0]).toMatchObject({ adjustmentId: expect.any(String) });
  });
});
