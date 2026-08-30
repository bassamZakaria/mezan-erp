// @vitest-environment jsdom
// Side-effect import so jest-dom's matcher augmentation (toBeInTheDocument,
// toHaveTextContent, …) is visible to apps/web's own `tsc --noEmit` — its
// tsconfig doesn't include packages/ui/src/test/setup.ts (which registers
// this for the rest of the workspace), even though the matchers work at
// runtime via vitest.config.ts's `setupFiles`.
import "@testing-library/jest-dom/vitest";
import { describe, expect, it } from "vitest";
import { useState, type ReactNode } from "react";
import { screen, within, waitFor, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ItemCategoryDTO, ItemDTO, PriceListDTO } from "@mezan/contracts";
import { ItemsScreen } from "./ItemsScreen";
import { renderWithProviders, stubTransport, testAdminSession } from "../data/test-support";
import { NavigationProvider } from "../navigation";
import type { ScreenKey } from "../router/screens";

/**
 * ItemsScreen's add/edit forms are sub-pages addressed via the shell's
 * `useSubPage` (navigation.tsx), which no-ops outside a real `NavigationProvider`.
 * This stands in for the shell's URL-driven one with in-memory segments — enough
 * for the screen under test to open, close and read its own sub-page.
 */
function TestNavigation({
  children,
  onOpenScreenAt,
}: {
  children: ReactNode;
  onOpenScreenAt?: (screen: ScreenKey, segments: readonly string[]) => void;
}) {
  const [segments, setSegments] = useState<readonly string[]>([]);
  return (
    <NavigationProvider
      value={{
        navigate: () => {},
        segments,
        openSubPage: setSegments,
        openScreenAt: onOpenScreenAt ?? (() => {}),
        intent: null,
        clearIntent: () => {},
      }}
    >
      {children}
    </NavigationProvider>
  );
}

/** The Select combobox commits on mousedown, not change (Select.tsx) — open it, then commit the matching option. */
function chooseSelectOption(triggerLabel: string, optionLabel: string) {
  fireEvent.click(screen.getByRole("combobox", { name: triggerLabel }));
  fireEvent.mouseDown(screen.getByRole("option", { name: optionLabel }));
}

function item(overrides: Partial<ItemDTO> = {}): ItemDTO {
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
    brandId: null, seasonId: null, description: null, defaultSupplierId: null, specifications: [],
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

const sampleItems: ItemDTO[] = [
  item(),
  item({ id: "itm-2", code: "ITM-000002", nameAr: "زيت عباد الشمس 1 لتر", nameEn: "Sunflower Oil 1L" }),
  item({ id: "itm-3", code: "ITM-000003", nameAr: "ورق طباعة A4 (رزمة 500 ورقة)", nameEn: null }),
];

function renderScreen(
  items: ItemDTO[] = sampleItems,
  opts: {
    categories?: ItemCategoryDTO[];
    itemsRequests?: string[];
    onItemsGet?: (path: string) => { status?: number; body: unknown } | undefined;
    onCreateItem?: (body: Record<string, unknown>) => { status?: number; body: unknown } | undefined;
  } = {},
) {
  let current = [...items];
  const itemsRequests = opts.itemsRequests ?? [];
  const transport = stubTransport({
    "GET /items": (_init, path) => {
      itemsRequests.push(path);
      const overridden = opts.onItemsGet?.(path);
      if (overridden) return overridden;
      const search = new URL(path, "http://x").searchParams.get("search");
      const rows = search
        ? current.filter((i) => [i.nameAr, i.nameEn, i.code].some((v) => v?.toLowerCase().includes(search.toLowerCase())))
        : current;
      return { body: rows };
    },
    "GET /accounts": () => ({ body: [] }),
    "GET /item-categories": () => ({ body: opts.categories ?? [] }),
    "GET /item-brands": () => ({ body: [] }),
    "GET /item-seasons": () => ({ body: [] }),
    "GET /item-units": () => ({ body: [] }),
    "POST /items": (init) => {
      const body = JSON.parse((init?.body as string) ?? "{}");
      const overridden = opts.onCreateItem?.(body);
      if (overridden) return overridden;
      const created: ItemDTO = { ...item(), ...body, id: body.id, code: body.code, status: "active" };
      current = [...current, created];
      return { status: 201, body: created };
    },
    "PATCH /items/itm-1": (init) => {
      const patch = JSON.parse((init?.body as string) ?? "{}");
      const updated: ItemDTO = { ...current[0]!, ...patch };
      current = [updated, ...current.slice(1)];
      return { body: updated };
    },
  });
  return renderWithProviders(
    <TestNavigation>
      <ItemsScreen />
    </TestNavigation>,
    { transport, initialSession: testAdminSession },
  );
}

describe("ItemsScreen", () => {
  it("renders the page title and stat totals matching the real catalog", async () => {
    renderScreen();
    expect(screen.getByRole("heading", { name: "الأصناف" })).toBeInTheDocument();
    expect(await screen.findAllByText(String(sampleItems.length))).not.toHaveLength(0);
    const activeCount = sampleItems.filter((i) => i.status === "active").length;
    expect(screen.getAllByText(String(activeCount)).length).toBeGreaterThan(0);
  });

  it("shows an empty state when there are no items yet", async () => {
    renderScreen([]);
    expect(await screen.findByText("لا توجد أصناف مطابقة")).toBeInTheDocument();
  });

  it("filters the visible rows by search text", async () => {
    const user = userEvent.setup();
    renderScreen();
    await screen.findByText("أرز أبيض مصري 5 كجم");
    await user.type(screen.getByPlaceholderText("بحث بالاسم أو الكود..."), "زيت عباد الشمس");
    // Every keystroke re-queries; wait for the search to have fully settled
    // (the non-matching row gone) before asserting on the matching one.
    await waitFor(() => {
      expect(screen.queryByText("ورق طباعة A4 (رزمة 500 ورقة)")).not.toBeInTheDocument();
      expect(screen.getByText("زيت عباد الشمس 1 لتر")).toBeInTheDocument();
    });
  });

  it("opens the item detail view on row click and shows the stubbed stock tab", async () => {
    const user = userEvent.setup();
    renderScreen();
    await user.click(await screen.findByText("أرز أبيض مصري 5 كجم"));

    expect(screen.getByRole("heading", { name: "ITM-000001 — أرز أبيض مصري 5 كجم" })).toBeInTheDocument();
    await user.click(screen.getByRole("tab", { name: "المخزون" }));

    await user.click(screen.getByRole("button", { name: "رجوع للقائمة" }));
    expect(screen.getByRole("heading", { name: "الأصناف" })).toBeInTheDocument();
  });

  it("hides the inventory-policy section once the item type is switched to service", async () => {
    const user = userEvent.setup();
    renderScreen();
    await screen.findByText("أرز أبيض مصري 5 كجم");
    await user.click(screen.getByRole("button", { name: "إضافة صنف" }));
    expect(screen.getByRole("heading", { name: "إضافة صنف" })).toBeInTheDocument();

    expect(screen.getByText("تتبع المخزون")).toBeInTheDocument();
    chooseSelectOption("نوع الصنف", "خدمة");
    expect(screen.queryByText("تتبع المخزون")).not.toBeInTheDocument();
  });

  it("creates a new item from the add form and it's findable via search", async () => {
    const user = userEvent.setup();
    renderScreen();
    await screen.findByText("أرز أبيض مصري 5 كجم");
    await user.click(screen.getByRole("button", { name: "إضافة صنف" }));
    expect(screen.getByRole("heading", { name: "إضافة صنف" })).toBeInTheDocument();

    await user.type(screen.getByLabelText("اسم الصنف *"), "منتج اختباري جديد");
    await user.click(screen.getByRole("button", { name: "إضافة" }));

    // Back on the list — the sub-page closed on successful create.
    expect(await screen.findByRole("heading", { name: "الأصناف" })).toBeInTheDocument();

    await user.type(await screen.findByPlaceholderText("بحث بالاسم أو الكود..."), "منتج اختباري جديد");
    expect(await screen.findByText("منتج اختباري جديد")).toBeInTheDocument();
  });

  it("rejects a duplicate barcode and keeps the form open with an error", async () => {
    const user = userEvent.setup();
    renderScreen();
    await screen.findByText("أرز أبيض مصري 5 كجم");
    await user.click(screen.getByRole("button", { name: "إضافة صنف" }));
    expect(screen.getByRole("heading", { name: "إضافة صنف" })).toBeInTheDocument();

    await user.type(screen.getByLabelText("اسم الصنف *"), "صنف باركود مكرر");
    await user.click(screen.getByRole("button", { name: "+ إضافة باركود آخر" }));
    await user.click(screen.getByRole("button", { name: "+ إضافة باركود آخر" }));
    const [firstBarcodeInput, secondBarcodeInput] = screen.getAllByLabelText("الباركود");
    await user.type(firstBarcodeInput!, "1112223334445");
    await user.type(secondBarcodeInput!, "1112223334445");

    await user.click(screen.getByRole("button", { name: "إضافة" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("مكرر");
    expect(screen.getByRole("heading", { name: "إضافة صنف" })).toBeInTheDocument();
  });

  it("edits an existing item's status via the row edit action", async () => {
    const user = userEvent.setup();
    renderScreen();
    await user.click(await screen.findByRole("button", { name: "تعديل أرز أبيض مصري 5 كجم" }));
    expect(screen.getByRole("heading", { name: "تعديل صنف" })).toBeInTheDocument();

    chooseSelectOption("الحالة", "غير نشط");
    await user.click(screen.getByRole("button", { name: "حفظ" }));

    // Back on the list — the sub-page closed on successful save.
    expect(await screen.findByRole("heading", { name: "الأصناف" })).toBeInTheDocument();
    const row = (await screen.findByText("أرز أبيض مصري 5 كجم")).closest("tr")!;
    expect(await within(row).findByText("غير نشط")).toBeInTheDocument();
  });

  it("shows the load-error banner on a failed fetch, and retry re-fetches", async () => {
    const user = userEvent.setup();
    let fail = true;
    renderScreen(sampleItems, {
      onItemsGet: () => (fail ? { status: 500, body: { error: "INTERNAL" } } : undefined),
    });

    expect(await screen.findByText("تعذّر تحميل الأصناف.")).toBeInTheDocument();

    fail = false;
    await user.click(screen.getByRole("button", { name: "إعادة المحاولة" }));

    expect(await screen.findByText("أرز أبيض مصري 5 كجم")).toBeInTheDocument();
    expect(screen.queryByText("تعذّر تحميل الأصناف.")).not.toBeInTheDocument();
  });

  it("LIMITATION: a failed list load also shows the empty-list message below the error banner", async () => {
    renderScreen(sampleItems, {
      onItemsGet: () => ({ status: 500, body: { error: "INTERNAL" } }),
    });

    expect(await screen.findByText("تعذّر تحميل الأصناف.")).toBeInTheDocument();
    // ItemsScreen.tsx renders the error banner ABOVE the DocumentList, but never
    // suppresses the list's own `emptyState` — `query.data` is undefined on a
    // failed fetch, so `items`/`filtered` fall back to `[]` and DocumentList
    // reads that as "no rows yet". A user cannot tell "the load failed" from
    // "there are no items" from this message alone. When ItemsScreen.tsx hides
    // `emptyState` (or passes a loading/error-aware one) while `query.isError`,
    // this assertion flips to `.not.toBeInTheDocument()`.
    expect(screen.getByText("لا توجد أصناف مطابقة")).toBeInTheDocument();
  });

  it("sends the picked category's real id in the /items request when the category filter is applied", async () => {
    const itemsRequests: string[] = [];
    renderScreen(sampleItems, {
      itemsRequests,
      categories: [
        { id: "cat-groceries", nameAr: "مواد غذائية", nameEn: null, parentId: null, status: "active" },
      ],
    });
    await screen.findByText("أرز أبيض مصري 5 كجم");
    itemsRequests.length = 0;

    chooseSelectOption("تصفية حسب التصنيف", "مواد غذائية");

    await waitFor(() => {
      expect(itemsRequests.some((p) => new URL(p, "http://x").searchParams.get("categoryId") === "cat-groceries")).toBe(true);
    });
    // The label alone proves nothing — the request must carry the category's id, not its Arabic name.
    expect(itemsRequests.every((p) => !p.includes("مواد+غذائية") && !decodeURIComponent(p).includes("مواد غذائية"))).toBe(true);
  });

  it("shows the server's own refusal message and keeps the form open when item creation is rejected server-side", async () => {
    const user = userEvent.setup();
    renderScreen(sampleItems, {
      onCreateItem: () => ({ status: 409, body: { message: "هذا الصنف تم إنشاؤه بالفعل من جلسة أخرى." } }),
    });
    await screen.findByText("أرز أبيض مصري 5 كجم");
    await user.click(screen.getByRole("button", { name: "إضافة صنف" }));
    await user.type(screen.getByLabelText("اسم الصنف *"), "صنف يرفضه الخادم");

    await user.click(screen.getByRole("button", { name: "إضافة" }));

    expect(await screen.findByText("هذا الصنف تم إنشاؤه بالفعل من جلسة أخرى.")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "إضافة صنف" })).toBeInTheDocument();
  });

  it("renders a zero sale price as a formatted zero, not blank or a raw scaled string", async () => {
    renderScreen([item({ salePrice: "0.00" })]);
    const row = (await screen.findByText("أرز أبيض مصري 5 كجم")).closest("tr")!;
    // Columns are nameAr, unit, stock, salePrice, costPrice, status, actions — salePrice is index 3.
    const priceCell = within(row).getAllByRole("cell")[3]!;
    expect(priceCell.textContent).not.toBe("");
    expect(priceCell.textContent).not.toContain("0.000000");
    expect(priceCell.textContent).toMatch(/0/);
  });

  it("sorts by price when the column header is clicked, and reverses on a second click", async () => {
    const user = userEvent.setup();
    renderScreen([
      item({ id: "itm-1", nameAr: "منتج أ", salePrice: "300.00" }),
      item({ id: "itm-2", code: "ITM-000002", nameAr: "منتج ب", salePrice: "100.00" }),
      item({ id: "itm-3", code: "ITM-000003", nameAr: "منتج ج", salePrice: "200.00" }),
    ]);
    await screen.findByText("منتج أ");

    function nameOrder() {
      return screen.getAllByRole("row").slice(1).map((row) => within(row).getAllByRole("cell")[0]!.textContent);
    }

    await user.click(screen.getByRole("columnheader", { name: /سعر البيع/ }));
    await waitFor(() => expect(nameOrder()[0]).toContain("منتج ب"));
    expect(nameOrder().map((c) => c?.includes("منتج ج") ?? false).indexOf(true)).toBe(1);

    await user.click(screen.getByRole("columnheader", { name: /سعر البيع/ }));
    await waitFor(() => expect(nameOrder()[0]).toContain("منتج أ"));
  });

  it("paginates client-side: page 2 shows the remaining rows and page 1's rows are gone", async () => {
    const user = userEvent.setup();
    const many = Array.from({ length: 7 }, (_, i) =>
      item({ id: `itm-${i + 1}`, code: `ITM-${String(i + 1).padStart(6, "0")}`, nameAr: `صنف رقم ${i + 1}` }),
    );
    renderScreen(many);
    await screen.findByText("صنف رقم 1");
    expect(screen.queryByText("صنف رقم 6")).not.toBeInTheDocument();

    await user.click(within(screen.getByRole("navigation", { name: "ترقيم الصفحات" })).getByRole("button", { name: "2" }));

    await waitFor(() => {
      expect(screen.queryByText("صنف رقم 1")).not.toBeInTheDocument();
      expect(screen.getByText("صنف رقم 6")).toBeInTheDocument();
      expect(screen.getByText("صنف رقم 7")).toBeInTheDocument();
    });
  });

  it("offers 'set opening balance' only for an out-of-stock item, and it navigates with the item's real id", async () => {
    const user = userEvent.setup();
    const navCalls: Array<{ screen: ScreenKey; segments: readonly string[] }> = [];
    const items = [
      item({ id: "itm-1", nameAr: "صنف نافد", onHand: "0.000000", stockState: "out" }),
      item({ id: "itm-2", code: "ITM-000002", nameAr: "صنف متوفر", onHand: "40.000000", stockState: "ok" }),
    ];
    const transport = stubTransport({
      "GET /items": () => ({ body: items }),
      "GET /accounts": () => ({ body: [] }),
      "GET /item-categories": () => ({ body: [] }),
      "GET /item-brands": () => ({ body: [] }),
      "GET /item-seasons": () => ({ body: [] }),
      "GET /item-units": () => ({ body: [] }),
    });
    renderWithProviders(
      <TestNavigation onOpenScreenAt={(screen, segments) => navCalls.push({ screen, segments })}>
        <ItemsScreen />
      </TestNavigation>,
      { transport, initialSession: testAdminSession },
    );
    await screen.findByText("صنف نافد");

    // The in-stock row gets no row-actions menu at all (empty `items` makes RowMenu render null) —
    // only its single pencil edit button exists.
    const okRow = (await screen.findByText("صنف متوفر")).closest("tr")!;
    expect(within(okRow).getAllByRole("button", { name: "تعديل صنف متوفر" })).toHaveLength(1);

    const outRow = screen.getByText("صنف نافد").closest("tr")!;
    // The row-menu trigger is rendered before the pencil edit button, so it's
    // the first of the two identically-labelled buttons (see the BUG test below).
    const [rowMenuTrigger] = within(outRow).getAllByRole("button", { name: "تعديل صنف نافد" });
    await user.click(rowMenuTrigger!);
    await user.click(screen.getByRole("menuitem", { name: "تعيين رصيد افتتاحي" }));

    expect(navCalls).toContainEqual({ screen: "stock-adjustments", segments: ["new", "INITIAL_STOCK", "itm-1"] });
  });

  it("BUG: the row-menu trigger and the pencil edit button share the identical accessible name, so they cannot be told apart by a screen reader", async () => {
    renderScreen([item({ id: "itm-1", nameAr: "صنف نافد", onHand: "0.000000", stockState: "out" })]);
    const row = (await screen.findByText("صنف نافد")).closest("tr")!;
    // Both the "⋮" row-actions menu and the pencil "edit" icon button are
    // labelled `t("items.editLabel", { name: row.nameAr })` in ItemsScreen.tsx
    // — "تعديل صنف نافد" for BOTH. A sighted user tells them apart by icon;
    // a screen-reader user hears "تعديل صنف نافد, button" twice with no way
    // to know which opens the row menu and which opens the edit form.
    const sameNameButtons = within(row).getAllByRole("button", { name: "تعديل صنف نافد" });
    expect(sameNameButtons.length).toBe(2);
  });

  it("saves only the edited price-list tier, leaving the sibling list's price and save affordance untouched", async () => {
    const patchRequests: Array<{ id: string; patch: Record<string, unknown> }> = [];
    const priceLists: PriceListDTO[] = [
      {
        id: "pl-retail",
        code: "PL-001",
        nameAr: "قائمة التجزئة",
        nameEn: null,
        description: null,
        isBase: false,
        active: true,
        lines: [{ itemId: "itm-1", unitCode: null, minQty: "0", price: "180.000000" }],
        createdAt: "2024-01-01",
      },
      {
        id: "pl-wholesale",
        code: "PL-002",
        nameAr: "قائمة الجملة",
        nameEn: null,
        description: null,
        isBase: false,
        active: true,
        lines: [{ itemId: "itm-1", unitCode: null, minQty: "0", price: "170.000000" }],
        createdAt: "2024-01-01",
      },
    ];
    const transport = stubTransport({
      "GET /items": () => ({ body: sampleItems }),
      "GET /accounts": () => ({ body: [] }),
      "GET /item-categories": () => ({ body: [] }),
      "GET /item-brands": () => ({ body: [] }),
      "GET /item-seasons": () => ({ body: [] }),
      "GET /item-units": () => ({ body: [] }),
      "GET /price-lists": () => ({ body: priceLists }),
      "PATCH /price-lists/*": (init, path) => {
        const id = path.split("/").pop()!;
        const patch = JSON.parse((init?.body as string) ?? "{}");
        patchRequests.push({ id, patch });
        return { body: { ...priceLists.find((p) => p.id === id)!, ...patch } };
      },
    });
    const user = userEvent.setup();
    renderWithProviders(
      <TestNavigation>
        <ItemsScreen />
      </TestNavigation>,
      { transport, initialSession: testAdminSession },
    );

    await user.click(await screen.findByText("أرز أبيض مصري 5 كجم"));
    await user.click(screen.getByRole("tab", { name: "قوائم الأسعار" }));

    const retailInput = await screen.findByLabelText("قائمة التجزئة — السعر المخصص");
    const wholesaleInput = screen.getByLabelText("قائمة الجملة — السعر المخصص");
    expect((wholesaleInput as HTMLInputElement).value).toBe("170.00");

    fireEvent.focus(retailInput);
    fireEvent.change(retailInput, { target: { value: "200.00" } });
    fireEvent.blur(retailInput);

    await user.click(screen.getByRole("button", { name: "حفظ" }));

    await waitFor(() => expect(patchRequests).toHaveLength(1));
    expect(patchRequests[0]).toEqual({
      id: "pl-retail",
      patch: { lines: [{ itemId: "itm-1", unitCode: null, minQty: "0", price: "200.00" }] },
    });
    // The wholesale row was never touched: no PATCH for it, its input still
    // reads its own unchanged price, and it never grew a "حفظ" button.
    expect(patchRequests.some((r) => r.id === "pl-wholesale")).toBe(false);
    expect((wholesaleInput as HTMLInputElement).value).toBe("170.00");
    expect(screen.queryByRole("button", { name: "حفظ" })).not.toBeInTheDocument();
  });

  it("keeps the edited price and the error visible when a price-list save is rejected, without touching the other list", async () => {
    const priceLists: PriceListDTO[] = [
      {
        id: "pl-retail",
        code: "PL-001",
        nameAr: "قائمة التجزئة",
        nameEn: null,
        description: null,
        isBase: false,
        active: true,
        lines: [{ itemId: "itm-1", unitCode: null, minQty: "0", price: "180.000000" }],
        createdAt: "2024-01-01",
      },
      {
        id: "pl-wholesale",
        code: "PL-002",
        nameAr: "قائمة الجملة",
        nameEn: null,
        description: null,
        isBase: false,
        active: true,
        lines: [{ itemId: "itm-1", unitCode: null, minQty: "0", price: "170.000000" }],
        createdAt: "2024-01-01",
      },
    ];
    const transport = stubTransport({
      "GET /items": () => ({ body: sampleItems }),
      "GET /accounts": () => ({ body: [] }),
      "GET /item-categories": () => ({ body: [] }),
      "GET /item-brands": () => ({ body: [] }),
      "GET /item-seasons": () => ({ body: [] }),
      "GET /item-units": () => ({ body: [] }),
      "GET /price-lists": () => ({ body: priceLists }),
      "PATCH /price-lists/*": () => ({ status: 409, body: { message: "قائمة الأسعار قيد التعديل من مستخدم آخر." } }),
    });
    const user = userEvent.setup();
    renderWithProviders(
      <TestNavigation>
        <ItemsScreen />
      </TestNavigation>,
      { transport, initialSession: testAdminSession },
    );

    await user.click(await screen.findByText("أرز أبيض مصري 5 كجم"));
    await user.click(screen.getByRole("tab", { name: "قوائم الأسعار" }));

    const retailInput = await screen.findByLabelText("قائمة التجزئة — السعر المخصص");
    fireEvent.focus(retailInput);
    fireEvent.change(retailInput, { target: { value: "200.00" } });
    fireEvent.blur(retailInput);
    await user.click(screen.getByRole("button", { name: "حفظ" }));

    expect(await screen.findByText("قائمة الأسعار قيد التعديل من مستخدم آخر.")).toBeInTheDocument();
    // The typed value survives the failure — nothing reverted it.
    expect((retailInput as HTMLInputElement).value).toBe("200.00");
    expect(screen.getByRole("button", { name: "حفظ" })).toBeInTheDocument();
    const wholesaleInput = screen.getByLabelText("قائمة الجملة — السعر المخصص");
    expect((wholesaleInput as HTMLInputElement).value).toBe("170.00");
  });

  it("BUG: a half-piaster price edit (e.g. 180 -> 180.005) is silently dropped by toFixed(2)'s float rounding, so the save round-trips the price unchanged", async () => {
    const priceLists: PriceListDTO[] = [
      {
        id: "pl-retail",
        code: "PL-001",
        nameAr: "قائمة التجزئة",
        nameEn: null,
        description: null,
        isBase: false,
        active: true,
        lines: [{ itemId: "itm-1", unitCode: null, minQty: "0", price: "180.000000" }],
        createdAt: "2024-01-01",
      },
    ];
    const patchRequests: Array<{ id: string; patch: Record<string, unknown> }> = [];
    const transport = stubTransport({
      "GET /items": () => ({ body: sampleItems }),
      "GET /accounts": () => ({ body: [] }),
      "GET /item-categories": () => ({ body: [] }),
      "GET /item-brands": () => ({ body: [] }),
      "GET /item-seasons": () => ({ body: [] }),
      "GET /item-units": () => ({ body: [] }),
      "GET /price-lists": () => ({ body: priceLists }),
      "PATCH /price-lists/*": (init, path) => {
        const id = path.split("/").pop()!;
        const patch = JSON.parse((init?.body as string) ?? "{}");
        patchRequests.push({ id, patch });
        return { body: { ...priceLists[0]!, ...patch } };
      },
    });
    const user = userEvent.setup();
    renderWithProviders(
      <TestNavigation>
        <ItemsScreen />
      </TestNavigation>,
      { transport, initialSession: testAdminSession },
    );

    await user.click(await screen.findByText("أرز أبيض مصري 5 كجم"));
    await user.click(screen.getByRole("tab", { name: "قوائم الأسعار" }));

    const retailInput = await screen.findByLabelText("قائمة التجزئة — السعر المخصص");
    fireEvent.focus(retailInput);
    // 1.005-style values are exactly where IEEE-754 doubles misround under
    // `.toFixed(2)` — (1.005).toFixed(2) === "1.00" in plain JS, not "1.01".
    fireEvent.change(retailInput, { target: { value: "180.005" } });
    fireEvent.blur(retailInput);
    await user.click(screen.getByRole("button", { name: "حفظ" }));

    await waitFor(() => expect(patchRequests).toHaveLength(1));
    // What actually reaches the server today: unchanged from the stored price,
    // even though the row was dirty and the save reported success. A real
    // Money type (bigint at 1e-6 scale) would never lose this half-piaster.
    expect((patchRequests[0]!.patch as { lines: Array<{ price: string }> }).lines[0]!.price).toBe("180.00");
  });

  it("adds two alternate units and removes only the first one, submitting the second one unchanged", async () => {
    const user = userEvent.setup();
    let created: Record<string, unknown> | undefined;
    renderScreen(sampleItems, {
      onCreateItem: (body) => {
        created = body;
        return undefined;
      },
    });
    await screen.findByText("أرز أبيض مصري 5 كجم");
    await user.click(screen.getByRole("button", { name: "إضافة صنف" }));
    await user.type(screen.getByLabelText("اسم الصنف *"), "صنف بوحدات بديلة");

    await user.click(screen.getByRole("button", { name: "+ إضافة وحدة" }));
    await user.click(screen.getByRole("button", { name: "+ إضافة وحدة" }));

    const codeInputs = screen.getAllByLabelText("كود الوحدة");
    const nameInputs = screen.getAllByLabelText("اسم الوحدة");
    const factorInputs = screen.getAllByLabelText("عامل التحويل");
    await user.type(codeInputs[0]!, "CTN");
    await user.type(nameInputs[0]!, "كرتونة");
    await user.clear(factorInputs[0]!);
    await user.type(factorInputs[0]!, "12");
    await user.type(codeInputs[1]!, "BOX");
    await user.type(nameInputs[1]!, "صندوق");
    await user.clear(factorInputs[1]!);
    await user.type(factorInputs[1]!, "24");

    const removeButtons = screen.getAllByLabelText("حذف الوحدة");
    await user.click(removeButtons[0]!);

    expect(screen.getAllByLabelText("كود الوحدة")).toHaveLength(1);
    expect((screen.getByLabelText("كود الوحدة") as HTMLInputElement).value).toBe("BOX");

    await user.click(screen.getByRole("button", { name: "إضافة" }));

    await waitFor(() => expect(created).toBeDefined());
    expect(created?.alternateUnits).toEqual([{ code: "BOX", name: "صندوق", factor: 24 }]);
  });
});
