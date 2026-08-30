// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, expect, it } from "vitest";
import { screen, fireEvent, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ItemDTO, PromotionDTO } from "@mezan/contracts";
import { PromotionsScreen } from "./PromotionsScreen";
import { renderWithProviders, stubTransport, testAdminSession } from "../data/test-support";

/** The Select combobox commits on mousedown, not change (Select.tsx) — open it, then commit the matching option. */
function chooseSelectOption(triggerLabel: string, optionLabel: string) {
  fireEvent.click(screen.getByRole("combobox", { name: triggerLabel }));
  fireEvent.mouseDown(screen.getByRole("option", { name: optionLabel }));
}

/** EntityPicker selection fires on mousedown (not click) — the input's blur never wins the race. */
function pickFromCombobox(container: HTMLElement, placeholder: string, optionLabel: string) {
  const input = within(container).getByPlaceholderText(placeholder);
  fireEvent.focus(input);
  fireEvent.change(input, { target: { value: optionLabel } });
  const option = within(container).getByRole("button", { name: (name) => name.startsWith(optionLabel) });
  fireEvent.mouseDown(option);
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
 * and never wires `htmlFor`/`id` — so `getByLabelText` cannot resolve a
 * `TextField`. Locate the control by walking from the visible label text.
 */
function fieldInput(container: HTMLElement, label: string): HTMLElement {
  const labelEl = within(container).getByText(label);
  const control = labelEl.parentElement?.querySelector("input, textarea, select");
  if (!control) throw new Error(`no control found for label "${label}"`);
  return control as HTMLElement;
}

function promotion(overrides: Partial<PromotionDTO> = {}): PromotionDTO {
  return {
    id: "promo-1",
    code: "SUMMER25",
    priority: 1,
    nameAr: "خصم الصيف",
    nameEn: null,
    description: null,
    type: "percentage",
    percentValue: 25,
    amountValue: null,
    minInvoiceValue: null,
    minQty: null,
    maxDiscountAmount: null,
    buyQty: null,
    getQty: null,
    bundleComponents: [],
    requiresCoupon: false,
    dayHourRestriction: null,
    scope: { type: "all", ids: [] },
    startDate: "2026-01-01",
    endDate: "2026-12-31",
    active: true,
    createdAt: "2026-08-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("PromotionsScreen", () => {
  it("renders the real promotions list from GET /promotions", async () => {
    renderWithProviders(<PromotionsScreen />, {
      initialSession: testAdminSession,
      transport: stubTransport({ "GET /promotions": () => ({ body: [promotion()] }) }),
    });
    expect(await screen.findByText("SUMMER25")).toBeInTheDocument();
    expect(screen.getByText("خصم الصيف")).toBeInTheDocument();
    expect(screen.getAllByText("نسبة خصم").length).toBeGreaterThan(0);
  });

  it("shows the real empty state when there are no promotions", async () => {
    renderWithProviders(<PromotionsScreen />, {
      initialSession: testAdminSession,
      transport: stubTransport({ "GET /promotions": () => ({ body: [] }) }),
    });
    expect(await screen.findByText("لا توجد عروض")).toBeInTheDocument();
  });

  it("creates a new promotion through POST /promotions and refreshes the list", async () => {
    const user = userEvent.setup();
    let created: unknown = null;
    renderWithProviders(<PromotionsScreen />, {
      initialSession: testAdminSession,
      transport: stubTransport({
        "GET /promotions": () => ({ body: created ? [promotion(), created as PromotionDTO] : [promotion()] }),
        "POST /promotions": (init) => {
          const body = JSON.parse(String(init?.body));
          created = promotion({ id: "promo-2", code: body.code, nameAr: body.nameAr, percentValue: body.percentValue });
          return { status: 201, body: created };
        },
      }),
    });

    await screen.findByText("SUMMER25");
    await user.click(screen.getByRole("button", { name: "إضافة عرض" }));

    const dialog = screen.getByRole("dialog", { name: "إضافة عرض" });
    await user.type(fieldInput(dialog, "الرمز *"), "WINTER10");
    await user.type(fieldInput(dialog, "الاسم *"), "خصم الشتاء");
    await user.click(within(dialog).getByRole("button", { name: "إضافة" }));

    await waitFor(() => expect(screen.queryByRole("dialog", { name: "إضافة عرض" })).not.toBeInTheDocument());
    expect(await screen.findByText("WINTER10")).toBeInTheDocument();
  });

  it("scopes a promotion to a real item id — not its Arabic name — when 'specific items' is chosen", async () => {
    const user = userEvent.setup();
    let created: Record<string, unknown> | undefined;
    renderWithProviders(<PromotionsScreen />, {
      initialSession: testAdminSession,
      transport: stubTransport({
        "GET /promotions": () => ({ body: [promotion()] }),
        "GET /items": () => ({ body: [itemFixture()] }),
        "POST /promotions": (init) => {
          created = JSON.parse(String(init?.body));
          return { status: 201, body: promotion({ id: "promo-2", ...created }) };
        },
      }),
    });

    await screen.findByText("SUMMER25");
    await user.click(screen.getByRole("button", { name: "إضافة عرض" }));
    const dialog = screen.getByRole("dialog", { name: "إضافة عرض" });
    await user.type(fieldInput(dialog, "الرمز *"), "RICE10");
    await user.type(fieldInput(dialog, "الاسم *"), "خصم الأرز");

    chooseSelectOption("النطاق", "أصناف محددة");
    pickFromCombobox(dialog, "أضف صنفاً إلى النطاق", "أرز أبيض مصري 5 كجم");

    fireEvent.click(within(dialog).getByRole("button", { name: "إضافة" }));

    await waitFor(() => expect(created).toBeDefined());
    expect(created?.scope).toEqual({ type: "item", ids: ["itm-1"] });
  });

  it("raises a promotion's priority from the row menu, sending only {priority: p+1}", async () => {
    const patchBodies: Record<string, unknown>[] = [];
    renderWithProviders(<PromotionsScreen />, {
      initialSession: testAdminSession,
      transport: stubTransport({
        "GET /promotions": () => ({ body: [promotion({ priority: 1 })] }),
        "GET /items": () => ({ body: [] }),
        "PATCH /promotions/promo-1": (init) => {
          patchBodies.push(JSON.parse(String(init?.body)));
          return { body: promotion({ priority: 2 }) };
        },
      }),
    });
    await screen.findByText("SUMMER25");

    fireEvent.click(screen.getByRole("button", { name: "إجراءات SUMMER25" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "رفع الأولوية" }));

    await waitFor(() => expect(patchBodies).toEqual([{ priority: 2 }]));
  });

  it("stops a promotion from the row menu only after the destructive-action confirm, sending {active:false}", async () => {
    const patchBodies: Record<string, unknown>[] = [];
    renderWithProviders(<PromotionsScreen />, {
      initialSession: testAdminSession,
      transport: stubTransport({
        "GET /promotions": () => ({ body: [promotion()] }),
        "GET /items": () => ({ body: [] }),
        "PATCH /promotions/promo-1": (init) => {
          patchBodies.push(JSON.parse(String(init?.body)));
          return { body: promotion({ active: false }) };
        },
      }),
    });
    await screen.findByText("SUMMER25");

    fireEvent.click(screen.getByRole("button", { name: "إجراءات SUMMER25" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "إيقاف العرض" }));
    const confirmDialog = screen.getByRole("dialog");
    fireEvent.click(within(confirmDialog).getByRole("button", { name: "إيقاف العرض" }));

    await waitFor(() => expect(patchBodies).toEqual([{ active: false }]));
  });

  it("shows the server's own refusal message and keeps the dialog open when creation is rejected server-side", async () => {
    const user = userEvent.setup();
    renderWithProviders(<PromotionsScreen />, {
      initialSession: testAdminSession,
      transport: stubTransport({
        "GET /promotions": () => ({ body: [promotion()] }),
        "GET /items": () => ({ body: [] }),
        "POST /promotions": () => ({ status: 409, body: { message: "الرمز \"SUMMER25\" مستخدم بالفعل." } }),
      }),
    });

    await screen.findByText("SUMMER25");
    await user.click(screen.getByRole("button", { name: "إضافة عرض" }));
    const dialog = screen.getByRole("dialog", { name: "إضافة عرض" });
    await user.type(fieldInput(dialog, "الرمز *"), "SUMMER25");
    await user.type(fieldInput(dialog, "الاسم *"), "عرض مكرر");
    await user.click(within(dialog).getByRole("button", { name: "إضافة" }));

    expect(await within(dialog).findByText("الرمز \"SUMMER25\" مستخدم بالفعل.")).toBeInTheDocument();
    expect(screen.getByRole("dialog", { name: "إضافة عرض" })).toBeInTheDocument();
  });

  it("LIMITATION: a failed list load also shows the empty-list message below the error banner", async () => {
    renderWithProviders(<PromotionsScreen />, {
      initialSession: testAdminSession,
      transport: stubTransport({
        "GET /promotions": () => ({ status: 500, body: { error: "INTERNAL" } }),
        "GET /items": () => ({ body: [] }),
      }),
    });

    expect(await screen.findByText("تعذّر تحميل العروض.")).toBeInTheDocument();
    // Same shape as ItemsScreen/PriceListsScreen: the error banner renders ABOVE
    // the DocumentList, but `promotions` falls back to `[]` on a failed fetch and
    // `query.isLoading` is false by then, so `emptyState` renders its ordinary
    // "no promotions" copy underneath. A user cannot distinguish "load failed"
    // from "there are no promotions" here. Flip this assertion to
    // `.not.toBeInTheDocument()` once PromotionsScreen.tsx suppresses
    // `emptyState` while `query.isError`.
    expect(screen.getByText("لا توجد عروض")).toBeInTheDocument();
  });
});
