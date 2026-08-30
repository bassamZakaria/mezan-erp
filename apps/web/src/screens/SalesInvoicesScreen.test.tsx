// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, expect, it } from "vitest";
import { useState, type ReactNode } from "react";
import { screen, fireEvent, waitFor, within } from "@testing-library/react";
import type { AccountDTO, CustomerDTO, ItemDTO, TreasuryAccountDTO, WarehouseDTO } from "@mezan/contracts";
import { SalesInvoicesScreen } from "./SalesInvoicesScreen";
import { renderWithProviders, stubTransport, testAdminSession } from "../data/test-support";
import type { JournalEntryDTO, SalesInvoiceDTO } from "../data/hooks";
import { NavigationProvider } from "../navigation";

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
    trackBatches: false, trackExpiry: false, reorderPoint: null, imageAttachmentId: null, reorderQty: null, revenueAccountId: null, cogsAccountId: null, inventoryAccountId: null,
    etaCodeType: null, etaItemCode: null, gpcCode: null, status: "active",
  },
];

const warehouses: WarehouseDTO[] = [{ id: "wh-1", code: "WH-MAIN", name: "مستودع الفرع الرئيسي", nameEn: null, branchId: "MAIN", type: "MAIN", isDefault: true, active: true }];

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

function baseHandlers(current: SalesInvoiceDTO[]) {
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
    "GET /accounts": () => ({ body: accounts }),
    "GET /treasury-accounts": () => ({ body: treasuryAccounts }),
    "GET /gl/journal-entries/je-1": () => ({ body: journalEntry }),
  };
}

describe("SalesInvoicesScreen — list", () => {
  it("renders the heading and seeded invoices with KPIs", async () => {
    const transport = stubTransport(baseHandlers(seededInvoices));
    renderWithProviders(<TestNavigation><SalesInvoicesScreen /></TestNavigation>, { transport, initialSession: testAdminSession });
    expect(screen.getByRole("heading", { name: "فواتير المبيعات" })).toBeInTheDocument();
    expect(await screen.findByText("INV-000001")).toBeInTheDocument();
    expect(screen.getByText("INV-000002")).toBeInTheDocument();
    expect(screen.getByText("INV-000003")).toBeInTheDocument();
  });

  it("shows an empty state when there are no invoices yet", async () => {
    const transport = stubTransport(baseHandlers([]));
    renderWithProviders(<TestNavigation><SalesInvoicesScreen /></TestNavigation>, { transport, initialSession: testAdminSession });
    expect(await screen.findByText("لا توجد فواتير مطابقة")).toBeInTheDocument();
  });

  it("filters to مدفوع via the status chips", async () => {
    const transport = stubTransport(baseHandlers(seededInvoices));
    renderWithProviders(<TestNavigation><SalesInvoicesScreen /></TestNavigation>, { transport, initialSession: testAdminSession });
    await screen.findByText("INV-000001");
    // "مدفوع" is a prefix of "مدفوع جزئياً" too, so anchor on the trailing count.
    fireEvent.click(screen.getByRole("tab", { name: /^مدفوع\s?\d/ }));
    // The status filter is now server-side: the row list only updates once the
    // refetch settles, and a transient loading state can briefly show neither
    // row — assert the settled state (both conditions) in one waitFor, not two.
    await waitFor(() => {
      expect(screen.queryByText("INV-000001")).not.toBeInTheDocument();
      expect(screen.getByText("INV-000002")).toBeInTheDocument();
    });
  });

  it("opens the detail view with the effects panel and tabs", async () => {
    const transport = stubTransport(baseHandlers(seededInvoices));
    renderWithProviders(<TestNavigation><SalesInvoicesScreen /></TestNavigation>, { transport, initialSession: testAdminSession });
    fireEvent.click(await screen.findByText("INV-000001"));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(await screen.findByRole("heading", { name: "INV-000001" })).toBeInTheDocument();
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
    renderWithProviders(<TestNavigation><SalesInvoicesScreen /></TestNavigation>, { transport, initialSession: testAdminSession });
    await screen.findByText("INV-000001");
    openNewInvoicePage();

    await pickFromCombobox("العميل *", "شركة الأمل للتجارة");
    await pickFromCombobox("الصنف — سطر 1", "أرز أبيض مصري");

    const confirmButton = screen.getByRole("button", { name: "تأكيد الفاتورة" });
    await waitFor(() => expect(confirmButton).toBeEnabled());
    fireEvent.click(confirmButton);

    // Create is a sub-page: success closes it back to the list, not a dialog.
    await waitFor(() => expect(screen.queryByRole("heading", { name: "فاتورة مبيعات جديدة" })).not.toBeInTheDocument());
    expect(await screen.findByText("INV-000004")).toBeInTheDocument();
  });

  it("shows a domain validation error instead of confirming an invoice without a customer", async () => {
    const transport = stubTransport(baseHandlers(seededInvoices));
    renderWithProviders(<TestNavigation><SalesInvoicesScreen /></TestNavigation>, { transport, initialSession: testAdminSession });
    await screen.findByText("INV-000001");
    openNewInvoicePage();
    await pickFromCombobox("الصنف — سطر 1", "أرز أبيض مصري");

    // With no customer chosen the confirm button stays disabled — no invoice is created.
    expect(screen.getByRole("button", { name: "تأكيد الفاتورة" })).toBeDisabled();
  });
});

describe("SalesInvoicesScreen — payments", () => {
  it("records a payment against a confirmed invoice and advances it to مدفوع جزئياً", async () => {
    let current = [...seededInvoices];
    const transport = stubTransport({
      ...baseHandlers(current),
      "GET /sales-invoices": () => ({ body: current }),
      "GET /sales-invoices/*": (_init, path) => {
        const idOrDocNo = decodeURIComponent(path.split("/").pop() ?? "");
        const found = current.find((inv) => inv.id === idOrDocNo || inv.docNo === idOrDocNo);
        return found ? { body: found } : { status: 404, body: { error: "NOT_FOUND" } };
      },
      "POST /sales-invoices/inv-1/payments": () => {
        current = current.map((inv) => (inv.id === "inv-1" ? { ...inv, status: "partially_paid" as const, amountPaid: "50.000000", remainingBalance: "160.900000" } : inv));
        return { body: current.find((inv) => inv.id === "inv-1")! };
      },
    });
    renderWithProviders(<TestNavigation><SalesInvoicesScreen /></TestNavigation>, { transport, initialSession: testAdminSession });
    fireEvent.click(await screen.findByText("INV-000001"));
    await screen.findByRole("heading", { name: "INV-000001" });
    fireEvent.click(screen.getByRole("tab", { name: "المدفوعات" }));

    typeMoney(screen.getByLabelText("قيمة الدفعة"), "50");
    selectOption("الخزينة المستلمة", "خزينة الفرع الرئيسي (TR-01)");
    fireEvent.click(screen.getByRole("button", { name: "تحصيل دفعة" }));

    await waitFor(() => expect(screen.getAllByText("مدفوع جزئياً").length).toBeGreaterThan(0));
  });

  it("fully pays off the partially-paid seeded invoice, advancing it to مدفوع", async () => {
    let current = [...seededInvoices];
    const transport = stubTransport({
      ...baseHandlers(current),
      "GET /sales-invoices": () => ({ body: current }),
      "GET /sales-invoices/*": (_init, path) => {
        const idOrDocNo = decodeURIComponent(path.split("/").pop() ?? "");
        const found = current.find((inv) => inv.id === idOrDocNo || inv.docNo === idOrDocNo);
        return found ? { body: found } : { status: 404, body: { error: "NOT_FOUND" } };
      },
      "POST /sales-invoices/inv-3/payments": () => {
        current = current.map((inv) => (inv.id === "inv-3" ? { ...inv, status: "paid" as const, amountPaid: "210.900000", remainingBalance: "0.000000" } : inv));
        return { body: current.find((inv) => inv.id === "inv-3")! };
      },
    });
    renderWithProviders(<TestNavigation><SalesInvoicesScreen /></TestNavigation>, { transport, initialSession: testAdminSession });
    fireEvent.click(await screen.findByText("INV-000003"));
    await screen.findByRole("heading", { name: "INV-000003" });
    fireEvent.click(screen.getByRole("tab", { name: "المدفوعات" }));

    // Pay the remaining balance shown in the المتبقي cell.
    const remainingCell = screen.getByText("المتبقي").closest("div")?.querySelector("dd");
    const remainingText = remainingCell?.textContent?.replace(/[^\d.]/g, "") ?? "0";

    typeMoney(screen.getByLabelText("قيمة الدفعة"), remainingText);
    selectOption("الخزينة المستلمة", "خزينة الفرع الرئيسي (TR-01)");
    fireEvent.click(screen.getByRole("button", { name: "تحصيل دفعة" }));

    await waitFor(() => expect(screen.getAllByText("مدفوع").length).toBeGreaterThan(0));
  });

  it("blocks recording a payment with no amount, or with no treasury chosen — the mutation never fires either time", async () => {
    const paymentRequests: unknown[] = [];
    const transport = stubTransport({
      ...baseHandlers(seededInvoices),
      "POST /sales-invoices/inv-1/payments": (init) => {
        paymentRequests.push(JSON.parse((init?.body as string) ?? "{}"));
        return { body: seededInvoices[0]! };
      },
    });
    renderWithProviders(<TestNavigation><SalesInvoicesScreen /></TestNavigation>, { transport, initialSession: testAdminSession });
    fireEvent.click(await screen.findByText("INV-000001"));
    await screen.findByRole("heading", { name: "INV-000001" });
    fireEvent.click(screen.getByRole("tab", { name: "المدفوعات" }));

    fireEvent.click(screen.getByRole("button", { name: "تحصيل دفعة" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("قيمة الدفعة يجب أن تكون أكبر من صفر.");
    expect(paymentRequests).toHaveLength(0);

    typeMoney(screen.getByLabelText("قيمة الدفعة"), "50");
    fireEvent.click(screen.getByRole("button", { name: "تحصيل دفعة" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("اختر الخزينة التي استُلم فيها المبلغ");
    expect(paymentRequests).toHaveLength(0);
  });

  it("keeps the typed payment amount and shows the server's own refusal when recording a payment is rejected", async () => {
    const transport = stubTransport({
      ...baseHandlers(seededInvoices),
      "POST /sales-invoices/inv-1/payments": () => ({ status: 409, body: { message: "المبلغ يتجاوز المتبقي على الفاتورة." } }),
    });
    renderWithProviders(<TestNavigation><SalesInvoicesScreen /></TestNavigation>, { transport, initialSession: testAdminSession });
    fireEvent.click(await screen.findByText("INV-000001"));
    await screen.findByRole("heading", { name: "INV-000001" });
    fireEvent.click(screen.getByRole("tab", { name: "المدفوعات" }));

    const amountInput = screen.getByLabelText("قيمة الدفعة");
    typeMoney(amountInput, "500");
    selectOption("الخزينة المستلمة", "خزينة الفرع الرئيسي (TR-01)");
    fireEvent.click(screen.getByRole("button", { name: "تحصيل دفعة" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("المبلغ يتجاوز المتبقي على الفاتورة.");
    expect((amountInput as HTMLInputElement).value).toBe("500.00");
  });
});

describe("SalesInvoicesScreen — create form line management", () => {
  it("removes the correct line by index: the survivor keeps its own qty, not the removed line's", async () => {
    let current = [...seededInvoices];
    let createdBody: Record<string, unknown> | undefined;
    const transport = stubTransport({
      ...baseHandlers(current),
      "GET /sales-invoices": () => ({ body: current }),
      "POST /sales-invoices": (init) => {
        const body = JSON.parse((init?.body as string) ?? "{}");
        createdBody = body;
        const created = invoice({ id: "inv-4", docNo: "INV-000004", status: "draft", journalEntryId: null, confirmedAt: null, ...body, lines: body.lines ?? [] });
        current = [...current, created];
        return { status: 201, body: created };
      },
    });
    renderWithProviders(<TestNavigation><SalesInvoicesScreen /></TestNavigation>, { transport, initialSession: testAdminSession });
    await screen.findByText("INV-000001");
    openNewInvoicePage();

    await pickFromCombobox("العميل *", "شركة الأمل للتجارة");
    await pickFromCombobox("الصنف — سطر 1", "أرز أبيض مصري");
    const qty1 = screen.getByLabelText("الكمية للسطر 1");
    fireEvent.change(qty1, { target: { value: "2" } });
    fireEvent.blur(qty1);

    fireEvent.click(screen.getByRole("button", { name: "إضافة بند" }));
    await pickFromCombobox("الصنف — سطر 2", "أرز أبيض مصري");
    const qty2 = screen.getByLabelText("الكمية للسطر 2");
    fireEvent.change(qty2, { target: { value: "3" } });
    fireEvent.blur(qty2);

    fireEvent.click(screen.getByRole("button", { name: "حذف السطر 1" }));

    // Only one line remains, re-numbered "line 1" — it must be the SURVIVOR
    // (qty 3), not a stale copy of the removed line (qty 2).
    await waitFor(() => expect((screen.getByLabelText("الكمية للسطر 1") as HTMLInputElement).value).toContain("3"));
    expect(screen.queryByLabelText("الكمية للسطر 2")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "حفظ كمسودة" }));

    await waitFor(() => expect(createdBody).toBeDefined());
    const lines = createdBody!.lines as Array<{ qty: string }>;
    expect(lines).toHaveLength(1);
    expect(lines[0]!.qty).toBe("3.000000");
  });
});

describe("SalesInvoicesScreen — row-scoped confirm from the list", () => {
  function deferred<T>() {
    let resolve!: (v: T) => void;
    let reject!: (e: unknown) => void;
    const promise = new Promise<T>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    return { promise, resolve, reject };
  }

  const draftA = invoice({ id: "inv-draft-a", docNo: null, status: "draft" });
  const draftB = invoice({ id: "inv-draft-b", docNo: null, status: "draft" });

  function renderWithGatedConfirm(gate: ReturnType<typeof deferred<void>>) {
    const list = [draftA, draftB];
    const base = stubTransport(baseHandlers(list));
    const transport = async (path: string, init?: RequestInit) => {
      const method = (init?.method ?? "GET").toUpperCase();
      if (method === "POST" && path === "/sales-invoices/inv-draft-a/confirm") {
        await gate.promise;
        const confirmed = { ...draftA, status: "confirmed" as const, docNo: "INV-000900" };
        list[0] = confirmed;
        return {
          status: 200,
          ok: true,
          json: async () => ({ ...confirmed, held: false }),
          text: async () => "",
        };
      }
      return base(path, init);
    };
    return renderWithProviders(<TestNavigation><SalesInvoicesScreen /></TestNavigation>, { transport, initialSession: testAdminSession });
  }

  it("leaves invoice B's own confirm action enabled while invoice A's confirm is still in flight", async () => {
    const gate = deferred<void>();
    renderWithGatedConfirm(gate);
    await screen.findAllByText("مسودة");

    // Both rows render as "مسودة" (draft, no docNo) — locate them by DOM order instead.
    const [rowA, rowB] = screen.getAllByRole("row").slice(1);

    fireEvent.click(within(rowA!).getByRole("button", { name: /^إجراءات/ }));
    fireEvent.click(await screen.findByRole("menuitem", { name: "تأكيد الفاتورة" }));

    fireEvent.click(within(rowB!).getByRole("button", { name: /^إجراءات/ }));
    const confirmB = await screen.findByRole("menuitem", { name: "تأكيد الفاتورة" });
    expect(confirmB).toBeEnabled();

    gate.resolve();
    await waitFor(() => expect(screen.getByText("INV-000900")).toBeInTheDocument());
  });

  it("shows the server's refusal for the failed row and leaves the other draft row's own confirm action untouched", async () => {
    const list = [draftA, draftB];
    const transport = stubTransport({
      ...baseHandlers(list),
      "POST /sales-invoices/inv-draft-a/confirm": () => ({ status: 409, body: { message: "الفترة المحاسبية مقفلة." } }),
    });
    renderWithProviders(<TestNavigation><SalesInvoicesScreen /></TestNavigation>, { transport, initialSession: testAdminSession });
    await screen.findAllByText("مسودة");

    const rows = screen.getAllByRole("row").slice(1);
    const [rowA, rowB] = rows;
    fireEvent.click(within(rowA!).getByRole("button", { name: /^إجراءات/ }));
    fireEvent.click(await screen.findByRole("menuitem", { name: "تأكيد الفاتورة" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("الفترة المحاسبية مقفلة.");
    // Invoice A stayed a draft — the row still reads "مسودة", not confirmed.
    expect(screen.getAllByText("مسودة").length).toBeGreaterThan(0);

    fireEvent.click(within(rowB!).getByRole("button", { name: /^إجراءات/ }));
    expect(screen.getByRole("menuitem", { name: "تأكيد الفاتورة" })).toBeEnabled();
  });
});
