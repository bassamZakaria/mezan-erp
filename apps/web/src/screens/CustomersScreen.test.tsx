// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, expect, it } from "vitest";
import { screen, fireEvent, within, waitFor } from "@testing-library/react";
import type { CustomerDTO, PriceListDTO } from "@mezan/contracts";
import { CustomersScreen } from "./CustomersScreen";
import { renderWithProviders, stubTransport, testAdminSession } from "../data/test-support";
import type { SalesInvoiceDTO } from "../data/hooks";

/**
 * `TextField` (settings/form-controls.tsx) renders a `<label>` that is never
 * associated with its input via `for`/`id`, so `getByLabelText` can't find
 * these fields. Fall back to the DOM structure the shared `Field` wrapper
 * always uses: a `<label>` immediately followed by its control in the same
 * wrapper `<div>`.
 */
function textFieldInput(container: HTMLElement, labelText: string): HTMLInputElement {
  const label = within(container).getByText(labelText, { selector: "label" });
  const input = label.parentElement?.querySelector<HTMLInputElement>("input, textarea");
  if (!input) throw new Error(`No input control found next to label "${labelText}"`);
  return input;
}

function customer(overrides: Partial<CustomerDTO> = {}): CustomerDTO {
  return {
    id: "cust-1",
    code: "C000001",
    nameAr: "شركة الأمل للتجارة",
    nameEn: "Al Amal Trading Co.",
    phone: "01012345001",
    email: "accounts@alamal.example",
    contactPerson: "محمود فتحي",
    taxNumber: "300111222300003",
    category: "تجزئة",
    notes: null,
    paymentTermsDays: 30,
    currency: "EGP",
    openingBalance: "450.00",
    active: true,
    priceListId: null,
    creditLimit: "15000.00",
    taxExempt: false,
    etaBuyerType: "business",
    commercialRegistrationNumber: null,
    address: null,
    logoAttachmentId: null,
    nationalId: null,
    ...overrides,
  };
}

const inactiveCustomer = customer({
  id: "cust-2",
  code: "C000002",
  nameAr: "مصنع الوادي الأخضر",
  nameEn: "Green Valley Factory",
  active: false,
});

function renderScreen(
  customers: CustomerDTO[] = [customer(), inactiveCustomer],
  opts: {
    priceLists?: PriceListDTO[];
    customersRequests?: string[];
    onCreateCustomer?: (body: Record<string, unknown>) => { status?: number; body: unknown } | undefined;
    patchRequests?: Array<{ id: string; patch: Record<string, unknown> }>;
  } = {},
) {
  let current = [...customers];
  const customersRequests = opts.customersRequests ?? [];
  const transport = stubTransport({
    "GET /customers": (_init, path) => {
      customersRequests.push(path);
      const status = new URL(path, "http://test").searchParams.get("status");
      const rows = status === "active" ? current.filter((c) => c.active) : status === "inactive" ? current.filter((c) => !c.active) : current;
      return { body: rows };
    },
    // The status chips (ListViews) hide any chip whose count is 0, so the
    // real counts endpoint has to be stubbed too, or the "active"/"inactive"
    // tabs never render for the test to click.
    "GET /customers/counts": () => {
      const active = current.filter((c) => c.active).length;
      return { body: { all: current.length, active, inactive: current.length - active } };
    },
    "GET /customers/stats": () => ({
      body: {
        count: current.length,
        active: current.filter((c) => c.active).length,
        creditLimits: "0",
        toCollect: "0",
      },
    }),
    "GET /price-lists": () => ({ body: opts.priceLists ?? [] }),
    "POST /customers": (init) => {
      const body = JSON.parse((init?.body as string) ?? "{}");
      const overridden = opts.onCreateCustomer?.(body);
      if (overridden) return overridden;
      const created: CustomerDTO = { ...customer(), ...body, id: body.id, code: body.code };
      current = [...current, created];
      return { status: 201, body: created };
    },
    "PATCH /customers/*": (init, path) => {
      const id = path.split("/").pop()!;
      const patch = JSON.parse((init?.body as string) ?? "{}");
      opts.patchRequests?.push({ id, patch });
      const index = current.findIndex((c) => c.id === id);
      const updated: CustomerDTO = { ...current[index]!, ...patch };
      current = [...current.slice(0, index), updated, ...current.slice(index + 1)];
      return { body: updated };
    },
    // The statement tab (كشف حساب) builds a real AR ledger from these.
    "GET /sales-invoices": () => ({ body: [] }),
    "GET /sales-returns": () => ({ body: [] }),
    "GET /vouchers": () => ({ body: [] }),
    "GET /reports/aging/customers": () => ({ body: { rows: [], groups: [], grandTotals: {}, reconciliation: null } }),
  });
  return renderWithProviders(<CustomersScreen />, { transport, initialSession: testAdminSession });
}

describe("CustomersScreen", () => {
  it("lists customers from the real backend", async () => {
    renderScreen();
    expect(screen.getByRole("heading", { name: "العملاء" })).toBeInTheDocument();
    expect(await screen.findByText("شركة الأمل للتجارة")).toBeInTheDocument();
    expect(screen.getByText("C000001")).toBeInTheDocument();
  });

  it("shows an empty state when there are no customers yet", async () => {
    renderScreen([]);
    expect(await screen.findByText("لا يوجد عملاء مطابقون")).toBeInTheDocument();
  });

  it("opens the customer detail on row click, with an overview tab and a real statement tab", async () => {
    renderScreen();
    fireEvent.click(await screen.findByText("شركة الأمل للتجارة"));
    expect(screen.getByRole("heading", { name: /شركة الأمل للتجارة/ })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "نظرة عامة" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "كشف حساب" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("tab", { name: "كشف حساب" }));
    // كشف حساب is a real AR movement ledger now, not a "قريباً" stub — the opening-balance
    // label appears both as a MiniStat and as the ledger's first row.
    expect((await screen.findAllByText("رصيد افتتاحي")).length).toBeGreaterThan(0);
  });

  it("returns to the list from the detail view", async () => {
    renderScreen();
    fireEvent.click(await screen.findByText("شركة الأمل للتجارة"));
    fireEvent.click(screen.getByRole("button", { name: "رجوع لقائمة العملاء" }));
    expect(screen.getByRole("heading", { name: "العملاء" })).toBeInTheDocument();
  });

  it("filters by status chip", async () => {
    renderScreen();
    await screen.findByText("شركة الأمل للتجارة");
    fireEvent.click(screen.getByRole("tab", { name: /غير نشط/ }));
    // `useUrlParam`'s write is buffered onto a microtask (url-state.ts), and the
    // list itself is server-filtered by status, so the rows only settle once
    // both the URL update and the refetch it triggers have gone through.
    await waitFor(() => {
      expect(screen.queryByText("شركة الأمل للتجارة")).not.toBeInTheDocument();
      expect(screen.getByText("مصنع الوادي الأخضر")).toBeInTheDocument();
    });
  });

  it("adds a new customer through the side panel", async () => {
    renderScreen();
    await screen.findByText("شركة الأمل للتجارة");
    fireEvent.click(screen.getByRole("button", { name: "إضافة عميل" }));

    const dialog = screen.getByRole("dialog", { name: "إضافة عميل" });
    fireEvent.change(textFieldInput(dialog, "اسم العميل *"), { target: { value: "عميل تجريبي" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "إضافة عميل" }));

    expect(await screen.findByText("عميل تجريبي")).toBeInTheDocument();
  });

  it("shows an Arabic validation error instead of adding an invalid customer", async () => {
    renderScreen();
    await screen.findByText("شركة الأمل للتجارة");
    fireEvent.click(screen.getByRole("button", { name: "إضافة عميل" }));
    const dialog = screen.getByRole("dialog", { name: "إضافة عميل" });
    // Leave the required Arabic name empty and try to save.
    fireEvent.click(within(dialog).getByRole("button", { name: "إضافة عميل" }));
    expect(within(dialog).getByText("الاسم بالعربية مطلوب")).toBeInTheDocument();
  });

  it("edits an existing customer from the detail view without clobbering its credit limit", async () => {
    renderScreen();
    fireEvent.click(await screen.findByText("شركة الأمل للتجارة"));
    fireEvent.click(screen.getByRole("button", { name: "تعديل" }));

    const dialog = screen.getByRole("dialog", { name: "تعديل عميل" });
    fireEvent.change(textFieldInput(dialog, "الهاتف"), { target: { value: "01000000000" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "حفظ التعديلات" }));

    await waitFor(() => expect(screen.getByText(/15,000|15000/)).toBeInTheDocument());
  });

  it("shows an error banner with a retry action when customers fail to load", async () => {
    const transport = stubTransport({
      "GET /customers": () => ({ status: 500, body: { error: "INTERNAL" } }),
      "GET /customers/counts": () => ({ body: {} }),
      "GET /customers/stats": () => ({ body: {} }),
      "GET /sales-invoices": () => ({ body: [] }),
      "GET /sales-returns": () => ({ body: [] }),
      "GET /vouchers": () => ({ body: [] }),
      "GET /reports/aging/customers": () => ({ body: { rows: [], groups: [], grandTotals: {}, reconciliation: null } }),
    });
    renderWithProviders(<CustomersScreen />, { transport, initialSession: testAdminSession });
    expect(await screen.findByText("تعذّر تحميل العملاء.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "إعادة المحاولة" })).toBeInTheDocument();
  });

  it("sends the picked price list's real id — not its Arabic name — in the /customers request", async () => {
    const customersRequests: string[] = [];
    renderScreen([customer(), inactiveCustomer], {
      customersRequests,
      priceLists: [
        { id: "pl-wholesale", code: "PL-002", nameAr: "قائمة الجملة", nameEn: null, description: null, isBase: false, active: true, lines: [], createdAt: "2024-01-01" },
      ],
    });
    await screen.findByText("شركة الأمل للتجارة");
    customersRequests.length = 0;

    const picker = screen.getByPlaceholderText("تصفية بقائمة الأسعار");
    fireEvent.focus(picker);
    fireEvent.change(picker, { target: { value: "قائمة الجملة" } });
    fireEvent.mouseDown(screen.getByRole("button", { name: (name) => name.startsWith("قائمة الجملة") }));

    await waitFor(() => {
      expect(customersRequests.some((p) => new URL(p, "http://x").searchParams.get("priceListId") === "pl-wholesale")).toBe(true);
    });
    expect(customersRequests.every((p) => !decodeURIComponent(p).includes("قائمة الجملة"))).toBe(true);
  });

  it("deactivates a customer from the row menu, sending only {active:false} and moving it off the active tab", async () => {
    const patchRequests: Array<{ id: string; patch: Record<string, unknown> }> = [];
    renderScreen([customer(), inactiveCustomer], { patchRequests });
    await screen.findByText("شركة الأمل للتجارة");

    fireEvent.click(screen.getByRole("button", { name: "إجراءات شركة الأمل للتجارة" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "إيقاف العميل" }));
    // Deactivation is a destructive action (tone: "danger"), so RowMenu gates
    // it behind its own confirm dialog rather than firing on the menu click.
    const confirmDialog = screen.getByRole("dialog");
    fireEvent.click(within(confirmDialog).getByRole("button", { name: "إيقاف العميل" }));

    await waitFor(() => {
      expect(patchRequests).toContainEqual({ id: "cust-1", patch: { active: false } });
    });

    fireEvent.click(screen.getByRole("tab", { name: /غير نشط/ }));
    await waitFor(() => {
      expect(screen.getByText("شركة الأمل للتجارة")).toBeInTheDocument();
    });
  });

  it("shows the server's own refusal message and keeps the panel open when creation is rejected server-side", async () => {
    renderScreen([customer(), inactiveCustomer], {
      onCreateCustomer: () => ({ status: 409, body: { message: "الرقم الضريبي مستخدم لعميل آخر بالفعل." } }),
    });
    await screen.findByText("شركة الأمل للتجارة");
    fireEvent.click(screen.getByRole("button", { name: "إضافة عميل" }));
    const dialog = screen.getByRole("dialog", { name: "إضافة عميل" });
    fireEvent.change(textFieldInput(dialog, "اسم العميل *"), { target: { value: "عميل يرفضه الخادم" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "إضافة عميل" }));

    expect(await screen.findByText("الرقم الضريبي مستخدم لعميل آخر بالفعل.")).toBeInTheDocument();
    expect(screen.getByRole("dialog", { name: "إضافة عميل" })).toBeInTheDocument();
  });

  it("binds the create form's price-list field to a real id, sent as priceListId in the POST body", async () => {
    let created: Record<string, unknown> | undefined;
    renderScreen([customer(), inactiveCustomer], {
      priceLists: [
        { id: "pl-wholesale", code: "PL-002", nameAr: "قائمة الجملة", nameEn: null, description: null, isBase: false, active: true, lines: [], createdAt: "2024-01-01" },
      ],
      onCreateCustomer: (body) => {
        created = body;
        return undefined;
      },
    });
    await screen.findByText("شركة الأمل للتجارة");
    fireEvent.click(screen.getByRole("button", { name: "إضافة عميل" }));
    const dialog = screen.getByRole("dialog", { name: "إضافة عميل" });
    fireEvent.change(textFieldInput(dialog, "اسم العميل *"), { target: { value: "عميل بقائمة أسعار" } });

    const picker = within(dialog).getByPlaceholderText("بدون قائمة أسعار");
    fireEvent.focus(picker);
    fireEvent.change(picker, { target: { value: "قائمة الجملة" } });
    fireEvent.mouseDown(within(dialog).getByRole("button", { name: (name) => name.startsWith("قائمة الجملة") }));

    fireEvent.click(within(dialog).getByRole("button", { name: "إضافة عميل" }));

    await waitFor(() => expect(created).toBeDefined());
    expect(created?.priceListId).toBe("pl-wholesale");
  });

  it("reactivates an inactive customer from the row menu, sending only {active:true}", async () => {
    const patchRequests: Array<{ id: string; patch: Record<string, unknown> }> = [];
    renderScreen([inactiveCustomer], { patchRequests });
    await screen.findByText("مصنع الوادي الأخضر");

    fireEvent.click(screen.getByRole("button", { name: "إجراءات مصنع الوادي الأخضر" }));
    // "activate" carries no danger tone, so it fires directly with no confirm step.
    fireEvent.click(screen.getByRole("menuitem", { name: "تفعيل العميل" }));

    await waitFor(() => {
      expect(patchRequests).toContainEqual({ id: "cust-2", patch: { active: true } });
    });
  });

  it("computes the statement's closing balance from a real opening balance, an unpaid invoice and a partial collection", async () => {
    const cust = customer({ openingBalance: "450.00" });
    const inv: SalesInvoiceDTO = {
      id: "inv-1",
      docType: "SALES_INVOICE",
      docNo: "INV-000001",
      status: "partially_paid",
      date: "2026-08-20",
      dueDate: "2026-09-20",
      customerId: cust.id,
      customerNameAr: cust.nameAr,
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
      amountPaid: "50.000000",
      returnedCredit: "0.000000",
      remainingBalance: "160.900000",
      journalEntryId: "je-1",
      workflowRequestId: null,
      createdAt: "2026-08-20T09:00:00.000Z",
      confirmedAt: "2026-08-20T09:00:00.000Z",
      lines: [],
      totals: { grossTotal: "185.00", lineDiscountTotal: "0.00", promotionDiscountTotal: "0.00", invoiceDiscountTotal: "0.00", subtotal: "185.00", taxableTotal: "185.00", taxTotal: "25.90", grandTotal: "210.90" },
    };
    const transport = stubTransport({
      "GET /customers": () => ({ body: [cust] }),
      "GET /customers/counts": () => ({ body: { all: 1, active: 1, inactive: 0 } }),
      "GET /customers/stats": () => ({ body: { count: 1, active: 1, creditLimits: "0", toCollect: "0" } }),
      "GET /price-lists": () => ({ body: [] }),
      "GET /sales-invoices": () => ({ body: [inv] }),
      "GET /sales-returns": () => ({ body: [] }),
      "GET /vouchers": () => ({ body: [] }),
      "GET /reports/aging/customers": () => ({ body: { rows: [], groups: [], grandTotals: {}, reconciliation: null } }),
    });
    renderWithProviders(<CustomersScreen />, { transport, initialSession: testAdminSession });

    fireEvent.click(await screen.findByText("شركة الأمل للتجارة"));
    fireEvent.click(screen.getByRole("tab", { name: "كشف حساب" }));

    // opening 450.00 (debit) + invoice grand total 210.90 (debit) = 660.90 debit;
    // the 50.00 counter-paid on the invoice (no allocations) is the only credit.
    const closingValue = (await screen.findByText("الرصيد الختامي")).nextElementSibling;
    expect(closingValue?.textContent).toBe("610.90");
    const debitValue = screen.getByText("إجمالي المدين").nextElementSibling;
    expect(debitValue?.textContent).toBe("660.90");
    const creditValue = screen.getByText("إجمالي الدائن").nextElementSibling;
    expect(creditValue?.textContent).toBe("50.00");
  });
});
