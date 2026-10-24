// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, expect, it } from "vitest";
import { useState, type ReactNode } from "react";
import { screen, fireEvent, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ItemDTO, PriceListDTO } from "@mezan/contracts";
import { PriceListsScreen } from "./PriceListsScreen";
import { renderWithProviders, stubTransport, testAdminSession } from "../data/test-support";
import { NavigationProvider } from "../navigation";

/** PriceListsScreen's detail view is a sub-page addressed via `useSubPage`
 * (navigation.tsx), which no-ops outside a real `NavigationProvider`. */
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

function itemFixture(overrides: Partial<ItemDTO> = {}): ItemDTO {
  return {
    id: "itm-1",
    code: "ITM-000001",
    nameAr: "أرز أبيض مصري 5 كجم",
    nameEn: "Egyptian White Rice 5kg",
    type: "stock",
    baseUnitCode: "PCS",
    alternateUnits: [],
    barcodes: [],
    categoryId: null,
    brandId: null,
    seasonId: null,
    description: null,
    defaultSupplierId: null,
    specifications: [],
    costingMethod: "WAC",
    salePrice: "185.00",
    costPrice: "150.00",
    taxRatePercent: 14,
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

function fieldInput(container: HTMLElement, label: string): HTMLElement {
  return within(container).getByLabelText(label);
}

function priceList(overrides: Partial<PriceListDTO> = {}): PriceListDTO {
  return {
    id: "pl-1",
    code: "PL-001",
    nameAr: "قائمة الأسعار الأساسية",
    nameEn: null,
    description: null,
    isBase: true,
    active: true,
    lines: [],
    createdAt: "2026-08-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("PriceListsScreen", () => {
  it("renders the real price-list list from GET /price-lists", async () => {
    renderWithProviders(<PriceListsScreen />, {
      initialSession: testAdminSession,
      transport: stubTransport({ "GET /price-lists": () => ({ body: [priceList()] }) }),
    });
    expect(await screen.findByText("قائمة الأسعار الأساسية")).toBeInTheDocument();
    expect(screen.getByText("PL-001")).toBeInTheDocument();
    expect(screen.getAllByText("قائمة أساسية").length).toBeGreaterThan(0);
  });

  it("shows the real empty state when there are no price lists", async () => {
    renderWithProviders(<PriceListsScreen />, {
      initialSession: testAdminSession,
      transport: stubTransport({ "GET /price-lists": () => ({ body: [] }) }),
    });
    expect(await screen.findByText("لا توجد قوائم أسعار — أنشئ قائمة جديدة")).toBeInTheDocument();
  });

  it("creates a new price list through POST /price-lists and refreshes the list", async () => {
    const user = userEvent.setup();
    let created: unknown = null;
    renderWithProviders(<PriceListsScreen />, {
      initialSession: testAdminSession,
      transport: stubTransport({
        "GET /price-lists": () => ({ body: created ? [priceList(), created as PriceListDTO] : [priceList()] }),
        "POST /price-lists": (init) => {
          const body = JSON.parse(String(init?.body));
          created = priceList({ id: "pl-2", code: body.code, nameAr: body.nameAr, isBase: body.isBase ?? false });
          return { status: 201, body: created };
        },
      }),
    });

    await screen.findByText("قائمة الأسعار الأساسية");
    await user.click(screen.getByRole("button", { name: "قائمة أسعار جديدة" }));

    const dialog = screen.getByRole("dialog", { name: "قائمة أسعار جديدة" });
    await user.type(fieldInput(dialog, "الاسم *"), "قائمة عملاء الجملة");
    await user.type(fieldInput(dialog, "الكود *"), "PL-002");
    await user.click(within(dialog).getByRole("button", { name: "حفظ" }));

    await waitFor(() => expect(screen.queryByRole("dialog", { name: "قائمة أسعار جديدة" })).not.toBeInTheDocument());
    expect(await screen.findByText("قائمة عملاء الجملة")).toBeInTheDocument();
  });

  /**
   * D124: `submit()` awaited `create.mutateAsync` with no try/catch, and the
   * click handler does not await `submit()` — so a rejected create escaped as
   * an unhandled promise rejection. In production that is an uncaught error
   * event on `window`; here it is caught and asserted directly.
   */
  it("reports a failed create in the panel and does NOT leak an unhandled promise rejection", async () => {
    const user = userEvent.setup();
    const rejections: unknown[] = [];
    const onRejection = (reason: unknown) => rejections.push(reason);
    process.on("unhandledRejection", onRejection);
    try {
      renderWithProviders(<PriceListsScreen />, {
        initialSession: testAdminSession,
        transport: stubTransport({
          "GET /price-lists": () => ({ body: [priceList()] }),
          "POST /price-lists": () => ({ status: 409, body: { error: "DUPLICATE_CODE", message: "الكود مستخدم بالفعل" } }),
        }),
      });

      await screen.findByText("قائمة الأسعار الأساسية");
      await user.click(screen.getByRole("button", { name: "قائمة أسعار جديدة" }));
      const dialog = screen.getByRole("dialog", { name: "قائمة أسعار جديدة" });
      await user.type(fieldInput(dialog, "الاسم *"), "قائمة مكررة");
      await user.type(fieldInput(dialog, "الكود *"), "PL-001");
      await user.click(within(dialog).getByRole("button", { name: "حفظ" }));

      // The failure is reported where the person is looking, and the panel
      // stays open with their draft intact so they can fix the code.
      expect(await within(dialog).findByText(/الكود مستخدم بالفعل/)).toBeInTheDocument();
      expect(screen.getByRole("dialog", { name: "قائمة أسعار جديدة" })).toBeInTheDocument();

      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(rejections).toEqual([]);
    } finally {
      process.off("unhandledRejection", onRejection);
    }
  });

  it("adds a tier bound to a real item id and sends that id — not its Arabic name — in the PATCH body", async () => {
    let patchBody: Record<string, unknown> | undefined;
    const itemPaths: string[] = [];
    renderWithProviders(
      <TestNavigation>
        <PriceListsScreen />
      </TestNavigation>,
      {
        initialSession: testAdminSession,
        transport: stubTransport({
          "GET /price-lists": () => ({ body: [priceList()] }),
          "GET /items": (_init, path) => {
            itemPaths.push(path);
            return { body: [itemFixture()] };
          },
          "PATCH /price-lists/pl-1": (init) => {
            patchBody = JSON.parse(String(init?.body));
            return { body: priceList({ lines: patchBody!.lines as PriceListDTO["lines"] }) };
          },
        }),
      },
    );

    fireEvent.click(await screen.findByText("قائمة الأسعار الأساسية"));
    fireEvent.click(screen.getAllByRole("button", { name: "إضافة شريحة" })[0]!);

    const itemPicker = screen.getByPlaceholderText("اختر صنفاً");
    fireEvent.focus(itemPicker);
    fireEvent.change(itemPicker, { target: { value: "أرز" } });
    fireEvent.mouseDown(await screen.findByRole("button", { name: (name) => name.startsWith("أرز") }));

    const priceInput = screen.getByLabelText("السعر المخصص");
    fireEvent.focus(priceInput);
    fireEvent.change(priceInput, { target: { value: "200" } });
    fireEvent.blur(priceInput);

    fireEvent.click(screen.getByRole("button", { name: "حفظ الأسعار" }));

    await waitFor(() => expect(patchBody).toBeDefined());
    expect(patchBody?.lines).toEqual([{ itemId: "itm-1", unitCode: "PCS", minQty: "1.000000", price: "200.000000" }]);
    expect(itemPaths.length).toBeGreaterThan(0);
    for (const path of itemPaths) expect(new URLSearchParams(path.split("?")[1]).get("page")).toBe("1");
  });

  it("keeps a stored six-decimal price exact and rounds a typed price half-up from its decimal digits, not its binary float", async () => {
    let patchBody: Record<string, unknown> | undefined;
    renderWithProviders(
      <TestNavigation>
        <PriceListsScreen />
      </TestNavigation>,
      {
        initialSession: testAdminSession,
        transport: stubTransport({
          "GET /price-lists": () => ({ body: [priceList({ lines: [{ itemId: "itm-1", unitCode: "PCS", minQty: "1.000000", price: "12.345678" }] })] }),
          "GET /items": () => ({ body: [itemFixture()] }),
          "PATCH /price-lists/pl-1": (init) => {
            patchBody = JSON.parse(String(init?.body));
            return { body: priceList({ lines: patchBody!.lines as PriceListDTO["lines"] }) };
          },
        }),
      },
    );

    fireEvent.click(await screen.findByText("قائمة الأسعار الأساسية"));
    fireEvent.click(screen.getAllByRole("button", { name: "إضافة شريحة" })[0]!);
    const pickers = screen.getAllByPlaceholderText("اختر صنفاً");
    const itemPicker = pickers[pickers.length - 1]!;
    fireEvent.focus(itemPicker);
    fireEvent.change(itemPicker, { target: { value: "أرز" } });
    fireEvent.mouseDown(await screen.findByRole("button", { name: (name) => name.startsWith("أرز") }));
    const minQtys = screen.getAllByLabelText("الحد الأدنى للكمية");
    const minQty = minQtys[minQtys.length - 1]!;
    fireEvent.focus(minQty);
    fireEvent.change(minQty, { target: { value: "5" } });
    fireEvent.blur(minQty, { target: { value: "5" } });
    const prices = screen.getAllByLabelText("السعر المخصص");
    const priceInput = prices[prices.length - 1]!;
    fireEvent.focus(priceInput);
    fireEvent.change(priceInput, { target: { value: "1.005" } });
    fireEvent.blur(priceInput);

    fireEvent.click(screen.getByRole("button", { name: "حفظ الأسعار" }));

    await waitFor(() => expect(patchBody).toBeDefined());
    // (1.005).toFixed(2) is "1.00", and the old save re-rounded the stored tier to "12.35".
    expect(patchBody?.lines).toEqual([
      { itemId: "itm-1", unitCode: "PCS", minQty: "1.000000", price: "12.345678" },
      { itemId: "itm-1", unitCode: "PCS", minQty: "5.000000", price: "1.010000" },
    ]);
  });

  it("refuses to save two tiers for the same item at the same minimum quantity, and sends no request", async () => {
    let patchCount = 0;
    renderWithProviders(
      <TestNavigation>
        <PriceListsScreen />
      </TestNavigation>,
      {
        initialSession: testAdminSession,
        transport: stubTransport({
          "GET /price-lists": () => ({
            body: [
              priceList({
                lines: [
                  { itemId: "itm-1", unitCode: "PCS", minQty: "1.000000", price: "150.00" },
                  { itemId: "itm-1", unitCode: "PCS", minQty: "1.000000", price: "140.00" },
                ],
              }),
            ],
          }),
          "GET /items": () => ({ body: [itemFixture()] }),
          "PATCH /price-lists/pl-1": () => {
            patchCount += 1;
            return { body: priceList() };
          },
        }),
      },
    );

    fireEvent.click(await screen.findByText("قائمة الأسعار الأساسية"));
    fireEvent.click(await screen.findByRole("button", { name: "حفظ الأسعار" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("لا يمكن تكرار نفس الصنف بنفس الحد الأدنى للكمية.");
    expect(patchCount).toBe(0);
  });

  it("deactivates a price list from the row menu only after the destructive-action confirm, sending {active:false}", async () => {
    const patchBodies: Record<string, unknown>[] = [];
    renderWithProviders(<PriceListsScreen />, {
      initialSession: testAdminSession,
      transport: stubTransport({
        "GET /price-lists": () => ({ body: [priceList()] }),
        "GET /items": () => ({ body: [] }),
        "PATCH /price-lists/pl-1": (init) => {
          patchBodies.push(JSON.parse(String(init?.body)));
          return { body: priceList({ active: false }) };
        },
      }),
    });
    await screen.findByText("قائمة الأسعار الأساسية");

    fireEvent.click(screen.getByRole("button", { name: "إجراءات قائمة الأسعار الأساسية" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "إيقاف القائمة" }));
    const confirmDialog = screen.getByRole("dialog");
    fireEvent.click(within(confirmDialog).getByRole("button", { name: "إيقاف القائمة" }));

    await waitFor(() => expect(patchBodies).toEqual([{ active: false }]));
  });

  it("does NOT show the empty-list message when the load failed — the banner is the only story (D123)", async () => {
    renderWithProviders(<PriceListsScreen />, {
      initialSession: testAdminSession,
      transport: stubTransport({
        "GET /price-lists": () => ({ status: 500, body: { error: "INTERNAL" } }),
        "GET /items": () => ({ body: [] }),
      }),
    });

    expect(await screen.findByText("تعذّر تحميل قوائم الأسعار. (رمز 500)")).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByText("لا توجد قوائم أسعار — أنشئ قائمة جديدة")).not.toBeInTheDocument());
  });
});
