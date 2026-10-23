// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useState, type ReactNode } from "react";
import { screen, fireEvent, waitFor, within } from "@testing-library/react";
import type { ItemDTO, StockTransferDocumentDTO, WarehouseDTO } from "@mezan/contracts";
import { StockTransfersScreen } from "./StockTransfersScreen";
import { renderWithProviders, stubTransport, testAdminSession } from "../data/test-support";
import { NavigationProvider } from "../navigation";

afterEach(() => {
  vi.restoreAllMocks();
  document.documentElement.removeAttribute("data-theme");
});

/**
 * StockTransfersScreen's detail view and add flow are sub-pages addressed
 * via the shell's `useSubPage` (navigation.tsx), which no-ops outside a real
 * `NavigationProvider`. This stands in for the shell's URL-driven one with
 * in-memory segments — enough for the screen under test to open, close and
 * read its own sub-page.
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

/** The Select combobox commits on mousedown, not change (packages/ui's Select) — open it, then commit the matching option. */
async function pickItem(inputLabel: string, itemName: string) {
  const input = screen.getByRole("combobox", { name: inputLabel });
  fireEvent.focus(input);
  fireEvent.change(input, { target: { value: itemName } });
  fireEvent.mouseDown(await screen.findByRole("button", { name: new RegExp(itemName) }, { timeout: 3000 }));
}

function chooseSelectOption(triggerLabel: string, optionLabel: string) {
  fireEvent.click(screen.getByRole("combobox", { name: triggerLabel }));
  fireEvent.mouseDown(screen.getByRole("option", { name: optionLabel }));
}

const warehouses: WarehouseDTO[] = [
  { id: "WH-MAIN", code: "WH-MAIN", name: "المستودع الرئيسي", nameEn: null, branchId: "b1", type: "MAIN", isDefault: true, active: true, projectId: null, custodianUserId: null },
  { id: "WH-VAN", code: "WH-VAN", name: "مستودع الفان", nameEn: null, branchId: "b1", type: "VAN", isDefault: false, active: true, projectId: null, custodianUserId: null },
];

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

const items: ItemDTO[] = [item()];

const trf1: StockTransferDocumentDTO = {
  id: "trf-1",
  docType: "STOCK_TRANSFER",
  docNo: "TRF-000001",
  date: "2026-08-10",
  memo: "تحويل للفان",
  status: "confirmed",
  lines: [{ itemId: "itm-1", fromWarehouseId: "WH-MAIN", toWarehouseId: "WH-VAN", qty: "10.000000" }],
  createdAt: "2026-08-10T10:00:00.000Z",
  confirmedAt: "2026-08-10T10:00:00.000Z",
};

const trf2: StockTransferDocumentDTO = {
  id: "trf-2",
  docType: "STOCK_TRANSFER",
  docNo: "TRF-000002",
  date: "2026-08-11",
  memo: "",
  status: "draft",
  lines: [{ itemId: "itm-1", fromWarehouseId: "WH-VAN", toWarehouseId: "WH-MAIN", qty: "2.000000" }],
  createdAt: "2026-08-11T10:00:00.000Z",
  confirmedAt: null,
};

const itemRequests: string[] = [];

function baseHandlers(current: StockTransferDocumentDTO[]) {
  return {
    "GET /inventory/stock-transfers": () => ({ body: current }),
    "GET /warehouses": () => ({ body: warehouses }),
    "GET /items": (_init: RequestInit | undefined, path: string) => {
      itemRequests.push(path);
      return { body: items };
    },
  };
}

function renderScreen() {
  const transport = stubTransport(baseHandlers([trf1, trf2]));
  return renderWithProviders(
    <TestNavigation>
      <StockTransfersScreen />
    </TestNavigation>,
    { transport, initialSession: testAdminSession },
  );
}

describe("StockTransfersScreen — list", () => {
  it("renders confirmed and draft transfers from the real backend", async () => {
    renderScreen();
    expect(screen.getByRole("heading", { name: "تحويلات المخزون" })).toBeInTheDocument();
    expect(await screen.findByText("TRF-000001")).toBeInTheDocument();
    expect(screen.getByText("TRF-000002")).toBeInTheDocument();
  });

  it("opens the detail view showing the route and valuation-neutral effect", async () => {
    renderScreen();
    fireEvent.click(await screen.findByText("TRF-000001"));
    expect(screen.getByLabelText("حالة المستند")).toBeInTheDocument();
    expect(screen.getByText("لا يتغير إجمالي قيمة المخزون")).toBeInTheDocument();
    expect(screen.getByText(/لا يمكن إلغاء تحويل مؤكد/)).toBeInTheDocument();
  });

  it("shows an empty state when there are no stock transfers yet", async () => {
    const transport = stubTransport(baseHandlers([]));
    renderWithProviders(
      <TestNavigation>
        <StockTransfersScreen />
      </TestNavigation>,
      { transport, initialSession: testAdminSession },
    );
    expect(await screen.findByText("لا توجد تحويلات مطابقة")).toBeInTheDocument();
  });
});

describe("StockTransfersScreen — create: valuation neutrality end to end", () => {
  it("posts a new transfer via the real API (draft + confirm) and shows it in the list", async () => {
    const postedItemIds: string[] = [];
    const generatedId = "trf-0003-0000-0000-000000000000";
    vi.spyOn(crypto, "randomUUID").mockReturnValue(generatedId as ReturnType<typeof crypto.randomUUID>);
    let current = [trf1, trf2];
    const transport = stubTransport({
      ...baseHandlers(current),
      "GET /inventory/stock-transfers": () => ({ body: current }),
      "POST /inventory/stock-transfers/draft": (init) => {
        const body = JSON.parse((init?.body as string) ?? "{}");
        postedItemIds.push(...body.lines.map((l: { itemId: string }) => l.itemId));
        const created: StockTransferDocumentDTO = {
          id: body.id,
          docType: "STOCK_TRANSFER",
          docNo: null,
          date: body.date,
          memo: body.memo ?? "",
          status: "draft",
          lines: body.lines,
          createdAt: "2026-08-22T10:00:00.000Z",
          confirmedAt: null,
        };
        current = [...current, created];
        return { status: 201, body: created };
      },
      [`POST /inventory/stock-transfers/${generatedId}/confirm`]: () => {
        const confirmed: StockTransferDocumentDTO = {
          ...current[current.length - 1]!,
          status: "confirmed",
          docNo: "TRF-000003",
          confirmedAt: "2026-08-22T10:00:00.000Z",
        };
        current = current.map((d) => (d.id === generatedId ? confirmed : d));
        return { body: { document: confirmed, held: false } };
      },
    });
    renderWithProviders(
      <TestNavigation>
        <StockTransfersScreen />
      </TestNavigation>,
      { transport, initialSession: testAdminSession },
    );

    await screen.findByText("TRF-000001");
    // The form seeds its warehouses once, on mount — open it only after they have loaded.
    await screen.findAllByText(/مستودع الفان/);
    fireEvent.click(screen.getByRole("button", { name: /تحويل جديد/ }));
    expect(screen.getByRole("heading", { name: "تحويل مخزون جديد" })).toBeInTheDocument();

    await pickItem("الصنف للسطر 1", "منتج 1");
    fireEvent.change(screen.getByLabelText("كمية التحويل للسطر 1"), { target: { value: "5" } });

    const save = screen.getByRole("button", { name: "حفظ" });
    expect(save).toBeEnabled();
    fireEvent.click(save);

    await waitFor(() => expect(screen.getByRole("heading", { name: "تحويلات المخزون" })).toBeInTheDocument());
    expect(await screen.findByText("TRF-000003")).toBeInTheDocument();
    expect(postedItemIds).toEqual(["itm-1"]);
    expect(itemRequests.length).toBeGreaterThan(0);
    for (const path of itemRequests) expect(new URLSearchParams(path.split("?")[1]).get("page")).toBe("1");
  });

  function draftOf(body: { id: string; date: string; memo?: string; lines: StockTransferDocumentDTO["lines"] }): StockTransferDocumentDTO {
    return {
      id: body.id, docType: "STOCK_TRANSFER", docNo: null, date: body.date, memo: body.memo ?? "", status: "draft", lines: body.lines,
      createdAt: "2026-08-22T10:00:00.000Z", confirmedAt: null,
    };
  }

  async function fillNewTransfer() {
    await screen.findAllByText(/مستودع الفان/);
    fireEvent.click((await screen.findAllByRole("button", { name: /تحويل جديد/ }))[0]!);
    await pickItem("الصنف للسطر 1", "منتج 1");
    fireEvent.change(screen.getByLabelText("كمية التحويل للسطر 1"), { target: { value: "5" } });
  }

  it("sends the same id when save is pressed again after a confirm that failed, and a new id for the next transfer", async () => {
    const sentIds: string[] = [];
    let current = [trf1];
    let confirms = 0;
    const transport = stubTransport({
      ...baseHandlers(current),
      "GET /inventory/stock-transfers": () => ({ body: current }),
      "POST /inventory/stock-transfers/draft": (init) => {
        const created = draftOf(JSON.parse((init?.body as string) ?? "{}"));
        sentIds.push(created.id);
        current = [trf1, created];
        return { status: 201, body: created };
      },
      "POST /inventory/stock-transfers/*/confirm": () => {
        confirms += 1;
        if (confirms === 1) return { status: 503, body: { error: "DATABASE_BUSY", message: "الخادم مشغول، أعد المحاولة" } };
        const confirmed = { ...current[current.length - 1]!, status: "confirmed" as const, docNo: `TRF-00000${confirms}` };
        current = [trf1, confirmed];
        return { body: { document: confirmed, held: false } };
      },
    });
    renderWithProviders(<TestNavigation><StockTransfersScreen /></TestNavigation>, { transport, initialSession: testAdminSession });

    await fillNewTransfer();
    fireEvent.click(screen.getByRole("button", { name: "حفظ" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("الخادم مشغول");
    fireEvent.click(screen.getByRole("button", { name: "حفظ" }));
    await waitFor(() => expect(screen.getByRole("heading", { name: "تحويلات المخزون" })).toBeInTheDocument());

    await fillNewTransfer();
    fireEvent.click(screen.getByRole("button", { name: "حفظ" }));
    await waitFor(() => expect(sentIds).toHaveLength(3));

    expect(sentIds[1]).toBe(sentIds[0]);
    expect(sentIds[2]).not.toBe(sentIds[0]);
  });

  it("does not confirm again a transfer the resend was answered with as already confirmed", async () => {
    let confirms = 0;
    const transport = stubTransport({
      ...baseHandlers([trf1]),
      "POST /inventory/stock-transfers/draft": (init) => ({
        status: 201,
        body: { ...draftOf(JSON.parse((init?.body as string) ?? "{}")), status: "confirmed", docNo: "TRF-000009" },
      }),
      "POST /inventory/stock-transfers/*/confirm": () => {
        confirms += 1;
        return { status: 409, body: { error: "INVALID_DOCUMENT_TRANSITION", message: "المستند مؤكَّد بالفعل" } };
      },
    });
    renderWithProviders(<TestNavigation><StockTransfersScreen /></TestNavigation>, { transport, initialSession: testAdminSession });

    await fillNewTransfer();
    fireEvent.click(screen.getByRole("button", { name: "حفظ" }));

    await waitFor(() => expect(screen.getByRole("heading", { name: "تحويلات المخزون" })).toBeInTheDocument());
    expect(confirms).toBe(0);
  });

  it("opens the transfer already saved, with a notice, when its id was used with other contents", async () => {
    let current = [trf1];
    const transport = stubTransport({
      ...baseHandlers(current),
      "GET /inventory/stock-transfers": () => ({ body: current }),
      "POST /inventory/stock-transfers/draft": (init) => {
        const body = JSON.parse((init?.body as string) ?? "{}");
        current = [trf1, { ...draftOf(body), status: "confirmed", docNo: "TRF-000007" }];
        return { status: 409, body: { error: "IDEMPOTENCY_KEY_REUSED", message: "سبق تسجيل مستند بهذا المعرّف ببيانات مختلفة" } };
      },
    });
    renderWithProviders(<TestNavigation><StockTransfersScreen /></TestNavigation>, { transport, initialSession: testAdminSession });

    await fillNewTransfer();
    fireEvent.click(screen.getByRole("button", { name: "حفظ" }));

    expect(await screen.findByRole("status")).toHaveTextContent("سبق حفظ هذا المستند، ففُتح المستند المحفوظ بدل إنشاء آخر");
    expect(await screen.findByText("TRF-000007")).toBeInTheDocument();
  });

  it("blocks posting when source and destination warehouses are the same", async () => {
    renderScreen();
    await screen.findByText("TRF-000001");
    fireEvent.click(screen.getByRole("button", { name: /تحويل جديد/ }));
    chooseSelectOption("المستودع الوجهة *", "المستودع الرئيسي");
    expect(screen.getByText("يجب أن يختلف المستودع المصدر عن مستودع الوجهة.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "حفظ" })).toBeDisabled();
  });
});

describe("StockTransfersScreen — a held document whose approval no longer stands", () => {
  it("says why in Arabic and asks for approval again through the document's own confirm", async () => {
    let standing = "reapproval_required";
    let confirms = 0;
    const held = { ...trf1, id: "held-1", docNo: "HELD-0001", status: "pending" as const, workflowRequestId: "held-1:confirm" };
    const transport = stubTransport({
      ...baseHandlers([]),
      "GET /inventory/stock-transfers": () => ({ body: [held] }),
      "GET /workflow/requests/*/standing": () => ({ body: { id: "held-1:confirm", status: standing, reason: standing === "reapproval_required" ? "الموافقة السابقة لم تعد صالحة للترحيل. اطلب الموافقة من جديد." : null, reasonEn: null } }),
      "POST /inventory/stock-transfers/held-1/confirm": () => {
        confirms += 1;
        standing = "pending";
        return { body: held };
      },
    });
    renderWithProviders(<TestNavigation><StockTransfersScreen /></TestNavigation>, { transport, initialSession: testAdminSession });
    fireEvent.click(await screen.findByText("HELD-0001"));
    const notice = await screen.findByTestId("reapproval-notice");
    expect(notice).toHaveTextContent("الموافقة السابقة لم تعد صالحة للترحيل. اطلب الموافقة من جديد.");
    fireEvent.click(within(notice).getByRole("button", { name: "طلب الموافقة من جديد" }));
    await waitFor(() => expect(confirms).toBe(1));
    await waitFor(() => expect(screen.queryByTestId("reapproval-notice")).not.toBeInTheDocument());
  });
});
