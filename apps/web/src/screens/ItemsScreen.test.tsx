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
import type { ItemDTO } from "@mezan/contracts";
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

function renderScreen(items: ItemDTO[] = sampleItems) {
  let current = [...items];
  const transport = stubTransport({
    "GET /items": (_init, path) => {
      const search = new URL(path, "http://x").searchParams.get("search");
      const rows = search
        ? current.filter((i) => [i.nameAr, i.nameEn, i.code].some((v) => v?.toLowerCase().includes(search.toLowerCase())))
        : current;
      return { body: rows };
    },
    "GET /accounts": () => ({ body: [] }),
    "POST /items": (init) => {
      const body = JSON.parse((init?.body as string) ?? "{}");
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
});
