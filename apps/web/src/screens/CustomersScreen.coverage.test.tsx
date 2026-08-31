// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, expect, it } from "vitest";
import { screen, fireEvent, within, waitFor } from "@testing-library/react";
import type {
  CustomerDTO,
  PriceListDTO,
  SalesReturnDocumentDTO,
  SalesReturnLineDTO,
} from "@mezan/contracts";
import type { VoucherRowDTO, SalesInvoiceDTO } from "../data/hooks";
import { CustomersScreen } from "./CustomersScreen";
import { renderWithProviders, stubTransport, testAdminSession } from "../data/test-support";

function selectOption(trigger: HTMLElement, optionLabel: string) {
  fireEvent.click(trigger);
  fireEvent.mouseDown(screen.getByRole("option", { name: optionLabel }));
}

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
    lines: [],
    totals: {
      grossTotal: "0.00",
      lineDiscountTotal: "0.00",
      promotionDiscountTotal: "0.00",
      invoiceDiscountTotal: "0.00",
      subtotal: "0.00",
      taxableTotal: "0.00",
      taxTotal: "0.00",
      grandTotal: "0.00",
    },
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
  return {
    id: "v-1",
    docNo: "CV-000001",
    voucherType: "customer_collection",
    direction: "receipt",
    status: "confirmed",
    date: "2026-08-10",
    memo: "",
    amount: "500.000000",
    currency: "EGP",
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
}

function voucherAllocation(overrides: Partial<import("@mezan/contracts").VoucherAllocationDTO> = {}): import("@mezan/contracts").VoucherAllocationDTO {
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

function renderScreen(
  customers: CustomerDTO[] = [customer()],
  opts: {
    priceLists?: PriceListDTO[];
    invoices?: SalesInvoiceDTO[];
    returns?: SalesReturnDocumentDTO[];
    vouchers?: VoucherRowDTO[];
    allocationsByVoucher?: Record<string, import("@mezan/contracts").VoucherAllocationDTO[]>;
    agingRows?: Array<Record<string, unknown>>;
    failAging?: boolean;
    failUnfilteredInvoices?: boolean;
    onCreateCustomer?: (body: Record<string, unknown>) => { status?: number; body: unknown } | undefined;
    patchRequests?: Array<{ id: string; patch: Record<string, unknown> }>;
    attachmentsByCustomer?: Record<string, import("@mezan/contracts").AttachmentDTO[]>;
  } = {},
) {
  let current = [...customers];
  const transport = stubTransport({
    "GET /customers": () => ({ body: current }),
    "GET /customers/counts": () => {
      const active = current.filter((c) => c.active).length;
      return { body: { all: current.length, active, inactive: current.length - active } };
    },
    "GET /customers/stats": () => ({
      body: { count: current.length, active: current.filter((c) => c.active).length, creditLimits: "0", toCollect: "0" },
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
    "GET /sales-invoices": (_init, path) => {
      const customerId = new URL(path, "http://test").searchParams.get("customerId");
      if (!customerId && opts.failUnfilteredInvoices) return { status: 500, body: { error: "INTERNAL" } };
      const all = opts.invoices ?? [];
      return { body: customerId ? all.filter((inv) => inv.customerId === customerId) : all };
    },
    "GET /sales-returns": () => ({ body: opts.returns ?? [] }),
    "GET /installments/plans": () => ({ body: [] }),
    "GET /vouchers": () => ({ body: opts.vouchers ?? [] }),
    "GET /vouchers/*/allocations": (_init, path) => {
      const voucherId = path.split("/")[2]!;
      return { body: { allocations: opts.allocationsByVoucher?.[voucherId] ?? [] } };
    },
    "GET /cheques": () => ({ body: [] }),
    "GET /audit": () => ({ body: [] }),
    "GET /attachments": (_init, path) => {
      const entityId = new URL(path, "http://test").searchParams.get("entityId") ?? "";
      return { body: opts.attachmentsByCustomer?.[entityId] ?? [] };
    },
    "GET /reports/aging/customers": () =>
      opts.failAging
        ? { status: 500, body: { error: "INTERNAL" } }
        : { body: { rows: opts.agingRows ?? [], groups: [], grandTotals: {}, reconciliation: null } },
  });
  return renderWithProviders(<CustomersScreen />, { transport, initialSession: testAdminSession });
}

describe("CustomersScreen — invoices tab branches", () => {
  it("shows the invoices tab's own empty message when this customer genuinely has no invoices", async () => {
    const other = salesInvoice({ id: "inv-other", customerId: "cust-9" });
    renderScreen([customer()], { invoices: [other] });
    fireEvent.click(await screen.findByText("شركة الأمل للتجارة"));
    fireEvent.click(screen.getByRole("tab", { name: "الفواتير" }));

    expect(await screen.findByText("لا توجد فواتير مبيعات مسجّلة لهذا العميل")).toBeInTheDocument();
  });

  it("orders two invoices on the same date by id when the dates tie", async () => {
    const a = salesInvoice({ id: "inv-b", docNo: "INV-B", date: "2026-08-01", customerId: "cust-1" });
    const b = salesInvoice({ id: "inv-a", docNo: "INV-A", date: "2026-08-01", customerId: "cust-1" });
    renderScreen([customer()], { invoices: [a, b] });
    fireEvent.click(await screen.findByText("شركة الأمل للتجارة"));
    fireEvent.click(screen.getByRole("tab", { name: "الفواتير" }));

    const rows = (await screen.findAllByRole("row")).slice(1);
    const firstDocNo = within(rows[0]!).getByText(/INV-/).textContent;
    expect(firstDocNo).toBe("INV-A");
  });

  it("shows a dash for an invoice with no document number in the invoices tab", async () => {
    const inv = salesInvoice({ id: "inv-1", docNo: null, customerId: "cust-1" });
    renderScreen([customer()], { invoices: [inv] });
    fireEvent.click(await screen.findByText("شركة الأمل للتجارة"));
    fireEvent.click(screen.getByRole("tab", { name: "الفواتير" }));

    const row = (await screen.findAllByRole("row"))[1]!;
    expect(within(row).getByText("—")).toBeInTheDocument();
  });
});

describe("CustomersScreen — statement tab branches", () => {
  it("shows the opening balance as a credit when it is negative", async () => {
    const cust = customer({ id: "cust-1", openingBalance: "-300.00" });
    renderScreen([cust]);
    fireEvent.click(await screen.findByText("شركة الأمل للتجارة"));
    fireEvent.click(screen.getByRole("tab", { name: "كشف حساب" }));

    const openingRow = (await screen.findByText("رصيد افتتاحي", { selector: "td" })).closest("tr")!;
    const cells = within(openingRow).getAllByRole("cell");
    // debit cell (index 3) reads "—"; credit cell (index 4) carries the 300.00.
    expect(cells[3]?.textContent).toBe("—");
    expect(cells[4]?.textContent).toBe("300.00");
  });

  it("skips a non-confirmed return and a return with no lines for this customer", async () => {
    const cust = customer({ id: "cust-1", openingBalance: "0.00" });
    const draftReturn = salesReturnDoc({ id: "sr-draft", status: "draft", date: "2026-08-02" });
    const othersReturn = salesReturnDoc({
      id: "sr-other",
      status: "confirmed",
      date: "2026-08-03",
      lines: [salesReturnLine({ customerId: "cust-9" })],
    });
    renderScreen([cust], { returns: [draftReturn, othersReturn] });
    fireEvent.click(await screen.findByText("شركة الأمل للتجارة"));
    fireEvent.click(screen.getByRole("tab", { name: "كشف حساب" }));

    await screen.findAllByText("رصيد افتتاحي");
    expect(screen.queryByText("مرتجع مبيعات")).not.toBeInTheDocument();
  });

  it("shows a return's own document number as the statement reference, falling back to its id when absent", async () => {
    const cust = customer({ id: "cust-1", openingBalance: "0.00" });
    const ret = salesReturnDoc({ id: "sr-1", docNo: null, status: "confirmed", date: "2026-08-06" });
    renderScreen([cust], { returns: [ret] });
    fireEvent.click(await screen.findByText("شركة الأمل للتجارة"));
    fireEvent.click(screen.getByRole("tab", { name: "كشف حساب" }));

    expect(await screen.findByText("sr-1")).toBeInTheDocument();
  });

  it("labels a disbursement voucher distinctly from a receipt, using its id when it has no document number", async () => {
    const cust = customer({ id: "cust-1", openingBalance: "0.00" });
    const disbursement = voucherRow({
      id: "v-2",
      docNo: null,
      direction: "payment",
      status: "confirmed",
      customerId: "cust-1",
      amount: "150.000000",
    });
    renderScreen([cust], { vouchers: [disbursement] });
    fireEvent.click(await screen.findByText("شركة الأمل للتجارة"));
    fireEvent.click(screen.getByRole("tab", { name: "كشف حساب" }));

    expect(await screen.findByText("سند صرف")).toBeInTheDocument();
    expect(screen.getByText("v-2")).toBeInTheDocument();
  });

  it("skips a transfer-direction voucher entirely in the statement ledger", async () => {
    const cust = customer({ id: "cust-1", openingBalance: "0.00" });
    const transfer = voucherRow({ id: "v-3", direction: "transfer", status: "confirmed", customerId: "cust-1", amount: "80.000000" });
    renderScreen([cust], { vouchers: [transfer] });
    fireEvent.click(await screen.findByText("شركة الأمل للتجارة"));
    fireEvent.click(screen.getByRole("tab", { name: "كشف حساب" }));

    await screen.findAllByText("رصيد افتتاحي");
    expect(screen.queryByText("v-3")).not.toBeInTheDocument();
  });

  it("puts an over-allocated receipt's excess on the credit side of the statement", async () => {
    const cust = customer({ id: "cust-1", openingBalance: "0.00" });
    const receipt = voucherRow({ id: "v-4", direction: "receipt", status: "confirmed", customerId: "cust-1", amount: "300.000000" });
    const alloc = voucherAllocation({ id: "alloc-over", voucherId: "v-4", invoiceId: "inv-1", amount: "500.000000", status: "active" });
    renderScreen([cust], { vouchers: [receipt], allocationsByVoucher: { "v-4": [alloc] } });
    fireEvent.click(await screen.findByText("شركة الأمل للتجارة"));
    fireEvent.click(screen.getByRole("tab", { name: "كشف حساب" }));

    const unallocatedNote = await screen.findByText("غير مخصص على فاتورة — تحت حساب العميل");
    const row = unallocatedNote.closest("tr")!;
    const cells = within(row).getAllByRole("cell");
    expect(cells[3]?.textContent).toBe("200.00");
    expect(cells[4]?.textContent).toBe("—");
  });

  it("resolves an allocation's invoice label from the invoice's own id when it has no document number", async () => {
    const cust = customer({ id: "cust-1", openingBalance: "0.00" });
    const inv = salesInvoice({ id: "inv-nodoc", docNo: null, customerId: "cust-1", status: "confirmed", totals: { ...salesInvoice().totals, grandTotal: "400.00" } });
    const receipt = voucherRow({ id: "v-5", direction: "receipt", status: "confirmed", customerId: "cust-1", amount: "400.000000" });
    const alloc = voucherAllocation({ id: "alloc-nodoc", voucherId: "v-5", invoiceId: "inv-nodoc", amount: "400.000000", status: "active" });
    renderScreen([cust], { invoices: [inv], vouchers: [receipt], allocationsByVoucher: { "v-5": [alloc] } });
    fireEvent.click(await screen.findByText("شركة الأمل للتجارة"));
    fireEvent.click(screen.getByRole("tab", { name: "كشف حساب" }));

    expect(await screen.findByText("مخصص على الفاتورة inv-nodoc")).toBeInTheDocument();
  });

  it("hides the aging-reconciliation banner (without erroring the whole tab) when only the aging report fails", async () => {
    const cust = customer({ id: "cust-1", openingBalance: "0.00" });
    renderScreen([cust], { failAging: true });
    fireEvent.click(await screen.findByText("شركة الأمل للتجارة"));
    fireEvent.click(screen.getByRole("tab", { name: "كشف حساب" }));

    await screen.findAllByText("رصيد افتتاحي");
    expect(screen.queryByText("مطابق لتقرير أعمار الديون")).not.toBeInTheDocument();
    expect(screen.queryByText("يختلف عن تقرير أعمار الديون")).not.toBeInTheDocument();
  });
});

describe("CustomersScreen — logo field branch", () => {
  it("clears the logo selection to null when 'no logo' is chosen after picking one", async () => {
    const patchRequests: Array<{ id: string; patch: Record<string, unknown> }> = [];
    renderScreen([customer()], {
      patchRequests,
      attachmentsByCustomer: { "cust-1": [{ id: "att-1", entityType: "customer", entityId: "cust-1", fileName: "logo.png", mimeType: "image/png", byteSize: 10, uploadedBy: "USER-ADMIN", uploadedAt: "2026-08-01T09:00:00.000Z", notes: null }] },
    });
    fireEvent.click(await screen.findByText("شركة الأمل للتجارة"));
    fireEvent.click(screen.getByRole("button", { name: "تعديل" }));
    const dialog = screen.getByRole("dialog", { name: "تعديل عميل" });
    fireEvent.click(within(dialog).getByRole("button", { name: "خيارات متقدمة" }));
    await within(dialog).findByLabelText("الشعار");
    selectOption(within(dialog).getByLabelText("الشعار"), "logo.png");
    selectOption(within(dialog).getByLabelText("الشعار"), "بلا شعار");
    fireEvent.click(within(dialog).getByRole("button", { name: "حفظ التعديلات" }));

    await waitFor(() => expect(patchRequests).toHaveLength(1));
    expect(patchRequests[0]?.patch.logoAttachmentId).toBeNull();
  });
});

describe("CustomersScreen — detail branches", () => {
  it("computes credit-remaining off zero owed when the unfiltered invoices request fails", async () => {
    const cust = customer({ id: "cust-1", creditLimit: "1000.00", openingBalance: "0.00" });
    renderScreen([cust], { failUnfilteredInvoices: true });
    fireEvent.click(await screen.findByText("شركة الأمل للتجارة"));

    const label = screen.getByText("متبقي من الحد");
    const valueDiv = label.nextElementSibling as HTMLElement;
    expect(valueDiv.querySelector(".mz-num")?.textContent).toBe("1,000.00");
  });

  it("shows no English subtitle in the detail header when the customer has none", async () => {
    const cust = customer({ id: "cust-1", nameEn: null });
    renderScreen([cust]);
    fireEvent.click(await screen.findByText("شركة الأمل للتجارة"));

    expect(screen.queryByText("Al Amal Trading Co.")).not.toBeInTheDocument();
  });

  it("shows every 'none' fallback on the overview tab for a customer with no optional fields filled in", async () => {
    const cust = customer({
      id: "cust-1",
      category: null,
      phone: null,
      email: null,
      contactPerson: null,
      taxNumber: null,
      commercialRegistrationNumber: null,
      address: null,
      nationalId: null,
      priceListId: null,
    });
    renderScreen([cust]);
    fireEvent.click(await screen.findByText("شركة الأمل للتجارة"));

    expect(screen.getAllByText("لا يوجد").length).toBeGreaterThanOrEqual(6);
    expect(screen.getByText("بدون تصنيف")).toBeInTheDocument();
    expect(screen.getByText("بدون قائمة أسعار")).toBeInTheDocument();
  });

  it("shows 'yes' for a tax-exempt customer on the overview tab", async () => {
    const cust = customer({ id: "cust-1", taxExempt: true });
    renderScreen([cust]);
    fireEvent.click(await screen.findByText("شركة الأمل للتجارة"));

    expect(screen.getByText("نعم")).toBeInTheDocument();
  });

  it("shows the notes card on the overview tab when the customer has notes", async () => {
    const cust = customer({ id: "cust-1", notes: "عميل مهم يحتاج متابعة" });
    renderScreen([cust]);
    fireEvent.click(await screen.findByText("شركة الأمل للتجارة"));

    expect(screen.getByText("عميل مهم يحتاج متابعة")).toBeInTheDocument();
  });

  it("shows blank optional fields in the edit form for a customer with none filled in", async () => {
    const cust = customer({
      id: "cust-1",
      nameEn: null,
      phone: null,
      email: null,
      contactPerson: null,
      taxNumber: null,
      category: null,
    });
    renderScreen([cust]);
    fireEvent.click(await screen.findByText("شركة الأمل للتجارة"));
    fireEvent.click(screen.getByRole("button", { name: "تعديل" }));
    const dialog = screen.getByRole("dialog", { name: "تعديل عميل" });

    expect(textFieldInput(dialog, "الاسم بالإنجليزي").value).toBe("");
    expect(textFieldInput(dialog, "الهاتف").value).toBe("");
    expect(textFieldInput(dialog, "البريد الإلكتروني").value).toBe("");
    expect(textFieldInput(dialog, "التصنيف").value).toBe("");
  });
});
