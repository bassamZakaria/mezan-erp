// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, expect, it } from "vitest";
import { screen, fireEvent, waitFor, within } from "@testing-library/react";
import type { AccountDTO, CustomerDTO, ItemDTO, WarehouseDTO } from "@mezan/contracts";
import { SalesInvoicesScreen } from "./SalesInvoicesScreen";
import { renderWithProviders, stubTransport, testAdminSession } from "../data/test-support";
import type { JournalEntryDTO, SalesInvoiceDTO } from "../data/hooks";

function openNewInvoicePanel() {
  fireEvent.click(screen.getByRole("button", { name: "فاتورة جديدة" }));
  return screen.getByRole("dialog", { name: "فاتورة مبيعات جديدة" });
}

/** Type into an EntityPicker combobox and pick the matching option — selection
 * fires on `onMouseDown` (not `click`), so the input's blur never wins the race. */
function pickFromCombobox(dialog: HTMLElement, label: string, optionLabel: string) {
  const input = within(dialog).getByLabelText(label);
  fireEvent.focus(input);
  fireEvent.change(input, { target: { value: optionLabel } });
  const option = within(dialog).getByRole("button", { name: new RegExp(optionLabel) });
  fireEvent.mouseDown(option);
}

/** MoneyInput only commits its draft to React state on blur. */
function typeMoney(input: HTMLElement, value: string) {
  fireEvent.change(input, { target: { value } });
  fireEvent.blur(input);
}

const customers: CustomerDTO[] = [
  {
    id: "cust-amal", code: "C1", nameAr: "شركة الأمل للتجارة", nameEn: null, phone: null, email: null, contactPerson: null, taxNumber: null,
    category: null, notes: null, paymentTermsDays: 30, currency: "EGP", openingBalance: "0", active: true, priceListId: null,
    creditLimit: "0", taxExempt: false, etaBuyerType: "auto", nationalId: null,
  },
];

const items: ItemDTO[] = [
  {
    id: "item-rice", code: "ITM-1", nameAr: "أرز أبيض مصري 5 كجم", nameEn: null, type: "stock", baseUnitCode: "PCS", alternateUnits: [], barcodes: [],
    categoryId: null, brandId: null, seasonId: null, description: null, defaultSupplierId: null, specifications: [], costingMethod: "WAC", salePrice: "185.00", costPrice: "150.00", taxRatePercent: 14, trackInventory: true,
    trackBatches: false, trackExpiry: false, reorderPoint: null, reorderQty: null, revenueAccountId: null, cogsAccountId: null, inventoryAccountId: null,
    etaCodeType: null, etaItemCode: null, gpcCode: null, status: "active",
  },
];

const warehouses: WarehouseDTO[] = [{ id: "wh-1", code: "WH-MAIN", name: "مستودع الفرع الرئيسي", branchId: "MAIN", type: "MAIN", isDefault: true, active: true }];

const accounts: AccountDTO[] = [
  { id: "1105", code: "1105", nameAr: "ذمم عملاء تجاريين", nameEn: null, type: "asset", naturalBalance: "debit", parentId: null, isHeader: false, status: "active" },
  { id: "4100", code: "4100", nameAr: "إيرادات المبيعات", nameEn: null, type: "revenue", naturalBalance: "credit", parentId: null, isHeader: false, status: "active" },
  { id: "2200", code: "2200", nameAr: "ضريبة القيمة المضافة مستحقة", nameEn: null, type: "liability", naturalBalance: "credit", parentId: null, isHeader: false, status: "active" },
];

function invoiceLine(overrides: Partial<SalesInvoiceDTO["lines"][number]> = {}): SalesInvoiceDTO["lines"][number] {
  return {
    lineId: "l1", itemId: "item-rice", itemNameAr: "أرز أبيض مصري 5 كجم", isStock: true, qty: "1.000000", unitPrice: "185.000000",
    discountPercent: 0, taxRatePercent: 14, revenueAccountId: "4100", cogsAccountId: "5100", inventoryAccountId: "1200", unitCost: "150.000000",
    ...overrides,
  };
}

function invoice(overrides: Partial<SalesInvoiceDTO> = {}): SalesInvoiceDTO {
  return {
    id: "inv-1",
    docType: "SALES_INVOICE",
    docNo: "INV-000001",
    status: "confirmed",
    date: "2026-08-20",
    dueDate: "2026-09-20",
    customerId: "cust-amal",
    customerNameAr: "شركة الأمل للتجارة",
    customerTaxExempt: false,
    warehouseId: "wh-1",
    branchId: "MAIN",
    salespersonId: null,
    salespersonNameAr: null,
    couponCode: null,
    appliedPromotion: null,
    currency: "EGP",
    notes: null,
    internalNotes: null,
    discount: { type: "amount", amount: "0.000000" },
    arAccountId: "1105",
    taxAccountId: "2200",
    amountPaid: "0.000000",
    returnedCredit: "0.000000",
    remainingBalance: "210.900000",
    journalEntryId: "je-1",
    workflowRequestId: null,
    createdAt: "2026-08-20T09:00:00.000Z",
    confirmedAt: "2026-08-20T09:00:00.000Z",
    lines: [invoiceLine()],
    totals: { grossTotal: "185.00", lineDiscountTotal: "0.00", promotionDiscountTotal: "0.00", invoiceDiscountTotal: "0.00", subtotal: "185.00", taxableTotal: "185.00", taxTotal: "25.90", grandTotal: "210.90" },
    ...overrides,
  };
}

const journalEntry: JournalEntryDTO = {
  id: "je-1",
  entryNo: "INV-000001",
  date: "2026-08-20",
  memo: "فاتورة مبيعات INV-000001",
  status: "posted",
  source: "system",
  createdAt: "2026-08-20T09:00:00.000Z",
  postedAt: "2026-08-20T09:00:00.000Z",
  reversesEntryId: null,
  reversedByEntryId: null, sourceDocType: null, sourceDocId: null, sourceDocNumber: null, sourceModule: "manual" as const,
  lines: [
    { accountId: "1105", debit: "210.90", credit: "0.00", memo: null },
    { accountId: "4100", debit: "0.00", credit: "185.00", memo: null },
    { accountId: "2200", debit: "0.00", credit: "25.90", memo: null },
  ],
};

const seededInvoices: SalesInvoiceDTO[] = [
  invoice(),
  invoice({ id: "inv-2", docNo: "INV-000002", status: "paid", amountPaid: "210.900000", remainingBalance: "0.000000" }),
  invoice({ id: "inv-3", docNo: "INV-000003", status: "partially_paid", amountPaid: "50.000000", remainingBalance: "160.900000" }),
];

function baseHandlers(current: SalesInvoiceDTO[]) {
  return {
    "GET /sales-invoices": () => ({ body: current }),
    "GET /customers": () => ({ body: customers }),
    "GET /items": () => ({ body: items }),
    "GET /warehouses": () => ({ body: warehouses }),
    "GET /accounts": () => ({ body: accounts }),
    "GET /gl/journal-entries/je-1": () => ({ body: journalEntry }),
  };
}

describe("SalesInvoicesScreen — list", () => {
  it("renders the heading and seeded invoices with KPIs", async () => {
    const transport = stubTransport(baseHandlers(seededInvoices));
    renderWithProviders(<SalesInvoicesScreen />, { transport, initialSession: testAdminSession });
    expect(screen.getByRole("heading", { name: "فواتير المبيعات" })).toBeInTheDocument();
    expect(await screen.findByText("INV-000001")).toBeInTheDocument();
    expect(screen.getByText("INV-000002")).toBeInTheDocument();
    expect(screen.getByText("INV-000003")).toBeInTheDocument();
  });

  it("shows an empty state when there are no invoices yet", async () => {
    const transport = stubTransport(baseHandlers([]));
    renderWithProviders(<SalesInvoicesScreen />, { transport, initialSession: testAdminSession });
    expect(await screen.findByText("لا توجد فواتير مطابقة")).toBeInTheDocument();
  });

  it("filters to مدفوع via the status chips", async () => {
    const transport = stubTransport(baseHandlers(seededInvoices));
    renderWithProviders(<SalesInvoicesScreen />, { transport, initialSession: testAdminSession });
    await screen.findByText("INV-000001");
    // "مدفوع" is a prefix of "مدفوع جزئياً" too, so anchor on the trailing count.
    fireEvent.click(screen.getByRole("tab", { name: /^مدفوع\s?\d/ }));
    expect(screen.getByText("INV-000002")).toBeInTheDocument();
    expect(screen.queryByText("INV-000001")).not.toBeInTheDocument();
  });

  it("opens the detail view with the effects panel and tabs", async () => {
    const transport = stubTransport(baseHandlers(seededInvoices));
    renderWithProviders(<SalesInvoicesScreen />, { transport, initialSession: testAdminSession });
    fireEvent.click(await screen.findByText("INV-000001"));
    expect(screen.getByRole("heading", { name: "INV-000001" })).toBeInTheDocument();
    expect(screen.getByText("تأثيرات هذه الفاتورة")).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "بنود الفاتورة" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "القيود المحاسبية" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "المدفوعات" })).toBeInTheDocument();
  });
});

describe("SalesInvoicesScreen — create + confirm flow", () => {
  it("creates and confirms a new invoice through the real API", async () => {
    let current = [...seededInvoices];
    const transport = stubTransport({
      ...baseHandlers(current),
      "GET /sales-invoices": () => ({ body: current }),
      "POST /sales-invoices": (init) => {
        const body = JSON.parse((init?.body as string) ?? "{}");
        const created = invoice({ id: "inv-4", docNo: null, status: "draft", journalEntryId: null, confirmedAt: null, ...body, lines: body.lines ?? [] });
        current = [...current, created];
        return { status: 201, body: created };
      },
      "POST /sales-invoices/inv-4/confirm": () => {
        current = current.map((inv) => (inv.id === "inv-4" ? { ...inv, status: "confirmed" as const, docNo: "INV-000004", journalEntryId: "je-4", confirmedAt: "2026-08-23T10:00:00.000Z" } : inv));
        return { body: { ...current.find((inv) => inv.id === "inv-4")!, held: false } };
      },
    });
    renderWithProviders(<SalesInvoicesScreen />, { transport, initialSession: testAdminSession });
    await screen.findByText("INV-000001");
    const dialog = openNewInvoicePanel();

    pickFromCombobox(dialog, "العميل *", "شركة الأمل للتجارة");
    pickFromCombobox(dialog, "الصنف — سطر 1", "أرز أبيض مصري");

    const confirmButton = within(dialog).getByRole("button", { name: "تأكيد الفاتورة" });
    await waitFor(() => expect(confirmButton).toBeEnabled());
    fireEvent.click(confirmButton);

    await waitFor(() => expect(screen.queryByRole("dialog", { name: "فاتورة مبيعات جديدة" })).not.toBeInTheDocument());
    expect(await screen.findByText("INV-000004")).toBeInTheDocument();
  });

  it("shows a domain validation error instead of confirming an invoice without a customer", async () => {
    const transport = stubTransport(baseHandlers(seededInvoices));
    renderWithProviders(<SalesInvoicesScreen />, { transport, initialSession: testAdminSession });
    await screen.findByText("INV-000001");
    const dialog = openNewInvoicePanel();
    pickFromCombobox(dialog, "الصنف — سطر 1", "أرز أبيض مصري");

    // With no customer chosen the confirm button stays disabled — no invoice is created.
    expect(within(dialog).getByRole("button", { name: "تأكيد الفاتورة" })).toBeDisabled();
  });
});

describe("SalesInvoicesScreen — payments", () => {
  it("records a payment against a confirmed invoice and advances it to مدفوع جزئياً", async () => {
    let current = [...seededInvoices];
    const transport = stubTransport({
      ...baseHandlers(current),
      "GET /sales-invoices": () => ({ body: current }),
      "POST /sales-invoices/inv-1/payments": () => {
        current = current.map((inv) => (inv.id === "inv-1" ? { ...inv, status: "partially_paid" as const, amountPaid: "50.000000", remainingBalance: "160.900000" } : inv));
        return { body: current.find((inv) => inv.id === "inv-1")! };
      },
    });
    renderWithProviders(<SalesInvoicesScreen />, { transport, initialSession: testAdminSession });
    fireEvent.click(await screen.findByText("INV-000001"));
    fireEvent.click(screen.getByRole("tab", { name: "المدفوعات" }));

    typeMoney(screen.getByLabelText("قيمة الدفعة"), "50");
    fireEvent.click(screen.getByRole("button", { name: "تحصيل دفعة" }));

    await waitFor(() => expect(screen.getAllByText("مدفوع جزئياً").length).toBeGreaterThan(0));
  });

  it("fully pays off the partially-paid seeded invoice, advancing it to مدفوع", async () => {
    let current = [...seededInvoices];
    const transport = stubTransport({
      ...baseHandlers(current),
      "GET /sales-invoices": () => ({ body: current }),
      "POST /sales-invoices/inv-3/payments": () => {
        current = current.map((inv) => (inv.id === "inv-3" ? { ...inv, status: "paid" as const, amountPaid: "210.900000", remainingBalance: "0.000000" } : inv));
        return { body: current.find((inv) => inv.id === "inv-3")! };
      },
    });
    renderWithProviders(<SalesInvoicesScreen />, { transport, initialSession: testAdminSession });
    fireEvent.click(await screen.findByText("INV-000003"));
    fireEvent.click(screen.getByRole("tab", { name: "المدفوعات" }));

    // Pay the remaining balance shown in the المتبقي cell.
    const remainingCell = screen.getByText("المتبقي").closest("div")?.querySelector("dd");
    const remainingText = remainingCell?.textContent?.replace(/[^\d.]/g, "") ?? "0";

    typeMoney(screen.getByLabelText("قيمة الدفعة"), remainingText);
    fireEvent.click(screen.getByRole("button", { name: "تحصيل دفعة" }));

    await waitFor(() => expect(screen.getAllByText("مدفوع").length).toBeGreaterThan(0));
  });
});
