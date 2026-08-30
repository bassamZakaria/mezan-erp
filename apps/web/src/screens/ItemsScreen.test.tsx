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
import type { ItemCategoryDTO, ItemDTO } from "@mezan/contracts";
import { ItemsScreen } from "./ItemsScreen";
import { renderWithProviders, stubTransport, testAdminSession } from "../data/test-support";
import { NavigationProvider } from "../navigation";

/**
 * ItemsScreen's add/edit forms are sub-pages addressed via the shell's
 * `useSubPage` (navigation.tsx), which no-ops outside a real `NavigationProvider`.
 * This stands in for the shell's URL-driven one with in-memory segments — enough
 * for the screen under test to open, close and read its own sub-page.
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
});
