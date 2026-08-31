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
  localStorage.removeItem("mezan.locale");
});

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

const warehouses: WarehouseDTO[] = [{ id: "WH-MAIN", code: "WH-MAIN", name: "المستودع الرئيسي", nameEn: null, branchId: "b1", type: "MAIN", isDefault: true, active: true }];

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

function doc(overrides: Partial<StockAdjustmentDocumentDTO> = {}): StockAdjustmentDocumentDTO {
  return {
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
    ...overrides,
  };
}

function journalEntry(overrides: Partial<JournalEntryDTO> = {}): JournalEntryDTO {
  return {
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
    ...overrides,
  };
}

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
      return { body: { all: current.length, draft: current.filter((d) => d.status === "draft").length, confirmed: current.filter((d) => d.status === "confirmed").length } };
    },
    "GET /warehouses": () => ({ body: warehouses }),
    "GET /items": () => ({ body: items }),
    "GET /accounts": () => ({ body: accounts }),
  };
}

describe("StockAdjustmentsScreen — reading a reason's fallbacks and English copy", () => {
  it("reads the reason picker's helper text in English once the interface language is switched", async () => {
    localStorage.setItem("mezan.locale", "en");
    const transport = stubTransport(baseHandlers(() => []));
    renderWithProviders(
      <TestNavigation initial={["new"]}>
        <StockAdjustmentsScreen />
      </TestNavigation>,
      { transport, initialSession: testAdminSession },
    );

    expect(await screen.findByText("Record the starting stock balance")).toBeInTheDocument();
  });

  it("shows a placeholder warehouse and reason for a document somehow recorded with no lines", async () => {
    const empty = doc({ id: "adj-empty", docNo: "ADJ-000099", lines: [] });
    const transport = stubTransport(baseHandlers(() => [empty]));
    renderWithProviders(
      <TestNavigation>
        <StockAdjustmentsScreen />
      </TestNavigation>,
      { transport, initialSession: testAdminSession },
    );

    expect(await screen.findByText("ADJ-000099")).toBeInTheDocument();
    expect(screen.getByText((_, node) => node?.tagName === "SPAN" && node.textContent === "— — أخرى")).toBeInTheDocument();
  });
});

describe("StockAdjustmentsScreen — deep links to a document the loaded list doesn't hold", () => {
  it("falls back to fetching a single document by id when it isn't in the current list", async () => {
    const notListed = doc({ id: "adj-deep", docNo: "ADJ-000077" });
    const transport = stubTransport({
      ...baseHandlers(() => []),
      "GET /inventory/stock-adjustments/adj-deep": () => ({ body: notListed }),
      "GET /gl/journal-entries/adj-deep": () => ({ status: 404, body: { error: "NOT_FOUND" } }),
    });
    renderWithProviders(
      <TestNavigation initial={["adj-deep"]}>
        <StockAdjustmentsScreen />
      </TestNavigation>,
      { transport, initialSession: testAdminSession },
    );

    expect(await screen.findByText("ADJ-000077")).toBeInTheDocument();
  });

  it("shows a not-found message when the server doesn't have the deep-linked document either", async () => {
    const transport = stubTransport({
      ...baseHandlers(() => []),
      "GET /inventory/stock-adjustments/adj-missing": () => ({ status: 404, body: { error: "NOT_FOUND" } }),
    });
    renderWithProviders(
      <TestNavigation initial={["adj-missing"]}>
        <StockAdjustmentsScreen />
      </TestNavigation>,
      { transport, initialSession: testAdminSession },
    );

    expect(await screen.findByText("لا توجد تسوية بهذا الرقم")).toBeInTheDocument();
    expect(screen.getByText(/adj-missing/)).toBeInTheDocument();
  });
});

describe("StockAdjustmentsScreen — a draft adjustment's affordances", () => {
  it("shows a placeholder title for a draft with no document number yet", async () => {
    const draft = doc({ id: "adj-draft", docNo: null, status: "draft", confirmedAt: null, journalEntryId: null });
    const transport = stubTransport({
      ...baseHandlers(() => [draft]),
      "POST /inventory/stock-adjustments/adj-draft/confirm": () => ({
        body: { document: { ...draft, status: "confirmed", docNo: "ADJ-000050", confirmedAt: "2026-08-22T00:00:00.000Z" }, held: false },
      }),
    });
    renderWithProviders(
      <TestNavigation>
        <StockAdjustmentsScreen />
      </TestNavigation>,
      { transport, initialSession: testAdminSession },
    );

    const row = (await screen.findByText("—")).closest("tr")!;
    fireEvent.click(row);

    expect(await screen.findByLabelText("حالة المستند")).toBeInTheDocument();
    expect(screen.getByText("تسوية مخزون")).toBeInTheDocument();
  });

  it("shows the server's refusal when confirming a draft adjustment fails", async () => {
    const draft = doc({ id: "adj-draft2", docNo: "ADJ-DRAFT2", status: "draft", confirmedAt: null, journalEntryId: null });
    const transport = stubTransport({
      ...baseHandlers(() => [draft]),
      "POST /inventory/stock-adjustments/adj-draft2/confirm": () => ({ status: 409, body: { message: "لا يمكن اعتماد تسوية تخفض المخزون تحت الصفر." } }),
    });
    renderWithProviders(
      <TestNavigation>
        <StockAdjustmentsScreen />
      </TestNavigation>,
      { transport, initialSession: testAdminSession },
    );

    fireEvent.click(await screen.findByRole("button", { name: "إجراءات ADJ-DRAFT2" }));
    fireEvent.click(await screen.findByRole("menuitem", { name: "تأكيد التسوية" }));

    expect(await screen.findByText("لا يمكن اعتماد تسوية تخفض المخزون تحت الصفر.")).toBeInTheDocument();
  });
});

describe("StockAdjustmentsScreen — filtering, paging and list-loading errors", () => {
  it("counts the reason and warehouse filters toward the active-filter badge", async () => {
    const transport = stubTransport(baseHandlers(() => [doc(), doc({ id: "adj-5", docNo: "ADJ-000005", lines: [{ itemId: "itm-1", warehouseId: "WH-MAIN", reason: "DAMAGE", direction: "OUT", qty: "5.000000", unitCost: null }] })]));
    renderWithProviders(
      <TestNavigation>
        <StockAdjustmentsScreen />
      </TestNavigation>,
      { transport, initialSession: testAdminSession },
    );
    await screen.findByText("ADJ-000001");

    await chooseSelectOption("السبب", "تلف");
    await waitFor(() => expect(screen.queryByText("ADJ-000001")).not.toBeInTheDocument());
    expect(screen.getByText("ADJ-000005")).toBeInTheDocument();

    await chooseSelectOption("المستودع", "المستودع الرئيسي");
    expect(screen.getByText("ADJ-000005")).toBeInTheDocument();
  });

  it("finds an item by an unmatched id, showing the raw id instead of a name", async () => {
    const ghostItem = doc({ id: "adj-ghost", docNo: "ADJ-GHOST", lines: [{ itemId: "itm-ghost", warehouseId: "WH-MAIN", reason: "OTHER", direction: "IN", qty: "1.000000", unitCost: "1.000000" }] });
    const transport = stubTransport(baseHandlers(() => [ghostItem]));
    renderWithProviders(
      <TestNavigation>
        <StockAdjustmentsScreen />
      </TestNavigation>,
      { transport, initialSession: testAdminSession },
    );

    fireEvent.click(await screen.findByText("ADJ-GHOST"));
    expect(await screen.findByText("itm-ghost")).toBeInTheDocument();
  });

  it("shows the server's refusal and a retry option when the adjustment list fails to load", async () => {
    const transport = stubTransport({
      ...baseHandlers(() => []),
      "GET /inventory/stock-adjustments": () => ({ status: 500, body: { message: "server down" } }),
    });
    renderWithProviders(
      <TestNavigation>
        <StockAdjustmentsScreen />
      </TestNavigation>,
      { transport, initialSession: testAdminSession },
    );

    expect(await screen.findByText("تعذّر تحميل تسويات المخزون.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "إعادة المحاولة" })).toBeInTheDocument();
  });

  it("shows the server's refusal when cancelling a row's confirm fails, via the rowError banner", async () => {
    const draft = doc({ id: "adj-rowfail", docNo: "ADJ-ROWFAIL", status: "draft", confirmedAt: null, journalEntryId: null });
    const transport = stubTransport({
      ...baseHandlers(() => [draft]),
      "POST /inventory/stock-adjustments/adj-rowfail/confirm": () => ({ status: 409, body: { message: "الكمية تتجاوز المتاح." } }),
    });
    renderWithProviders(
      <TestNavigation>
        <StockAdjustmentsScreen />
      </TestNavigation>,
      { transport, initialSession: testAdminSession },
    );

    fireEvent.click(await screen.findByRole("button", { name: "إجراءات ADJ-ROWFAIL" }));
    fireEvent.click(await screen.findByRole("menuitem", { name: "تأكيد التسوية" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("الكمية تتجاوز المتاح.");
  });

  it("resets to page 1 when the URL names a page past the end of the list", async () => {
    const transport = stubTransport(baseHandlers(() => [doc()]));
    renderWithProviders(
      <TestNavigation>
        <StockAdjustmentsScreen />
      </TestNavigation>,
      { transport, initialSession: testAdminSession, route: "/?page=5" },
    );
    expect(await screen.findByText("ADJ-000001")).toBeInTheDocument();
  });
});

describe("StockAdjustmentsScreen — the GL tab's fallbacks", () => {
  it("falls back to the raw account id when an entry references an account outside the chart", async () => {
    const withUnknownAccount = doc({ id: "adj-acct", docNo: "ADJ-ACCT" });
    const transport = stubTransport({
      ...baseHandlers(() => [withUnknownAccount]),
      "GET /gl/journal-entries/adj-acct": () => ({ body: journalEntry({ id: "adj-acct", lines: [{ accountId: "9999", debit: "0.000000", credit: "0.000000", memo: null }] }) }),
    });
    renderWithProviders(
      <TestNavigation>
        <StockAdjustmentsScreen />
      </TestNavigation>,
      { transport, initialSession: testAdminSession },
    );

    fireEvent.click(await screen.findByText("ADJ-ACCT"));
    fireEvent.click(screen.getByRole("tab", { name: "المحاسبة" }));
    expect(await screen.findByText("9999")).toBeInTheDocument();
  });

  it("shows a generic failure when the journal entry fails to load for a reason other than 404", async () => {
    const withBrokenEntry = doc({ id: "adj-broken", docNo: "ADJ-BROKEN" });
    const transport = stubTransport({
      ...baseHandlers(() => [withBrokenEntry]),
      "GET /gl/journal-entries/adj-broken": () => ({ status: 500, body: { message: "server down" } }),
    });
    renderWithProviders(
      <TestNavigation>
        <StockAdjustmentsScreen />
      </TestNavigation>,
      { transport, initialSession: testAdminSession },
    );

    fireEvent.click(await screen.findByText("ADJ-BROKEN"));
    fireEvent.click(screen.getByRole("tab", { name: "المحاسبة" }));
    expect(await screen.findByText("تعذّر تحميل القيد المحاسبي.")).toBeInTheDocument();
  });
});

describe("StockAdjustmentsScreen — a two-directional reason lets each line pick IN or OUT", () => {
  it("shows a direction column and posts a decrease line with no unit cost", async () => {
    const generatedId = "adj-0007-0000-0000-000000000000";
    vi.spyOn(crypto, "randomUUID").mockReturnValue(generatedId as ReturnType<typeof crypto.randomUUID>);
    let posted: Record<string, unknown> | null = null;
    const transport = stubTransport({
      ...baseHandlers(() => []),
      "POST /inventory/stock-adjustments/draft": (init) => {
        posted = JSON.parse((init?.body as string) ?? "{}");
        const created: StockAdjustmentDocumentDTO = {
          id: generatedId, docType: "STOCK_ADJUSTMENT", docNo: null, date: (posted as Record<string, unknown>).date as string,
          memo: (posted as Record<string, unknown>).memo as string, status: "draft",
          lines: (posted as Record<string, unknown>).lines as StockAdjustmentDocumentDTO["lines"],
          createdAt: "2026-08-22T10:00:00.000Z", confirmedAt: null, journalEntryId: null,
        };
        return { status: 201, body: created };
      },
      [`POST /inventory/stock-adjustments/${generatedId}/confirm`]: () => ({
        body: { document: { id: generatedId, docType: "STOCK_ADJUSTMENT", docNo: "ADJ-000007", date: "2026-08-22", memo: "", status: "confirmed", lines: [], createdAt: "2026-08-22T10:00:00.000Z", confirmedAt: "2026-08-22T10:00:00.000Z", journalEntryId: null }, held: false },
      }),
    });
    renderWithProviders(
      <TestNavigation initial={["new"]}>
        <StockAdjustmentsScreen />
      </TestNavigation>,
      { transport, initialSession: testAdminSession },
    );

    fireEvent.click(await screen.findByRole("button", { name: /تصحيح جرد/ }));
    expect(screen.getByRole("heading", { name: "تسوية — تصحيح جرد" })).toBeInTheDocument();
    expect(screen.getByText("الاتجاه")).toBeInTheDocument();

    await chooseSelectOption("الصنف للسطر 1", "منتج 1");
    await chooseSelectOption("الاتجاه للسطر 1", "نقصان");
    expect(screen.getByLabelText("سعر التكلفة للسطر 1")).toBeDisabled();
    fireEvent.change(screen.getByLabelText("الكمية للسطر 1"), { target: { value: "3" } });

    fireEvent.click(screen.getByRole("button", { name: "اعتماد التسوية" }));

    await waitFor(() => expect(posted).not.toBeNull());
    const postedLine = (posted as unknown as { lines: Array<Record<string, unknown>> }).lines[0]!;
    expect(postedLine).toMatchObject({ direction: "OUT" });
    expect(postedLine).not.toHaveProperty("unitCost");
  });

  it("adds a second line and edits only that line, leaving the first untouched", async () => {
    const transport = stubTransport(baseHandlers(() => []));
    renderWithProviders(
      <TestNavigation initial={["new"]}>
        <StockAdjustmentsScreen />
      </TestNavigation>,
      { transport, initialSession: testAdminSession },
    );

    fireEvent.click(await screen.findByRole("button", { name: /أخرى/ }));
    await chooseSelectOption("الصنف للسطر 1", "منتج 1");
    fireEvent.change(screen.getByLabelText("الكمية للسطر 1"), { target: { value: "10" } });

    fireEvent.click(screen.getByRole("button", { name: "إضافة بند" }));
    expect(screen.getByLabelText("الكمية للسطر 2")).toHaveValue(null);

    await chooseSelectOption("الصنف للسطر 2", "منتج 3");
    fireEvent.change(screen.getByLabelText("الكمية للسطر 2"), { target: { value: "4" } });

    expect(screen.getByLabelText("الكمية للسطر 1")).toHaveValue(10);
    expect(screen.getByLabelText("الكمية للسطر 2")).toHaveValue(4);

    fireEvent.change(screen.getByLabelText("الكمية للسطر 1"), { target: { value: "" } });
    expect(screen.getByLabelText("الكمية للسطر 1")).toHaveValue(null);
    fireEvent.change(screen.getByLabelText("سعر التكلفة للسطر 1"), { target: { value: "" } });
    expect(screen.getByLabelText("سعر التكلفة للسطر 1")).toHaveValue(null);
  });
});

describe("StockAdjustmentsScreen — creating a non-opening-balance adjustment", () => {
  it("titles the form for the reason and shows the server's refusal when approving fails", async () => {
    const transport = stubTransport({
      ...baseHandlers(() => []),
      "POST /inventory/stock-adjustments/draft": () => ({ status: 409, body: { message: "لا يمكن تسجيل تسوية بكمية صفر." } }),
    });
    renderWithProviders(
      <TestNavigation initial={["new"]}>
        <StockAdjustmentsScreen />
      </TestNavigation>,
      { transport, initialSession: testAdminSession },
    );

    fireEvent.click(await screen.findByRole("button", { name: /تلف/ }));
    expect(screen.getByRole("heading", { name: "تسوية — تلف" })).toBeInTheDocument();

    await chooseSelectOption("الصنف للسطر 1", "منتج 1");
    fireEvent.change(screen.getByLabelText("الكمية للسطر 1"), { target: { value: "2" } });
    fireEvent.click(screen.getByRole("button", { name: "اعتماد التسوية" }));

    expect(await screen.findByText("لا يمكن تسجيل تسوية بكمية صفر.")).toBeInTheDocument();
  });

  it("lands directly on a reason's form from a deep link, with the item already answered", async () => {
    const transport = stubTransport(baseHandlers(() => []));
    renderWithProviders(
      <TestNavigation initial={["new", "DAMAGE", "itm-1"]}>
        <StockAdjustmentsScreen />
      </TestNavigation>,
      { transport, initialSession: testAdminSession },
    );

    expect(await screen.findByRole("heading", { name: "تسوية — تلف" })).toBeInTheDocument();
    const itemCombobox = await screen.findByRole("combobox", { name: "الصنف للسطر 1" });
    await waitFor(() => expect(itemCombobox).toHaveTextContent("منتج 1"));
  });

  it("leaves the reason picker open when the routed reason in the URL isn't a real one", async () => {
    const transport = stubTransport(baseHandlers(() => []));
    renderWithProviders(
      <TestNavigation initial={["new", "NOT_A_REAL_REASON"]}>
        <StockAdjustmentsScreen />
      </TestNavigation>,
      { transport, initialSession: testAdminSession },
    );

    expect(await screen.findByRole("heading", { name: "اختر سبب التسوية" })).toBeInTheDocument();
  });
});
