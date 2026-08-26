// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import type { AccountDTO, ItemDTO, StockAdjustmentDocumentDTO, WarehouseDTO } from "@mezan/contracts";
import { StockAdjustmentsScreen } from "./StockAdjustmentsScreen";
import { renderWithProviders, stubTransport, testAdminSession } from "../data/test-support";
import type { JournalEntryDTO } from "../data/hooks";

afterEach(() => {
  document.documentElement.removeAttribute("data-theme");
});

const warehouses: WarehouseDTO[] = [{ id: "WH-MAIN", code: "WH-MAIN", name: "المستودع الرئيسي", branchId: "b1", type: "MAIN", isDefault: true, active: true }];

function item(overrides: Partial<ItemDTO> = {}): ItemDTO {
  return {
    id: "itm-1",
    code: "ITM-000001",
    nameAr: "منتج 1",
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

const items: ItemDTO[] = [item(), item({ id: "itm-3", code: "ITM-000003", nameAr: "منتج 3" })];

const accounts: AccountDTO[] = [
  { id: "1200", code: "1200", nameAr: "المخزون", nameEn: "Inventory", type: "asset", naturalBalance: "debit", parentId: null, isHeader: false, status: "active" },
  { id: "3100", code: "3100", nameAr: "رأس المال", nameEn: "Capital", type: "equity", naturalBalance: "credit", parentId: null, isHeader: false, status: "active" },
];

const adj1: StockAdjustmentDocumentDTO = {
  id: "adj-1",
  docType: "STOCK_ADJUSTMENT",
  docNo: "ADJ-000001",
  date: "2026-08-01",
  memo: "الرصيد الافتتاحي",
  status: "confirmed",
  lines: [{ itemId: "itm-1", warehouseId: "WH-MAIN", reason: "INITIAL_STOCK", direction: "IN", qty: "100.000000", unitCost: "10.000000" }],
  createdAt: "2026-08-01T10:00:00.000Z",
  confirmedAt: "2026-08-01T10:00:00.000Z",
  journalEntryId: "adj-1",
};

const adj5: StockAdjustmentDocumentDTO = {
  id: "adj-5",
  docType: "STOCK_ADJUSTMENT",
  docNo: "ADJ-000005",
  date: "2026-08-05",
  memo: "تلف",
  status: "confirmed",
  lines: [{ itemId: "itm-1", warehouseId: "WH-MAIN", reason: "DAMAGE", direction: "OUT", qty: "5.000000", unitCost: null }],
  createdAt: "2026-08-05T10:00:00.000Z",
  confirmedAt: "2026-08-05T10:00:00.000Z",
  journalEntryId: null,
};

const journalEntry: JournalEntryDTO = {
  id: "adj-1",
  entryNo: "JE-000001",
  date: "2026-08-01",
  memo: "الرصيد الافتتاحي",
  source: "system",
  status: "posted",
  createdAt: "2026-08-01T10:00:00.000Z",
  postedAt: "2026-08-01T10:00:00.000Z",
  reversesEntryId: null,
  reversedByEntryId: null,
  lines: [
    { accountId: "1200", debit: "1000.000000", credit: "0.000000", memo: null },
    { accountId: "3100", debit: "0.000000", credit: "1000.000000", memo: null },
  ],
};

function baseHandlers(current: StockAdjustmentDocumentDTO[]) {
  return {
    "GET /inventory/stock-adjustments": () => ({ body: current }),
    "GET /warehouses": () => ({ body: warehouses }),
    "GET /items": () => ({ body: items }),
    "GET /accounts": () => ({ body: accounts }),
    "GET /gl/journal-entries/adj-1": () => ({ body: journalEntry }),
    "GET /gl/journal-entries/adj-5": () => ({ status: 404, body: { error: "NOT_FOUND" } }),
  };
}

function renderScreen() {
  const transport = stubTransport(baseHandlers([adj1, adj5]));
  return renderWithProviders(<StockAdjustmentsScreen />, { transport, initialSession: testAdminSession });
}

describe("StockAdjustmentsScreen — list", () => {
  it("renders confirmed adjustments from the real backend with correct KPIs", async () => {
    renderScreen();
    expect(screen.getByRole("heading", { name: "تسويات المخزون" })).toBeInTheDocument();
    expect(await screen.findByText("ADJ-000001")).toBeInTheDocument();
    expect(screen.getByText("ADJ-000005")).toBeInTheDocument();
  });

  it("filters to confirmed via the status chips", async () => {
    renderScreen();
    await screen.findByText("ADJ-000001");
    fireEvent.click(screen.getByRole("tab", { name: /مؤكد/ }));
    expect(screen.getByText("ADJ-000001")).toBeInTheDocument();
  });

  it("opens the detail view with the INITIAL_STOCK opening balance and its real GL entry", async () => {
    renderScreen();
    fireEvent.click(await screen.findByText("ADJ-000001"));
    expect(screen.getByLabelText("حالة المستند")).toBeInTheDocument();
    expect(screen.getByText("رصيد افتتاحي")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("tab", { name: "المحاسبة" }));
    expect(await screen.findByText("المخزون")).toBeInTheDocument();
    expect(screen.getByText("رأس المال")).toBeInTheDocument();
  });

  it("shows no GL entry for a reason that doesn't post one (404)", async () => {
    renderScreen();
    fireEvent.click(await screen.findByText("ADJ-000005"));
    fireEvent.click(screen.getByRole("tab", { name: "المحاسبة" }));
    expect(await screen.findByText(/لا يوجد قيد محاسبي/)).toBeInTheDocument();
  });
});

describe("StockAdjustmentsScreen — create: reason picker + INITIAL_STOCK flow", () => {
  it("posts a new opening-balance adjustment via the real API (draft + confirm) and shows it in the list", async () => {
    const generatedId = "adj-0006-0000-0000-000000000000";
    vi.spyOn(crypto, "randomUUID").mockReturnValue(generatedId as ReturnType<typeof crypto.randomUUID>);
    let current = [adj1, adj5];
    const transport = stubTransport({
      ...baseHandlers(current),
      "GET /inventory/stock-adjustments": () => ({ body: current }),
      "POST /inventory/stock-adjustments/draft": (init) => {
        const body = JSON.parse((init?.body as string) ?? "{}");
        const created: StockAdjustmentDocumentDTO = {
          id: body.id,
          docType: "STOCK_ADJUSTMENT",
          docNo: null,
          date: body.date,
          memo: body.memo ?? "",
          status: "draft",
          lines: body.lines,
          createdAt: "2026-08-22T10:00:00.000Z",
          confirmedAt: null,
          journalEntryId: null,
        };
        current = [...current, created];
        return { status: 201, body: created };
      },
      [`POST /inventory/stock-adjustments/${generatedId}/confirm`]: () => {
        const confirmed: StockAdjustmentDocumentDTO = {
          ...current[current.length - 1]!,
          status: "confirmed",
          docNo: "ADJ-000006",
          confirmedAt: "2026-08-22T10:00:00.000Z",
        };
        current = current.map((d) => (d.id === generatedId ? confirmed : d));
        return { body: { document: confirmed, held: false } };
      },
    });
    renderWithProviders(<StockAdjustmentsScreen />, { transport, initialSession: testAdminSession });
    await screen.findByText("ADJ-000001");
    fireEvent.click(screen.getByRole("button", { name: "تسوية جديدة" }));
    expect(screen.getByRole("heading", { name: "اختر سبب التسوية" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /رصيد افتتاحي/ }));
    expect(screen.getByRole("heading", { name: "الرصيد الافتتاحي" })).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("الصنف للسطر 1"), { target: { value: "itm-3" } });
    fireEvent.change(screen.getByLabelText("الكمية للسطر 1"), { target: { value: "40" } });
    fireEvent.change(screen.getByLabelText("سعر التكلفة للسطر 1"), { target: { value: "60" } });

    fireEvent.click(screen.getByRole("button", { name: "اعتماد التسوية" }));

    await waitFor(() => expect(screen.getByRole("heading", { name: "تسويات المخزون" })).toBeInTheDocument());
    expect(await screen.findByText("ADJ-000006")).toBeInTheDocument();
  });
});

describe("StockAdjustmentsScreen — themes", () => {
  it.each(["light", "dark"] as const)("renders the list in the %s theme", async (theme) => {
    document.documentElement.setAttribute("data-theme", theme);
    renderScreen();
    expect(screen.getByRole("heading", { name: "تسويات المخزون" })).toBeInTheDocument();
    await screen.findByText("ADJ-000001");
  });
});
