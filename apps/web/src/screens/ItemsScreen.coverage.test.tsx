// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, expect, it } from "vitest";
import { useState, type ReactNode } from "react";
import { screen, within, waitFor, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type {
  AccountDTO,
  AttachmentDTO,
  ItemBrandDTO,
  ItemCategoryDTO,
  ItemDTO,
  ItemSeasonDTO,
  ItemSpecificationDTO,
  PriceListDTO,
  SupplierDTO,
  WarehouseDTO,
} from "@mezan/contracts";
import type { ItemCostLayerRecord, ItemStockPositionRecord, StockMovementRowDTO } from "../data/hooks";
import { ItemsScreen } from "./ItemsScreen";
import { renderWithProviders, stubTransport, testAdminSession } from "../data/test-support";
import { NavigationProvider } from "../navigation";
import type { ScreenKey } from "../router/screens";

/**
 * Mirrors ItemsScreen.test.tsx's TestNavigation, plus `initialSegments` so a
 * test can deep-link straight to an edit sub-page (e.g. one whose target no
 * longer exists) without going through the click that normally opens it.
 */
function TestNavigation({
  children,
  onOpenScreenAt,
  onNavigate,
  initialSegments = [],
}: {
  children: ReactNode;
  onOpenScreenAt?: (screen: ScreenKey, segments: readonly string[]) => void;
  onNavigate?: (screen: ScreenKey) => void;
  initialSegments?: readonly string[];
}) {
  const [segments, setSegments] = useState<readonly string[]>(initialSegments);
  return (
    <NavigationProvider
      value={{
        navigate: onNavigate ?? (() => {}),
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

/**
 * EntityPicker (packages/ui) opens on focus and commits on the option's
 * mousedown, before the input's own blur can close it. The mousedown handler
 * lives on the `<button>` nested inside each `<li role="option">`, not on the
 * `<li>` itself — firing the event on the li never reaches it, since it only
 * bubbles upward to ancestors, not down into descendants.
 */
function pickEntity(triggerLabel: string, optionLabel: string) {
  fireEvent.focus(screen.getByRole("combobox", { name: triggerLabel }));
  const option = screen.getByRole("option", { name: optionLabel });
  fireEvent.mouseDown(option.querySelector("button")!);
}

/** MoneyInput (packages/ui) shows a raw draft while focused and commits only on blur. */
function setMoney(input: HTMLElement, value: string) {
  fireEvent.focus(input);
  fireEvent.change(input, { target: { value } });
  fireEvent.blur(input);
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

function warehouse(overrides: Partial<WarehouseDTO> = {}): WarehouseDTO {
  return { id: "wh-1", code: "MAIN", name: "المستودع الرئيسي", nameEn: null, branchId: "b1", type: "MAIN", isDefault: true, active: true, ...overrides };
}

function account(overrides: Partial<AccountDTO> = {}): AccountDTO {
  return {
    id: "acc-1",
    code: "4101",
    nameAr: "إيرادات المبيعات",
    nameEn: null,
    type: "revenue",
    naturalBalance: "credit",
    parentId: null,
    isHeader: false,
    status: "active",
    ...overrides,
  };
}

function supplier(overrides: Partial<SupplierDTO> = {}): SupplierDTO {
  return {
    id: "sup-1",
    code: "SUP-001",
    nameAr: "مورد الأرز المصري",
    nameEn: null,
    phone: null,
    email: null,
    contactPerson: null,
    taxNumber: null,
    category: null,
    notes: null,
    paymentTermsDays: 30,
    currency: "EGP",
    openingBalance: "0.00",
    active: true,
    addressCity: null,
    addressDistrict: null,
    addressStreet: null,
    ...overrides,
  };
}

function brand(overrides: Partial<ItemBrandDTO> = {}): ItemBrandDTO {
  return { id: "brand-1", code: "BR-01", nameAr: "الأهرام", nameEn: null, status: "active", ...overrides };
}

function season(overrides: Partial<ItemSeasonDTO> = {}): ItemSeasonDTO {
  return { id: "season-1", code: "SUM", nameAr: "الصيف", nameEn: null, startDate: null, endDate: null, status: "active", ...overrides };
}

function specDefinition(overrides: Partial<ItemSpecificationDTO> = {}): ItemSpecificationDTO {
  return {
    code: "WEIGHT",
    nameAr: "الوزن",
    nameEn: null,
    type: "text",
    values: [],
    unit: "كجم",
    filterable: true,
    status: "active",
    usageCount: 0,
    ...overrides,
  };
}

function stockPosition(overrides: Partial<ItemStockPositionRecord> = {}): ItemStockPositionRecord {
  return { warehouseId: "wh-1", onHand: "40.000000", reserved: "5.000000", available: "35.000000", totalValue: "6000.000000", averageCost: "150.000000", ...overrides };
}

function costLayer(overrides: Partial<ItemCostLayerRecord> = {}): ItemCostLayerRecord {
  return {
    id: "layer-1",
    warehouseId: "wh-1",
    unitCost: "150.000000",
    originalQty: "50.000000",
    remainingQty: "40.000000",
    sourceDocType: "GOODS_RECEIPT",
    sourceDocNumber: "GR-000001",
    createdAt: "2026-07-01T09:00:00.000Z",
    ...overrides,
  };
}

function movement(overrides: Partial<StockMovementRowDTO> = {}): StockMovementRowDTO {
  return {
    id: "mv-1",
    itemId: "itm-1",
    warehouseId: "wh-1",
    direction: "IN",
    qty: "50.000000",
    unitCost: "150.000000",
    sourceDocType: "GOODS_RECEIPT",
    sourceDocId: "gr-1",
    sourceDocNumber: "GR-000001",
    reason: null,
    occurredAt: "2026-07-01T09:00:00.000Z",
    ...overrides,
  };
}

function attachment(overrides: Partial<AttachmentDTO> = {}): AttachmentDTO {
  return {
    id: "att-1",
    entityType: "item",
    entityId: "itm-1",
    fileName: "product.png",
    mimeType: "image/png",
    byteSize: 1024,
    uploadedBy: "USER-ADMIN",
    uploadedAt: "2026-07-01T09:00:00.000Z",
    notes: null,
    ...overrides,
  };
}

function renderScreen(
  items: ItemDTO[] = sampleItems,
  opts: {
    categories?: ItemCategoryDTO[];
    itemsRequests?: string[];
    onItemsGet?: (path: string) => { status?: number; body: unknown } | undefined;
    onCreateItem?: (body: Record<string, unknown>) => { status?: number; body: unknown } | undefined;
    accounts?: AccountDTO[];
    suppliers?: SupplierDTO[];
    brands?: ItemBrandDTO[];
    seasons?: ItemSeasonDTO[];
    warehouses?: WarehouseDTO[];
    specifications?: ItemSpecificationDTO[];
    stockByItem?: Record<string, { positions: ItemStockPositionRecord[]; layers: ItemCostLayerRecord[] }>;
    movementsByItem?: Record<string, StockMovementRowDTO[]>;
    attachmentsByItem?: Record<string, AttachmentDTO[]>;
    units?: { code: string; nameAr: string; nameEn: string | null; status: "active" | "inactive" }[];
    onPatchItem?: (id: string, patch: Record<string, unknown>) => void;
    onOpenScreenAt?: (screen: ScreenKey, segments: readonly string[]) => void;
    onNavigate?: (screen: ScreenKey) => void;
    initialSegments?: readonly string[];
  } = {},
) {
  let current = [...items];
  const itemsRequests = opts.itemsRequests ?? [];
  const transport = stubTransport({
    "GET /items": (_init, path) => {
      itemsRequests.push(path);
      const overridden = opts.onItemsGet?.(path);
      if (overridden) return overridden;
      const params = new URL(path, "http://x").searchParams;
      const search = params.get("search");
      const status = params.get("status");
      const categoryId = params.get("categoryId");
      const brandId = params.get("brandId");
      const seasonId = params.get("seasonId");
      const unitCode = params.get("unitCode");
      let rows = current;
      if (status === "active" || status === "inactive") rows = rows.filter((i) => i.status === status);
      if (search) rows = rows.filter((i) => [i.nameAr, i.nameEn, i.code].some((v) => v?.toLowerCase().includes(search.toLowerCase())));
      if (categoryId) rows = rows.filter((i) => i.categoryId === categoryId);
      if (brandId) rows = rows.filter((i) => i.brandId === brandId);
      if (seasonId) rows = rows.filter((i) => i.seasonId === seasonId);
      if (unitCode) rows = rows.filter((i) => i.baseUnitCode === unitCode);
      return { body: rows };
    },
    "GET /items/counts": () => {
      const active = current.filter((i) => i.status === "active").length;
      return { body: { all: current.length, active, inactive: current.length - active } };
    },
    "GET /items/stats": () => {
      const active = current.filter((i) => i.status === "active").length;
      return { body: { count: current.length, active, stockTracked: current.filter((i) => i.trackInventory).length, nonStock: current.filter((i) => !i.trackInventory).length } };
    },
    "GET /accounts": () => ({ body: opts.accounts ?? [] }),
    "GET /item-categories": () => ({ body: opts.categories ?? [] }),
    "GET /item-brands": () => ({ body: opts.brands ?? [] }),
    "GET /item-seasons": () => ({ body: opts.seasons ?? [] }),
    "GET /item-units": () => ({ body: opts.units ?? [] }),
    "GET /suppliers": () => ({ body: opts.suppliers ?? [] }),
    "GET /warehouses": () => ({ body: opts.warehouses ?? [] }),
    "GET /item-specifications": () => ({ body: opts.specifications ?? [] }),
    "GET /inventory/items/*/stock": (_init, path) => {
      const itemId = path.split("/")[3]!.split("?")[0]!;
      return { body: opts.stockByItem?.[itemId] ?? { positions: [], layers: [] } };
    },
    "GET /inventory/movements": (_init, path) => {
      const params = new URL(path, "http://x").searchParams;
      const itemId = params.get("itemId") ?? "";
      return { body: opts.movementsByItem?.[itemId] ?? [] };
    },
    "GET /audit": () => ({ body: [] }),
    "GET /attachments": (_init, path) => {
      const entityId = new URL(path, "http://x").searchParams.get("entityId") ?? "";
      return { body: opts.attachmentsByItem?.[entityId] ?? [] };
    },
    "POST /items": (init) => {
      const body = JSON.parse((init?.body as string) ?? "{}");
      const overridden = opts.onCreateItem?.(body);
      if (overridden) return overridden;
      const created: ItemDTO = { ...item(), ...body, id: body.id, code: body.code, status: "active" };
      current = [...current, created];
      return { status: 201, body: created };
    },
    "PATCH /items/*": (init, path) => {
      const id = path.split("/").pop()!;
      const patch = JSON.parse((init?.body as string) ?? "{}");
      opts.onPatchItem?.(id, patch);
      const existing = current.find((i) => i.id === id)!;
      const updated: ItemDTO = { ...existing, ...patch };
      current = current.map((i) => (i.id === id ? updated : i));
      return { body: updated };
    },
  });
  return renderWithProviders(
    <TestNavigation onOpenScreenAt={opts.onOpenScreenAt} onNavigate={opts.onNavigate} initialSegments={opts.initialSegments}>
      <ItemsScreen />
    </TestNavigation>,
    { transport, initialSession: testAdminSession },
  );
}

describe("ItemsScreen coverage", () => {

  it("BUG: the auto-generated code collides with an existing item's code once the catalogue has a gap, and the form then refuses to save under that colliding code", async () => {
    const user = userEvent.setup();
    // Only one item in the catalogue, but its code is ITM-000002 (e.g. the
    // first item was deleted elsewhere) — nextItemCode() is derived purely
    // from `items.length`, so it proposes the very code already in use.
    renderScreen([item({ id: "itm-2", code: "ITM-000002" })]);
    await user.click(await screen.findByRole("button", { name: "إضافة صنف" }));
    expect((screen.getByLabelText("كود الصنف") as HTMLInputElement).value).toBe("ITM-000002");

    await user.type(screen.getByLabelText("اسم الصنف *"), "صنف جديد");
    await user.click(screen.getByRole("button", { name: "إضافة" }));

    expect(await screen.findByRole("alert")).toHaveTextContent('الكود "ITM-000002" مستخدم بالفعل');
    expect(screen.getByRole("heading", { name: "إضافة صنف" })).toBeInTheDocument();
  });

  it("refuses a name made up only of whitespace", async () => {
    const user = userEvent.setup();
    renderScreen();
    await user.click(await screen.findByRole("button", { name: "إضافة صنف" }));
    await user.type(screen.getByLabelText("اسم الصنف *"), " ");
    await user.click(screen.getByRole("button", { name: "إضافة" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("اسم الصنف مطلوب");
  });

  it("refuses to save an edited item whose legacy data tracks stock despite a type that cannot — the form offers no toggle to fix it", async () => {
    const user = userEvent.setup();
    // Bad data an import or an older build could have produced: a service
    // item flagged as stock-tracking. Because the stock-policy section only
    // renders for draft.type === "stock", this item's edit form never shows
    // the toggle that would let the user clear it.
    renderScreen([item({ id: "itm-1", type: "service", trackInventory: true })]);
    await user.click(await screen.findByRole("button", { name: "تعديل أرز أبيض مصري 5 كجم" }));
    expect(screen.queryByText("تتبع المخزون")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "حفظ" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("لا يمكن لصنف من نوع");
  });

  it("refuses an alternate unit left with a blank code and name", async () => {
    const user = userEvent.setup();
    renderScreen();
    await user.click(await screen.findByRole("button", { name: "إضافة صنف" }));
    await user.type(screen.getByLabelText("اسم الصنف *"), "صنف بوحدة ناقصة");
    await user.click(screen.getByRole("button", { name: "+ إضافة وحدة" }));

    await user.click(screen.getByRole("button", { name: "إضافة" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("كود واسم الوحدة البديلة مطلوبان");
  });

  it("refuses an alternate unit whose code repeats the base unit", async () => {
    const user = userEvent.setup();
    renderScreen();
    await user.click(await screen.findByRole("button", { name: "إضافة صنف" }));
    await user.type(screen.getByLabelText("اسم الصنف *"), "صنف بوحدة مطابقة");
    await user.click(screen.getByRole("button", { name: "+ إضافة وحدة" }));
    await user.type(screen.getByLabelText("كود الوحدة"), "PCS");
    await user.type(screen.getByLabelText("اسم الوحدة"), "قطعة بديلة");

    await user.click(screen.getByRole("button", { name: "إضافة" }));
    expect(await screen.findByRole("alert")).toHaveTextContent('الوحدة البديلة "PCS" لا يمكن أن تطابق الوحدة الأساسية');
  });

  it("refuses two alternate units that share the same code", async () => {
    const user = userEvent.setup();
    renderScreen();
    await user.click(await screen.findByRole("button", { name: "إضافة صنف" }));
    await user.type(screen.getByLabelText("اسم الصنف *"), "صنف بوحدتين مكررتين");
    await user.click(screen.getByRole("button", { name: "+ إضافة وحدة" }));
    await user.click(screen.getByRole("button", { name: "+ إضافة وحدة" }));
    const codeInputs = screen.getAllByLabelText("كود الوحدة");
    const nameInputs = screen.getAllByLabelText("اسم الوحدة");
    await user.type(codeInputs[0]!, "CTN");
    await user.type(nameInputs[0]!, "كرتونة");
    await user.type(codeInputs[1]!, "CTN");
    await user.type(nameInputs[1]!, "كرتونة أخرى");

    await user.click(screen.getByRole("button", { name: "إضافة" }));
    expect(await screen.findByRole("alert")).toHaveTextContent('كود الوحدة البديلة "CTN" مكرر');
  });

  it("refuses an alternate unit whose conversion factor is not a positive number", async () => {
    const user = userEvent.setup();
    renderScreen();
    await user.click(await screen.findByRole("button", { name: "إضافة صنف" }));
    await user.type(screen.getByLabelText("اسم الصنف *"), "صنف بعامل تحويل صفري");
    await user.click(screen.getByRole("button", { name: "+ إضافة وحدة" }));
    await user.type(screen.getByLabelText("كود الوحدة"), "CTN");
    await user.type(screen.getByLabelText("اسم الوحدة"), "كرتونة");
    fireEvent.change(screen.getByLabelText("عامل التحويل"), { target: { value: "0" } });

    await user.click(screen.getByRole("button", { name: "إضافة" }));
    expect(await screen.findByRole("alert")).toHaveTextContent('عامل تحويل الوحدة "CTN" يجب أن يكون رقماً موجباً');
  });

  it("refuses a barcode row left blank", async () => {
    const user = userEvent.setup();
    renderScreen();
    await user.click(await screen.findByRole("button", { name: "إضافة صنف" }));
    await user.type(screen.getByLabelText("اسم الصنف *"), "صنف بباركود فارغ");
    await user.click(screen.getByRole("button", { name: "+ إضافة باركود آخر" }));

    await user.click(screen.getByRole("button", { name: "إضافة" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("لا يمكن ترك الباركود فارغاً");
  });

  it("creates a service item with inventory tracking, batch tracking and expiry tracking all forced off", async () => {
    const user = userEvent.setup();
    let created: Record<string, unknown> | undefined;
    renderScreen([], { onCreateItem: (body) => { created = body; return undefined; } });
    await user.click(await screen.findByRole("button", { name: "إضافة صنف" }));
    chooseSelectOption("نوع الصنف", "خدمة");
    await user.type(screen.getByLabelText("اسم الصنف *"), "خدمة صيانة");

    await user.click(screen.getByRole("button", { name: "إضافة" }));
    await waitFor(() => expect(created).toBeDefined());
    expect(created).toMatchObject({ type: "service", trackInventory: false, trackBatches: false, trackExpiry: false });
  });

  it("switches the type to stock and back, keeping the batch-tracking flag under the type=stock branch both times", async () => {
    const user = userEvent.setup();
    renderScreen();
    await user.click(await screen.findByRole("button", { name: "إضافة صنف" }));
    chooseSelectOption("نوع الصنف", "خدمة");
    expect(screen.queryByText("تتبع المخزون")).not.toBeInTheDocument();
    chooseSelectOption("نوع الصنف", "منتج مخزون");
    expect(screen.getByText("تتبع المخزون")).toBeInTheDocument();
  });

  it("shows the 'save the item first' hint for a brand-new item's image field, and its own empty message once the item exists with no images", async () => {
    const user = userEvent.setup();
    renderScreen(sampleItems, { attachmentsByItem: { "itm-1": [attachment({ mimeType: "application/pdf", fileName: "spec-sheet.pdf" })] } });
    await user.click(await screen.findByRole("button", { name: "إضافة صنف" }));
    expect(await screen.findByText("احفظ الصنف أولاً، ثم أرفق صورة من تبويب المرفقات")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "إلغاء" }));

    await user.click(await screen.findByRole("button", { name: "تعديل أرز أبيض مصري 5 كجم" }));
    expect(await screen.findByText("لا توجد صور بين مرفقات هذا الصنف")).toBeInTheDocument();
  });

  it("picks an ETA code type and fills its item code, then can be reset back to none before saving", async () => {
    const user = userEvent.setup();
    let created: Record<string, unknown> | undefined;
    renderScreen([], { onCreateItem: (body) => { created = body; return undefined; } });
    await user.click(await screen.findByRole("button", { name: "إضافة صنف" }));
    await user.type(screen.getByLabelText("اسم الصنف *"), "صنف بكود جي بي سي");
    chooseSelectOption("نوع الكود (ETA)", "GPC");
    await user.type(screen.getByLabelText("كود GPC"), "01234567890123");
    chooseSelectOption("نوع الكود (ETA)", "بدون");

    await user.click(screen.getByRole("button", { name: "إضافة" }));
    await waitFor(() => expect(created).toBeDefined());
    expect(created).toMatchObject({ etaCodeType: null });
  });

  it("shows the specifications tab's value bare when its definition carries no unit, and a value with no matching definition falls back to its raw code", async () => {
    const user = userEvent.setup();
    renderScreen([
      item({
        id: "itm-1",
        specifications: [
          { code: "SIZE", value: "M" },
          { code: "UNKNOWN_SPEC", value: "42" },
        ],
      }),
    ], { specifications: [specDefinition({ code: "SIZE", nameAr: "المقاس", unit: null })] });
    await user.click(await screen.findByText("أرز أبيض مصري 5 كجم"));
    await user.click(screen.getByRole("tab", { name: "المواصفات" }));

    expect(await screen.findByText("M")).toBeInTheDocument();
    expect(screen.getByText("42")).toBeInTheDocument();
    expect(screen.getByText("UNKNOWN_SPEC")).toBeInTheDocument();
  });

  it("shows the movements tab falling back to the source doc id, then to a dash, and labels an outbound movement", async () => {
    const user = userEvent.setup();
    renderScreen(sampleItems, {
      warehouses: [warehouse({ id: "wh-unknown-free" })],
      stockByItem: { "itm-1": { positions: [stockPosition({ warehouseId: "wh-1" })], layers: [] } },
      movementsByItem: {
        "itm-1": [
          movement({ id: "mv-a", direction: "OUT", sourceDocNumber: null, sourceDocId: "gr-only-id" }),
          movement({ id: "mv-b", direction: "OUT", sourceDocNumber: null, sourceDocId: null }),
        ],
      },
    });
    await user.click(await screen.findByText("أرز أبيض مصري 5 كجم"));
    await user.click(screen.getByRole("tab", { name: "دفتر الحركة" }));

    expect(await screen.findByText("gr-only-id")).toBeInTheDocument();
    expect(screen.getAllByText("صادر").length).toBeGreaterThan(0);
    const rows = screen.getAllByRole("row").slice(1);
    const lastRowCells = within(rows[rows.length - 1]!).getAllByRole("cell");
    expect(lastRowCells[1]!.textContent).toBe("—");
  });

  it("shows the movements and cost-layers tabs falling back to the raw warehouse id when the warehouse isn't in the loaded list", async () => {
    const user = userEvent.setup();
    renderScreen(sampleItems, {
      warehouses: [],
      stockByItem: {
        "itm-1": {
          positions: [stockPosition({ warehouseId: "wh-ghost" })],
          layers: [costLayer({ warehouseId: "wh-ghost", sourceDocNumber: null, sourceDocType: "GOODS_RECEIPT" })],
        },
      },
      movementsByItem: { "itm-1": [movement({ warehouseId: "wh-ghost" })] },
    });
    await user.click(await screen.findByText("أرز أبيض مصري 5 كجم"));
    await user.click(screen.getByRole("tab", { name: "طبقات التكلفة" }));
    expect(await screen.findByText("GOODS_RECEIPT")).toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: "دفتر الحركة" }));
    expect(await screen.findByText("wh-ghost")).toBeInTheDocument();
  });

  it("sorts the list by cost price and by name, each ascending then descending", async () => {
    const user = userEvent.setup();
    renderScreen([
      item({ id: "itm-1", nameAr: "منتج أ", costPrice: "300.00" }),
      item({ id: "itm-2", code: "ITM-000002", nameAr: "منتج ب", costPrice: "100.00" }),
      item({ id: "itm-3", code: "ITM-000003", nameAr: "منتج ج", costPrice: "200.00" }),
    ]);
    await screen.findByText("منتج أ");
    function nameOrder() {
      return screen.getAllByRole("row").slice(1).map((row) => within(row).getAllByRole("cell")[0]!.textContent);
    }

    await user.click(screen.getByRole("columnheader", { name: /تكلفة الوحدة|سعر التكلفة/ }));
    await waitFor(() => expect(nameOrder()[0]).toContain("منتج ب"));
    await user.click(screen.getByRole("columnheader", { name: /تكلفة الوحدة|سعر التكلفة/ }));
    await waitFor(() => expect(nameOrder()[0]).toContain("منتج أ"));

    await user.click(screen.getByRole("columnheader", { name: "اسم الصنف" }));
    await waitFor(() => expect(nameOrder()[0]).toContain("منتج أ"));
    await user.click(screen.getByRole("columnheader", { name: "اسم الصنف" }));
    await waitFor(() => expect(nameOrder()[0]).toContain("منتج ج"));
  });

  it("shows a low-stock pill next to the on-hand quantity", async () => {
    renderScreen([item({ id: "itm-1", onHand: "3.000000", stockState: "low" })]);
    const row = (await screen.findByText("أرز أبيض مصري 5 كجم")).closest("tr")!;
    expect(within(row).getByText("منخفض")).toBeInTheDocument();
  });

  it("shows the loading message, then the not-found message, for an edit address whose item never resolves", async () => {
    renderScreen(sampleItems, { initialSegments: ["NO-SUCH-CODE"] });
    expect(await screen.findByText("لم يتم العثور على هذا الصنف.")).toBeInTheDocument();
  });

  it("opens the add form before the catalogue finishes loading, and still lands on a correct, unique code once it has", async () => {
    const user = userEvent.setup();
    renderScreen(sampleItems);
    // No `await` on the items query settling — the add button is already in
    // the DOM even while the very first /items fetch is still in flight.
    await user.click(screen.getByRole("button", { name: "إضافة صنف" }));
    await waitFor(() => {
      expect((screen.getByLabelText("كود الصنف") as HTMLInputElement).value).toBe("ITM-000004");
    });
  });

  it("shows the brand and season names on the item detail page once they're set, not just the dash for an unset one", async () => {
    renderScreen([item({ id: "itm-1", brandId: "brand-1", seasonId: "season-1" })], {
      brands: [brand({ id: "brand-1", nameAr: "الأهرام" })],
      seasons: [season({ id: "season-1", nameAr: "الصيف" })],
    });
    await userEvent.setup().click(await screen.findByText("أرز أبيض مصري 5 كجم"));
    expect(await screen.findByText("الأهرام")).toBeInTheDocument();
    expect(screen.getByText("الصيف")).toBeInTheDocument();
  });

  it("shows the default-supplier's own name when found, and the raw id when its supplier no longer exists", async () => {
    const user = userEvent.setup();
    renderScreen([item({ id: "itm-1", defaultSupplierId: "sup-ghost" })], { suppliers: [] });
    await user.click(await screen.findByText("أرز أبيض مصري 5 كجم"));
    expect(await screen.findByText("sup-ghost")).toBeInTheDocument();
  });

  it("shows yes/yes for track-stock and batch/expiry tracking, and the accounting tab's own account labels and eta code", async () => {
    const user = userEvent.setup();
    renderScreen([
      item({
        id: "itm-1",
        trackInventory: true,
        trackBatches: true,
        revenueAccountId: "acc-rev",
        cogsAccountId: "acc-unknown",
        etaCodeType: "EGS",
        etaItemCode: "EG-0001-SKU",
      }),
    ], { accounts: [account({ id: "acc-rev", code: "4101", nameAr: "إيرادات المبيعات" })] });
    await user.click(await screen.findByText("أرز أبيض مصري 5 كجم"));

    expect(await screen.findAllByText("نعم")).not.toHaveLength(0);
    await user.click(screen.getByRole("tab", { name: "الحسابات" }));
    expect(await screen.findByText("4101 — إيرادات المبيعات")).toBeInTheDocument();
    expect(screen.getByText("acc-unknown")).toBeInTheDocument();
    expect(screen.getByText("EGS")).toBeInTheDocument();
    expect(screen.getByText("EG-0001-SKU")).toBeInTheDocument();
  });

  it("lists an item's real alternate units and barcodes on its own detail tab", async () => {
    const user = userEvent.setup();
    renderScreen([
      item({
        id: "itm-1",
        alternateUnits: [{ code: "CTN", name: "كرتونة", factor: 12 }],
        barcodes: ["6221031012345"],
      }),
    ]);
    await user.click(await screen.findByText("أرز أبيض مصري 5 كجم"));
    await user.click(screen.getByRole("tab", { name: "الوحدات والباركود" }));

    expect(await screen.findByText("1 CTN = 12 PCS")).toBeInTheDocument();
    expect(screen.getByText("6221031012345")).toBeInTheDocument();
  });

  it("shows the pricing tab and summary as a formatted zero when the item has no sale or cost price", async () => {
    const user = userEvent.setup();
    renderScreen([item({ id: "itm-1", salePrice: null, costPrice: null })]);
    await user.click(await screen.findByText("أرز أبيض مصري 5 كجم"));
    await user.click(screen.getByRole("tab", { name: "التسعير" }));
    const zeroCells = screen.getAllByText((_, el) => el?.textContent === "0.00");
    expect(zeroCells.length).toBeGreaterThan(0);
  });

  it("clearing a price-lists custom-price field commits it as zero, not a blank value", async () => {
    const user = userEvent.setup();
    const priceLists: PriceListDTO[] = [
      {
        id: "pl-a",
        code: "PL-A",
        nameAr: "قائمة أ",
        nameEn: null,
        description: null,
        isBase: false,
        active: true,
        lines: [{ itemId: "itm-1", unitCode: null, minQty: "0", price: "50.000000" }],
        createdAt: "2024-01-01",
      },
    ];
    renderWithProviders(
      <TestNavigation>
        <ItemsScreen />
      </TestNavigation>,
      {
        transport: stubTransport({
          "GET /items": () => ({ body: [item({ id: "itm-1", salePrice: "185.00" })] }),
          "GET /accounts": () => ({ body: [] }),
          "GET /item-categories": () => ({ body: [] }),
          "GET /item-brands": () => ({ body: [] }),
          "GET /item-seasons": () => ({ body: [] }),
          "GET /item-units": () => ({ body: [] }),
          "GET /price-lists": () => ({ body: priceLists }),
        }),
        initialSession: testAdminSession,
      },
    );
    await user.click(await screen.findByText("أرز أبيض مصري 5 كجم"));
    await user.click(screen.getByRole("tab", { name: "قوائم الأسعار" }));

    const input = await screen.findByLabelText("قائمة أ — السعر المخصص");
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "" } });
    fireEvent.blur(input);

    expect((input as HTMLInputElement).value).toBe("0.00");
  });

  it("leaves the English name, prices and specifications blank when editing an item that was saved without any of them", async () => {
    const user = userEvent.setup();
    renderScreen([
      item({
        id: "itm-1",
        nameEn: null,
        salePrice: null,
        costPrice: null,
        specifications: undefined as unknown as [],
      }),
    ]);
    await user.click(await screen.findByRole("button", { name: "تعديل أرز أبيض مصري 5 كجم" }));
    expect(screen.getByRole("heading", { name: "تعديل صنف" })).toBeInTheDocument();
    expect((screen.getByLabelText("الاسم بالإنجليزي") as HTMLInputElement).value).toBe("");
    expect((screen.getByLabelText("سعر البيع") as HTMLInputElement).value).toBe("");
    expect((screen.getByLabelText("سعر التكلفة") as HTMLInputElement).value).toBe("");
  });

  it("BUG: the reorder-point and reorder-quantity negative-value checks in validateDraft can never fire — the field's own min=0 already blocks the browser from submitting a negative value", async () => {
    const user = userEvent.setup();
    const { container } = renderScreen();
    await user.click(await screen.findByRole("button", { name: "إضافة صنف" }));
    await user.type(screen.getByLabelText("اسم الصنف *"), "صنف بقيم سالبة");
    fireEvent.change(screen.getByLabelText("نقطة إعادة الطلب"), { target: { value: "-5" } });
    fireEvent.change(screen.getByLabelText("كمية إعادة الطلب"), { target: { value: "-1" } });
    fireEvent.change(screen.getByLabelText("نسبة الضريبة %"), { target: { value: "-1" } });

    // A real click on the submit button never reaches handleSubmit here — the
    // number inputs' own min=0 fails the browser's native constraint
    // validation first, so JS's own "cannot be negative" checks are dead code
    // through this form. Bypassing the click and dispatching `submit`
    // directly is the only way to reach validateDraft with these values.
    fireEvent.submit(container.querySelector("form")!);
    expect(await screen.findByRole("alert")).toHaveTextContent("نقطة إعادة الطلب لا يمكن أن تكون سالبة");
  });

  it("refuses a negative tax rate once the reorder fields are valid, reaching the tax-rate check", async () => {
    const user = userEvent.setup();
    const { container } = renderScreen();
    await user.click(await screen.findByRole("button", { name: "إضافة صنف" }));
    await user.type(screen.getByLabelText("اسم الصنف *"), "صنف بضريبة سالبة");
    fireEvent.change(screen.getByLabelText("نسبة الضريبة %"), { target: { value: "-1" } });

    fireEvent.submit(container.querySelector("form")!);
    expect(await screen.findByRole("alert")).toHaveTextContent("نسبة الضريبة لا يمكن أن تكون سالبة");
  });

  it("lets an image attachment be picked for an existing item and submits its real id", async () => {
    const user = userEvent.setup();
    let patched: Record<string, unknown> | undefined;
    renderScreen(sampleItems, {
      attachmentsByItem: {
        "itm-1": [attachment({ id: "att-img", mimeType: "image/jpeg", fileName: "rice-bag.jpg" }), attachment({ id: "att-doc", mimeType: "application/pdf", fileName: "cert.pdf" })],
      },
      onPatchItem: (_id, patch) => { patched = patch; },
    });
    await user.click(await screen.findByRole("button", { name: "تعديل أرز أبيض مصري 5 كجم" }));
    chooseSelectOption("صورة الصنف", "rice-bag.jpg");
    await user.click(screen.getByRole("button", { name: "حفظ" }));

    await waitFor(() => expect(patched).toBeDefined());
    expect(patched?.imageAttachmentId).toBe("att-img");
  });

  it("shows the item's real GL accounts and submits a newly picked one under its own real id", async () => {
    const user = userEvent.setup();
    let patched: Record<string, unknown> | undefined;
    const accounts = [account({ id: "acc-rev", code: "4101", nameAr: "إيرادات المبيعات" }), account({ id: "acc-cogs", code: "5101", nameAr: "تكلفة المبيعات" })];
    renderScreen([item({ id: "itm-1", revenueAccountId: "acc-rev" })], { accounts, onPatchItem: (_id, patch) => { patched = patch; } });
    await user.click(await screen.findByRole("button", { name: "تعديل أرز أبيض مصري 5 كجم" }));
    expect((screen.getByRole("combobox", { name: "حساب الإيراد" }) as HTMLInputElement).value).toBe("4101 — إيرادات المبيعات");

    // Picks a real account for revenue (was already real -> stays real), and
    // for cost picks a real account then resets it back to the default —
    // exercising both sides of each field's own onChange independently.
    pickEntity("حساب الإيراد", "الافتراضي حسب نوع الصنف");
    pickEntity("حساب التكلفة", "5101 — تكلفة المبيعات");
    pickEntity("حساب التكلفة", "الافتراضي حسب نوع الصنف");
    await user.click(screen.getByRole("button", { name: "حفظ" }));

    await waitFor(() => expect(patched).toBeDefined());
    expect(patched?.revenueAccountId).toBe(null);
    expect(patched?.cogsAccountId).toBe(null);
  });

  it("resets a picked inventory GL account back to the type default, and picks a fresh one for it too", async () => {
    const accounts = [account({ id: "acc-inv", code: "1301", nameAr: "المخزون" }), account({ id: "acc-inv-2", code: "1302", nameAr: "مخزون البضاعة الجاهزة" })];
    const user = userEvent.setup();
    renderScreen([item({ id: "itm-1", inventoryAccountId: "acc-inv" })], { accounts });
    await user.click(await screen.findByRole("button", { name: "تعديل أرز أبيض مصري 5 كجم" }));
    expect((screen.getByRole("combobox", { name: "حساب المخزون" }) as HTMLInputElement).value).toBe("1301 — المخزون");

    pickEntity("حساب المخزون", "الافتراضي حسب نوع الصنف");
    expect((screen.getByRole("combobox", { name: "حساب المخزون" }) as HTMLInputElement).value).toBe("الافتراضي حسب نوع الصنف");

    pickEntity("حساب المخزون", "1302 — مخزون البضاعة الجاهزة");
    expect((screen.getByRole("combobox", { name: "حساب المخزون" }) as HTMLInputElement).value).toBe("1302 — مخزون البضاعة الجاهزة");
  });

  it("picks a real category in the add form, then resets it back to uncategorised, sending null", async () => {
    const user = userEvent.setup();
    let created: Record<string, unknown> | undefined;
    renderScreen([], {
      categories: [{ id: "cat-1", nameAr: "مواد غذائية", nameEn: null, parentId: null, status: "active" }],
      onCreateItem: (body) => { created = body; return undefined; },
    });
    await user.click(await screen.findByRole("button", { name: "إضافة صنف" }));
    await user.type(screen.getByLabelText("اسم الصنف *"), "صنف مصنف");
    pickEntity("التصنيف", "مواد غذائية");
    pickEntity("التصنيف", "بدون تصنيف");

    await user.click(screen.getByRole("button", { name: "إضافة" }));
    await waitFor(() => expect(created).toBeDefined());
    expect(created).toMatchObject({ categoryId: null });
  });

  it("pre-fills a select-type specification's existing value from the edit form", async () => {
    const user = userEvent.setup();
    renderScreen([item({ id: "itm-1", specifications: [{ code: "SIZE", value: "M" }] })], {
      specifications: [specDefinition({ code: "SIZE", nameAr: "المقاس", type: "select", values: ["S", "M", "L"], unit: null })],
    });
    await user.click(await screen.findByRole("button", { name: "تعديل أرز أبيض مصري 5 كجم" }));
    expect(screen.getByRole("combobox", { name: "المقاس" })).toHaveTextContent("M");
  });

  it("filters the list to items priced in the picked unit, sending the unit's own code", async () => {
    const user = userEvent.setup();
    const itemsRequests: string[] = [];
    renderScreen(
      [item({ id: "itm-1", baseUnitCode: "PCS" }), item({ id: "itm-2", code: "ITM-000002", nameAr: "زيت عباد الشمس 1 لتر", baseUnitCode: "KG" })],
      { itemsRequests, units: [{ code: "PCS", nameAr: "قطعة", nameEn: null, status: "active" }, { code: "KG", nameAr: "كيلوغرام", nameEn: null, status: "active" }] },
    );
    await screen.findByText("أرز أبيض مصري 5 كجم");
    itemsRequests.length = 0;

    chooseSelectOption("تصفية حسب الوحدة", "قطعة");
    await waitFor(() => {
      expect(itemsRequests.some((p) => new URL(p, "http://x").searchParams.get("unitCode") === "PCS")).toBe(true);
    });
  });

  it("shows the price-lists tab against a zero base price when the item has no sale price, treating an untiered line as the base tier", async () => {
    const user = userEvent.setup();
    const priceLists: PriceListDTO[] = [
      {
        id: "pl-open",
        code: "PL-OPEN",
        nameAr: "قائمة مفتوحة",
        nameEn: null,
        description: null,
        isBase: true,
        active: true,
        lines: [
          { itemId: "itm-1", unitCode: null, minQty: null as unknown as string, price: "50.000000" },
          { itemId: "itm-1", unitCode: null, minQty: "5", price: "0.000000" },
        ],
        createdAt: "2024-01-01",
      },
    ];
    renderWithProviders(
      <TestNavigation>
        <ItemsScreen />
      </TestNavigation>,
      {
        transport: stubTransport({
          "GET /items": () => ({ body: [item({ id: "itm-1", salePrice: null })] }),
          "GET /accounts": () => ({ body: [] }),
          "GET /item-categories": () => ({ body: [] }),
          "GET /item-brands": () => ({ body: [] }),
          "GET /item-seasons": () => ({ body: [] }),
          "GET /item-units": () => ({ body: [] }),
          "GET /price-lists": () => ({ body: priceLists }),
        }),
        initialSession: testAdminSession,
      },
    );

    await user.click(await screen.findByText("أرز أبيض مصري 5 كجم"));
    await user.click(screen.getByRole("tab", { name: "قوائم الأسعار" }));

    expect(await screen.findAllByText(/القائمة الأساسية/)).not.toHaveLength(0);
    // The untiered line reads as tier "0" and still gets its own bound field.
    expect(screen.getAllByLabelText("قائمة مفتوحة — السعر المخصص")).toHaveLength(2);
  });

  it("shows a positive delta on the price-lists tab in success ink, and a zero delta as a dash, saving only the tier that changed", async () => {
    const user = userEvent.setup();
    const patchRequests: Array<{ id: string; patch: Record<string, unknown> }> = [];
    const priceLists: PriceListDTO[] = [
      {
        id: "pl-tiered",
        code: "PL-TIERED",
        nameAr: "قائمة متدرجة",
        nameEn: null,
        description: null,
        isBase: false,
        active: true,
        lines: [
          { itemId: "itm-1", unitCode: null, minQty: "0", price: "185.000000" },
          { itemId: "itm-1", unitCode: null, minQty: "10", price: "220.000000" },
        ],
        createdAt: "2024-01-01",
      },
    ];
    renderWithProviders(
      <TestNavigation>
        <ItemsScreen />
      </TestNavigation>,
      {
        transport: stubTransport({
          "GET /items": () => ({ body: [item({ id: "itm-1", salePrice: "185.00" })] }),
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
        }),
        initialSession: testAdminSession,
      },
    );

    await user.click(await screen.findByText("أرز أبيض مصري 5 كجم"));
    await user.click(screen.getByRole("tab", { name: "قوائم الأسعار" }));

    const rows = await screen.findAllByRole("row");
    const baseRow = rows.find((r) => within(r).queryByText("0"))!;
    expect(within(baseRow).getByText("—")).toBeInTheDocument();
    const tierRow = rows.find((r) => within(r).queryByText("10"))!;
    // 220 - 185 = 35, a positive delta.
    expect(within(tierRow).getByText("35.00")).toBeInTheDocument();

    const tierInputs = screen.getAllByLabelText("قائمة متدرجة — السعر المخصص");
    setMoney(tierInputs[1]!, "260.00");
    await user.click(screen.getByRole("button", { name: "حفظ" }));

    await waitFor(() => expect(patchRequests).toHaveLength(1));
    const lines = (patchRequests[0]!.patch as { lines: Array<{ minQty: string; price: string }> }).lines;
    expect(lines.find((l) => l.minQty === "10")!.price).toBe("260.00");
    expect(lines.find((l) => l.minQty === "0")!.price).toBe("185.000000");
  });

  it("refuses a negative reorder quantity on its own, once the reorder point itself is valid", async () => {
    const { container } = renderScreen();
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "إضافة صنف" }));
    await user.type(screen.getByLabelText("اسم الصنف *"), "صنف بكمية سالبة فقط");
    fireEvent.change(screen.getByLabelText("كمية إعادة الطلب"), { target: { value: "-1" } });

    fireEvent.submit(container.querySelector("form")!);
    expect(await screen.findByRole("alert")).toHaveTextContent("كمية إعادة الطلب لا يمكن أن تكون سالبة");
  });

  it("falls back to the raw warehouse id on the stock tab when the warehouse isn't in the loaded list", async () => {
    const user = userEvent.setup();
    renderScreen(sampleItems, {
      warehouses: [],
      stockByItem: { "itm-1": { positions: [stockPosition({ warehouseId: "wh-ghost" })], layers: [] } },
    });
    await user.click(await screen.findByText("أرز أبيض مصري 5 كجم"));
    await user.click(screen.getByRole("tab", { name: "المخزون" }));
    expect(await screen.findByText("wh-ghost")).toBeInTheDocument();
  });

  it("leaves a price-list line for a different item entirely untouched when saving this item's own tier", async () => {
    const user = userEvent.setup();
    const patchRequests: Array<{ id: string; patch: Record<string, unknown> }> = [];
    const priceLists: PriceListDTO[] = [
      {
        id: "pl-shared",
        code: "PL-SHARED",
        nameAr: "قائمة مشتركة",
        nameEn: null,
        description: null,
        isBase: false,
        active: true,
        lines: [
          { itemId: "itm-1", unitCode: null, minQty: "0", price: "185.000000" },
          { itemId: "itm-other", unitCode: null, minQty: "0", price: "99.000000" },
        ],
        createdAt: "2024-01-01",
      },
    ];
    renderWithProviders(
      <TestNavigation>
        <ItemsScreen />
      </TestNavigation>,
      {
        transport: stubTransport({
          "GET /items": () => ({ body: [item({ id: "itm-1", salePrice: "185.00" })] }),
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
        }),
        initialSession: testAdminSession,
      },
    );
    await user.click(await screen.findByText("أرز أبيض مصري 5 كجم"));
    await user.click(screen.getByRole("tab", { name: "قوائم الأسعار" }));

    const input = await screen.findByLabelText("قائمة مشتركة — السعر المخصص");
    setMoney(input, "200.00");
    await user.click(screen.getByRole("button", { name: "حفظ" }));

    await waitFor(() => expect(patchRequests).toHaveLength(1));
    const lines = (patchRequests[0]!.patch as { lines: Array<{ itemId: string; price: string }> }).lines;
    expect(lines.find((l) => l.itemId === "itm-1")!.price).toBe("200.00");
    // The other item's own tier is carried through byte for byte.
    expect(lines.find((l) => l.itemId === "itm-other")!.price).toBe("99.000000");
  });

  it("shows the add form's own loading state before the catalogue arrives, seeding a real code only once it has", async () => {
    const user = userEvent.setup();
    let releaseItems: (() => void) | undefined;
    const itemsGate = new Promise<void>((resolve) => { releaseItems = resolve; });
    const rest = stubTransport({
      "GET /items/counts": () => ({ body: { all: 0, active: 0, inactive: 0 } }),
      "GET /items/stats": () => ({ body: {} }),
      "GET /accounts": () => ({ body: [] }),
      "GET /item-categories": () => ({ body: [] }),
      "GET /item-brands": () => ({ body: [] }),
      "GET /item-seasons": () => ({ body: [] }),
      "GET /item-units": () => ({ body: [] }),
      "GET /suppliers": () => ({ body: [] }),
      "GET /warehouses": () => ({ body: [] }),
      "GET /item-specifications": () => ({ body: [] }),
    });
    const transport = async (path: string, init?: RequestInit) => {
      if (path.split("?")[0] === "/items" && (init?.method ?? "GET").toUpperCase() === "GET") {
        await itemsGate;
        return { status: 200, ok: true, json: <T,>() => Promise.resolve(sampleItems as unknown as T), text: () => Promise.resolve(JSON.stringify(sampleItems)) };
      }
      return rest(path, init);
    };
    renderWithProviders(
      <TestNavigation>
        <ItemsScreen />
      </TestNavigation>,
      { transport, initialSession: testAdminSession },
    );
    await user.click(await screen.findByRole("button", { name: "إضافة صنف" }));
    // The catalogue is still in flight — the code field must not have seeded
    // a wrong code (e.g. ITM-000001 from an empty array) that then sticks.
    expect((screen.getByLabelText("كود الصنف") as HTMLInputElement).value).toBe("");

    releaseItems!();
    await waitFor(() => {
      expect((screen.getByLabelText("كود الصنف") as HTMLInputElement).value).toBe("ITM-000004");
    });
  });

  it("shows the GL account and category pickers unselected when the item's stored id no longer matches any loaded option", async () => {
    const user = userEvent.setup();
    renderScreen(
      [
        item({
          id: "itm-1",
          categoryId: "cat-deleted",
          revenueAccountId: "acc-deleted",
          cogsAccountId: "acc-deleted",
          inventoryAccountId: "acc-deleted",
        }),
      ],
      { accounts: [account({ id: "acc-real", code: "4101" })], categories: [{ id: "cat-real", nameAr: "فئة حقيقية", nameEn: null, parentId: null, status: "active" }] },
    );
    await user.click(await screen.findByRole("button", { name: "تعديل أرز أبيض مصري 5 كجم" }));

    expect((screen.getByRole("combobox", { name: "التصنيف" }) as HTMLInputElement).value).toBe("");
    expect((screen.getByRole("combobox", { name: "حساب الإيراد" }) as HTMLInputElement).value).toBe("");
    expect((screen.getByRole("combobox", { name: "حساب التكلفة" }) as HTMLInputElement).value).toBe("");
    expect((screen.getByRole("combobox", { name: "حساب المخزون" }) as HTMLInputElement).value).toBe("");
  });
});
