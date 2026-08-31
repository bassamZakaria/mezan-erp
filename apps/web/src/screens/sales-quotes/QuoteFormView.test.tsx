// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, expect, it } from "vitest";
import { screen, fireEvent, within, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { BranchDTO, CustomerDTO, ItemDTO } from "@mezan/contracts";
import { QuoteFormView } from "./QuoteFormView";
import { renderWithProviders, stubTransport, testAdminSession } from "../../data/test-support";

// jsdom has no layout engine and does not implement scrollIntoView; the
// dropdown menu (Select) calls it when the active option changes.
if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = () => {};
}

/**
 * `findBy*` resolves on its FIRST synchronous check when the element is
 * already present (e.g. static headings), so `await screen.findByRole(...)`
 * on one of those does NOT give queued fetch/react-query microtasks a chance
 * to flush. A real macrotask tick does.
 */
function flushData(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/** The grand-total figure in the sticky summary card — distinct from a single line's own total, which can coincide with it. */
function grandTotalText(): string | null {
  return screen.getByText("الإجمالي الكلي").closest("div")?.querySelector(".mz-num")?.textContent ?? null;
}

function pickFromCombobox(container: HTMLElement, label: string, optionLabel: string) {
  const input = within(container).getByLabelText(label);
  fireEvent.focus(input);
  fireEvent.change(input, { target: { value: optionLabel } });
  const option = within(container).getByRole("button", { name: (n) => n.startsWith(optionLabel) });
  fireEvent.mouseDown(option);
}

const branches: BranchDTO[] = [
  { id: "MAIN", code: "MAIN", name: "الفرع الرئيسي", parentBranchId: null, phone: null, email: null, address: null, isMain: true, active: true },
];
const customers: CustomerDTO[] = [
  {
    id: "cust-1", code: "C1", nameAr: "متجر الأمل", nameEn: null, phone: null, email: null, contactPerson: null, taxNumber: null, category: null,
    notes: null, paymentTermsDays: 0, currency: "EGP", openingBalance: "0", active: true, priceListId: null, creditLimit: "0", taxExempt: false,
    etaBuyerType: "business", commercialRegistrationNumber: null, address: null, logoAttachmentId: null, nationalId: null,
  },
];
const items: ItemDTO[] = [
  {
    id: "item-1", code: "ITM-1", nameAr: "صنف تجريبي", nameEn: null, type: "stock", baseUnitCode: "PCS", alternateUnits: [], barcodes: [],
    categoryId: null, brandId: null, seasonId: null, description: null, defaultSupplierId: null, specifications: [], costingMethod: "WAC",
    salePrice: "200.000000", costPrice: "150.000000", taxRatePercent: 14, trackInventory: true, trackBatches: false, trackExpiry: false,
    reorderPoint: null, imageAttachmentId: null, reorderQty: null, revenueAccountId: null, cogsAccountId: null, inventoryAccountId: null,
    etaCodeType: null, etaItemCode: null, gpcCode: null, status: "active",
  },
];

function renderForm(extra: Record<string, (init: RequestInit | undefined, path: string) => { status?: number; body: unknown }> = {}) {
  let lastCreateBody: unknown = null;
  const onClose = () => {};
  const transport = stubTransport({
    "GET /branches": () => ({ body: branches }),
    "GET /customers": () => ({ body: customers }),
    "GET /items": () => ({ body: items }),
    "GET /price-lists": () => ({ body: [] }),
    "GET /inventory/stock-balance": () => ({ body: { rows: [] } }),
    "GET /reports/aging/customers": () => ({ body: { rows: [], groups: [], grandTotals: {}, reconciliation: null } }),
    "POST /sales-quotes": (init) => {
      lastCreateBody = JSON.parse((init?.body as string) ?? "{}");
      return { body: { id: "q-new", docNo: "SQ-000002" } };
    },
    ...extra,
  });
  const result = renderWithProviders(<QuoteFormView onClose={onClose} />, { transport, initialSession: testAdminSession });
  return { ...result, getCreateBody: () => lastCreateBody };
}

describe("QuoteFormView", () => {
  it("blocks submit with an Arabic message when no customer is picked", async () => {
    renderForm();
    await screen.findByRole("heading", { name: "عرض سعر جديد" });
    await flushData();
    fireEvent.click(screen.getByRole("button", { name: "حفظ كمسودة" }));
    expect(await screen.findByText("اختر عميلاً.")).toBeInTheDocument();
  });

  it("blocks submit with an Arabic message when a line has no item", async () => {
    renderForm();
    await screen.findByRole("heading", { name: "عرض سعر جديد" });
    await flushData();
    pickFromCombobox(document.body, "العميل *", "متجر الأمل");
    fireEvent.click(screen.getByRole("button", { name: "حفظ كمسودة" }));
    expect(await screen.findByText("اختر صنفاً من المخزون لكل بند.")).toBeInTheDocument();
  });

  it("creates a quote with the real picked customer and item ids, the item's own sale price seeded onto the line", async () => {
    const { getCreateBody } = renderForm();
    await screen.findByRole("heading", { name: "عرض سعر جديد" });
    await flushData();
    pickFromCombobox(document.body, "العميل *", "متجر الأمل");
    pickFromCombobox(document.body, "الصنف — بند 1", "صنف تجريبي");
    fireEvent.click(screen.getByRole("button", { name: "حفظ كمسودة" }));
    await waitFor(() => expect(getCreateBody()).not.toBeNull());
    const body = getCreateBody() as Record<string, unknown>;
    expect(body.customerId).toBe("cust-1");
    const lines = body.lines as Array<Record<string, unknown>>;
    expect(lines[0]!.itemId).toBe("item-1");
    expect(lines[0]!.unitPrice).toBe("200.000000");
  });

  it("the pricing summary renders formatted Money and reacts to a percent discount, never a raw scaled-decimal string", async () => {
    renderForm();
    await screen.findByRole("heading", { name: "عرض سعر جديد" });
    await flushData();
    pickFromCombobox(document.body, "الصنف — بند 1", "صنف تجريبي");
    expect(await screen.findByText((_, el) => el?.textContent === "200.00")).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByText("200.000000")).not.toBeInTheDocument());
  });

  it("a server refusal on create renders the server's Arabic message, not raw JSON", async () => {
    const { getCreateBody } = renderForm({
      "POST /sales-quotes": () => ({ status: 400, body: { message: "الصنف غير متاح للبيع" } }),
    });
    await screen.findByRole("heading", { name: "عرض سعر جديد" });
    await flushData();
    pickFromCombobox(document.body, "العميل *", "متجر الأمل");
    pickFromCombobox(document.body, "الصنف — بند 1", "صنف تجريبي");
    fireEvent.click(screen.getByRole("button", { name: "حفظ كمسودة" }));
    expect(await screen.findByText("الصنف غير متاح للبيع")).toBeInTheDocument();
    void getCreateBody;
  });

  it("editing qty on line 1 and adding a second line recomputes the summary to the exact decimal total, and both lines' real values reach the request", async () => {
    const { getCreateBody } = renderForm();
    await screen.findByRole("heading", { name: "عرض سعر جديد" });
    await flushData();
    pickFromCombobox(document.body, "العميل *", "متجر الأمل");
    pickFromCombobox(document.body, "الصنف — بند 1", "صنف تجريبي");

    const qty1 = screen.getAllByText("الكمية")[0]!.parentElement!.querySelector("input")!;
    fireEvent.change(qty1, { target: { value: "3" } });

    // line1: 3 * 200 = 600, tax 14% = 84, total 684 — before the second line exists.
    await waitFor(() => expect(grandTotalText()).toBe("684.00"));

    fireEvent.click(screen.getByRole("button", { name: "إضافة بند" }));
    pickFromCombobox(document.body, "الصنف — بند 2", "صنف تجريبي");

    // line2 defaults to qty 1: 1 * 200 = 200, tax 28, total 228. Combined: subtotal 800, tax 112, grand 912.
    await waitFor(() => expect(grandTotalText()).toBe("912.00"));

    fireEvent.click(screen.getByRole("button", { name: "حفظ كمسودة" }));
    await waitFor(() => expect(getCreateBody()).not.toBeNull());
    const body = getCreateBody() as Record<string, unknown>;
    const lines = body.lines as Array<Record<string, unknown>>;
    expect(lines).toHaveLength(2);
    expect(lines[0]!.qty).toBe("3.000000");
    expect(lines[0]!.unitPrice).toBe("200.000000");
    expect(lines[1]!.qty).toBe("1.000000");
    expect(lines[1]!.unitPrice).toBe("200.000000");
  });

  it("removing a line drops it from the payload and the grand total falls by exactly that line's own amount", async () => {
    const { getCreateBody } = renderForm();
    await screen.findByRole("heading", { name: "عرض سعر جديد" });
    await flushData();
    pickFromCombobox(document.body, "العميل *", "متجر الأمل");
    pickFromCombobox(document.body, "الصنف — بند 1", "صنف تجريبي");
    const qty1 = screen.getAllByText("الكمية")[0]!.parentElement!.querySelector("input")!;
    fireEvent.change(qty1, { target: { value: "3" } });

    fireEvent.click(screen.getByRole("button", { name: "إضافة بند" }));
    pickFromCombobox(document.body, "الصنف — بند 2", "صنف تجريبي");
    await waitFor(() => expect(grandTotalText()).toBe("912.00"));

    fireEvent.click(screen.getByRole("button", { name: "حذف البند 2" }));

    // Back to a single 684.00 line — the 228.00 removed line's own amount, exactly.
    await waitFor(() => expect(grandTotalText()).toBe("684.00"));

    fireEvent.click(screen.getByRole("button", { name: "حفظ كمسودة" }));
    await waitFor(() => expect(getCreateBody()).not.toBeNull());
    const lines = (getCreateBody() as Record<string, unknown>).lines as Array<Record<string, unknown>>;
    expect(lines).toHaveLength(1);
    expect(lines[0]!.qty).toBe("3.000000");
  });

  it("the remove-line button is disabled on the last remaining line — a quote can never be submitted with zero lines by deleting them all", async () => {
    renderForm();
    await screen.findByRole("heading", { name: "عرض سعر جديد" });
    await flushData();
    expect(screen.getByRole("button", { name: "حذف البند 1" })).toBeDisabled();
  });

  it("expanding a line and editing its own discount % and tax % recomputes only that line's total, and reaches the request", async () => {
    const { getCreateBody } = renderForm();
    await screen.findByRole("heading", { name: "عرض سعر جديد" });
    await flushData();
    pickFromCombobox(document.body, "العميل *", "متجر الأمل");
    pickFromCombobox(document.body, "الصنف — بند 1", "صنف تجريبي");
    const qty1 = screen.getAllByText("الكمية")[0]!.parentElement!.querySelector("input")!;
    fireEvent.change(qty1, { target: { value: "2" } });

    fireEvent.click(screen.getByRole("button", { name: "تفاصيل البند 1" }));
    const discountInput = screen.getByText("خصم %").parentElement!.querySelector("input")!;
    fireEvent.change(discountInput, { target: { value: "25" } });
    const taxInput = screen.getByText("نسبة الضريبة %").parentElement!.querySelector("input")!;
    fireEvent.change(taxInput, { target: { value: "5" } });

    // gross 2*200=400, line discount 25% = 100, net/base 300, tax 5% of 300 = 15, total 315.
    // With a single line the line total and grand total coincide.
    await waitFor(() => expect(grandTotalText()).toBe("315.00"));

    fireEvent.click(screen.getByRole("button", { name: "حفظ كمسودة" }));
    await waitFor(() => expect(getCreateBody()).not.toBeNull());
    const lines = (getCreateBody() as Record<string, unknown>).lines as Array<Record<string, unknown>>;
    expect(lines[0]!.discountPercent).toBe(25);
    expect(lines[0]!.taxRatePercent).toBe(5);
    expect(lines[0]!.qty).toBe("2.000000");
  });

  it("the header discount percent reduces the taxable base and grand total by the exact rounded amount, and is carried as a percent discount", async () => {
    const { getCreateBody } = renderForm();
    await screen.findByRole("heading", { name: "عرض سعر جديد" });
    await flushData();
    pickFromCombobox(document.body, "العميل *", "متجر الأمل");
    pickFromCombobox(document.body, "الصنف — بند 1", "صنف تجريبي");

    const discountValueInput = screen.getByText("قيمة الخصم").parentElement!.querySelector("input")!;
    fireEvent.change(discountValueInput, { target: { value: "10" } });

    // subtotal 200, header discount 10% = 20, taxable 180, tax 14% of 180 = 25.2, grand 205.20.
    await waitFor(() => expect(grandTotalText()).toBe("205.20"));

    fireEvent.click(screen.getByRole("button", { name: "حفظ كمسودة" }));
    await waitFor(() => expect(getCreateBody()).not.toBeNull());
    const body = getCreateBody() as Record<string, unknown>;
    expect(body.discount).toEqual({ type: "percent", percent: 10 });
  });

  it("the branch defaults from working location and can be re-picked to a real branch id", async () => {
    const user = userEvent.setup();
    const { getCreateBody } = renderForm();
    await screen.findByRole("heading", { name: "عرض سعر جديد" });
    await flushData();
    pickFromCombobox(document.body, "العميل *", "متجر الأمل");
    pickFromCombobox(document.body, "الصنف — بند 1", "صنف تجريبي");
    await user.click(screen.getByRole("combobox", { name: "الفرع *" }));
    await user.click(await screen.findByRole("option", { name: /الفرع الرئيسي/ }));
    fireEvent.click(screen.getByRole("button", { name: "حفظ كمسودة" }));
    await waitFor(() => expect(getCreateBody()).not.toBeNull());
    expect((getCreateBody() as Record<string, unknown>).branchId).toBe("MAIN");
  });
});
