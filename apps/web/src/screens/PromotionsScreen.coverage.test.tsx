// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, expect, it } from "vitest";
import { screen, fireEvent, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ItemDTO, PromotionDTO } from "@mezan/contracts";
import { PromotionsScreen } from "./PromotionsScreen";
import { renderWithProviders, stubTransport, testAdminSession } from "../data/test-support";

/** MoneyInput only commits its draft to React state on blur. */
function typeMoney(input: HTMLElement, value: string) {
  fireEvent.change(input, { target: { value } });
  fireEvent.blur(input);
}

/** QtyInput mirrors MoneyInput's commit-on-blur behaviour. */
function typeQty(input: HTMLElement, value: string) {
  fireEvent.change(input, { target: { value } });
  fireEvent.blur(input);
}

/** The Select combobox commits on mousedown, not change (Select.tsx). */
function chooseSelectOption(triggerLabel: string, optionLabel: string) {
  fireEvent.click(screen.getByRole("combobox", { name: triggerLabel }));
  fireEvent.mouseDown(screen.getByRole("option", { name: optionLabel }));
}

/** EntityPicker selection fires on mousedown, scoped to the input's own dropdown. */
function pickFromCombobox(input: HTMLElement, optionLabel: string) {
  fireEvent.focus(input);
  fireEvent.change(input, { target: { value: optionLabel } });
  const scope = input.parentElement!;
  fireEvent.mouseDown(within(scope).getByRole("button", { name: (name) => name.startsWith(optionLabel) }));
}

/** ISO calendar day, local time, offset from today — mirrors `../lib/dates.ts#todayIso`. */
function isoDaysFromToday(offsetDays: number): string {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
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
    startDate: isoDaysFromToday(-30),
    endDate: isoDaysFromToday(60),
    active: true,
    createdAt: "2026-08-01T00:00:00.000Z",
    ...overrides,
  };
}

function render(promos: PromotionDTO[], extra: Record<string, (init: RequestInit | undefined, path: string) => { status?: number; body: unknown }> = {}) {
  return renderWithProviders(<PromotionsScreen />, {
    initialSession: testAdminSession,
    transport: stubTransport({
      "GET /promotions": () => ({ body: promos }),
      "GET /items": () => ({ body: [] }),
      "GET /promotions/report": () => ({ body: [] }),
      ...extra,
    }),
  });
}

describe("PromotionsScreen — derived state and filters", () => {
  it("derives each promotion's real-time state from its dates and active flag, and filters the list by status tab", async () => {
    const promos = [
      promotion({ id: "p-active", code: "ACT01", nameAr: "نشط الآن", startDate: isoDaysFromToday(-30), endDate: isoDaysFromToday(60) }),
      promotion({ id: "p-scheduled", code: "SCH01", nameAr: "مجدول لاحقاً", startDate: isoDaysFromToday(10), endDate: isoDaysFromToday(40) }),
      promotion({ id: "p-ended-date", code: "END01", nameAr: "منتهي بالتاريخ", startDate: isoDaysFromToday(-60), endDate: isoDaysFromToday(-10) }),
      promotion({ id: "p-ended-inactive", code: "END02", nameAr: "موقوف يدوياً", active: false, startDate: isoDaysFromToday(-10), endDate: isoDaysFromToday(10) }),
      promotion({ id: "p-expiring", code: "EXP01", nameAr: "قرب الانتهاء نص", startDate: isoDaysFromToday(-10), endDate: isoDaysFromToday(3) }),
    ];
    render(promos);

    const rowFor = async (code: string) => (await screen.findByText(code)).closest("tr")!;

    expect(within(await rowFor("ACT01")).getByText("فعال")).toBeInTheDocument();
    expect(within(await rowFor("SCH01")).getByText("مجدول")).toBeInTheDocument();
    expect(within(await rowFor("END01")).getByText("منتهي")).toBeInTheDocument();
    expect(within(await rowFor("END02")).getByText("منتهي")).toBeInTheDocument();
    expect(within(await rowFor("EXP01")).getByText("قرب الانتهاء")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("tab", { name: /^منتهي/ }));
    await waitFor(() => expect(screen.queryByText("ACT01")).not.toBeInTheDocument());
    expect(screen.getByText("END01")).toBeInTheDocument();
    expect(screen.getByText("END02")).toBeInTheDocument();
    expect(screen.queryByText("EXP01")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("tab", { name: /قرب الانتهاء/ }));
    await waitFor(() => expect(screen.queryByText("END01")).not.toBeInTheDocument());
    expect(screen.getByText("EXP01")).toBeInTheDocument();
  });

  it("filters to coupon-required promotions, then to promotions with a discount cap, using the toggle chips", async () => {
    const promos = [
      promotion({ id: "p-plain", code: "PLAIN1", requiresCoupon: false, maxDiscountAmount: null }),
      promotion({ id: "p-coupon", code: "COUPON1", requiresCoupon: true, maxDiscountAmount: null }),
      promotion({ id: "p-capped", code: "CAP1", requiresCoupon: false, maxDiscountAmount: "20.000000" }),
    ];
    render(promos);

    await screen.findByText("PLAIN1");
    fireEvent.click(screen.getByRole("button", { name: "التي تتطلب كوبوناً" }));
    await waitFor(() => expect(screen.queryByText("PLAIN1")).not.toBeInTheDocument());
    expect(screen.getByText("COUPON1")).toBeInTheDocument();
    expect(screen.queryByText("CAP1")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "التي تتطلب كوبوناً" }));
    await screen.findByText("PLAIN1");

    fireEvent.click(screen.getByRole("button", { name: "التي لها سقف خصم" }));
    await waitFor(() => expect(screen.queryByText("PLAIN1")).not.toBeInTheDocument());
    expect(screen.getByText("CAP1")).toBeInTheDocument();
    expect(screen.queryByText("COUPON1")).not.toBeInTheDocument();
  });

  it("searches promotions by code or by Arabic name", async () => {
    const promos = [
      promotion({ id: "p-1", code: "WINTER10", nameAr: "خصم الشتاء" }),
      promotion({ id: "p-2", code: "SPRING5", nameAr: "خصم الربيع" }),
    ];
    render(promos);

    await screen.findByText("WINTER10");
    const searchInput = screen.getByPlaceholderText("ابحث برمز العرض أو اسمه…");
    fireEvent.change(searchInput, { target: { value: "spring" } });
    await waitFor(() => expect(screen.queryByText("WINTER10")).not.toBeInTheDocument(), { timeout: 2000 });
    expect(screen.getByText("SPRING5")).toBeInTheDocument();

    fireEvent.change(searchInput, { target: { value: "الشتاء" } });
    await waitFor(() => expect(screen.getByText("WINTER10")).toBeInTheDocument(), { timeout: 2000 });
  });
});

describe("PromotionsScreen — list columns", () => {
  it("shows a buy-x-get-y quantity pair, a plain discount amount, a minimum quantity, a discount cap and the coupon badge", async () => {
    const promos = [
      promotion({ id: "p-bg", code: "BUYGET", type: "buy_x_get_y", percentValue: null, amountValue: null, buyQty: 3, getQty: 1 }),
      promotion({ id: "p-fx", code: "FIXED75", type: "fixed_amount", percentValue: null, amountValue: "75.000000", minQty: "5.000000", maxDiscountAmount: "40.000000", requiresCoupon: true }),
    ];
    render(promos);

    const bgRow = (await screen.findByText("BUYGET")).closest("tr")!;
    expect(within(bgRow).getByText("3 + 1")).toBeInTheDocument();

    const fxRow = (await screen.findByText("FIXED75")).closest("tr")!;
    expect(within(fxRow).getByText("75.00")).toBeInTheDocument();
    expect(within(fxRow).getByText("5")).toBeInTheDocument();
    expect(within(fxRow).getByText("40.00")).toBeInTheDocument();
    expect(within(fxRow).getByText("بكوبون")).toBeInTheDocument();
  });

  it("falls back to zero for a percentage, a buy-x-get-y pair or a plain amount that were never set", async () => {
    const promos = [
      promotion({ id: "p-pct0", code: "PCT0", type: "percentage", percentValue: null }),
      promotion({ id: "p-bg0", code: "BUYGET0", type: "buy_x_get_y", percentValue: null, amountValue: null, buyQty: null, getQty: null }),
      promotion({ id: "p-fx0", code: "SPECIAL0", type: "special_price", percentValue: null, amountValue: null }),
    ];
    render(promos);

    const pctRow = (await screen.findByText("PCT0")).closest("tr")!;
    expect(within(pctRow).getByText("0%")).toBeInTheDocument();

    const bgRow = (await screen.findByText("BUYGET0")).closest("tr")!;
    expect(within(bgRow).getByText("0 + 0")).toBeInTheDocument();

    const fxRow = (await screen.findByText("SPECIAL0")).closest("tr")!;
    expect(within(fxRow).getByText("0.00")).toBeInTheDocument();
  });
});

describe("PromotionsScreen — the usage report", () => {
  it("shows the real usage figures from the usage report", async () => {
    render([], {
      "GET /promotions/report": () => ({
        body: [{ id: "u1", code: "USAGE1", nameAr: "عرض الاستخدام", usageCount: 12, discountGranted: "500.000000", reversedDiscount: "50.000000", netDiscount: "450.000000" }],
      }),
    });

    const usageSection = (await screen.findByText("استخدام العروض")).closest("div")!;
    await within(usageSection).findByText("USAGE1");
    expect(within(usageSection).getByText("12")).toBeInTheDocument();
    expect(within(usageSection).getByText("500.00")).toBeInTheDocument();
    expect(within(usageSection).getByText("50.00")).toBeInTheDocument();
    expect(within(usageSection).getByText("450.00")).toBeInTheDocument();
  });

  it("shows the empty usage message when there is no usage in the period", async () => {
    render([]);
    expect(await screen.findByText("لا توجد عروض في الفترة.")).toBeInTheDocument();
  });
});

describe("PromotionsScreen — the promotion-type fields", () => {
  it("shows only the fields relevant to the chosen promotion type, hiding the rest", async () => {
    const user = userEvent.setup();
    render([]);
    await user.click(screen.getByRole("button", { name: "إضافة عرض" }));
    const dialog = screen.getByRole("dialog", { name: "إضافة عرض" });

    expect(within(dialog).getByLabelText("قيمة الخصم % *")).toBeInTheDocument();
    expect(within(dialog).queryByLabelText("قيمة الخصم")).not.toBeInTheDocument();
    expect(within(dialog).queryByText("مكوّنات الحزمة")).not.toBeInTheDocument();

    chooseSelectOption("النوع *", "خصم مبلغ");
    expect(within(dialog).queryByLabelText("قيمة الخصم % *")).not.toBeInTheDocument();
    expect(within(dialog).getByText("قيمة الخصم")).toBeInTheDocument();
    expect(within(dialog).getByLabelText("قيمة الخصم")).toBeInTheDocument();

    chooseSelectOption("النوع *", "سعر خاص");
    expect(within(dialog).getByText("السعر الخاص للوحدة")).toBeInTheDocument();

    chooseSelectOption("النوع *", "حزمة");
    expect(within(dialog).getByText("سعر الحزمة")).toBeInTheDocument();
    expect(within(dialog).getByText("مكونات الحزمة")).toBeInTheDocument();

    chooseSelectOption("النوع *", "اشتر واحصل على");
    expect(within(dialog).queryByText("مكونات الحزمة")).not.toBeInTheDocument();
    expect(within(dialog).getByLabelText("اشترِ (X)")).toBeInTheDocument();
    expect(within(dialog).getByLabelText("واحصل على (Y)")).toBeInTheDocument();

    chooseSelectOption("النوع *", "نسبة خصم");
    expect(within(dialog).getByLabelText("قيمة الخصم % *")).toBeInTheDocument();
    expect(within(dialog).queryByLabelText("اشترِ (X)")).not.toBeInTheDocument();
  });
});

describe("PromotionsScreen — creating a bundle or buy-x-get-y promotion", () => {
  it("creates a bundle promotion with its own price and two components", async () => {
    const user = userEvent.setup();
    let created: Record<string, unknown> | undefined;
    render([], {
      "GET /items": () => ({ body: [itemFixture(), itemFixture({ id: "itm-2", code: "ITM-000002", nameAr: "زيت عباد الشمس 1 لتر" })] }),
      "POST /promotions": (init) => {
        created = JSON.parse(String(init?.body));
        return { status: 201, body: promotion({ id: "promo-bundle", ...created }) };
      },
    });

    await user.click(screen.getByRole("button", { name: "إضافة عرض" }));
    const dialog = screen.getByRole("dialog", { name: "إضافة عرض" });
    await user.type(fieldInput(dialog, "الرمز *"), "BUNDLE1");
    await user.type(fieldInput(dialog, "الاسم *"), "حزمة الأرز والزيت");
    chooseSelectOption("النوع *", "حزمة");

    typeMoney(within(dialog).getByLabelText("قيمة الخصم"), "99.5");

    fireEvent.click(within(dialog).getByRole("button", { name: "إضافة مكوّن" }));
    let pickers = within(dialog).getAllByPlaceholderText("اختر صنفاً");
    pickFromCombobox(pickers[0]!, "أرز أبيض مصري 5 كجم");

    fireEvent.click(within(dialog).getByRole("button", { name: "إضافة مكوّن" }));
    pickers = within(dialog).getAllByPlaceholderText("اختر صنفاً");
    pickFromCombobox(pickers[1]!, "زيت عباد الشمس 1 لتر");
    const qtyInputs = within(dialog).getAllByLabelText("الكمية");
    typeQty(qtyInputs[1]!, "2");

    fireEvent.click(within(dialog).getByRole("button", { name: "إضافة" }));

    await waitFor(() => expect(created).toBeDefined());
    expect(created?.type).toBe("bundle");
    expect(created?.amountValue).toBe("99.50");
    expect(created?.percentValue).toBeNull();
    expect(created?.buyQty).toBeNull();
    expect(created?.getQty).toBeNull();
    expect(created?.bundleComponents).toEqual([
      { itemId: "itm-1", qty: "1.000000" },
      { itemId: "itm-2", qty: "2.000000" },
    ]);
  });

  it("creates a buy-x-get-y promotion with its own quantities, and no percent or amount value", async () => {
    const user = userEvent.setup();
    let created: Record<string, unknown> | undefined;
    render([], {
      "POST /promotions": (init) => {
        created = JSON.parse(String(init?.body));
        return { status: 201, body: promotion({ id: "promo-bg", ...created }) };
      },
    });

    await user.click(screen.getByRole("button", { name: "إضافة عرض" }));
    const dialog = screen.getByRole("dialog", { name: "إضافة عرض" });
    await user.type(fieldInput(dialog, "الرمز *"), "B2G1");
    await user.type(fieldInput(dialog, "الاسم *"), "اشترِ ٢ واحصل على ١");
    chooseSelectOption("النوع *", "اشتر واحصل على");

    const buyInput = within(dialog).getByLabelText("اشترِ (X)");
    fireEvent.change(buyInput, { target: { value: "4" } });
    const getInput = within(dialog).getByLabelText("واحصل على (Y)");
    fireEvent.change(getInput, { target: { value: "2" } });

    fireEvent.click(within(dialog).getByRole("button", { name: "إضافة" }));

    await waitFor(() => expect(created).toBeDefined());
    expect(created?.type).toBe("buy_x_get_y");
    expect(created?.buyQty).toBe(4);
    expect(created?.getQty).toBe(2);
    expect(created?.percentValue).toBeNull();
    expect(created?.amountValue).toBeNull();
  });

  it("sends a minimum invoice value, a minimum quantity and a discount cap in the create body when filled in", async () => {
    const user = userEvent.setup();
    let created: Record<string, unknown> | undefined;
    render([], {
      "POST /promotions": (init) => {
        created = JSON.parse(String(init?.body));
        return { status: 201, body: promotion({ id: "promo-thresholds", ...created }) };
      },
    });

    await user.click(screen.getByRole("button", { name: "إضافة عرض" }));
    const dialog = screen.getByRole("dialog", { name: "إضافة عرض" });
    await user.type(fieldInput(dialog, "الرمز *"), "THRESH1");
    await user.type(fieldInput(dialog, "الاسم *"), "عرض بحدود");

    typeMoney(within(dialog).getByLabelText("حد أدنى لقيمة الفاتورة"), "100");
    typeQty(within(dialog).getByLabelText("حد أدنى للكمية"), "3");
    typeMoney(within(dialog).getByLabelText("الحد الأقصى للخصم"), "50");

    fireEvent.click(within(dialog).getByRole("button", { name: "إضافة" }));

    await waitFor(() => expect(created).toBeDefined());
    expect(created?.minInvoiceValue).toBe("100.00");
    expect(created?.minQty).toBe("3.000000");
    expect(created?.maxDiscountAmount).toBe("50.00");
  });

  it("treats a minimum quantity of zero as no threshold at all", async () => {
    const user = userEvent.setup();
    let created: Record<string, unknown> | undefined;
    render([], {
      "POST /promotions": (init) => {
        created = JSON.parse(String(init?.body));
        return { status: 201, body: promotion({ id: "promo-zero-qty", ...created }) };
      },
    });

    await user.click(screen.getByRole("button", { name: "إضافة عرض" }));
    const dialog = screen.getByRole("dialog", { name: "إضافة عرض" });
    await user.type(fieldInput(dialog, "الرمز *"), "ZEROQTY");
    await user.type(fieldInput(dialog, "الاسم *"), "عرض بدون حد كمية");

    typeQty(within(dialog).getByLabelText("حد أدنى للكمية"), "0");
    fireEvent.click(within(dialog).getByRole("button", { name: "إضافة" }));

    await waitFor(() => expect(created).toBeDefined());
    expect(created?.minQty).toBeNull();
  });

  it("leaves the amount at zero when a special-price promotion's amount field is left blank", async () => {
    const user = userEvent.setup();
    let created: Record<string, unknown> | undefined;
    render([], {
      "POST /promotions": (init) => {
        created = JSON.parse(String(init?.body));
        return { status: 201, body: promotion({ id: "promo-blank-amount", ...created }) };
      },
    });

    await user.click(screen.getByRole("button", { name: "إضافة عرض" }));
    const dialog = screen.getByRole("dialog", { name: "إضافة عرض" });
    await user.type(fieldInput(dialog, "الرمز *"), "BLANKAMT");
    await user.type(fieldInput(dialog, "الاسم *"), "سعر خاص بدون قيمة");
    chooseSelectOption("النوع *", "سعر خاص");

    fireEvent.click(within(dialog).getByRole("button", { name: "إضافة" }));

    await waitFor(() => expect(created).toBeDefined());
    expect(created?.type).toBe("special_price");
    expect(created?.amountValue).toBe("0.00");
  });
});

describe("PromotionsScreen — editing a promotion", () => {
  it("prefills every field when editing, including a scope item missing from the catalog, and saves the edit", async () => {
    const editPromo = promotion({
      id: "promo-edit",
      code: "EDIT10",
      nameAr: "عرض للتعديل",
      type: "fixed_amount",
      percentValue: null,
      amountValue: "60.000000",
      minInvoiceValue: "200.000000",
      minQty: "4.000000",
      maxDiscountAmount: "30.000000",
      requiresCoupon: true,
      active: true,
      scope: { type: "item", ids: ["itm-1", "itm-ghost"] },
    });
    let patched: Record<string, unknown> | undefined;
    render([editPromo], {
      "GET /items": () => ({ body: [itemFixture()] }),
      "PATCH /promotions/promo-edit": (init) => {
        patched = JSON.parse(String(init?.body));
        return { body: promotion({ ...editPromo, ...patched }) };
      },
    });

    fireEvent.click(await screen.findByText("EDIT10"));
    const dialog = screen.getByRole("dialog", { name: "تعديل العرض" });

    expect(fieldInput(dialog, "الرمز *")).toHaveValue("EDIT10");
    expect(fieldInput(dialog, "الاسم *")).toHaveValue("عرض للتعديل");
    expect(within(dialog).getByLabelText("قيمة الخصم")).toHaveValue("60.00");
    expect(within(dialog).getByLabelText("حد أدنى لقيمة الفاتورة")).toHaveValue("200.00");
    expect(within(dialog).getByLabelText("حد أدنى للكمية")).toHaveValue("4");
    expect(within(dialog).getByLabelText("الحد الأقصى للخصم")).toHaveValue("30.00");
    expect(within(dialog).getByText("أرز أبيض مصري 5 كجم")).toBeInTheDocument();
    expect(within(dialog).getByText("itm-ghost")).toBeInTheDocument();

    fireEvent.click(within(dialog).getByRole("switch", { name: "نشط" }));
    fireEvent.click(within(dialog).getByRole("button", { name: "حفظ التعديلات" }));

    await waitFor(() => expect(patched).toBeDefined());
    expect(patched?.active).toBe(false);
    expect(patched?.amountValue).toBe("60.00");
    expect(patched?.scope).toEqual({ type: "item", ids: ["itm-1", "itm-ghost"] });
  });

  it("leaves the amount, thresholds and cap blank when editing a plain percentage promotion that never had them", async () => {
    const plainPromo = promotion({ id: "promo-plain-edit", code: "PLAINEDIT", type: "percentage", percentValue: 15 });
    let patched: Record<string, unknown> | undefined;
    render([plainPromo], {
      "PATCH /promotions/promo-plain-edit": (init) => {
        patched = JSON.parse(String(init?.body));
        return { body: promotion({ ...plainPromo, ...patched }) };
      },
    });

    fireEvent.click(await screen.findByText("PLAINEDIT"));
    const dialog = screen.getByRole("dialog", { name: "تعديل العرض" });
    expect(within(dialog).getByLabelText("حد أدنى لقيمة الفاتورة")).toHaveValue("");
    expect(within(dialog).getByLabelText("الحد الأقصى للخصم")).toHaveValue("");

    fireEvent.click(within(dialog).getByRole("button", { name: "حفظ التعديلات" }));

    await waitFor(() => expect(patched).toBeDefined());
    expect(patched?.amountValue).toBeNull();
    expect(patched?.minInvoiceValue).toBeNull();
    expect(patched?.minQty).toBeNull();
    expect(patched?.maxDiscountAmount).toBeNull();
  });

  it("adds a scoped item only once even when picked twice, and removes it through its own delete button", async () => {
    const user = userEvent.setup();
    let created: Record<string, unknown> | undefined;
    render([], {
      "GET /items": () => ({ body: [itemFixture(), itemFixture({ id: "itm-2", code: "ITM-000002", nameAr: "سكر أبيض 1 كجم" })] }),
      "POST /promotions": (init) => {
        created = JSON.parse(String(init?.body));
        return { status: 201, body: promotion({ id: "promo-scoped", ...created }) };
      },
    });

    await user.click(screen.getByRole("button", { name: "إضافة عرض" }));
    const dialog = screen.getByRole("dialog", { name: "إضافة عرض" });
    await user.type(fieldInput(dialog, "الرمز *"), "SCOPE1");
    await user.type(fieldInput(dialog, "الاسم *"), "عرض على أصناف محددة");
    chooseSelectOption("النطاق", "أصناف محددة");

    const addItemInput = within(dialog).getByPlaceholderText("أضف صنفاً إلى النطاق");
    pickFromCombobox(addItemInput, "أرز أبيض مصري 5 كجم");
    pickFromCombobox(addItemInput, "أرز أبيض مصري 5 كجم");
    const scopeList = within(dialog).getByText("الأصناف المشمولة").closest("div")!;
    expect(within(scopeList).getAllByText("أرز أبيض مصري 5 كجم")).toHaveLength(1);

    fireEvent.click(within(scopeList).getByRole("button", { name: "حذف" }));
    expect(within(scopeList).queryByText("أرز أبيض مصري 5 كجم")).not.toBeInTheDocument();

    pickFromCombobox(addItemInput, "سكر أبيض 1 كجم");
    fireEvent.click(within(dialog).getByRole("button", { name: "إضافة" }));

    await waitFor(() => expect(created).toBeDefined());
    expect(created?.scope).toEqual({ type: "item", ids: ["itm-2"] });
  });
});

describe("PromotionsScreen — activating and deactivating", () => {
  it("shows resume in the row menu for an inactive promotion and reactivates it", async () => {
    const promo = promotion({ id: "promo-inactive", code: "OLD5", active: false });
    let patched: Record<string, unknown> | undefined;
    render([promo], {
      "PATCH /promotions/promo-inactive": (init) => {
        patched = JSON.parse(String(init?.body));
        return { body: promotion({ ...promo, active: true }) };
      },
    });

    await screen.findByText("OLD5");
    fireEvent.click(screen.getByRole("button", { name: "إجراءات OLD5" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "استئناف العرض" }));

    await waitFor(() => expect(patched).toEqual({ active: true }));
  });
});
