// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, expect, it } from "vitest";
import { screen, fireEvent, within, waitFor } from "@testing-library/react";
import type { BranchDTO, CustomerDTO, ItemDTO } from "@mezan/contracts";
import { QuoteFormView } from "./QuoteFormView";
import { renderWithProviders, stubTransport, testAdminSession, type StubResult } from "../../data/test-support";

if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = () => {};
}

function flushData(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function pickFromCombobox(container: HTMLElement, label: string, optionLabel: string) {
  const input = within(container).getByLabelText(label);
  fireEvent.focus(input);
  fireEvent.change(input, { target: { value: optionLabel } });
  const option = within(container).getByRole("button", { name: (n) => n.startsWith(optionLabel) });
  fireEvent.mouseDown(option);
}

function selectValue(label: string, optionLabel: string) {
  fireEvent.click(screen.getByRole("combobox", { name: label }));
  fireEvent.mouseDown(screen.getByRole("option", { name: optionLabel }));
}

const branches: BranchDTO[] = [
  { id: "MAIN", code: "MAIN", name: "الفرع الرئيسي", parentBranchId: null, phone: null, email: null, address: null, isMain: true, active: true },
  { id: "ALEX", code: "ALEX", name: "فرع الإسكندرية", parentBranchId: "MAIN", phone: null, email: null, address: null, isMain: false, active: true },
];

function customer(overrides: Partial<CustomerDTO> = {}): CustomerDTO {
  return {
    id: "cust-1", code: "C1", nameAr: "متجر الأمل", nameEn: null, phone: null, email: null, contactPerson: null,
    taxNumber: null, category: null, notes: null, paymentTermsDays: 0, currency: "EGP", openingBalance: "0",
    active: true, priceListId: null, creditLimit: "0", taxExempt: false, etaBuyerType: "business",
    commercialRegistrationNumber: null, address: null, logoAttachmentId: null, nationalId: null,
    ...overrides,
  };
}

function item(overrides: Partial<ItemDTO> = {}): ItemDTO {
  return {
    id: "item-1", code: "ITM-1", nameAr: "صنف تجريبي", nameEn: null, type: "stock", baseUnitCode: "PCS",
    alternateUnits: [], barcodes: [], categoryId: null, brandId: null, seasonId: null, description: null,
    defaultSupplierId: null, specifications: [], costingMethod: "WAC", salePrice: "200.000000",
    costPrice: "150.000000", taxRatePercent: 14, trackInventory: true, trackBatches: false, trackExpiry: false,
    reorderPoint: null, imageAttachmentId: null, reorderQty: null, revenueAccountId: null, cogsAccountId: null,
    inventoryAccountId: null, etaCodeType: null, etaItemCode: null, gpcCode: null, status: "active",
    ...overrides,
  };
}

type Handlers = Record<string, (init: RequestInit | undefined, path: string) => StubResult>;

function renderForm(overrides: Handlers = {}) {
  let created: Record<string, unknown> | null = null;
  const transport = stubTransport({
    "GET /branches": () => ({ body: branches }),
    "GET /customers": () => ({ body: [customer()] }),
    "GET /items": () => ({ body: [item()] }),
    "GET /price-lists": () => ({ body: [] }),
    "GET /inventory/stock-balance": () => ({ body: { rows: [] } }),
    "GET /reports/aging/customers": () => ({ body: { rows: [], groups: [], grandTotals: {}, reconciliation: null } }),
    "POST /sales-quotes": (init) => {
      created = JSON.parse((init?.body as string) ?? "{}") as Record<string, unknown>;
      return { body: { id: "q-new", docNo: "SQ-000002" } };
    },
    ...overrides,
  });
  renderWithProviders(<QuoteFormView onClose={() => {}} />, { transport, initialSession: testAdminSession });
  return { getCreated: () => created };
}

async function ready() {
  await screen.findByRole("heading", { name: "عرض سعر جديد" });
  await flushData();
}

describe("QuoteFormView — the price a line opens at", () => {
  it("uses the customer's own price list ahead of the item's sale price", async () => {
    const { getCreated } = renderForm({
      "GET /customers": () => ({ body: [customer({ priceListId: "pl-vip" })] }),
      "GET /price-lists": () => ({
        body: [
          { id: "pl-base", code: "BASE", nameAr: "قائمة الأسعار الأساسية", isBase: true, active: true, lines: [{ itemId: "item-1", price: "200.000000" }] },
          { id: "pl-vip", code: "VIP", nameAr: "قائمة كبار العملاء", isBase: false, active: true, lines: [{ itemId: "item-1", price: "175.000000" }] },
        ],
      }),
    });
    await ready();

    pickFromCombobox(document.body, "العميل *", "متجر الأمل");
    expect(await screen.findByText("قائمة كبار العملاء")).toBeInTheDocument();

    pickFromCombobox(document.body, "الصنف — بند 1", "صنف تجريبي");
    fireEvent.click(screen.getByRole("button", { name: "حفظ كمسودة" }));

    await waitFor(() => expect(getCreated()).not.toBeNull());
    expect(getCreated()).toMatchObject({ priceListId: "pl-vip" });
    expect((getCreated()!.lines as Array<{ unitPrice: string }>)[0]!.unitPrice).toBe("175.000000");
  });

  it("falls back to the active BASE list when the customer has none of their own", async () => {
    const { getCreated } = renderForm({
      "GET /price-lists": () => ({
        body: [
          { id: "pl-old", code: "OLD", nameAr: "قائمة قديمة", isBase: true, active: false, lines: [{ itemId: "item-1", price: "999.000000" }] },
          { id: "pl-base", code: "BASE", nameAr: "قائمة الأسعار الأساسية", isBase: true, active: true, lines: [{ itemId: "item-1", price: "190.000000" }] },
        ],
      }),
    });
    await ready();

    pickFromCombobox(document.body, "العميل *", "متجر الأمل");
    expect(await screen.findByText("قائمة الأسعار الأساسية")).toBeInTheDocument();

    pickFromCombobox(document.body, "الصنف — بند 1", "صنف تجريبي");
    fireEvent.click(screen.getByRole("button", { name: "حفظ كمسودة" }));

    await waitFor(() => expect(getCreated()).not.toBeNull());
    expect((getCreated()!.lines as Array<{ unitPrice: string }>)[0]!.unitPrice).toBe("190.000000");
  });

  it("says so plainly when no price list applies, and prices from the item itself", async () => {
    const { getCreated } = renderForm();
    await ready();

    expect(screen.getByText("السعر الافتراضي للأصناف")).toBeInTheDocument();

    pickFromCombobox(document.body, "العميل *", "متجر الأمل");
    pickFromCombobox(document.body, "الصنف — بند 1", "صنف تجريبي");
    fireEvent.click(screen.getByRole("button", { name: "حفظ كمسودة" }));

    await waitFor(() => expect(getCreated()).not.toBeNull());
    expect(getCreated()).toMatchObject({ priceListId: null });
    expect((getCreated()!.lines as Array<{ unitPrice: string }>)[0]!.unitPrice).toBe("200.000000");
  });

  it("opens a line at zero for an item carrying no sale price and listed nowhere", async () => {
    const { getCreated } = renderForm({ "GET /items": () => ({ body: [item({ salePrice: null })] }) });
    await ready();

    pickFromCombobox(document.body, "العميل *", "متجر الأمل");
    pickFromCombobox(document.body, "الصنف — بند 1", "صنف تجريبي");
    fireEvent.click(screen.getByRole("button", { name: "حفظ كمسودة" }));

    await waitFor(() => expect(getCreated()).not.toBeNull());
    expect((getCreated()!.lines as Array<{ unitPrice: string }>)[0]!.unitPrice).toBe("0.000000");
  });
});

describe("QuoteFormView — what the seller is warned about before quoting", () => {
  it("shows what the customer already owes, marked as a debt", async () => {
    renderForm({
      "GET /reports/aging/customers": () => ({
        body: { rows: [{ customerId: "cust-1", total: 4200 }], groups: [], grandTotals: {}, reconciliation: null },
      }),
    });
    await ready();

    pickFromCombobox(document.body, "العميل *", "متجر الأمل");
    const owed = (await screen.findByText("مديونية العميل الحالية:")).parentElement!;
    expect(within(owed).getByText("4,200.00")).toBeInTheDocument();
  });

  it("shows a zero balance for a customer the aging report does not list", async () => {
    renderForm();
    await ready();

    pickFromCombobox(document.body, "العميل *", "متجر الأمل");
    const owed = (await screen.findByText("مديونية العميل الحالية:")).parentElement!;
    expect(within(owed).getByText("0.00")).toBeInTheDocument();
  });

  it("marks a tracked item with nothing on hand as out of stock", async () => {
    renderForm({ "GET /inventory/stock-balance": () => ({ body: { rows: [{ itemId: "item-1", onHand: "0.000000" }] } }) });
    await ready();

    pickFromCombobox(document.body, "العميل *", "متجر الأمل");
    pickFromCombobox(document.body, "الصنف — بند 1", "صنف تجريبي");

    expect(await screen.findByText("غير متوفر بالمخزون")).toBeInTheDocument();
  });

  it("reports what IS on hand when the item has stock", async () => {
    renderForm({ "GET /inventory/stock-balance": () => ({ body: { rows: [{ itemId: "item-1", onHand: "18.000000" }] } }) });
    await ready();

    pickFromCombobox(document.body, "العميل *", "متجر الأمل");
    pickFromCombobox(document.body, "الصنف — بند 1", "صنف تجريبي");

    const line = (await screen.findByText("المتاح:")).parentElement!;
    expect(within(line).getByText("18")).toBeInTheDocument();
  });

  it("says nothing about stock for a service the business does not track", async () => {
    renderForm({
      "GET /items": () => ({ body: [item({ type: "service", trackInventory: false })] }),
      "GET /inventory/stock-balance": () => ({ body: { rows: [{ itemId: "item-1", onHand: "0.000000" }] } }),
    });
    await ready();

    pickFromCombobox(document.body, "العميل *", "متجر الأمل");
    pickFromCombobox(document.body, "الصنف — بند 1", "صنف تجريبي");

    await flushData();
    expect(screen.queryByText("غير متوفر بالمخزون")).not.toBeInTheDocument();
    expect(screen.queryByText("المتاح:")).not.toBeInTheDocument();
  });

  it("says plainly that there is nothing to quote when the catalogue is empty", async () => {
    renderForm({ "GET /items": () => ({ body: [] }) });
    await ready();

    expect(screen.getByText("لا توجد أصناف في المخزون — أضف صنفاً أولاً من شاشة الأصناف.")).toBeInTheDocument();
  });
});

describe("QuoteFormView — the currency and the branch", () => {
  it("adopts the customer's own currency when they do not trade in pounds", async () => {
    const { getCreated } = renderForm({ "GET /customers": () => ({ body: [customer({ currency: "USD" })] }) });
    await ready();

    pickFromCombobox(document.body, "العميل *", "متجر الأمل");
    pickFromCombobox(document.body, "الصنف — بند 1", "صنف تجريبي");
    fireEvent.click(screen.getByRole("button", { name: "حفظ كمسودة" }));

    await waitFor(() => expect(getCreated()).not.toBeNull());
    expect(getCreated()).toMatchObject({ currency: "USD" });
  });

  it("offers only the base currency for a customer who trades in pounds", async () => {
    renderForm();
    await ready();

    pickFromCombobox(document.body, "العميل *", "متجر الأمل");
    fireEvent.click(screen.getByRole("combobox", { name: "العملة" }));
    expect(screen.getAllByRole("option")).toHaveLength(1);
  });

  it("carries the branch the seller picked, not the default one", async () => {
    const { getCreated } = renderForm();
    await ready();

    pickFromCombobox(document.body, "العميل *", "متجر الأمل");
    selectValue("الفرع *", "فرع الإسكندرية · ALEX");
    pickFromCombobox(document.body, "الصنف — بند 1", "صنف تجريبي");
    fireEvent.click(screen.getByRole("button", { name: "حفظ كمسودة" }));

    await waitFor(() => expect(getCreated()).not.toBeNull());
    expect(getCreated()).toMatchObject({ branchId: "ALEX" });
  });

  it("refuses a quote with no branch behind it at all", async () => {
    const { getCreated } = renderForm({ "GET /branches": () => ({ body: [] }) });
    await ready();

    pickFromCombobox(document.body, "العميل *", "متجر الأمل");
    fireEvent.click(screen.getByRole("button", { name: "حفظ كمسودة" }));

    expect(await screen.findByText("اختر الفرع.")).toBeInTheDocument();
    expect(getCreated()).toBeNull();
  });
});

describe("QuoteFormView — the notes a quote carries", () => {
  it("sends null rather than an empty string for notes the seller left blank", async () => {
    const { getCreated } = renderForm();
    await ready();

    pickFromCombobox(document.body, "العميل *", "متجر الأمل");
    pickFromCombobox(document.body, "الصنف — بند 1", "صنف تجريبي");
    fireEvent.click(screen.getByRole("button", { name: "حفظ كمسودة" }));

    await waitFor(() => expect(getCreated()).not.toBeNull());
    expect(getCreated()).toMatchObject({ notes: null, internalNotes: null });
  });

  it("trims both note fields before sending them", async () => {
    const { getCreated } = renderForm();
    await ready();

    pickFromCombobox(document.body, "العميل *", "متجر الأمل");
    pickFromCombobox(document.body, "الصنف — بند 1", "صنف تجريبي");
    fireEvent.change(screen.getByLabelText("ملاحظات"), { target: { value: "  تسليم خلال أسبوع  " } });
    fireEvent.change(screen.getByLabelText("ملاحظات داخلية"), { target: { value: "  هامش منخفض  " } });
    fireEvent.click(screen.getByRole("button", { name: "حفظ كمسودة" }));

    await waitFor(() => expect(getCreated()).not.toBeNull());
    expect(getCreated()).toMatchObject({ notes: "تسليم خلال أسبوع", internalNotes: "هامش منخفض" });
  });
});
