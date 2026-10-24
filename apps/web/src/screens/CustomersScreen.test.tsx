// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, expect, it } from "vitest";
import { screen, fireEvent, within, waitFor } from "@testing-library/react";
import type {
  AttachmentDTO,
  AuditEventDTO,
  ChequeDTO,
  CustomerDTO,
  InstallmentLineDTO,
  InstallmentPlanDocumentDTO,
  PartyStatementDTO,
  PartyStatementLineDTO,
  PriceListDTO,
  SalesReturnDocumentDTO,
  SalesReturnLineDTO,
  TaxRateDTO,
  VoucherAllocationDTO,
} from "@mezan/contracts";
import { BranchCaveatCodeDTO } from "@mezan/contracts";
import type { VoucherRowDTO, SalesInvoiceDTO } from "../data/hooks";
import { CustomersScreen } from "./CustomersScreen";
import { renderWithProviders, stubTransport, testAdminSession } from "../data/test-support";
import { Money } from "@mezan/domain";

/** The server's `/sales-invoices/counts` and `/stats` over a fixture, filtered as the route filters. */
function invoiceSummaryHandlers(invoices: () => readonly SalesInvoiceDTO[]) {
  const scoped = (path: string) => {
    const params = new URL(path, "http://test").searchParams;
    const customerId = params.get("customerId");
    const status = params.get("status");
    const matchesStatus = (inv: SalesInvoiceDTO) =>
      !status || (status === "active" ? ["confirmed", "partially_paid", "paid"].includes(inv.status) : inv.status === status);
    return invoices().filter((inv) => (!customerId || inv.customerId === customerId) && matchesStatus(inv));
  };
  return {
    "GET /sales-invoices/counts": (_init: RequestInit | undefined, path: string) => {
      const counts: Record<string, number> = { all: 0 };
      for (const inv of scoped(path)) {
        counts.all = (counts.all ?? 0) + 1;
        counts[inv.status] = (counts[inv.status] ?? 0) + 1;
      }
      return { body: counts };
    },
    "GET /sales-invoices/stats": (_init: RequestInit | undefined, path: string) => {
      const live = scoped(path).filter((inv) => !["draft", "cancelled", "reversed"].includes(inv.status));
      const sum = (values: string[]) => values.reduce((total, v) => total.add(Money.fromMajor(v)), Money.zero()).toString();
      return {
        body: {
          count: live.length,
          sales: sum(live.map((inv) => inv.baseGrandTotal ?? inv.totals.grandTotal)),
          collected: sum(live.map((inv) => inv.amountPaid)),
          returned: "0",
          remaining: sum(live.map((inv) => inv.remainingBalance)),
          overdueCount: 0,
          overdue: "0",
          dueSoonCount: 0,
          dueSoon: "0",
        },
      };
    },
  };
}

/**
 * `Select` (packages/ui/src/primitives/Select.tsx) is a styled listbox, not a
 * native `<select>` — it has no `value` to `fireEvent.change`. Open it and
 * commit the option the same way a pointer user does: `mousedown`, since the
 * listbox commits on `onMouseDown` rather than `click`.
 */
function selectOption(trigger: HTMLElement, optionLabel: string) {
  fireEvent.click(trigger);
  fireEvent.mouseDown(screen.getByRole("option", { name: optionLabel }));
}

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
    taxExemptionRateId: null,
    etaBuyerType: "business",
    commercialRegistrationNumber: null,
    address: null,
    logoAttachmentId: null,
    nationalId: null,
    owed: "450.000000",
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

function salesInvoice(overrides: Partial<SalesInvoiceDTO> = {}): SalesInvoiceDTO {
  return {
    id: "inv-x",
    docType: "SALES_INVOICE",
    docNo: "INV-000001",
    status: "confirmed",
    date: "2026-08-01",
    dueDate: "2026-09-01",
    customerId: "cust-1",
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
    remainingBalance: "0.000000",
    journalEntryId: "je-x",
    workflowRequestId: null,
    createdAt: "2026-08-01T09:00:00.000Z",
    confirmedAt: "2026-08-01T09:00:00.000Z",
    projectId: null,
    fxRate: null,
    lines: [],
    totals: {
      taxInclusive: false, grossTotal: "0.00",
      lineDiscountTotal: "0.00",
      promotionDiscountTotal: "0.00",
      invoiceDiscountTotal: "0.00",
      subtotal: "0.00",
      taxableTotal: "0.00",
      taxTotal: "0.00",
      grandTotal: "0.00",
    },
    ...overrides,
    baseGrandTotal: overrides.baseGrandTotal ?? overrides.totals?.grandTotal ?? "0.00",
  };
}

function installmentLine(overrides: Partial<InstallmentLineDTO> = {}): InstallmentLineDTO {
  return {
    no: 1,
    customerId: "cust-1",
    sourceInvoiceId: "inv-1",
    sourceInvoiceNumber: "INV-000001",
    frequency: "MONTHLY",
    downPayment: "0",
    dueDate: "2026-09-01",
    amount: "500.00",
    paidAmount: "0",
    status: "pending",
    lateFeeAmount: "0",
    ...overrides,
  };
}

function installmentPlanDoc(overrides: Partial<InstallmentPlanDocumentDTO> = {}): InstallmentPlanDocumentDTO {
  return {
    id: "ip-1",
    docType: "INSTALLMENT_PLAN",
    docNo: "IP-000001",
    date: "2026-07-01",
    memo: "",
    status: "confirmed",
    lines: [installmentLine()],
    createdAt: "2026-07-01T09:00:00.000Z",
    confirmedAt: "2026-07-01T09:00:00.000Z",
    reversesDocId: null,
    reversedByDocId: null,
    workflowRequestId: null,
    journalEntryId: null,
    ...overrides,
  };
}

function salesReturnLine(overrides: Partial<SalesReturnLineDTO> = {}): SalesReturnLineDTO {
  return {
    itemId: "item-1",
    warehouseId: "wh-1",
    customerId: "cust-1",
    sourceInvoiceId: "inv-1",
    sourceInvoiceNumber: "INV-000001",
    reason: "DEFECTIVE",
    availableQty: "2",
    qty: "1",
    unitPrice: "100.00",
    unitCost: "60.00",
    taxAmount: "14.00",
    ...overrides,
  };
}

function salesReturnDoc(overrides: Partial<SalesReturnDocumentDTO> = {}): SalesReturnDocumentDTO {
  return {
    id: "sr-1",
    docType: "SALES_RETURN",
    docNo: "SR-000001",
    date: "2026-08-05",
    memo: "",
    status: "confirmed",
    lines: [salesReturnLine()],
    createdAt: "2026-08-05T09:00:00.000Z",
    confirmedAt: "2026-08-05T09:00:00.000Z",
    reversesDocId: null,
    reversedByDocId: null,
    workflowRequestId: null,
    journalEntryId: null,
    awaitingRefund: false,
    refundDue: "0.00",
    refundedTotal: "0.00",
    refunds: [],
    ...overrides,
  };
}

function voucherRow(overrides: Partial<VoucherRowDTO> = {}): VoucherRowDTO {
  const row: VoucherRowDTO = {
    id: "v-1",
    docNo: "CV-000001",
    voucherType: "customer_collection",
    direction: "receipt",
    status: "confirmed",
    date: "2026-08-10",
    memo: "",
    amount: "500.000000",
    currency: "EGP",
    fxRate: null,
    baseAmount: "500.000000",
    branchId: "MAIN",
    paymentMethod: "cash",
    treasuryAccountId: "tr-1",
    treasuryGlAccountId: "1310",
    counterpartyGlAccountId: null,
    counterTreasuryAccountId: null,
    counterTreasuryGlAccountId: null,
    customerId: "cust-1",
    supplierId: null,
    referenceNo: null,
    costCenterId: null,
    projectId: null,
    costCategory: null,
    withholdingAmount: null,
    withholdingRatePercent: null,
    netPaidAmount: "500.000000",
    journalEntryId: "je-v1",
    confirmedAt: "2026-08-10T09:00:00.000Z",
    allocatable: false,
    allocationSummary: {
      voucherAmount: "500.000000",
      allocated: "500.000000",
      unallocated: "0.000000",
      fullyAllocated: true,
      needsAllocation: false,
    },
    ...overrides,
  };
  return { ...row, baseAmount: overrides.baseAmount ?? row.amount };
}

function voucherAllocation(overrides: Partial<VoucherAllocationDTO> = {}): VoucherAllocationDTO {
  return {
    id: "alloc-1",
    voucherId: "v-1",
    invoiceId: "inv-1",
    amount: "500.000000",
    status: "active",
    createdAt: "2026-08-10T09:00:00.000Z",
    reversedAt: null,
    ...overrides,
  };
}

function attachment(overrides: Partial<AttachmentDTO> = {}): AttachmentDTO {
  return {
    id: "att-1",
    entityType: "customer",
    entityId: "cust-1",
    fileName: "logo.png",
    mimeType: "image/png",
    byteSize: 2048,
    uploadedBy: "USER-ADMIN",
    uploadedAt: "2026-08-01T09:00:00.000Z",
    notes: null,
    ...overrides,
  };
}

function auditEvent(overrides: Partial<AuditEventDTO> = {}): AuditEventDTO {
  return {
    stream: "sensitive",
    module: "customers",
    entityType: "CUSTOMER",
    entityId: "cust-1",
    action: "UPDATE",
    actor: "محمد الشهابي",
    branchId: null,
    timestamp: "2026-08-15T10:00:00.000Z",
    severity: "INFO",
    details: null,
    ...overrides,
  };
}

function renderScreen(
  customers: CustomerDTO[] = [customer(), inactiveCustomer],
  opts: {
    priceLists?: PriceListDTO[];
    taxRates?: TaxRateDTO[];
    customersRequests?: string[];
    onCreateCustomer?: (body: Record<string, unknown>) => { status?: number; body: unknown } | undefined;
    patchRequests?: Array<{ id: string; patch: Record<string, unknown> }>;
    /** Ids the fake server treats as over their credit limit, for the `overLimit=true` filter. */
    overLimitIds?: Set<string>;
    invoices?: SalesInvoiceDTO[];
    installmentPlans?: InstallmentPlanDocumentDTO[];
    returns?: SalesReturnDocumentDTO[];
    vouchers?: VoucherRowDTO[];
    allocationsByVoucher?: Record<string, VoucherAllocationDTO[]>;
    auditEventsByCustomer?: Record<string, AuditEventDTO[]>;
    attachmentsByCustomer?: Record<string, AttachmentDTO[]>;
    agingRows?: Array<Record<string, unknown>>;
    /** The server-built كشف حساب (`/reports/statements/customers/:id`). */
    statement?: (customerId: string) => { status?: number; body: unknown };
    /** Fails only the per-customer `?customerId=` invoices request. */
    failScopedInvoices?: boolean;
    failInstallments?: boolean;
    failReturns?: boolean;
    failAudit?: boolean;
    route?: string;
  } = {},
) {
  let current = [...customers];
  const customersRequests = opts.customersRequests ?? [];
  const transport = stubTransport({
    "GET /customers": (_init, path) => {
      customersRequests.push(path);
      const params = new URL(path, "http://test").searchParams;
      const status = params.get("status");
      const q = params.get("q");
      const overLimit = params.get("overLimit") === "true";
      let rows = status === "active" ? current.filter((c) => c.active) : status === "inactive" ? current.filter((c) => !c.active) : current;
      if (q) rows = rows.filter((c) => c.nameAr.includes(q) || c.code.includes(q));
      if (overLimit) rows = rows.filter((c) => (opts.overLimitIds ?? new Set()).has(c.id));
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
    "GET /tax-rates": () => ({ body: opts.taxRates ?? [] }),
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
    "GET /sales-invoices": (_init, path) => {
      const customerId = new URL(path, "http://test").searchParams.get("customerId");
      if (customerId && opts.failScopedInvoices) return { status: 500, body: { error: "INTERNAL" } };
      const all = opts.invoices ?? [];
      return { body: customerId ? all.filter((inv) => inv.customerId === customerId) : all };
    },
    ...invoiceSummaryHandlers(() => opts.invoices ?? []),
    "GET /sales-returns": () => (opts.failReturns ? { status: 500, body: { error: "INTERNAL" } } : { body: opts.returns ?? [] }),
    "GET /installments/plans": () =>
      opts.failInstallments ? { status: 500, body: { error: "INTERNAL" } } : { body: opts.installmentPlans ?? [] },
    "GET /vouchers": () => ({ body: opts.vouchers ?? [] }),
    "GET /vouchers/*/allocations": (_init, path) => {
      const voucherId = path.split("/")[2]!;
      return { body: { allocations: opts.allocationsByVoucher?.[voucherId] ?? [] } };
    },
    "GET /cheques": () => ({ body: [] }),
    "GET /audit": (_init, path) => {
      if (opts.failAudit) return { status: 500, body: { error: "INTERNAL" } };
      const entityId = new URL(path, "http://test").searchParams.get("entityId") ?? "";
      const events = opts.auditEventsByCustomer?.[entityId] ?? [];
      // `GET /audit` answers `{ events, total }` (auditQueryResponseSchema) —
      // a bare array reads back as zero events and the panel shows its empty
      // state, which is exactly what made this fixture stop proving anything.
      return { body: { events, total: events.length } };
    },
    "GET /attachments": (_init, path) => {
      const entityId = new URL(path, "http://test").searchParams.get("entityId") ?? "";
      return { body: opts.attachmentsByCustomer?.[entityId] ?? [] };
    },
    "GET /reports/aging/customers": () => ({ body: { rows: opts.agingRows ?? [], groups: [], grandTotals: {}, reconciliation: null } }),
    "GET /reports/statements/customers/*": (_init, path) => {
      const customerId = decodeURIComponent(path.split("/").pop()!.split("?")[0]!);
      return opts.statement?.(customerId) ?? { body: statementOf(customerId, []) };
    },
  });
  return renderWithProviders(<CustomersScreen />, { transport, initialSession: testAdminSession, route: opts.route });
}

type StatementLine = Pick<PartyStatementLineDTO, "kind" | "reference" | "increase" | "decrease"> & Partial<PartyStatementLineDTO>;

/** What `/reports/statements/customers/:id` answers: base amounts, a running balance, and the party's aging row beside the closing. */
function statementOf(partyId: string, lines: StatementLine[], agingTotal?: string): PartyStatementDTO {
  let running = 0;
  let increase = 0;
  let decrease = 0;
  const built = lines.map((line, index) => {
    running += Number(line.increase) - Number(line.decrease);
    increase += Number(line.increase);
    decrease += Number(line.decrease);
    return { key: `l${index}`, date: "2026-08-20", allocations: [], ...line, balance: running.toFixed(6) };
  });
  return {
    partyId,
    asOfDate: "2026-08-31",
    branchCaveat: null,
    lines: built,
    totalIncrease: increase.toFixed(6),
    totalDecrease: decrease.toFixed(6),
    closing: running.toFixed(6),
    agingTotal: agingTotal ?? running.toFixed(6),
  };
}

describe("CustomersScreen", () => {
  it("lists customers from the real backend", async () => {
    renderScreen();
    expect(screen.getByRole("heading", { name: "العملاء" })).toBeInTheDocument();
    expect(await screen.findByText("شركة الأمل للتجارة")).toBeInTheDocument();
    expect(screen.getByText("C000001")).toBeInTheDocument();
  });

  it("shows what the server says each customer owes, not a figure rebuilt from invoices in the browser (D195)", async () => {
    const owing = customer({ owed: "1234.50" });
    const invoice = salesInvoice({ id: "inv-x", customerId: owing.id, status: "confirmed", remainingBalance: "99999.000000" });
    renderScreen([owing], { invoices: [invoice] });
    expect(await screen.findByText("1,234.50")).toBeInTheDocument();
    expect(screen.queryByText("99,999.00")).not.toBeInTheDocument();

    fireEvent.click(screen.getByText("شركة الأمل للتجارة"));
    expect(screen.getByText("متبقي من الحد").nextElementSibling?.textContent).toContain("13,765.50");
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

  it("scopes the invoices tab to this customer's own invoices, excluding another customer's, with real stats", async () => {
    const mine1 = salesInvoice({
      id: "inv-1",
      docNo: "INV-000010",
      customerId: "cust-1",
      status: "confirmed",
      amountPaid: "100.000000",
      totals: { ...salesInvoice().totals, grandTotal: "300.00" },
    });
    const mine2 = salesInvoice({
      id: "inv-2",
      docNo: "INV-000011",
      customerId: "cust-1",
      status: "confirmed",
      amountPaid: "0.000000",
      totals: { ...salesInvoice().totals, grandTotal: "150.50" },
    });
    const awaitingApproval = salesInvoice({
      id: "inv-3",
      docNo: "INV-000012",
      customerId: "cust-1",
      status: "pending",
      totals: { ...salesInvoice().totals, grandTotal: "1000.00" },
    });
    const other = salesInvoice({ id: "inv-9", docNo: "INV-999999", customerId: "cust-2", status: "confirmed" });
    renderScreen([customer(), inactiveCustomer], { invoices: [mine1, mine2, awaitingApproval, other] });
    fireEvent.click(await screen.findByText("شركة الأمل للتجارة"));
    fireEvent.click(screen.getByRole("tab", { name: "الفواتير" }));

    expect(await screen.findByText("INV-000010")).toBeInTheDocument();
    expect(screen.getByText("INV-000011")).toBeInTheDocument();
    expect(screen.queryByText("INV-999999")).not.toBeInTheDocument();

    expect(screen.getByText("INV-000012")).toBeInTheDocument();
    expect(screen.getByText("عدد الفواتير").nextElementSibling?.textContent).toBe("3");
    // An invoice still awaiting approval is listed but is not سارية, so neither its count nor its total joins them.
    expect(screen.getByText("فواتير سارية").nextElementSibling?.textContent).toBe("2");
    expect(screen.getByText("إجمالي الفواتير السارية").nextElementSibling?.textContent).toBe("450.50");
    // "المحصّل" also labels a table column header — the MiniStat is the first occurrence.
    expect(screen.getAllByText("المحصّل")[0]?.nextElementSibling?.textContent).toBe("100.00");
  });

  it("recovers the invoices tab via retry after its request fails once", async () => {
    let calls = 0;
    const scopedPaths: string[] = [];
    const transport = stubTransport({
      "GET /customers": () => ({ body: [customer()] }),
      "GET /customers/counts": () => ({ body: { all: 1, active: 1, inactive: 0 } }),
      "GET /customers/stats": () => ({ body: { count: 1, active: 1, creditLimits: "0", toCollect: "0" } }),
      "GET /price-lists": () => ({ body: [] }),
      "GET /sales-invoices": (_init, path) => {
        const customerId = new URL(path, "http://test").searchParams.get("customerId");
        if (!customerId) return { body: [] };
        scopedPaths.push(path);
        calls += 1;
        if (calls === 1) return { status: 500, body: { error: "INTERNAL" } };
        return { body: [salesInvoice({ id: "inv-1", docNo: "INV-000010", customerId: "cust-1", status: "confirmed" })] };
      },
      ...invoiceSummaryHandlers(() => [salesInvoice({ id: "inv-1", docNo: "INV-000010", customerId: "cust-1", status: "confirmed" })]),
      "GET /sales-returns": () => ({ body: [] }),
      "GET /vouchers": () => ({ body: [] }),
      "GET /cheques": () => ({ body: [] }),
      "GET /installments/plans": () => ({ body: [] }),
      "GET /audit": () => ({ body: [] }),
      "GET /attachments": () => ({ body: [] }),
      "GET /reports/aging/customers": () => ({ body: { rows: [], groups: [], grandTotals: {}, reconciliation: null } }),
    });
    renderWithProviders(<CustomersScreen />, { transport, initialSession: testAdminSession });
    fireEvent.click(await screen.findByText("شركة الأمل للتجارة"));
    fireEvent.click(screen.getByRole("tab", { name: "الفواتير" }));

    expect(await screen.findByText("تعذّر تحميل فواتير العميل.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "إعادة المحاولة" }));
    // Retry must actually re-fire the request, not just clear the banner —
    // a retry button that only reset local state would leave this blank forever.
    expect(await screen.findByText("INV-000010")).toBeInTheDocument();
    // One page of the customer's invoices, newest number first — never the whole set.
    const params = new URL(scopedPaths.at(-1)!, "http://test").searchParams;
    expect(params.get("page")).toBe("1");
    expect(params.get("pageSize")).toBe("25");
    expect(params.get("sort")).toBe("docNo");
    expect(params.get("sortDir")).toBe("desc");
  });

  it("scopes the installments tab to this customer's own plan lines, summing only their amount", async () => {
    const plan = installmentPlanDoc({
      id: "ip-1",
      date: "2026-07-01",
      status: "confirmed",
      lines: [installmentLine({ customerId: "cust-1", amount: "200.00" }), installmentLine({ customerId: "cust-2", amount: "9999.00" })],
    });
    renderScreen([customer(), inactiveCustomer], { installmentPlans: [plan] });
    fireEvent.click(await screen.findByText("شركة الأمل للتجارة"));
    fireEvent.click(screen.getByRole("tab", { name: "التقسيط" }));

    const row = (await screen.findByText("2026-07-01")).closest("tr")!;
    // Only cust-1's own line (200.00) may contribute — cust-2's 9999.00 must not leak in.
    expect(within(row).getByText("200.00")).toBeInTheDocument();
    expect(within(row).queryByText(/9,?999\.00/)).not.toBeInTheDocument();
  });

  it("shows the installments tab's own empty message rather than an error, when this customer has no plans", async () => {
    const plan = installmentPlanDoc({ lines: [installmentLine({ customerId: "cust-2" })] });
    renderScreen([customer(), inactiveCustomer], { installmentPlans: [plan] });
    fireEvent.click(await screen.findByText("شركة الأمل للتجارة"));
    fireEvent.click(screen.getByRole("tab", { name: "التقسيط" }));

    expect(await screen.findByText("لا توجد خطط تقسيط لهذا العميل")).toBeInTheDocument();
    // The invoices/installments/returns tabs share one error message key —
    // its absence here proves the empty state isn't an error banner in disguise (D123-shaped bug).
    expect(screen.queryByText("تعذّر تحميل فواتير العميل.")).not.toBeInTheDocument();
  });

  it("scopes the returns tab to this customer's own return lines and computes qty × price + tax", async () => {
    const ret = salesReturnDoc({
      id: "sr-1",
      date: "2026-08-05",
      status: "confirmed",
      lines: [
        salesReturnLine({ customerId: "cust-1", qty: "2", unitPrice: "100.00", taxAmount: "28.00" }),
        salesReturnLine({ customerId: "cust-2", qty: "5", unitPrice: "1000.00", taxAmount: "700.00" }),
      ],
    });
    renderScreen([customer(), inactiveCustomer], { returns: [ret] });
    fireEvent.click(await screen.findByText("شركة الأمل للتجارة"));
    fireEvent.click(screen.getByRole("tab", { name: "المرتجعات" }));

    const row = (await screen.findByText("2026-08-05")).closest("tr")!;
    // What the customer's own line took off their receivable: 2 × 100.00 +
    // 28.00 tax = 228.00; the cust-2 line must not leak in.
    expect(within(row).getByText("228.00")).toBeInTheDocument();
  });

  it("shows this customer's own audit events, actor and action", async () => {
    renderScreen([customer(), inactiveCustomer], {
      auditEventsByCustomer: {
        "cust-1": [auditEvent({ action: "UPDATE_CUSTOMER", actor: "سارة عبد الله", timestamp: "2026-08-15T10:00:00.000Z" })],
      },
    });
    fireEvent.click(await screen.findByText("شركة الأمل للتجارة"));
    fireEvent.click(screen.getByRole("tab", { name: "سجل التدقيق" }));

    expect(await screen.findByText("UPDATE_CUSTOMER")).toBeInTheDocument();
    expect(screen.getByText("سارة عبد الله")).toBeInTheDocument();
  });

  it("shows an error banner with a retry action in the audit tab when the trail fails to load", async () => {
    renderScreen([customer(), inactiveCustomer], { failAudit: true });
    fireEvent.click(await screen.findByText("شركة الأمل للتجارة"));
    fireEvent.click(screen.getByRole("tab", { name: "سجل التدقيق" }));

    expect(await screen.findByText("تعذّر تحميل سجل المراجعة. (رمز 500)")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "إعادة المحاولة" })).toBeInTheDocument();
  });

  it("shows the 'save first' message for the logo field on a new customer, inside the collapsed advanced section", async () => {
    renderScreen();
    await screen.findByText("شركة الأمل للتجارة");
    fireEvent.click(screen.getByRole("button", { name: "إضافة عميل" }));
    const dialog = screen.getByRole("dialog", { name: "إضافة عميل" });
    const toggle = within(dialog).getByRole("button", { name: "خيارات متقدمة" });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(within(dialog).getByText("احفظ العميل أولاً، ثم ارفع الشعار من تبويب المرفقات واختره هنا.")).toBeInTheDocument();
  });

  it("shows the 'no images' message for the logo field when the edited customer has no image attachments", async () => {
    renderScreen([customer(), inactiveCustomer], { attachmentsByCustomer: { "cust-1": [] } });
    fireEvent.click(await screen.findByText("شركة الأمل للتجارة"));
    fireEvent.click(screen.getByRole("button", { name: "تعديل" }));
    const dialog = screen.getByRole("dialog", { name: "تعديل عميل" });
    fireEvent.click(within(dialog).getByRole("button", { name: "خيارات متقدمة" }));
    expect(await within(dialog).findByText("لا توجد صور مرفقة بهذا العميل — ارفع صورة من تبويب المرفقات أولاً.")).toBeInTheDocument();
  });

  it("binds the logo field to the attachment's real id, sent as logoAttachmentId in the PATCH body", async () => {
    const patchRequests: Array<{ id: string; patch: Record<string, unknown> }> = [];
    renderScreen([customer(), inactiveCustomer], {
      patchRequests,
      attachmentsByCustomer: { "cust-1": [attachment({ id: "att-logo-1", fileName: "شعار.png", mimeType: "image/png" })] },
    });
    fireEvent.click(await screen.findByText("شركة الأمل للتجارة"));
    fireEvent.click(screen.getByRole("button", { name: "تعديل" }));
    const dialog = screen.getByRole("dialog", { name: "تعديل عميل" });
    fireEvent.click(within(dialog).getByRole("button", { name: "خيارات متقدمة" }));
    await within(dialog).findByLabelText("الشعار");
    selectOption(within(dialog).getByLabelText("الشعار"), "شعار.png");
    fireEvent.click(within(dialog).getByRole("button", { name: "حفظ التعديلات" }));

    await waitFor(() => expect(patchRequests).toHaveLength(1));
    expect(patchRequests[0]?.patch.logoAttachmentId).toBe("att-logo-1");
  });

  it("narrows the list to over-limit customers only when the filter chip is toggled, and restores on toggle-off", async () => {
    const customersRequests: string[] = [];
    renderScreen([customer(), inactiveCustomer], { customersRequests, overLimitIds: new Set(["cust-1"]) });
    await screen.findByText("شركة الأمل للتجارة");
    await screen.findByText("مصنع الوادي الأخضر");
    customersRequests.length = 0;

    fireEvent.click(screen.getByRole("button", { name: "تجاوزوا حد الائتمان" }));
    await waitFor(() => {
      expect(screen.queryByText("مصنع الوادي الأخضر")).not.toBeInTheDocument();
      expect(screen.getByText("شركة الأمل للتجارة")).toBeInTheDocument();
    });
    expect(customersRequests.some((p) => new URL(p, "http://x").searchParams.get("overLimit") === "true")).toBe(true);

    fireEvent.click(screen.getByRole("button", { name: "تجاوزوا حد الائتمان" }));
    await waitFor(() => expect(screen.getByText("مصنع الوادي الأخضر")).toBeInTheDocument());
  });

  it("narrows the list by search text, removing the non-matching customer", async () => {
    const customersRequests: string[] = [];
    renderScreen([customer(), inactiveCustomer], { customersRequests });
    await screen.findByText("شركة الأمل للتجارة");
    customersRequests.length = 0;

    fireEvent.change(screen.getByPlaceholderText("بحث بالاسم أو الكود أو الهاتف…"), { target: { value: "الأمل" } });
    await waitFor(() => {
      expect(screen.queryByText("مصنع الوادي الأخضر")).not.toBeInTheDocument();
      expect(screen.getByText("شركة الأمل للتجارة")).toBeInTheDocument();
    });
    expect(customersRequests.some((p) => new URL(p, "http://x").searchParams.get("q") === "الأمل")).toBe(true);
  });

  it("paginates by real page size, and changing the page size resets to page 1", async () => {
    const c1 = customer({ id: "cust-1", code: "C000001", nameAr: "شركة الأمل للتجارة" });
    const c2 = customer({ id: "cust-2", code: "C000002", nameAr: "مصنع الوادي الأخضر" });
    const c3 = customer({ id: "cust-3", code: "C000003", nameAr: "متجر النخبة للأدوات" });
    renderScreen([c1, c2, c3], { route: "/?size=2" });
    await screen.findByText("شركة الأمل للتجارة");
    expect(screen.getByText("مصنع الوادي الأخضر")).toBeInTheDocument();
    expect(screen.queryByText("متجر النخبة للأدوات")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "2" }));
    await waitFor(() => expect(screen.getByText("متجر النخبة للأدوات")).toBeInTheDocument());
    expect(screen.queryByText("شركة الأمل للتجارة")).not.toBeInTheDocument();

    selectOption(screen.getByLabelText("صفوف لكل صفحة"), "10");
    await waitFor(() => {
      expect(screen.getByText("شركة الأمل للتجارة")).toBeInTheDocument();
      expect(screen.getByText("مصنع الوادي الأخضر")).toBeInTheDocument();
      expect(screen.getByText("متجر النخبة للأدوات")).toBeInTheDocument();
    });
  });

  it("recovers a bookmarked out-of-range page back to page 1 instead of showing an empty list forever", async () => {
    renderScreen([customer(), inactiveCustomer], { route: "/?page=5" });
    // With 2 customers and the default page size, page 5 doesn't exist — if the
    // recovery effect were missing, `pageRows` would stay permanently empty.
    await waitFor(() => expect(screen.getByText("شركة الأمل للتجارة")).toBeInTheDocument());
  });

  it("shows a negative, danger-toned credit-remaining figure when what the customer owes passes their limit", async () => {
    const cust = customer({ id: "cust-1", openingBalance: "0.00", creditLimit: "1000.00", owed: "1200.000000" });
    renderScreen([cust, inactiveCustomer]);
    fireEvent.click(await screen.findByText("شركة الأمل للتجارة"));

    const label = screen.getByText("متبقي من الحد");
    const valueDiv = label.nextElementSibling as HTMLElement;
    expect(valueDiv.className).toContain("text-danger-ink");
    expect(valueDiv.querySelector(".mz-num")?.textContent).toBe("-200.00");
  });

  it("shows a positive, default-toned credit-remaining figure when the customer is within their limit", async () => {
    const cust = customer({ id: "cust-1", openingBalance: "0.00", creditLimit: "1000.00", owed: "300.000000" });
    renderScreen([cust, inactiveCustomer]);
    fireEvent.click(await screen.findByText("شركة الأمل للتجارة"));

    const label = screen.getByText("متبقي من الحد");
    const valueDiv = label.nextElementSibling as HTMLElement;
    expect(valueDiv.className).not.toContain("text-danger-ink");
    expect(valueDiv.querySelector(".mz-num")?.textContent).toBe("700.00");
  });

  it("leaves a blank customer code for the server to allocate", async () => {
    let created: Record<string, unknown> | undefined;
    renderScreen([customer(), inactiveCustomer], {
      onCreateCustomer: (body) => {
        created = body;
        return undefined;
      },
    });
    await screen.findByText("شركة الأمل للتجارة");
    fireEvent.click(screen.getByRole("button", { name: "إضافة عميل" }));
    const dialog = screen.getByRole("dialog", { name: "إضافة عميل" });
    fireEvent.change(textFieldInput(dialog, "اسم العميل *"), { target: { value: "عميل بلا كود" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "إضافة عميل" }));

    await waitFor(() => expect(created).toBeDefined());
    expect(created).not.toHaveProperty("code");
  });

  it("preserves an explicit customer code instead of auto-generating one", async () => {
    let created: Record<string, unknown> | undefined;
    renderScreen([customer(), inactiveCustomer], {
      onCreateCustomer: (body) => {
        created = body;
        return undefined;
      },
    });
    await screen.findByText("شركة الأمل للتجارة");
    fireEvent.click(screen.getByRole("button", { name: "إضافة عميل" }));
    const dialog = screen.getByRole("dialog", { name: "إضافة عميل" });
    fireEvent.change(textFieldInput(dialog, "اسم العميل *"), { target: { value: "عميل بكود صريح" } });
    fireEvent.change(textFieldInput(dialog, "الكود"), { target: { value: "VIP-01" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "إضافة عميل" }));

    await waitFor(() => expect(created).toBeDefined());
    expect(created?.code).toBe("VIP-01");
  });

  it("defaults the currency to EGP when the field is cleared before saving", async () => {
    let created: Record<string, unknown> | undefined;
    renderScreen([customer(), inactiveCustomer], {
      onCreateCustomer: (body) => {
        created = body;
        return undefined;
      },
    });
    await screen.findByText("شركة الأمل للتجارة");
    fireEvent.click(screen.getByRole("button", { name: "إضافة عميل" }));
    const dialog = screen.getByRole("dialog", { name: "إضافة عميل" });
    fireEvent.change(textFieldInput(dialog, "اسم العميل *"), { target: { value: "عميل بلا عملة" } });
    fireEvent.change(textFieldInput(dialog, "العملة"), { target: { value: "" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "إضافة عميل" }));

    await waitFor(() => expect(created).toBeDefined());
    expect(created?.currency).toBe("EGP");
  });

  it("sends every basic and advanced field the user filled in, exactly as typed", async () => {
    let created: Record<string, unknown> | undefined;
    renderScreen([customer(), inactiveCustomer], {
      onCreateCustomer: (body) => {
        created = body;
        return undefined;
      },
    });
    await screen.findByText("شركة الأمل للتجارة");
    fireEvent.click(screen.getByRole("button", { name: "إضافة عميل" }));
    const dialog = screen.getByRole("dialog", { name: "إضافة عميل" });

    fireEvent.change(textFieldInput(dialog, "اسم العميل *"), { target: { value: "متجر النور" } });
    fireEvent.change(textFieldInput(dialog, "الاسم بالإنجليزي"), { target: { value: "Al Noor Store" } });
    fireEvent.change(textFieldInput(dialog, "شروط الدفع (أيام)"), { target: { value: "45" } });
    fireEvent.change(textFieldInput(dialog, "التصنيف"), { target: { value: "جملة" } });
    fireEvent.change(textFieldInput(dialog, "البريد الإلكتروني"), { target: { value: "sales@alnoor.example" } });

    fireEvent.click(within(dialog).getByRole("button", { name: "خيارات متقدمة" }));
    fireEvent.change(textFieldInput(dialog, "الرقم الضريبي"), { target: { value: "300999888700003" } });
    fireEvent.change(textFieldInput(dialog, "رقم السجل التجاري"), { target: { value: "CR-055012" } });
    fireEvent.click(within(dialog).getByRole("switch", { name: "إعفاء ضريبي" }));
    selectOption(within(dialog).getByLabelText("نوع المشتري (ETA)"), "فرد");
    fireEvent.change(textFieldInput(dialog, "الرقم القومي"), { target: { value: "29001011234567" } });
    fireEvent.change(textFieldInput(dialog, "جهة الاتصال"), { target: { value: "كريم حسن" } });
    fireEvent.change(textFieldInput(dialog, "العنوان"), { target: { value: "شارع الجمهورية، المنصورة" } });
    fireEvent.change(textFieldInput(dialog, "ملاحظات"), { target: { value: "عميل جديد من معرض القاهرة" } });

    fireEvent.click(within(dialog).getByRole("button", { name: "إضافة عميل" }));

    await waitFor(() => expect(created).toBeDefined());
    expect(created).toMatchObject({
      nameAr: "متجر النور",
      nameEn: "Al Noor Store",
      paymentTermsDays: 45,
      category: "جملة",
      email: "sales@alnoor.example",
      taxNumber: "300999888700003",
      commercialRegistrationNumber: "CR-055012",
      taxExempt: true,
      taxExemptionRateId: null,
      etaBuyerType: "individual",
      nationalId: "29001011234567",
      contactPerson: "كريم حسن",
      address: "شارع الجمهورية، المنصورة",
      notes: "عميل جديد من معرض القاهرة",
    });
  });

  it("closes the panel without saving when cancel is clicked, and again via the panel's own close button", async () => {
    const customersRequests: string[] = [];
    renderScreen([customer(), inactiveCustomer], { customersRequests });
    await screen.findByText("شركة الأمل للتجارة");
    fireEvent.click(screen.getByRole("button", { name: "إضافة عميل" }));
    let dialog = screen.getByRole("dialog", { name: "إضافة عميل" });
    fireEvent.change(textFieldInput(dialog, "اسم العميل *"), { target: { value: "عميل ملغى" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "إلغاء" }));
    expect(screen.queryByRole("dialog", { name: "إضافة عميل" })).not.toBeInTheDocument();
    expect(screen.queryByText("عميل ملغى")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "إضافة عميل" }));
    dialog = screen.getByRole("dialog", { name: "إضافة عميل" });
    fireEvent.click(within(dialog).getByRole("button", { name: "إغلاق اللوحة" }));
    expect(screen.queryByRole("dialog", { name: "إضافة عميل" })).not.toBeInTheDocument();
  });

  it("edits the credit limit and the active toggle from the edit form, sending both in the PATCH body", async () => {
    const patchRequests: Array<{ id: string; patch: Record<string, unknown> }> = [];
    renderScreen([customer(), inactiveCustomer], { patchRequests });
    fireEvent.click(await screen.findByText("شركة الأمل للتجارة"));
    fireEvent.click(screen.getByRole("button", { name: "تعديل" }));
    const dialog = screen.getByRole("dialog", { name: "تعديل عميل" });

    fireEvent.change(textFieldInput(dialog, "الحد الائتماني"), { target: { value: "25000" } });
    fireEvent.click(within(dialog).getByRole("switch", { name: "نشط" }));
    fireEvent.click(within(dialog).getByRole("button", { name: "حفظ التعديلات" }));

    await waitFor(() => expect(patchRequests).toHaveLength(1));
    expect(patchRequests[0]?.patch.creditLimit).toBe("25000");
    expect(patchRequests[0]?.patch.active).toBe(false);
  });

  it("opens the customer file and the edit form from the row menu's own view/edit actions", async () => {
    renderScreen();
    await screen.findByText("شركة الأمل للتجارة");
    fireEvent.click(screen.getByRole("button", { name: "إجراءات شركة الأمل للتجارة" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "عرض ملف العميل" }));
    expect(screen.getByRole("heading", { name: /شركة الأمل للتجارة/ })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "رجوع لقائمة العملاء" }));
    fireEvent.click(screen.getByRole("button", { name: "إجراءات شركة الأمل للتجارة" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "تعديل البيانات" }));
    expect(screen.getByRole("dialog", { name: "تعديل عميل" })).toBeInTheDocument();
  });

  function retryTransport(overrides: {
    installments?: () => { status?: number; body: unknown };
    returns?: () => { status?: number; body: unknown };
    vouchers?: () => { status?: number; body: unknown };
  }) {
    return stubTransport({
      "GET /customers": () => ({ body: [customer()] }),
      "GET /customers/counts": () => ({ body: { all: 1, active: 1, inactive: 0 } }),
      "GET /customers/stats": () => ({ body: { count: 1, active: 1, creditLimits: "0", toCollect: "0" } }),
      "GET /price-lists": () => ({ body: [] }),
      "GET /sales-invoices": () => ({ body: [] }),
      "GET /cheques": () => ({ body: [] }),
      "GET /installments/plans": () => overrides.installments?.() ?? { body: [] },
      "GET /sales-returns": () => overrides.returns?.() ?? { body: [] },
      "GET /vouchers": () => overrides.vouchers?.() ?? { body: [] },
      "GET /reports/aging/customers": () => ({ body: { rows: [], groups: [], grandTotals: {}, reconciliation: null } }),
      "GET /audit": () => ({ body: [] }),
      "GET /attachments": () => ({ body: [] }),
    });
  }

  it("recovers the installments tab via retry after its request fails once", async () => {
    let calls = 0;
    const transport = retryTransport({
      installments: () => {
        calls += 1;
        if (calls === 1) return { status: 500, body: { error: "INTERNAL" } };
        return { body: [installmentPlanDoc({ lines: [installmentLine({ customerId: "cust-1", amount: "500.00" })] })] };
      },
    });
    renderWithProviders(<CustomersScreen />, { transport, initialSession: testAdminSession });
    fireEvent.click(await screen.findByText("شركة الأمل للتجارة"));
    fireEvent.click(screen.getByRole("tab", { name: "التقسيط" }));

    expect(await screen.findByText("تعذّر تحميل فواتير العميل.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "إعادة المحاولة" }));
    expect(await screen.findByText("500.00")).toBeInTheDocument();
  });

  it("recovers the returns tab via retry after its request fails once", async () => {
    let calls = 0;
    const transport = retryTransport({
      returns: () => {
        calls += 1;
        if (calls === 1) return { status: 500, body: { error: "INTERNAL" } };
        return { body: [salesReturnDoc({ status: "confirmed", lines: [salesReturnLine({ customerId: "cust-1" })] })] };
      },
    });
    renderWithProviders(<CustomersScreen />, { transport, initialSession: testAdminSession });
    fireEvent.click(await screen.findByText("شركة الأمل للتجارة"));
    fireEvent.click(screen.getByRole("tab", { name: "المرتجعات" }));

    expect(await screen.findByText("تعذّر تحميل فواتير العميل.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "إعادة المحاولة" }));
    // The returns tab has no docNo column — its rows are keyed by date/status/amount.
    expect(await screen.findByText("2026-08-05")).toBeInTheDocument();
  });

  it("shows the server's statement in base currency: debits, credits and the closing it sends (D200–D205)", async () => {
    renderScreen([customer({ id: "cust-1" })], {
      statement: (id) => ({
        body: statementOf(id, [
          { kind: "opening", reference: "", increase: "450.000000", decrease: "0.000000" },
          { kind: "invoice", reference: "INV-000001", increase: "4800.000000", decrease: "0.000000" },
          { kind: "receipt", reference: "CV-000001", increase: "0.000000", decrease: "500.000000", allocations: [{ invoiceRef: "INV-000001", amount: "300.000000" }] },
          { kind: "journal", reference: "JE-000007", increase: "1140.000000", decrease: "0.000000" },
        ]),
      }),
    });
    fireEvent.click(await screen.findByText("شركة الأمل للتجارة"));
    fireEvent.click(screen.getByRole("tab", { name: "كشف حساب" }));

    expect((await screen.findByText("إجمالي المدين")).nextElementSibling?.textContent).toBe("6,390.00");
    expect(screen.getByText("إجمالي الدائن").nextElementSibling?.textContent).toBe("500.00");
    expect(screen.getByText("الرصيد الختامي").nextElementSibling?.textContent).toBe("5,890.00");
    expect(screen.getByText("قيد يومية")).toBeInTheDocument();
    expect(screen.getByText("مخصص على الفاتورة INV-000001")).toBeInTheDocument();
    expect(screen.getByText("غير مخصص على فاتورة — تحت حساب العميل")).toBeInTheDocument();
    expect(screen.getByText("مطابق لتقرير أعمار الديون")).toBeInTheDocument();
  });

  it("shows a bounced cheque as received and then returned (D192)", async () => {
    renderScreen([customer({ id: "cust-1" })], {
      statement: (id) => ({
        body: statementOf(id, [
          { kind: "cheque", reference: "CHQ-1", increase: "0.000000", decrease: "1750.000000" },
          { kind: "cheque_returned", reference: "CHQ-1", increase: "1750.000000", decrease: "0.000000" },
        ]),
      }),
    });
    fireEvent.click(await screen.findByText("شركة الأمل للتجارة"));
    fireEvent.click(screen.getByRole("tab", { name: "كشف حساب" }));

    expect(await screen.findByText("ارتداد شيك")).toBeInTheDocument();
    expect(screen.getByText("شيك وارد")).toBeInTheDocument();
    expect(screen.getByText("الرصيد الختامي").nextElementSibling?.textContent).toBe("0.00");
  });

  it("says the statement differs from the aging report when the server's two figures disagree", async () => {
    renderScreen([customer({ id: "cust-1" })], {
      statement: (id) => ({ body: statementOf(id, [{ kind: "invoice", reference: "INV-1", increase: "500.000000", decrease: "0.000000" }], "350.000000") }),
    });
    fireEvent.click(await screen.findByText("شركة الأمل للتجارة"));
    fireEvent.click(screen.getByRole("tab", { name: "كشف حساب" }));

    expect(await screen.findByText("يختلف عن تقرير أعمار الديون")).toBeInTheDocument();
  });

  it("prints the server's caveat above a branch-filtered statement whose balance carries unattributed postings", async () => {
    renderScreen([customer({ id: "cust-1" })], {
      statement: (id) => ({
        body: {
          ...statementOf(id, [{ kind: "opening", reference: "", increase: "250.000000", decrease: "0.000000" }]),
          branchCaveat: {
            code: BranchCaveatCodeDTO.IncludesUnattributed,
            message: "العرض مقيَّد بفروعك، لكن الرصيد يشمل حركات غير مخصصة لفرع.",
            messageEn: "Limited to your branches, but the balance includes unattributed postings.",
            unattributedNet: "250.000000",
          },
        },
      }),
    });
    fireEvent.click(await screen.findByText("شركة الأمل للتجارة"));
    fireEvent.click(screen.getByRole("tab", { name: "كشف حساب" }));

    const note = await screen.findByRole("note");
    expect(note).toHaveTextContent("العرض مقيَّد بفروعك، لكن الرصيد يشمل حركات غير مخصصة لفرع.");
    expect(note).toHaveTextContent("صافي غير المخصص ضمن الرصيد: 250.00");
  });

  it("prints no caveat when the server sends none", async () => {
    renderScreen([customer({ id: "cust-1" })], {
      statement: (id) => ({ body: statementOf(id, [{ kind: "opening", reference: "", increase: "250.000000", decrease: "0.000000" }]) }),
    });
    fireEvent.click(await screen.findByText("شركة الأمل للتجارة"));
    fireEvent.click(screen.getByRole("tab", { name: "كشف حساب" }));

    expect(await screen.findByText("الرصيد الختامي")).toBeInTheDocument();
    expect(screen.queryByRole("note")).not.toBeInTheDocument();
  });

  it("recovers the statement tab via retry after its request fails once", async () => {
    let calls = 0;
    renderScreen([customer({ id: "cust-1" })], {
      statement: (id) => {
        calls += 1;
        if (calls === 1) return { status: 500, body: { error: "INTERNAL" } };
        return { body: statementOf(id, [{ kind: "opening", reference: "", increase: "10.000000", decrease: "0.000000" }]) };
      },
    });
    fireEvent.click(await screen.findByText("شركة الأمل للتجارة"));
    fireEvent.click(screen.getByRole("tab", { name: "كشف حساب" }));

    expect(await screen.findByText("تعذّر تحميل حركة حساب العميل.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "إعادة المحاولة" }));
    expect((await screen.findAllByText("رصيد افتتاحي")).length).toBe(2);
  });

  describe("ضريبة الإعفاء — the 0% rate an exempt customer's lines are filed under (D79)", () => {
    const taxRate = (overrides: Partial<TaxRateDTO>): TaxRateDTO => ({
      id: "VAT14", code: "VAT14", name: "ضريبة القيمة المضافة", rate: 14, calculationType: "exclusive", isDefault: true,
      outputTaxAccountId: null, inputTaxAccountId: null, etaSubType: "auto", status: "active", isSystem: false, ...overrides,
    });
    const taxRates = [
      taxRate({}),
      taxRate({ id: "VAT-EXEMPT", code: "VAT-EXEMPT", name: "معفى من الضريبة", rate: 0, isDefault: false, etaSubType: "V003" }),
      taxRate({ id: "VAT-EXPORT", code: "VAT-EXPORT", name: "تصدير — نسبة صفر", rate: 0, isDefault: false, etaSubType: "V001" }),
      taxRate({ id: "OLD-ZERO", code: "OLD-ZERO", name: "صفر قديمة", rate: 0, isDefault: false, etaSubType: "V003", status: "inactive" }),
      taxRate({ id: "SYS-NOT-SUBJECT", code: "SYS-NOT-SUBJECT", name: "غير خاضع", rate: 0, isDefault: false, etaSubType: "V004", isSystem: true }),
    ];

    async function openAdvanced() {
      await screen.findByText("شركة الأمل للتجارة");
      fireEvent.click(screen.getByRole("button", { name: "إضافة عميل" }));
      const dialog = screen.getByRole("dialog", { name: "إضافة عميل" });
      fireEvent.change(textFieldInput(dialog, "اسم العميل *"), { target: { value: "جهة معفاة" } });
      fireEvent.click(within(dialog).getByRole("button", { name: "خيارات متقدمة" }));
      return dialog;
    }

    it("offers the picker only for an exempt customer, over the tenant's ACTIVE 0% rates, and sends the picked rate's real id", async () => {
      let created: Record<string, unknown> | undefined;
      renderScreen([customer()], { taxRates, onCreateCustomer: (body) => { created = body; return undefined; } });
      const dialog = await openAdvanced();
      expect(within(dialog).queryByLabelText("ضريبة الإعفاء")).toBeNull();

      fireEvent.click(within(dialog).getByRole("switch", { name: "إعفاء ضريبي" }));
      fireEvent.click(within(dialog).getByLabelText("ضريبة الإعفاء"));
      const offered = screen.getAllByRole("option").map((option) => option.textContent);
      expect(offered).toEqual(["بدون — تُصنَّف بنود فواتيره يدوياً", "معفى من الضريبة", "تصدير — نسبة صفر"]);
      fireEvent.mouseDown(screen.getByRole("option", { name: "تصدير — نسبة صفر" }));

      fireEvent.click(within(dialog).getByRole("button", { name: "إضافة عميل" }));
      await waitFor(() => expect(created).toBeDefined());
      expect(created).toMatchObject({ taxExempt: true, taxExemptionRateId: "VAT-EXPORT" });
    });

    it("drops the picked rate when the exemption is switched back off", async () => {
      let created: Record<string, unknown> | undefined;
      renderScreen([customer()], { taxRates, onCreateCustomer: (body) => { created = body; return undefined; } });
      const dialog = await openAdvanced();
      const exempt = within(dialog).getByRole("switch", { name: "إعفاء ضريبي" });
      fireEvent.click(exempt);
      selectOption(within(dialog).getByLabelText("ضريبة الإعفاء"), "معفى من الضريبة");
      fireEvent.click(exempt);

      fireEvent.click(within(dialog).getByRole("button", { name: "إضافة عميل" }));
      await waitFor(() => expect(created).toBeDefined());
      expect(created).toMatchObject({ taxExempt: false, taxExemptionRateId: null });
    });
  });
});
