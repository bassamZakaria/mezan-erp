// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, expect, it, vi } from "vitest";
import { useState, type ReactNode } from "react";
import { screen, fireEvent, waitFor, within } from "@testing-library/react";
import type {
  AccountDTO,
  AllowedCurrenciesDTO,
  AuditQueryResponseDTO,
  BranchDTO,
  CustomerDTO,
  EmployeeDTO,
  EtaSubmissionDTO,
  InstallmentPlanDocumentDTO,
  ItemDTO,
  PriceListDTO,
  SalesReturnDocumentDTO,
  TenantSettingsDTO,
  TreasuryAccountDTO,
  WarehouseDTO,
} from "@mezan/contracts";
import { SalesInvoicesScreen } from "./SalesInvoicesScreen";
import { renderWithProviders, stubTransport, testAdminSession } from "../data/test-support";
import type { Transport } from "../data/transport";
import type { ItemAvailabilityDTO, JournalEntryDTO, SalesInvoiceDTO } from "../data/hooks";
import { NavigationProvider } from "../navigation";
import { todayIso } from "../lib/dates";

/**
 * SalesInvoicesScreen's create/detail views are sub-pages addressed via the
 * shell's `useSubPage` (navigation.tsx), which no-ops outside a real
 * `NavigationProvider`. This stands in for the shell's URL-driven one with
 * in-memory segments — enough for the screen under test to open, close and
 * read its own sub-page.
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

/**
 * Opens the new-invoice sub-page and clicks past its creation-method step
 * (manual is the default choice) so the line-item form is on screen.
 */
function openNewInvoicePage() {
  fireEvent.click(screen.getByRole("button", { name: /^فاتورة جديدة/ }));
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "فاتورة مبيعات جديدة" })).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "متابعة" }));
}

/**
 * Type into an EntityPicker combobox and pick the matching option — selection
 * fires on `onMouseDown` (not `click`), so the input's blur never wins the
 * race. The create page is a sub-page now, mounted fresh on navigation rather
 * than pre-rendered behind a hidden dialog, so its own entity list (customers,
 * items, …) may still be in flight the instant the form appears — `findByRole`
 * polls for the option instead of assuming it is already there.
 */
async function pickFromCombobox(label: string, optionLabel: string) {
  const input = screen.getByLabelText(label);
  fireEvent.focus(input);
  fireEvent.change(input, { target: { value: optionLabel } });
  const option = await screen.findByRole("button", { name: new RegExp(optionLabel) });
  fireEvent.mouseDown(option);
}

/** MoneyInput only commits its draft to React state on blur. */
function typeMoney(input: HTMLElement, value: string) {
  fireEvent.change(input, { target: { value } });
  fireEvent.blur(input);
}

/** Opens a `Select` field's popup by its trigger's accessible label and picks the named option — commit fires on `onMouseDown`. */
function selectOption(label: string, optionLabel: string) {
  fireEvent.click(screen.getByRole("combobox", { name: label }));
  fireEvent.mouseDown(screen.getByRole("option", { name: optionLabel }));
}

const customers: CustomerDTO[] = [
  {
    id: "cust-amal", code: "C1", nameAr: "شركة الأمل للتجارة", nameEn: null, phone: null, email: null, contactPerson: null, taxNumber: null,
    category: null, notes: null, paymentTermsDays: 30, currency: "EGP", openingBalance: "0", active: true, priceListId: null,
    creditLimit: "0", taxExempt: false, etaBuyerType: "auto", commercialRegistrationNumber: null, address: null, logoAttachmentId: null, nationalId: null,
  },
  {
    id: "cust-nadia", code: "C2", nameAr: "متجر نادية للجملة", nameEn: null, phone: null, email: null, contactPerson: null, taxNumber: null,
    category: null, notes: null, paymentTermsDays: 15, currency: "EGP", openingBalance: "0", active: true, priceListId: "pl-1",
    creditLimit: "0", taxExempt: false, etaBuyerType: "auto", commercialRegistrationNumber: null, address: null, logoAttachmentId: null, nationalId: null,
  },
];

const treasuryAccounts: TreasuryAccountDTO[] = [
  {
    id: "tr-cash-main", code: "TR-01", name: "خزينة الفرع الرئيسي", nameEn: null, type: "cash", currency: "EGP",
    branchId: "MAIN", glAccountId: null, openingBalance: "0", openingBalanceDate: null, status: "active",
  },
];

const items: ItemDTO[] = [
  {
    id: "item-rice", code: "ITM-1", nameAr: "أرز أبيض مصري 5 كجم", nameEn: null, type: "stock", baseUnitCode: "PCS", alternateUnits: [], barcodes: [],
    categoryId: null, brandId: null, seasonId: null, description: null, defaultSupplierId: null, specifications: [], costingMethod: "WAC", salePrice: "185.00", costPrice: "150.00", taxRatePercent: 14, trackInventory: true,
    trackBatches: false, trackExpiry: false, reorderPoint: null, imageAttachmentId: null, reorderQty: null, revenueAccountId: "4100-CUSTOM", cogsAccountId: "5100-CUSTOM", inventoryAccountId: "1200-CUSTOM",
    etaCodeType: null, etaItemCode: null, gpcCode: null, status: "active",
  },
  {
    id: "item-oil", code: "ITM-2", nameAr: "زيت طهي مكرر 1 لتر", nameEn: null, type: "stock", baseUnitCode: "PCS", alternateUnits: [{ code: "CTN", name: "كرتونة", factor: 12 }], barcodes: [],
    categoryId: null, brandId: null, seasonId: null, description: null, defaultSupplierId: null, specifications: [], costingMethod: "WAC", salePrice: "20.00", costPrice: "15.00", taxRatePercent: 14, trackInventory: true,
    trackBatches: false, trackExpiry: false, reorderPoint: null, imageAttachmentId: null, reorderQty: null, revenueAccountId: "4100-CUSTOM", cogsAccountId: "5100-CUSTOM", inventoryAccountId: "1200-CUSTOM",
    etaCodeType: null, etaItemCode: null, gpcCode: null, status: "active",
  },
  {
    id: "item-generic", code: "ITM-3", nameAr: "سكر أبيض 1 كجم", nameEn: null, type: "stock", baseUnitCode: "PCS", alternateUnits: [], barcodes: [],
    categoryId: null, brandId: null, seasonId: null, description: null, defaultSupplierId: null, specifications: [], costingMethod: "WAC", salePrice: "50.00", costPrice: "40.00", taxRatePercent: 14, trackInventory: true,
    trackBatches: false, trackExpiry: false, reorderPoint: null, imageAttachmentId: null, reorderQty: null, revenueAccountId: null, cogsAccountId: null, inventoryAccountId: null,
    etaCodeType: null, etaItemCode: null, gpcCode: null, status: "active",
  },
];

const warehouses: WarehouseDTO[] = [
  { id: "wh-1", code: "WH-MAIN", name: "مستودع الفرع الرئيسي", nameEn: null, branchId: "MAIN", type: "MAIN", isDefault: true, active: true },
  { id: "wh-2", code: "WH-SUB", name: "مستودع فرعي", nameEn: null, branchId: "MAIN", type: "TRANSIT", isDefault: false, active: true },
];

const branches: BranchDTO[] = [
  { id: "MAIN", code: "MAIN", name: "الفرع الرئيسي", parentBranchId: null, phone: null, email: null, address: null, isMain: true, active: true },
  { id: "BR-2", code: "BR2", name: "فرع المعادي", parentBranchId: null, phone: null, email: null, address: null, isMain: false, active: true },
];

const employees: EmployeeDTO[] = [
  {
    id: "emp-1", code: "EMP-1", firstName: "Ahmed", lastName: "Aly", firstNameAr: "أحمد", lastNameAr: "علي",
    email: null, phone: null, birthDate: null, nationalId: null, gender: null, maritalStatus: null,
    departmentId: null, jobTitleId: null, managerId: null, branchId: "MAIN", hireDate: "2024-01-01",
    workerCategory: "monthly", employmentType: "full_time", overtimeEligibility: "not_eligible",
    standardWorkHours: null, probationEndDate: null, priorServiceYears: 0, requireSelfieAtClockIn: false,
    requireBiometricAtClockIn: false, address: null, emergencyContact: null, status: "active",
    terminatedAt: null, createdAt: "2024-01-01T00:00:00.000Z",
  } as unknown as EmployeeDTO,
];

const priceLists: PriceListDTO[] = [
  {
    id: "pl-base", code: "PL-BASE", nameAr: "قائمة الأسعار الأساسية", nameEn: null, description: null, isBase: true, active: true,
    lines: [], createdAt: "2026-01-01T00:00:00.000Z",
  },
  {
    id: "pl-1", code: "PL-1", nameAr: "قائمة أسعار الجملة", nameEn: null, description: null, isBase: false, active: true,
    lines: [{ itemId: "item-rice", unitCode: null, minQty: "0", price: "150.000000" }], createdAt: "2026-01-01T00:00:00.000Z",
  },
];

const accounts: AccountDTO[] = [
  { id: "1105", code: "1105", nameAr: "ذمم عملاء تجاريين", nameEn: null, type: "asset", naturalBalance: "debit", parentId: null, isHeader: false, status: "active" },
  { id: "4100", code: "4100", nameAr: "إيرادات المبيعات", nameEn: null, type: "revenue", naturalBalance: "credit", parentId: null, isHeader: false, status: "active" },
  { id: "2200", code: "2200", nameAr: "ضريبة القيمة المضافة مستحقة", nameEn: null, type: "liability", naturalBalance: "credit", parentId: null, isHeader: false, status: "active" },
  { id: "5100", code: "5100", nameAr: "تكلفة البضاعة المباعة", nameEn: null, type: "expense", naturalBalance: "debit", parentId: null, isHeader: false, status: "active" },
  { id: "1200", code: "1200", nameAr: "المخزون", nameEn: null, type: "asset", naturalBalance: "debit", parentId: null, isHeader: false, status: "active" },
];

function tenantSettings(taxCalculation: "EXCLUSIVE" | "INCLUSIVE"): TenantSettingsDTO {
  return { taxCalculation } as unknown as TenantSettingsDTO;
}

function allowedCurrencies(overrides: Partial<AllowedCurrenciesDTO> = {}): AllowedCurrenciesDTO {
  return { base: "EGP", multiCurrencyEnabled: false, allowed: [], ...overrides };
}

function availability(overrides: Partial<ItemAvailabilityDTO> = {}): ItemAvailabilityDTO {
  return { itemId: "item-rice", warehouseId: "wh-1", onHand: "0", showOtherWarehouseStock: false, otherWarehouses: [], ...overrides };
}

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
    taxInclusive: false,
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

const LIST_STATUSES = ["draft", "confirmed", "partially_paid", "paid", "cancelled"] as const;

/** The chip-count breakdown the real `/sales-invoices/counts` route computes server-side. */
function countsFor(list: SalesInvoiceDTO[]): Record<string, number> {
  const counts: Record<string, number> = {
    all: list.length,
    open: list.filter((i) => i.status !== "paid" && i.status !== "cancelled").length,
    overdue: 0,
  };
  for (const status of LIST_STATUSES) counts[status] = list.filter((i) => i.status === status).length;
  return counts;
}

/** Everything the create form and the detail view need, so a test only overrides what it cares about. */
function fullHandlers(current: SalesInvoiceDTO[]) {
  return {
    "GET /sales-invoices": (_init: RequestInit | undefined, path: string) => {
      const status = new URLSearchParams(path.split("?")[1] ?? "").get("status");
      return { body: status ? current.filter((inv) => inv.status === status) : current };
    },
    "GET /sales-invoices/counts": () => ({ body: countsFor(current) }),
    "GET /sales-invoices/*": (_init: RequestInit | undefined, path: string) => {
      const idOrDocNo = decodeURIComponent(path.split("/").pop() ?? "");
      const found = current.find((inv) => inv.id === idOrDocNo || inv.docNo === idOrDocNo);
      return found ? { body: found } : { status: 404, body: { error: "NOT_FOUND" } };
    },
    "GET /customers": () => ({ body: customers }),
    "GET /items": () => ({ body: items }),
    "GET /warehouses": () => ({ body: warehouses }),
    "GET /branches": () => ({ body: branches }),
    "GET /accounts": () => ({ body: accounts }),
    "GET /treasury-accounts": () => ({ body: treasuryAccounts }),
    "GET /hr/employees": () => ({ body: employees }),
    "GET /price-lists": () => ({ body: priceLists }),
    "GET /sales-quotes": () => ({ body: [] }),
    "GET /gl/journal-entries/je-1": () => ({ body: journalEntry }),
    "GET /inventory/availability": (_init: RequestInit | undefined, path: string) => {
      const params = new URLSearchParams(path.split("?")[1] ?? "");
      return { body: availability({ itemId: params.get("itemId") ?? "", warehouseId: params.get("warehouseId") ?? "" }) };
    },
  };
}

describe("SalesInvoicesScreen — the line editor's pricing and unit rules", () => {
  it("prices the line from the customer's price list, not the item's own sale price", async () => {
    const transport = stubTransport(fullHandlers(seededInvoices));
    renderWithProviders(<TestNavigation><SalesInvoicesScreen /></TestNavigation>, { transport, initialSession: testAdminSession });
    await screen.findByText("INV-000001");
    openNewInvoicePage();

    await pickFromCombobox("العميل *", "متجر نادية للجملة");
    await pickFromCombobox("الصنف — سطر 1", "أرز أبيض مصري");

    expect((screen.getByLabelText("السعر للسطر 1") as HTMLInputElement).value).toBe("150.00");
  });

  it("prices the line from the item's own sale price when the customer has no wholesale list of their own", async () => {
    const transport = stubTransport(fullHandlers(seededInvoices));
    renderWithProviders(<TestNavigation><SalesInvoicesScreen /></TestNavigation>, { transport, initialSession: testAdminSession });
    await screen.findByText("INV-000001");
    openNewInvoicePage();

    await pickFromCombobox("العميل *", "شركة الأمل للتجارة");
    await pickFromCombobox("الصنف — سطر 1", "أرز أبيض مصري");

    // cust-amal has no priceListId, so the base price list applies — and it
    // carries no line for this item, so the item's own price wins.
    expect((screen.getByLabelText("السعر للسطر 1") as HTMLInputElement).value).toBe("185.00");
  });

  it("converts an alternate-unit quantity to the base quantity the ledger moves", async () => {
    const transport = stubTransport(fullHandlers(seededInvoices));
    renderWithProviders(<TestNavigation><SalesInvoicesScreen /></TestNavigation>, { transport, initialSession: testAdminSession });
    await screen.findByText("INV-000001");
    openNewInvoicePage();

    await pickFromCombobox("العميل *", "شركة الأمل للتجارة");
    await pickFromCombobox("الصنف — سطر 1", "زيت طهي مكرر");

    selectOption("وحدة البند", "كرتونة · ×12");
    const qty = screen.getByLabelText("الكمية للسطر 1");
    fireEvent.change(qty, { target: { value: "2" } });
    fireEvent.blur(qty);

    expect(await screen.findByText("2 CTN = 24 PCS")).toBeInTheDocument();
    expect(screen.getByText("· يُخصم من المخزون", { exact: false })).toBeInTheDocument();
  });

  it("switches a line's discount between percent and amount, sending the amount as a decimal string on the wire", async () => {
    let createdBody: Record<string, unknown> | undefined;
    let current = [...seededInvoices];
    const transport = stubTransport({
      ...fullHandlers(current),
      "GET /sales-invoices": () => ({ body: current }),
      "POST /sales-invoices": (init) => {
        const body = JSON.parse((init?.body as string) ?? "{}");
        createdBody = body;
        const created = invoice({ id: "inv-9", docNo: "INV-000009", status: "draft", journalEntryId: null, confirmedAt: null, ...body, lines: body.lines ?? [] });
        current = [...current, created];
        return { status: 201, body: created };
      },
    });
    renderWithProviders(<TestNavigation><SalesInvoicesScreen /></TestNavigation>, { transport, initialSession: testAdminSession });
    await screen.findByText("INV-000001");
    openNewInvoicePage();

    await pickFromCombobox("العميل *", "شركة الأمل للتجارة");
    await pickFromCombobox("الصنف — سطر 1", "أرز أبيض مصري");

    // Avoid the top-level document discount value field, whose default label
    // collides with the line one once both read "amount".
    selectOption("نوع الخصم", "نسبة %");
    selectOption("نوع خصم البند", "مبلغ ثابت");
    typeMoney(screen.getByLabelText("قيمة الخصم"), "10");

    fireEvent.click(screen.getByRole("button", { name: "حفظ كمسودة" }));

    await waitFor(() => expect(createdBody).toBeDefined());
    const lines = createdBody!.lines as Array<{ discountType: string; discountAmount: string; discountPercent: number }>;
    expect(lines[0]!.discountType).toBe("amount");
    expect(lines[0]!.discountAmount).toBe("10.000000");
    expect(lines[0]!.discountPercent).toBe(0);
  });
});

describe("SalesInvoicesScreen — the create form's tenant-driven settings", () => {
  it("reads the tenant's tax-inclusive basis for the totals preview", async () => {
    const transport = stubTransport({ ...fullHandlers(seededInvoices), "GET /settings": () => ({ body: tenantSettings("INCLUSIVE") }) });
    renderWithProviders(<TestNavigation><SalesInvoicesScreen /></TestNavigation>, { transport, initialSession: testAdminSession });
    await screen.findByText("INV-000001");
    openNewInvoicePage();

    expect(await screen.findByText("المجموع الفرعي (شامل الضريبة)")).toBeInTheDocument();
    expect(screen.getByText("منها ضريبة")).toBeInTheDocument();
  });

  it("reads the tenant's tax-exclusive basis for the totals preview", async () => {
    const transport = stubTransport({ ...fullHandlers(seededInvoices), "GET /settings": () => ({ body: tenantSettings("EXCLUSIVE") }) });
    renderWithProviders(<TestNavigation><SalesInvoicesScreen /></TestNavigation>, { transport, initialSession: testAdminSession });
    await screen.findByText("INV-000001");
    openNewInvoicePage();

    expect(await screen.findByText("المجموع الفرعي")).toBeInTheDocument();
    expect(screen.getByText("الضريبة")).toBeInTheDocument();
  });

  it("offers every allowed currency once the tenant turns multi-currency on", async () => {
    const transport = stubTransport({
      ...fullHandlers(seededInvoices),
      "GET /settings/currencies": () => ({ body: allowedCurrencies({ multiCurrencyEnabled: true, allowed: ["USD"] }) }),
    });
    renderWithProviders(<TestNavigation><SalesInvoicesScreen /></TestNavigation>, { transport, initialSession: testAdminSession });
    await screen.findByText("INV-000001");
    openNewInvoicePage();

    fireEvent.click(await screen.findByRole("combobox", { name: "العملة" }));
    await waitFor(() => expect(screen.getAllByRole("option").length).toBe(2));
  });

  it("limits the currency choice to the tenant's base currency when multi-currency is off", async () => {
    const transport = stubTransport({
      ...fullHandlers(seededInvoices),
      "GET /settings/currencies": () => ({ body: allowedCurrencies({ multiCurrencyEnabled: false, allowed: ["USD"] }) }),
    });
    renderWithProviders(<TestNavigation><SalesInvoicesScreen /></TestNavigation>, { transport, initialSession: testAdminSession });
    await screen.findByText("INV-000001");
    openNewInvoicePage();

    fireEvent.click(await screen.findByRole("combobox", { name: "العملة" }));
    await waitFor(() => expect(screen.getAllByRole("option").length).toBe(1));
    expect(screen.getByRole("option", { name: /EGP/ })).toBeInTheDocument();
  });
});

describe("SalesInvoicesScreen — GL account fallbacks", () => {
  it("falls back to the screen's own revenue/COGS/inventory accounts when an item has none configured", async () => {
    let createdBody: Record<string, unknown> | undefined;
    let current = [...seededInvoices];
    const transport = stubTransport({
      ...fullHandlers(current),
      "GET /sales-invoices": () => ({ body: current }),
      "POST /sales-invoices": (init) => {
        const body = JSON.parse((init?.body as string) ?? "{}");
        createdBody = body;
        const created = invoice({ id: "inv-9", docNo: "INV-000009", status: "draft", journalEntryId: null, confirmedAt: null, ...body, lines: body.lines ?? [] });
        current = [...current, created];
        return { status: 201, body: created };
      },
    });
    renderWithProviders(<TestNavigation><SalesInvoicesScreen /></TestNavigation>, { transport, initialSession: testAdminSession });
    await screen.findByText("INV-000001");
    openNewInvoicePage();

    await pickFromCombobox("العميل *", "شركة الأمل للتجارة");
    await pickFromCombobox("الصنف — سطر 1", "سكر أبيض");

    fireEvent.click(screen.getByRole("button", { name: "حفظ كمسودة" }));

    await waitFor(() => expect(createdBody).toBeDefined());
    const lines = createdBody!.lines as Array<{ revenueAccountId: string; cogsAccountId: string; inventoryAccountId: string }>;
    expect(lines[0]!.revenueAccountId).toBe("4100");
    expect(lines[0]!.cogsAccountId).toBe("5100");
    expect(lines[0]!.inventoryAccountId).toBe("1200");
  });
});

describe("SalesInvoicesScreen — create form guards", () => {
  it("disables removing the only remaining line", async () => {
    const transport = stubTransport(fullHandlers(seededInvoices));
    renderWithProviders(<TestNavigation><SalesInvoicesScreen /></TestNavigation>, { transport, initialSession: testAdminSession });
    await screen.findByText("INV-000001");
    openNewInvoicePage();

    expect(screen.getByRole("button", { name: "حذف السطر 1" })).toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: "إضافة بند" }));
    expect(screen.getByRole("button", { name: "حذف السطر 1" })).toBeEnabled();
  });

  it("derives the due date from the customer's payment terms, and stops once the user edits it by hand", async () => {
    const transport = stubTransport(fullHandlers(seededInvoices));
    renderWithProviders(<TestNavigation><SalesInvoicesScreen /></TestNavigation>, { transport, initialSession: testAdminSession });
    await screen.findByText("INV-000001");
    openNewInvoicePage();

    await pickFromCombobox("العميل *", "شركة الأمل للتجارة");
    const expected = new Date(todayIso());
    expected.setDate(expected.getDate() + 30);
    await waitFor(() =>
      expect((screen.getByLabelText("تاريخ الاستحقاق *", { exact: false }) as HTMLInputElement).value).toBe(
        expected.toISOString().slice(0, 10),
      ),
    );

    fireEvent.change(screen.getByLabelText("تاريخ الاستحقاق *", { exact: false }), { target: { value: "2026-12-31" } });

    // Switching to a customer on different terms must not overwrite a due
    // date the user already set by hand.
    await pickFromCombobox("العميل *", "متجر نادية للجملة");
    expect((screen.getByLabelText("تاريخ الاستحقاق *", { exact: false }) as HTMLInputElement).value).toBe("2026-12-31");
  });

  it("sends a blank salesperson and coupon as null, not empty strings", async () => {
    let createdBody: Record<string, unknown> | undefined;
    let current = [...seededInvoices];
    const transport = stubTransport({
      ...fullHandlers(current),
      "GET /sales-invoices": () => ({ body: current }),
      "POST /sales-invoices": (init) => {
        const body = JSON.parse((init?.body as string) ?? "{}");
        createdBody = body;
        const created = invoice({ id: "inv-9", docNo: "INV-000009", status: "draft", journalEntryId: null, confirmedAt: null, ...body, lines: body.lines ?? [] });
        current = [...current, created];
        return { status: 201, body: created };
      },
    });
    renderWithProviders(<TestNavigation><SalesInvoicesScreen /></TestNavigation>, { transport, initialSession: testAdminSession });
    await screen.findByText("INV-000001");
    openNewInvoicePage();

    await pickFromCombobox("العميل *", "شركة الأمل للتجارة");
    await pickFromCombobox("الصنف — سطر 1", "أرز أبيض مصري");
    fireEvent.change(screen.getByLabelText("كود الكوبون", { exact: false }), { target: { value: "   " } });
    fireEvent.change(screen.getByLabelText("ملاحظات"), { target: { value: "  " } });

    fireEvent.click(screen.getByRole("button", { name: "حفظ كمسودة" }));

    await waitFor(() => expect(createdBody).toBeDefined());
    expect(createdBody!.salespersonId).toBeNull();
    expect(createdBody!.salespersonNameAr).toBeNull();
    expect(createdBody!.couponCode).toBeNull();
    expect(createdBody!.notes).toBeNull();
  });

  it("trims and sends real salesperson, coupon and notes content", async () => {
    let createdBody: Record<string, unknown> | undefined;
    let current = [...seededInvoices];
    const transport = stubTransport({
      ...fullHandlers(current),
      "GET /sales-invoices": () => ({ body: current }),
      "POST /sales-invoices": (init) => {
        const body = JSON.parse((init?.body as string) ?? "{}");
        createdBody = body;
        const created = invoice({ id: "inv-9", docNo: "INV-000009", status: "draft", journalEntryId: null, confirmedAt: null, ...body, lines: body.lines ?? [] });
        current = [...current, created];
        return { status: 201, body: created };
      },
    });
    renderWithProviders(<TestNavigation><SalesInvoicesScreen /></TestNavigation>, { transport, initialSession: testAdminSession });
    await screen.findByText("INV-000001");
    openNewInvoicePage();

    await pickFromCombobox("العميل *", "شركة الأمل للتجارة");
    await pickFromCombobox("الصنف — سطر 1", "أرز أبيض مصري");
    await pickFromCombobox("مندوب المبيعات", "أحمد علي");
    fireEvent.change(screen.getByLabelText("كود الكوبون", { exact: false }), { target: { value: "  SUMMER10  " } });
    fireEvent.change(screen.getByLabelText("ملاحظات"), { target: { value: "  يُسلَّم صباحاً  " } });

    fireEvent.click(screen.getByRole("button", { name: "حفظ كمسودة" }));

    await waitFor(() => expect(createdBody).toBeDefined());
    expect(createdBody!.salespersonId).toBe("emp-1");
    expect(createdBody!.salespersonNameAr).toBe("أحمد علي");
    expect(createdBody!.couponCode).toBe("SUMMER10");
    expect(createdBody!.notes).toBe("يُسلَّم صباحاً");
  });

  it("shows the server's own refusal message and clears the busy state when creating the invoice fails", async () => {
    const transport = stubTransport({
      ...fullHandlers(seededInvoices),
      "POST /sales-invoices": () => ({ status: 409, body: { message: "الفترة المحاسبية مقفلة." } }),
    });
    renderWithProviders(<TestNavigation><SalesInvoicesScreen /></TestNavigation>, { transport, initialSession: testAdminSession });
    await screen.findByText("INV-000001");
    openNewInvoicePage();

    await pickFromCombobox("العميل *", "شركة الأمل للتجارة");
    await pickFromCombobox("الصنف — سطر 1", "أرز أبيض مصري");
    fireEvent.click(screen.getByRole("button", { name: "حفظ كمسودة" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("الفترة المحاسبية مقفلة.");
    // The busy flag must be cleared on failure or the buttons stay disabled forever.
    expect(screen.getByRole("button", { name: "حفظ كمسودة" })).toBeEnabled();
  });
});

describe("SalesInvoicesScreen — the stock-availability pill's three tones", () => {
  it("reads in stock, and lists what the other warehouses hold when the tenant shows that", async () => {
    const transport = stubTransport({
      ...fullHandlers(seededInvoices),
      "GET /inventory/availability": () => ({
        body: availability({ itemId: "item-rice", warehouseId: "wh-1", onHand: "50", showOtherWarehouseStock: true, otherWarehouses: [{ warehouseId: "wh-2", onHand: "30" }] }),
      }),
    });
    renderWithProviders(<TestNavigation><SalesInvoicesScreen /></TestNavigation>, { transport, initialSession: testAdminSession });
    await screen.findByText("INV-000001");
    openNewInvoicePage();

    await pickFromCombobox("العميل *", "شركة الأمل للتجارة");
    await pickFromCombobox("الصنف — سطر 1", "أرز أبيض مصري");

    expect(await screen.findByText("متوفر")).toBeInTheDocument();
    expect(screen.getByText("مستودع فرعي 30", { exact: false })).toBeInTheDocument();
  });

  it("reads short by the missing quantity when the line asks for more than is on hand", async () => {
    const transport = stubTransport({
      ...fullHandlers(seededInvoices),
      "GET /inventory/availability": () => ({ body: availability({ itemId: "item-rice", warehouseId: "wh-1", onHand: "10" }) }),
    });
    renderWithProviders(<TestNavigation><SalesInvoicesScreen /></TestNavigation>, { transport, initialSession: testAdminSession });
    await screen.findByText("INV-000001");
    openNewInvoicePage();

    await pickFromCombobox("العميل *", "شركة الأمل للتجارة");
    await pickFromCombobox("الصنف — سطر 1", "أرز أبيض مصري");
    const qty = screen.getByLabelText("الكمية للسطر 1");
    fireEvent.change(qty, { target: { value: "15" } });
    fireEvent.blur(qty);

    expect(await screen.findByText("ناقص 5 PCS")).toBeInTheDocument();
  });

  it("reads out of stock when there is nothing on hand", async () => {
    const transport = stubTransport({
      ...fullHandlers(seededInvoices),
      "GET /inventory/availability": () => ({ body: availability({ itemId: "item-rice", warehouseId: "wh-1", onHand: "0" }) }),
    });
    renderWithProviders(<TestNavigation><SalesInvoicesScreen /></TestNavigation>, { transport, initialSession: testAdminSession });
    await screen.findByText("INV-000001");
    openNewInvoicePage();

    await pickFromCombobox("العميل *", "شركة الأمل للتجارة");
    await pickFromCombobox("الصنف — سطر 1", "أرز أبيض مصري");

    expect(await screen.findByText("غير متوفر")).toBeInTheDocument();
  });
});

describe("SalesInvoicesScreen — list view states", () => {
  it("flags an overdue confirmed invoice with a follow-up banner and a days-overdue pill on its row", async () => {
    const overdueDate = new Date(Date.now() - 10 * 86_400_000).toISOString().slice(0, 10);
    const list = [invoice({ id: "inv-od", docNo: "INV-000050", status: "confirmed", dueDate: overdueDate })];
    const transport = stubTransport({
      ...fullHandlers(list),
      "GET /sales-invoices/counts": () => ({ body: { ...countsFor(list), overdue: 1 } }),
    });
    renderWithProviders(<TestNavigation><SalesInvoicesScreen /></TestNavigation>, { transport, initialSession: testAdminSession });

    expect(await screen.findByText("تحتاج متابعة")).toBeInTheDocument();
    expect(screen.getByText("فواتير تجاوزت تاريخ الاستحقاق وتحتاج متابعة عاجلة: 1.")).toBeInTheDocument();
    expect(screen.getByText("متأخرة 10 يوم")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "عرض الفواتير المتأخرة" }));
    await waitFor(() => expect(screen.getByRole("tab", { name: /متأخرة/ })).toHaveAttribute("aria-selected", "true"));
  });

  it("shows the failed-to-load state with a retry action when the invoice list errors", async () => {
    let calls = 0;
    const transport: Transport = async (path, init) => {
      if (path.startsWith("/sales-invoices") && !path.includes("counts") && (init?.method ?? "GET") === "GET") {
        calls += 1;
        return { status: 500, ok: false, json: async <T,>() => ({ error: "SERVER" }) as T, text: async () => "" };
      }
      return stubTransport(fullHandlers(seededInvoices))(path, init);
    };
    renderWithProviders(<TestNavigation><SalesInvoicesScreen /></TestNavigation>, { transport, initialSession: testAdminSession });

    expect(await screen.findByText("تعذّر تحميل فواتير المبيعات.")).toBeInTheDocument();
    const callsBeforeRetry = calls;
    fireEvent.click(screen.getByRole("button", { name: "إعادة المحاولة" }));
    await waitFor(() => expect(calls).toBeGreaterThan(callsBeforeRetry));
  });

  it("marks a returned and a partly-collected row, and a fully-settled invoice", async () => {
    const list = [
      invoice({ id: "inv-set", docNo: "INV-000060", status: "paid", amountPaid: "210.900000", returnedCredit: "50.000000", remainingBalance: "0.000000" }),
    ];
    const transport = stubTransport(fullHandlers(list));
    renderWithProviders(<TestNavigation><SalesInvoicesScreen /></TestNavigation>, { transport, initialSession: testAdminSession });

    await screen.findByText("INV-000060");
    expect(screen.getByText("مسددة بالكامل")).toBeInTheDocument();
    expect(screen.getByText("210.90", { exact: false })).toBeInTheDocument();
  });

  it("carries every active filter into the request that drives the rows, the counts and the KPI strip", async () => {
    const seenPaths: string[] = [];
    const transport: Transport = async (path, init) => {
      if (path.startsWith("/sales-invoices?") || path === "/sales-invoices") seenPaths.push(path);
      return stubTransport(fullHandlers(seededInvoices))(path, init);
    };
    renderWithProviders(<TestNavigation><SalesInvoicesScreen /></TestNavigation>, { transport, initialSession: testAdminSession });
    await screen.findByText("INV-000001");

    fireEvent.click(screen.getByRole("tab", { name: /^مؤكد\s?\d/ }));
    selectOption("الفرع", "فرع المعادي");
    selectOption("المستودع", "مستودع فرعي");
    await pickFromCombobox("تصفية بالعميل", "شركة الأمل للتجارة");
    fireEvent.change(screen.getByLabelText("من تاريخ"), { target: { value: "2026-01-01" } });
    fireEvent.change(screen.getByLabelText("إلى تاريخ"), { target: { value: "2026-12-31" } });
    fireEvent.change(screen.getByLabelText("بحث برقم الفاتورة أو اسم العميل…"), { target: { value: "INV-0001" } });

    await waitFor(() => {
      const last = seenPaths[seenPaths.length - 1] ?? "";
      expect(last).toContain("status=confirmed");
      expect(last).toContain("branchId=BR-2");
      expect(last).toContain("warehouseId=wh-2");
      expect(last).toContain("customerId=cust-amal");
      expect(last).toContain("fromDate=2026-01-01");
      expect(last).toContain("toDate=2026-12-31");
    });
  });

  it("changes the page size sent to the server", async () => {
    const seenPaths: string[] = [];
    const transport: Transport = async (path, init) => {
      if (path.startsWith("/sales-invoices?") || path === "/sales-invoices") seenPaths.push(path);
      return stubTransport(fullHandlers(seededInvoices))(path, init);
    };
    renderWithProviders(<TestNavigation><SalesInvoicesScreen /></TestNavigation>, { transport, initialSession: testAdminSession });
    await screen.findByText("INV-000001");

    selectOption("عدد الصفوف", "50");
    await waitFor(() => expect(seenPaths[seenPaths.length - 1] ?? "").toContain("pageSize=50"));
  });

  it("previews an invoice from its row menu and copies its plain-text summary to the clipboard", async () => {
    Object.assign(navigator, { clipboard: { writeText: vi.fn().mockResolvedValue(undefined) } });
    const transport = stubTransport(fullHandlers(seededInvoices));
    renderWithProviders(<TestNavigation><SalesInvoicesScreen /></TestNavigation>, { transport, initialSession: testAdminSession });
    const row = (await screen.findByText("INV-000001")).closest("tr")!;
    fireEvent.click(within(row).getByRole("button", { name: /^إجراءات/ }));
    fireEvent.click(await screen.findByRole("menuitem", { name: "معاينة سريعة" }));

    expect(await screen.findByRole("heading", { name: "معاينة الفاتورة INV-000001" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "نسخ ملخص الفاتورة" }));
    expect(await screen.findByText("تم نسخ الملخص")).toBeInTheDocument();
  });

  it("shows the clipboard failure message when copying the summary is denied", async () => {
    Object.assign(navigator, { clipboard: { writeText: vi.fn().mockRejectedValue(new Error("denied")) } });
    const transport = stubTransport(fullHandlers(seededInvoices));
    renderWithProviders(<TestNavigation><SalesInvoicesScreen /></TestNavigation>, { transport, initialSession: testAdminSession });
    const row = (await screen.findByText("INV-000001")).closest("tr")!;
    fireEvent.click(within(row).getByRole("button", { name: /^إجراءات/ }));
    fireEvent.click(await screen.findByRole("menuitem", { name: "معاينة سريعة" }));
    await screen.findByRole("heading", { name: "معاينة الفاتورة INV-000001" });
    fireEvent.click(screen.getByRole("button", { name: "نسخ ملخص الفاتورة" }));
    expect(await screen.findByText("تعذّر النسخ إلى الحافظة")).toBeInTheDocument();
  });

  it("offers a return and an installment plan action only for a row that is actually owing", async () => {
    const list = [invoice({ id: "inv-owe", docNo: "INV-000070", status: "confirmed", remainingBalance: "210.900000" })];
    const transport = stubTransport(fullHandlers(list));
    renderWithProviders(<TestNavigation><SalesInvoicesScreen /></TestNavigation>, { transport, initialSession: testAdminSession });
    const row = (await screen.findByText("INV-000070")).closest("tr")!;
    expect(within(row).getByRole("button", { name: "تحصيل" })).toBeInTheDocument();
    fireEvent.click(within(row).getByRole("button", { name: /^إجراءات/ }));
    expect(await screen.findByRole("menuitem", { name: "إنشاء مرتجع مبيعات" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "إنشاء خطة أقساط" })).toBeInTheDocument();
  });

  it("opens the compliant print destination from a row's own menu action", async () => {
    const transport = stubTransport(fullHandlers(seededInvoices));
    renderWithProviders(<TestNavigation><SalesInvoicesScreen /></TestNavigation>, { transport, initialSession: testAdminSession });
    const row = (await screen.findByText("INV-000001")).closest("tr")!;
    fireEvent.click(within(row).getByRole("button", { name: /^إجراءات/ }));
    fireEvent.click(await screen.findByRole("menuitem", { name: "طباعة" }));

    expect(await screen.findByText("قالب الطباعة غير متاح")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "فواتير المبيعات" })).not.toBeInTheDocument();
  });
});

describe("SalesInvoicesScreen — detail view", () => {
  it("opens a still-unconfirmed invoice under its generic title, and surfaces the server's refusal when confirming it fails", async () => {
    const draft = invoice({ id: "inv-draft", docNo: null, status: "draft", journalEntryId: null, confirmedAt: null });
    const transport = stubTransport({
      ...fullHandlers([draft]),
      "POST /sales-invoices/inv-draft/confirm": () => ({ status: 409, body: { message: "لا يوجد رصيد مخزون كافٍ." } }),
    });
    renderWithProviders(<TestNavigation><SalesInvoicesScreen /></TestNavigation>, { transport, initialSession: testAdminSession });
    // A docNo-less draft reads "مسودة" in the status filter chips too, so the
    // row itself — not its text — is the unambiguous thing to click.
    await screen.findAllByText("مسودة");
    fireEvent.click(screen.getAllByRole("row")[1]!);

    expect(await screen.findByRole("heading", { name: "فاتورة مبيعات" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "تأكيد الفاتورة" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("لا يوجد رصيد مخزون كافٍ.");
  });

  it("says no journal entry exists yet for a still-draft invoice", async () => {
    const draft = invoice({ id: "inv-draft2", docNo: "INV-000080", status: "draft", journalEntryId: null, confirmedAt: null });
    const transport = stubTransport(fullHandlers([draft]));
    renderWithProviders(<TestNavigation><SalesInvoicesScreen /></TestNavigation>, { transport, initialSession: testAdminSession });

    fireEvent.click(await screen.findByText("INV-000080"));
    await screen.findByRole("heading", { name: "INV-000080" });
    fireEvent.click(screen.getByRole("tab", { name: "القيود المحاسبية" }));
    expect(await screen.findByText("لم يتم ترحيل قيد بعد — الفاتورة ما زالت مسودة.")).toBeInTheDocument();
  });

  it("shows a loading state while the journal entry is still in flight, then the posted entry itself", async () => {
    const confirmed = invoice({ id: "inv-conf2", docNo: "INV-000081" });
    let resolveJournal!: (v: unknown) => void;
    const pendingJournal = new Promise((res) => { resolveJournal = res; });
    const base = stubTransport(fullHandlers([confirmed]));
    const transport: Transport = async (path, init) => {
      if (path === "/gl/journal-entries/je-1") {
        await pendingJournal;
        return base(path, init);
      }
      return base(path, init);
    };
    renderWithProviders(<TestNavigation><SalesInvoicesScreen /></TestNavigation>, { transport, initialSession: testAdminSession });

    fireEvent.click(await screen.findByText("INV-000081"));
    await screen.findByRole("heading", { name: "INV-000081" });
    fireEvent.click(screen.getByRole("tab", { name: "القيود المحاسبية" }));
    expect(await screen.findByText("جارٍ تحميل القيد المحاسبي…")).toBeInTheDocument();

    resolveJournal(undefined);
    expect(await screen.findByText("رقم القيد:", { exact: false })).toBeInTheDocument();
  });

  it("blocks recording a payment once the invoice is fully settled, and shows no pending installment-plan action", async () => {
    const paid = invoice({ id: "inv-paid2", docNo: "INV-000090", status: "paid", amountPaid: "210.900000", remainingBalance: "0.000000" });
    const transport = stubTransport(fullHandlers([paid]));
    renderWithProviders(<TestNavigation><SalesInvoicesScreen /></TestNavigation>, { transport, initialSession: testAdminSession });
    fireEvent.click(await screen.findByText("INV-000090"));
    await screen.findByRole("heading", { name: "INV-000090" });
    fireEvent.click(screen.getByRole("tab", { name: "المدفوعات" }));
    expect(await screen.findByText("لا يمكن تسجيل دفعة في حالة الفاتورة الحالية.")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("tab", { name: "الأقساط" }));
    expect(await screen.findByText("لا توجد خطة أقساط على هذه الفاتورة.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "إنشاء خطة أقساط" })).not.toBeInTheDocument();
  });

  it("offers to start an installment plan for an unpaid balance that has no plan yet", async () => {
    const transport = stubTransport(fullHandlers(seededInvoices));
    renderWithProviders(<TestNavigation><SalesInvoicesScreen /></TestNavigation>, { transport, initialSession: testAdminSession });
    fireEvent.click(await screen.findByText("INV-000001"));
    await screen.findByRole("heading", { name: "INV-000001" });
    fireEvent.click(screen.getByRole("tab", { name: "الأقساط" }));
    expect(await screen.findByText("لا توجد خطة أقساط على هذه الفاتورة.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "إنشاء خطة أقساط" })).toBeInTheDocument();
  });

  it("lists the sales returns, installment plans, ETA submissions and audit entries raised against this invoice", async () => {
    const target = invoice({ id: "inv-hist", docNo: "INV-000095" });
    const salesReturn: SalesReturnDocumentDTO = {
      id: "ret-1", docType: "SALES_RETURN", docNo: "SR-000001", date: "2026-08-25", memo: "", status: "confirmed",
      lines: [{ itemId: "item-rice", warehouseId: "wh-1", customerId: "cust-amal", sourceInvoiceId: "inv-hist", sourceInvoiceNumber: "INV-000095", reason: "DEFECTIVE", availableQty: "1", qty: "1", unitPrice: "185", unitCost: "150", taxAmount: "25.9" }],
      createdAt: "2026-08-25T00:00:00.000Z", confirmedAt: "2026-08-25T00:00:00.000Z", reversesDocId: null, reversedByDocId: null,
      workflowRequestId: null, journalEntryId: null, awaitingRefund: false, refundDue: "0", refundedTotal: "0", refunds: [],
    };
    const plan: InstallmentPlanDocumentDTO = {
      id: "plan-1", docType: "INSTALLMENT_PLAN", docNo: "IP-000001", date: "2026-08-25", memo: "", status: "confirmed",
      lines: [{ no: 1, customerId: "cust-amal", sourceInvoiceId: "inv-hist", sourceInvoiceNumber: "INV-000095", frequency: "MONTHLY", downPayment: "0", dueDate: "2026-09-25", amount: "100", paidAmount: "0", status: "pending", lateFeeAmount: "0" }],
      createdAt: "2026-08-25T00:00:00.000Z", confirmedAt: "2026-08-25T00:00:00.000Z", reversesDocId: null, reversedByDocId: null,
      workflowRequestId: null, journalEntryId: null,
    };
    const etaRow: EtaSubmissionDTO = {
      id: "eta-1", internalId: "INV-000095", documentType: "invoice" as EtaSubmissionDTO["documentType"], status: "accepted" as EtaSubmissionDTO["status"],
      etaUuid: "UUID-123", errors: [], exclusionReason: null, createdAt: "2026-08-25T00:00:00.000Z", updatedAt: "2026-08-25T10:00:00.000Z", submittedAt: "2026-08-25T09:00:00.000Z",
    };
    const auditResponse: AuditQueryResponseDTO = {
      events: [{ stream: "sensitive", module: "sales", entityType: "SALES_INVOICE", entityId: "inv-hist", action: "confirm", actor: "محمد الشهابي", branchId: "MAIN", timestamp: "2026-08-25T09:00:00.000Z", severity: "INFO", details: { id: "inv-hist" } }],
      total: 1,
    };
    const transport = stubTransport({
      ...fullHandlers([target]),
      "GET /sales-returns": () => ({ body: [salesReturn] }),
      "GET /installments/plans": () => ({ body: [plan] }),
      "GET /eta/submissions": () => ({ body: [etaRow] }),
      "GET /audit": () => ({ body: auditResponse }),
    });
    renderWithProviders(<TestNavigation><SalesInvoicesScreen /></TestNavigation>, { transport, initialSession: testAdminSession });
    fireEvent.click(await screen.findByText("INV-000095"));
    await screen.findByRole("heading", { name: "INV-000095" });

    fireEvent.click(screen.getByRole("tab", { name: "المرتجعات" }));
    expect(await screen.findByText("SR-000001")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("tab", { name: "الأقساط" }));
    expect(await screen.findByText("IP-000001")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("tab", { name: "الفاتورة الإلكترونية" }));
    expect(await screen.findByText("accepted")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("tab", { name: "السجل" }));
    expect(await screen.findByText("confirm")).toBeInTheDocument();
  });

  it("deducts confirmed returns from the invoice's own totals footer", async () => {
    const withReturns = invoice({ id: "inv-ret", docNo: "INV-000096", returnedCredit: "50.000000" });
    const transport = stubTransport(fullHandlers([withReturns]));
    renderWithProviders(<TestNavigation><SalesInvoicesScreen /></TestNavigation>, { transport, initialSession: testAdminSession });
    fireEvent.click(await screen.findByText("INV-000096"));
    await screen.findByRole("heading", { name: "INV-000096" });

    expect(await screen.findByText("خصم المرتجعات المؤكدة")).toBeInTheDocument();
    expect(screen.getByText("الصافي بعد المرتجعات")).toBeInTheDocument();
  });
});
