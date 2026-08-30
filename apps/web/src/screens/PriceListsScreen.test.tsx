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

/**
 * `Field` renders its `<label>` as a sibling of the control, not wrapping it,
 * and never wires `htmlFor`/`id` — so `getByLabelText` cannot resolve it.
 * Locate the control by walking from the visible label text instead.
 */
function fieldInput(container: HTMLElement, label: string): HTMLElement {
  const labelEl = within(container).getByText(label);
  const control = labelEl.parentElement?.querySelector("input, textarea, select, button[role='switch']");
  if (!control) throw new Error(`no control found for label "${label}"`);
  return control as HTMLElement;
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

  it("adds a tier bound to a real item id and sends that id — not its Arabic name — in the PATCH body", async () => {
    let patchBody: Record<string, unknown> | undefined;
    renderWithProviders(
      <TestNavigation>
        <PriceListsScreen />
      </TestNavigation>,
      {
        initialSession: testAdminSession,
        transport: stubTransport({
          "GET /price-lists": () => ({ body: [priceList()] }),
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

    const itemPicker = screen.getByPlaceholderText("اختر صنفاً");
    fireEvent.focus(itemPicker);
    fireEvent.change(itemPicker, { target: { value: "أرز" } });
    fireEvent.mouseDown(screen.getByRole("button", { name: (name) => name.startsWith("أرز") }));

    const priceInput = screen.getByLabelText("السعر المخصص");
    fireEvent.focus(priceInput);
    fireEvent.change(priceInput, { target: { value: "200" } });
    fireEvent.blur(priceInput);

    fireEvent.click(screen.getByRole("button", { name: "حفظ الأسعار" }));

    await waitFor(() => expect(patchBody).toBeDefined());
    expect(patchBody?.lines).toEqual([{ itemId: "itm-1", unitCode: "PCS", minQty: "1.000000", price: "200.00" }]);
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

  it("LIMITATION: a failed list load also shows the empty-list message below the error banner", async () => {
    renderWithProviders(<PriceListsScreen />, {
      initialSession: testAdminSession,
      transport: stubTransport({
        "GET /price-lists": () => ({ status: 500, body: { error: "INTERNAL" } }),
        "GET /items": () => ({ body: [] }),
      }),
    });

    expect(await screen.findByText("تعذّر تحميل قوائم الأسعار.")).toBeInTheDocument();
    // PriceListsScreen.tsx renders the error banner ABOVE the DocumentList, but
    // `query.data` is undefined on a failed fetch, so `priceLists` falls back to
    // `[]` and — because `query.isLoading` is also false by then — DocumentList's
    // `emptyState` renders its ordinary "no price lists" copy underneath the
    // error banner. A user cannot tell "the load failed" from "there are no
    // price lists" from this screen alone. When PriceListsScreen.tsx suppresses
    // (or replaces) `emptyState` while `query.isError`, this assertion flips to
    // `.not.toBeInTheDocument()`.
    expect(screen.getByText("لا توجد قوائم أسعار — أنشئ قائمة جديدة")).toBeInTheDocument();
  });
});
