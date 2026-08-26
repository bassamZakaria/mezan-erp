// @vitest-environment jsdom
// Side-effect import so jest-dom's matcher augmentation (toBeInTheDocument,
// toHaveTextContent, …) is visible to apps/web's own `tsc --noEmit` — its
// tsconfig doesn't include packages/ui/src/test/setup.ts (which registers
// this for the rest of the workspace), even though the matchers work at
// runtime via vitest.config.ts's `setupFiles`.
import "@testing-library/jest-dom/vitest";
import { describe, expect, it } from "vitest";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ItemDTO } from "@mezan/contracts";
import { ItemsScreen } from "./ItemsScreen";
import { renderWithProviders, stubTransport, testAdminSession } from "../data/test-support";

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
    brand: null,
    costingMethod: "WAC",
    salePrice: "185.00",
    costPrice: "150.00",
    taxRatePercent: 14,
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

const sampleItems: ItemDTO[] = [
  item(),
  item({ id: "itm-2", code: "ITM-000002", nameAr: "زيت عباد الشمس 1 لتر", nameEn: "Sunflower Oil 1L" }),
  item({ id: "itm-3", code: "ITM-000003", nameAr: "ورق طباعة A4 (رزمة 500 ورقة)", nameEn: null }),
];

function renderScreen(items: ItemDTO[] = sampleItems) {
  let current = [...items];
  const transport = stubTransport({
    "GET /items": () => ({ body: current }),
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
  return renderWithProviders(<ItemsScreen />, { transport, initialSession: testAdminSession });
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
    expect(screen.getByText("زيت عباد الشمس 1 لتر")).toBeInTheDocument();
    expect(screen.queryByText("ورق طباعة A4 (رزمة 500 ورقة)")).not.toBeInTheDocument();
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
    const dialog = screen.getByRole("dialog", { name: "إضافة صنف" });

    expect(within(dialog).getByText("تتبع المخزون")).toBeInTheDocument();
    await user.selectOptions(within(dialog).getByLabelText("نوع الصنف *"), "service");
    expect(within(dialog).queryByText("تتبع المخزون")).not.toBeInTheDocument();
  });

  it("creates a new item from the add form and it's findable via search", async () => {
    const user = userEvent.setup();
    renderScreen();
    await screen.findByText("أرز أبيض مصري 5 كجم");
    await user.click(screen.getByRole("button", { name: "إضافة صنف" }));
    const dialog = screen.getByRole("dialog", { name: "إضافة صنف" });

    await user.type(within(dialog).getByLabelText("اسم الصنف *"), "منتج اختباري جديد");
    await user.click(within(dialog).getByRole("button", { name: "إضافة" }));

    expect(screen.queryByRole("dialog", { name: "إضافة صنف" })).not.toBeInTheDocument();

    await user.type(await screen.findByPlaceholderText("بحث بالاسم أو الكود..."), "منتج اختباري جديد");
    expect(await screen.findByText("منتج اختباري جديد")).toBeInTheDocument();
  });

  it("rejects a duplicate barcode and keeps the form open with an error", async () => {
    const user = userEvent.setup();
    renderScreen();
    await screen.findByText("أرز أبيض مصري 5 كجم");
    await user.click(screen.getByRole("button", { name: "إضافة صنف" }));
    const dialog = screen.getByRole("dialog", { name: "إضافة صنف" });

    await user.type(within(dialog).getByLabelText("اسم الصنف *"), "صنف باركود مكرر");
    await user.click(within(dialog).getByRole("button", { name: "+ إضافة باركود آخر" }));
    await user.click(within(dialog).getByRole("button", { name: "+ إضافة باركود آخر" }));
    const [firstBarcodeInput, secondBarcodeInput] = within(dialog).getAllByLabelText("الباركود");
    await user.type(firstBarcodeInput!, "1112223334445");
    await user.type(secondBarcodeInput!, "1112223334445");

    await user.click(within(dialog).getByRole("button", { name: "إضافة" }));

    expect(await within(dialog).findByRole("alert")).toHaveTextContent("مكرر");
    expect(screen.getByRole("dialog", { name: "إضافة صنف" })).toBeInTheDocument();
  });

  it("edits an existing item's status via the row edit action", async () => {
    const user = userEvent.setup();
    renderScreen();
    await user.click(await screen.findByRole("button", { name: "تعديل أرز أبيض مصري 5 كجم" }));
    const dialog = screen.getByRole("dialog", { name: "تعديل صنف" });

    await user.selectOptions(within(dialog).getByLabelText("الحالة"), "inactive");
    await user.click(within(dialog).getByRole("button", { name: "حفظ" }));

    expect(screen.queryByRole("dialog", { name: "تعديل صنف" })).not.toBeInTheDocument();
    const row = (await screen.findByText("أرز أبيض مصري 5 كجم")).closest("tr")!;
    expect(await within(row).findByText("غير نشط")).toBeInTheDocument();
  });
});
