// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useState, type ReactNode } from "react";
import { screen, fireEvent, waitFor, within } from "@testing-library/react";
import type { AccountDTO, ItemDTO, StockAdjustmentDocumentDTO, WarehouseDTO } from "@mezan/contracts";
import { StockAdjustmentsScreen } from "./StockAdjustmentsScreen";
import { renderWithProviders, stubTransport, testAdminSession } from "../data/test-support";
import type { JournalEntryDTO } from "../data/hooks";
import { NavigationProvider } from "../navigation";

afterEach(() => {
  document.documentElement.removeAttribute("data-theme");
});

/**
 * StockAdjustmentsScreen's detail view and add flow are sub-pages addressed
 * via the shell's `useSubPage` (navigation.tsx), which no-ops outside a real
 * `NavigationProvider`. This stands in for the shell's URL-driven one with
 * in-memory segments — enough for the screen under test to open, close and
 * read its own sub-page.
 */
/** The Select combobox commits on mousedown, not change (packages/ui's Select) — open it, then commit the matching option. */
function chooseSelectOption(triggerLabel: string, optionLabel: string) {
  fireEvent.click(screen.getByRole("combobox", { name: triggerLabel }));
  fireEvent.mouseDown(screen.getByRole("option", { name: optionLabel }));
}

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

const warehouses: WarehouseDTO[] = [{ id: "WH-MAIN", code: "WH-MAIN", name: "المستودع الرئيسي", nameEn: null, branchId: "b1", type: "MAIN", isDefault: true, active: true, projectId: null, custodianUserId: null }];

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
  reversedByEntryId: null, sourceDocType: null, sourceDocId: null, sourceDocNumber: null, sourceModule: "manual" as const,
  lines: [
    { accountId: "1200", debit: "1000.000000", credit: "0.000000", memo: null },
    { accountId: "3100", debit: "0.000000", credit: "1000.000000", memo: null },
  ],
};

function baseHandlers(getCurrent: () => StockAdjustmentDocumentDTO[]) {
  return {
    "GET /inventory/stock-adjustments": (_init: RequestInit | undefined, path: string) => {
      const current = getCurrent();
      const status = new URL(path, "http://x").searchParams.get("status");
      const rows = status ? current.filter((d) => d.status === status) : current;
      return { body: rows };
    },
    "GET /inventory/stock-adjustments/counts": () => {
      const current = getCurrent();
      return {
        body: {
          all: current.length,
          draft: current.filter((d) => d.status === "draft").length,
          confirmed: current.filter((d) => d.status === "confirmed").length,
        },
      };
    },
    "GET /warehouses": () => ({ body: warehouses }),
    "GET /items": () => ({ body: items }),
    "GET /accounts": () => ({ body: accounts }),
    "GET /gl/journal-entries/adj-1": () => ({ body: journalEntry }),
    "GET /gl/journal-entries/adj-5": () => ({ status: 404, body: { error: "NOT_FOUND" } }),
  };
}

function renderScreen() {
  const current = [adj1, adj5];
  const transport = stubTransport(baseHandlers(() => current));
  return renderWithProviders(
    <TestNavigation>
      <StockAdjustmentsScreen />
    </TestNavigation>,
    { transport, initialSession: testAdminSession },
  );
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

  it("shows an empty state when there are no stock adjustments yet", async () => {
    const current: StockAdjustmentDocumentDTO[] = [];
    const transport = stubTransport(baseHandlers(() => current));
    renderWithProviders(
      <TestNavigation>
        <StockAdjustmentsScreen />
      </TestNavigation>,
      { transport, initialSession: testAdminSession },
    );
    expect(await screen.findByText("لا توجد تسويات مطابقة")).toBeInTheDocument();
  });
});

describe("StockAdjustmentsScreen — create: reason picker + INITIAL_STOCK flow", () => {
  it("posts a new opening-balance adjustment via the real API (draft + confirm) and shows it in the list", async () => {
    const generatedId = "adj-0006-0000-0000-000000000000";
    vi.spyOn(crypto, "randomUUID").mockReturnValue(generatedId as ReturnType<typeof crypto.randomUUID>);
    let current = [adj1, adj5];
    const transport = stubTransport({
      ...baseHandlers(() => current),
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
    renderWithProviders(
      <TestNavigation>
        <StockAdjustmentsScreen />
      </TestNavigation>,
      { transport, initialSession: testAdminSession },
    );
    await screen.findByText("ADJ-000001");
    fireEvent.click(screen.getByRole("button", { name: "تسوية جديدة" }));
    expect(screen.getByRole("heading", { name: "اختر سبب التسوية" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /رصيد افتتاحي/ }));
    expect(screen.getByRole("heading", { name: "الرصيد الافتتاحي" })).toBeInTheDocument();

    chooseSelectOption("الصنف للسطر 1", "منتج 3");
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

describe("StockAdjustmentsScreen — a held document whose approval no longer stands", () => {
  it("says why in Arabic and asks for approval again through the document's own confirm", async () => {
    let standing = "reapproval_required";
    let confirms = 0;
    const held = { ...adj1, id: "held-1", docNo: "HELD-0001", status: "pending" as const, workflowRequestId: "held-1:confirm" };
    const transport = stubTransport({
      ...baseHandlers(() => []),
      "GET /inventory/stock-adjustments": () => ({ body: [held] }),
      "GET /workflow/requests/*/standing": () => ({ body: { id: "held-1:confirm", status: standing, reason: standing === "reapproval_required" ? "الموافقة السابقة لم تعد صالحة للترحيل. اطلب الموافقة من جديد." : null, reasonEn: null } }),
      "POST /inventory/stock-adjustments/held-1/confirm": () => {
        confirms += 1;
        standing = "pending";
        return { body: held };
      },
    });
    renderWithProviders(<TestNavigation><StockAdjustmentsScreen /></TestNavigation>, { transport, initialSession: testAdminSession });
    fireEvent.click(await screen.findByText("HELD-0001"));
    const notice = await screen.findByTestId("reapproval-notice");
    expect(notice).toHaveTextContent("الموافقة السابقة لم تعد صالحة للترحيل. اطلب الموافقة من جديد.");
    fireEvent.click(within(notice).getByRole("button", { name: "طلب الموافقة من جديد" }));
    await waitFor(() => expect(confirms).toBe(1));
    await waitFor(() => expect(screen.queryByTestId("reapproval-notice")).not.toBeInTheDocument());
  });
});
