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
 * This stands in for the shell's URL-driven one with in-memory segments — `initial` lets a
 * test land directly on a sub-page (a re-opened counting sheet, a detail deep link) the way
 * a bookmark or a resumed session would.
 */
/** The Select combobox commits on mousedown, not change (packages/ui's Select) — open it, then commit the matching option. */
async function chooseSelectOption(triggerLabel: string, optionLabel: string) {
  fireEvent.click(screen.getByRole("combobox", { name: triggerLabel }));
  fireEvent.mouseDown(await screen.findByRole("option", { name: optionLabel }));
}

function TestNavigation({ children, initial = [] }: { children: ReactNode; initial?: readonly string[] }) {
  const [segments, setSegments] = useState<readonly string[]>(initial);
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
  { id: "WH-MAIN", code: "WH-MAIN", name: "المستودع الرئيسي", nameEn: null, branchId: "b1", type: "MAIN", isDefault: true, active: true },
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

function baseHandlers(current: PhysicalCountDTO[], overrides: Record<string, (init: RequestInit | undefined, path: string) => { status?: number; body: unknown }> = {}) {
  return {
    "GET /warehouses": () => ({ body: warehouses }),
    "GET /items": () => ({ body: items }),
    "GET /inventory/stock-balance": () => ({ body: { rows: stockBalance } }),
    "GET /inventory/physical-counts": () => ({ body: current }),
    ...overrides,
  };
}

function seedCount(overrides: Partial<PhysicalCountDTO> = {}): PhysicalCountDTO {
  return {
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
    ...overrides,
  };
}

describe("PhysicalCountsScreen — a blind count withholds figures until it closes", () => {
  it("hides the system quantity and variance columns while a blind count is open, and records + finishes it", async () => {
    const blindOpen = seedCount({
      id: "count-blind",
      countNo: "CNT-000020",
      blind: true,
      lines: [{ itemId: "itm-1", systemQty: null, unitCost: null, countedQty: null, varianceQty: null, varianceValue: null }],
    });
    const recorded: unknown[] = [];
    let completed = false;
    const transport = stubTransport({
      ...baseHandlers([blindOpen]),
      "POST /inventory/physical-counts/*/counts": (init) => {
        recorded.push(JSON.parse((init?.body as string) ?? "{}"));
        return { body: blindOpen };
      },
      "POST /inventory/physical-counts/*/complete": () => {
        completed = true;
        return { body: { ...blindOpen, status: "COMPLETED" } };
      },
    });
    renderWithProviders(
      <TestNavigation initial={["count-blind", "count"]}>
        <PhysicalCountsScreen />
      </TestNavigation>,
      { transport, initialSession: testAdminSession },
    );

    expect(await screen.findByText("جرد أعمى — كميات النظام والفروقات مخفية حتى إنهاء الجرد.")).toBeInTheDocument();
    expect(screen.queryByText("النظام")).not.toBeInTheDocument();
    expect(screen.queryByText("الفرق")).not.toBeInTheDocument();

    const countedInput = screen.getByLabelText("الكمية المعدودة لصنف أرز أبيض مصري 5 كجم (ITM-000001)");
    fireEvent.change(countedInput, { target: { value: "88" } });
    fireEvent.click(screen.getByRole("button", { name: "إنهاء الجرد" }));

    await waitFor(() => expect(completed).toBe(true));
    expect(recorded).toEqual([{ entries: [{ itemId: "itm-1", countedQty: "88" }] }]);
  });

  it("reveals the system quantity and variance once a blind count has closed", async () => {
    const closedBlind = seedCount({
      id: "count-blind-done",
      countNo: "CNT-000021",
      blind: true,
      status: "COMPLETED",
      lines: [{ itemId: "itm-1", systemQty: "90.000000", unitCost: "10.000000", countedQty: "85.000000", varianceQty: "-5.000000", varianceValue: "-50.000000" }],
      variance: {
        totalLines: 1, countedLines: 1, uncountedLines: 0, matchedLines: 0, overLines: 0, shortLines: 1,
        overQty: "0.000000", shortQty: "5.000000", netQty: "-5.000000", overValue: "0.000000", shortValue: "50.000000", netValue: "-50.000000", absValue: "50.000000",
      },
      completedAt: "2026-08-22T10:05:00.000Z",
    });
    const transport = stubTransport(baseHandlers([closedBlind]));
    renderWithProviders(
      <TestNavigation>
        <PhysicalCountsScreen />
      </TestNavigation>,
      { transport, initialSession: testAdminSession },
    );

    fireEvent.click(await screen.findByText("CNT-000021"));
    expect(screen.getByText("جرد أعمى")).toBeInTheDocument();
    expect(await screen.findByText("90.00")).toBeInTheDocument();
    expect(screen.getByText("-5.00")).toBeInTheDocument();
  });

  it("shows a completed blind count's entry sheet read-only, with no finish button, when re-opened", async () => {
    const closedBlind = seedCount({
      id: "count-blind-view",
      countNo: "CNT-000022",
      blind: true,
      status: "COMPLETED",
      lines: [{ itemId: "itm-1", systemQty: "90.000000", unitCost: "10.000000", countedQty: "90.000000", varianceQty: "0.000000", varianceValue: "0.000000" }],
    });
    const transport = stubTransport(baseHandlers([closedBlind]));
    renderWithProviders(
      <TestNavigation initial={["count-blind-view", "count"]}>
        <PhysicalCountsScreen />
      </TestNavigation>,
      { transport, initialSession: testAdminSession },
    );

    expect(await screen.findByText("النظام")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "إنهاء الجرد" })).not.toBeInTheDocument();
    expect(screen.getByLabelText("الكمية المعدودة لصنف أرز أبيض مصري 5 كجم (ITM-000001)")).toBeDisabled();
  });
});

describe("PhysicalCountsScreen — recording counts and resuming a partly-counted session", () => {
  it("resuming a count keeps the previously recorded quantity for a line that was already counted", async () => {
    const secondItem = item({ id: "itm-2", code: "ITM-000002", nameAr: "سكر" });
    const partial = seedCount({
      id: "count-partial",
      countNo: "CNT-000030",
      lines: [
        { itemId: "itm-1", systemQty: "90.000000", unitCost: "10.000000", countedQty: "80.000000", varianceQty: null, varianceValue: null },
        { itemId: "itm-2", systemQty: "40.000000", unitCost: "5.000000", countedQty: null, varianceQty: null, varianceValue: null },
      ],
    });
    const transport = stubTransport({
      ...baseHandlers([partial]),
      "GET /items": () => ({ body: [item(), secondItem] }),
    });
    renderWithProviders(
      <TestNavigation initial={["count-partial", "count"]}>
        <PhysicalCountsScreen />
      </TestNavigation>,
      { transport, initialSession: testAdminSession },
    );

    const firstInput = await screen.findByLabelText("الكمية المعدودة لصنف أرز أبيض مصري 5 كجم (ITM-000001)");
    expect(firstInput).toHaveValue(80);
    const secondInput = screen.getByLabelText("الكمية المعدودة لصنف سكر (ITM-000002)");
    expect(secondInput).toHaveValue(40);
    expect(screen.getByRole("button", { name: "إنهاء الجرد" })).toBeEnabled();

    fireEvent.change(secondInput, { target: { value: "" } });
    expect(screen.getByRole("button", { name: "إنهاء الجرد" })).toBeDisabled();
  });

  it("shows the server's refusal when finishing a count fails", async () => {
    const inProgress = seedCount({ id: "count-fail" });
    const transport = stubTransport({
      ...baseHandlers([inProgress]),
      "POST /inventory/physical-counts/*/counts": () => ({ body: inProgress }),
      "POST /inventory/physical-counts/*/complete": () => ({ status: 409, body: { message: "لا يمكن إنهاء جرد ببنود غير معدودة." } }),
    });
    renderWithProviders(
      <TestNavigation initial={["count-fail", "count"]}>
        <PhysicalCountsScreen />
      </TestNavigation>,
      { transport, initialSession: testAdminSession },
    );

    const countedInput = await screen.findByLabelText("الكمية المعدودة لصنف أرز أبيض مصري 5 كجم (ITM-000001)");
    fireEvent.change(countedInput, { target: { value: "90" } });
    fireEvent.click(screen.getByRole("button", { name: "إنهاء الجرد" }));

    expect(await screen.findByText("لا يمكن إنهاء جرد ببنود غير معدودة.")).toBeInTheDocument();
  });
});

describe("PhysicalCountsScreen — a count that matched exactly generates no variance", () => {
  it("shows a zero net variance and no resulting adjustment for a fully matched, completed count", async () => {
    const matched = seedCount({
      id: "count-matched",
      countNo: "CNT-000040",
      status: "COMPLETED",
      lines: [{ itemId: "itm-1", systemQty: "90.000000", unitCost: "10.000000", countedQty: "90.000000", varianceQty: "0.000000", varianceValue: "0.000000" }],
      variance: {
        totalLines: 1, countedLines: 1, uncountedLines: 0, matchedLines: 1, overLines: 0, shortLines: 0,
        overQty: "0.000000", shortQty: "0.000000", netQty: "0.000000", overValue: "0.000000", shortValue: "0.000000", netValue: "0.000000", absValue: "0.000000",
      },
      completedAt: "2026-08-22T10:05:00.000Z",
    });
    const transport = stubTransport(baseHandlers([matched]));
    renderWithProviders(
      <TestNavigation>
        <PhysicalCountsScreen />
      </TestNavigation>,
      { transport, initialSession: testAdminSession },
    );

    fireEvent.click(await screen.findByText("CNT-000040"));
    expect(screen.getAllByText("+0.00").length).toBeGreaterThan(0);
    expect(screen.getByText("0")).toBeInTheDocument();
  });

  it("shows the resulting adjustment as created once one has been generated", async () => {
    const generated = seedCount({
      id: "count-generated",
      countNo: "CNT-000041",
      status: "ADJUSTMENT_GENERATED",
      generatedAdjustmentId: "adj-99",
      lines: [{ itemId: "itm-1", systemQty: "90.000000", unitCost: "10.000000", countedQty: "85.000000", varianceQty: "-5.000000", varianceValue: "-50.000000" }],
      variance: {
        totalLines: 1, countedLines: 1, uncountedLines: 0, matchedLines: 0, overLines: 0, shortLines: 1,
        overQty: "0.000000", shortQty: "5.000000", netQty: "-5.000000", overValue: "0.000000", shortValue: "50.000000", netValue: "-50.000000", absValue: "50.000000",
      },
      completedAt: "2026-08-22T10:05:00.000Z",
    });
    const transport = stubTransport(baseHandlers([generated]));
    renderWithProviders(
      <TestNavigation>
        <PhysicalCountsScreen />
      </TestNavigation>,
      { transport, initialSession: testAdminSession },
    );

    fireEvent.click(await screen.findByText("CNT-000041"));
    expect(screen.getByText("تم إنشاؤها")).toBeInTheDocument();
  });

  it("shows the server's refusal when generating the adjustment fails", async () => {
    const completed = seedCount({
      id: "count-genfail",
      countNo: "CNT-000042",
      status: "COMPLETED",
      lines: [{ itemId: "itm-1", systemQty: "90.000000", unitCost: "10.000000", countedQty: "85.000000", varianceQty: "-5.000000", varianceValue: "-50.000000" }],
      variance: {
        totalLines: 1, countedLines: 1, uncountedLines: 0, matchedLines: 0, overLines: 0, shortLines: 1,
        overQty: "0.000000", shortQty: "5.000000", netQty: "-5.000000", overValue: "0.000000", shortValue: "50.000000", netValue: "-50.000000", absValue: "50.000000",
      },
      completedAt: "2026-08-22T10:05:00.000Z",
    });
    const transport = stubTransport({
      ...baseHandlers([completed]),
      "POST /inventory/physical-counts/*/generate-adjustment": () => ({ status: 409, body: { message: "تعذر توليد التسوية." } }),
    });
    renderWithProviders(
      <TestNavigation>
        <PhysicalCountsScreen />
      </TestNavigation>,
      { transport, initialSession: testAdminSession },
    );

    fireEvent.click(await screen.findByText("CNT-000042"));
    fireEvent.click(screen.getByRole("button", { name: "توليد تسوية" }));

    expect(await screen.findByText("تعذر توليد التسوية.")).toBeInTheDocument();
  });
});

describe("PhysicalCountsScreen — a cancelled count with no snapshot at all", () => {
  it("shows dashes throughout, falls back to the raw id for its number, and to raw ids for an unknown warehouse or item", async () => {
    const cancelled = seedCount({
      id: "count-cancelled",
      countNo: null,
      warehouseId: "WH-GHOST",
      status: "CANCELLED",
      blind: false,
      lines: [{ itemId: "itm-ghost", systemQty: null, unitCost: null, countedQty: null, varianceQty: null, varianceValue: null }],
      variance: null,
    });
    const transport = stubTransport(baseHandlers([cancelled]));
    renderWithProviders(
      <TestNavigation>
        <PhysicalCountsScreen />
      </TestNavigation>,
      { transport, initialSession: testAdminSession },
    );

    expect(await screen.findByText("WH-GHOST")).toBeInTheDocument();
    expect(screen.getAllByText("—").length).toBeGreaterThan(0);

    fireEvent.click(screen.getByText("WH-GHOST"));
    expect(await screen.findByText("جرد فعلي")).toBeInTheDocument();
    expect(screen.getByText("جرد ظاهر")).toBeInTheDocument();
    expect(screen.getByText("itm-ghost")).toBeInTheDocument();
  });

  it("shows the blind-count label instead of a dash when a blind count with no snapshot is still listed", async () => {
    const blindNoVariance = seedCount({
      id: "count-blind-list",
      countNo: null,
      status: "IN_PROGRESS",
      blind: true,
      lines: [{ itemId: "itm-1", systemQty: null, unitCost: null, countedQty: null, varianceQty: null, varianceValue: null }],
      variance: null,
    });
    const transport = stubTransport(baseHandlers([blindNoVariance]));
    renderWithProviders(
      <TestNavigation>
        <PhysicalCountsScreen />
      </TestNavigation>,
      { transport, initialSession: testAdminSession },
    );

    expect(await screen.findByText("جرد أعمى")).toBeInTheDocument();
  });
});

describe("PhysicalCountsScreen — cancelling and list-loading errors", () => {
  it("shows the server's refusal when cancelling an in-progress count fails", async () => {
    const inProgress = seedCount({ id: "count-cancel-fail" });
    const transport = stubTransport({
      ...baseHandlers([inProgress]),
      "POST /inventory/physical-counts/*/cancel": () => ({ status: 409, body: { message: "لا يمكن إلغاء هذا الجرد." } }),
    });
    renderWithProviders(
      <TestNavigation>
        <PhysicalCountsScreen />
      </TestNavigation>,
      { transport, initialSession: testAdminSession },
    );

    fireEvent.click(await screen.findByRole("button", { name: "إجراءات CNT-000001" }));
    fireEvent.click(await screen.findByRole("menuitem", { name: "إلغاء" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "إلغاء" }));

    expect(await screen.findByText("لا يمكن إلغاء هذا الجرد.")).toBeInTheDocument();
  });

  it("shows the server's error message in the empty state when the count list fails to load", async () => {
    const transport = stubTransport({
      ...baseHandlers([]),
      "GET /inventory/physical-counts": () => ({ status: 500, body: { message: "server down" } }),
    });
    renderWithProviders(
      <TestNavigation>
        <PhysicalCountsScreen />
      </TestNavigation>,
      { transport, initialSession: testAdminSession },
    );

    expect(await screen.findByText("تعذّر تحميل قوائم الجرد.")).toBeInTheDocument();
  });

  it("resets to page 1 when the URL names a page past the end of the list", async () => {
    const transport = stubTransport(baseHandlers([seedCount()]));
    renderWithProviders(
      <TestNavigation>
        <PhysicalCountsScreen />
      </TestNavigation>,
      { transport, initialSession: testAdminSession, route: "/?page=5" },
    );
    expect(await screen.findByText("CNT-000001")).toBeInTheDocument();
  });
});

describe("PhysicalCountsScreen — starting a new count", () => {
  it("cannot start a count with no warehouse configured, even though the add button isn't disabled", async () => {
    const transport = stubTransport({
      "GET /warehouses": () => ({ body: [] }),
      "GET /items": () => ({ body: items }),
      "GET /inventory/stock-balance": () => ({ body: { rows: stockBalance } }),
      "GET /inventory/physical-counts": () => ({ body: [] }),
    });
    renderWithProviders(
      <TestNavigation initial={["new"]}>
        <PhysicalCountsScreen />
      </TestNavigation>,
      { transport, initialSession: testAdminSession },
    );

    const addButton = await screen.findByRole("button", { name: "إضافة" });
    await waitFor(() => expect(addButton).toBeEnabled());
    fireEvent.click(addButton);

    expect(screen.getByRole("heading", { name: "جرد جديد" })).toBeInTheDocument();
  });

  /**
   * PRODUCT DEFECT (not fixed here): `NewCountView`'s `warehouseId` state is
   * seeded from `warehouses[0]?.id` in a plain `useState` initializer, which
   * runs on the component's very first render — before `useWarehouses()` at
   * the parent has resolved. Landing on `.../new` directly (a deep link, or a
   * page reload while composing) mounts the form before the warehouse list
   * has loaded, so it permanently starts blank even once the list arrives,
   * and the "Add" button's `disabled` only checks `itemIds.length`, never
   * `warehouseId`. This test picks the warehouse explicitly, as a real user
   * facing a blank selector would have to.
   */
  it("shows the server's refusal when starting a count with a memo fails", async () => {
    const transport = stubTransport({
      ...baseHandlers([]),
      "POST /inventory/physical-counts": () => ({ status: 409, body: { message: "لا يمكن بدء جرد آخر لهذا المستودع." } }),
    });
    renderWithProviders(
      <TestNavigation initial={["new"]}>
        <PhysicalCountsScreen />
      </TestNavigation>,
      { transport, initialSession: testAdminSession },
    );

    await screen.findByPlaceholderText("YYYY-MM-DD");
    await chooseSelectOption("المستودع *", "المستودع الرئيسي");
    fireEvent.change(screen.getByPlaceholderText("YYYY-MM-DD"), { target: { value: "2026-08-22" } });
    fireEvent.change(screen.getByPlaceholderText("ملاحظات الجرد..."), { target: { value: "جرد نهاية الشهر" } });

    const addButton = await screen.findByRole("button", { name: "إضافة" });
    await waitFor(() => expect(addButton).toBeEnabled());
    fireEvent.click(addButton);

    expect(await screen.findByText("لا يمكن بدء جرد آخر لهذا المستودع.")).toBeInTheDocument();
  });
});
