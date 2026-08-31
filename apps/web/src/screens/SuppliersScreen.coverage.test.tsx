// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, expect, it } from "vitest";
import { screen, fireEvent, within, waitFor } from "@testing-library/react";
import type { OpenInvoiceDTO, PurchaseInvoiceDTO, SupplierDTO, VoucherAllocationDTO, VoucherDTO } from "@mezan/contracts";
import { SuppliersScreen } from "./SuppliersScreen";
import { renderWithProviders, stubTransport, testAdminSession } from "../data/test-support";

function supplier(overrides: Partial<SupplierDTO> = {}): SupplierDTO {
  return {
    id: "sup-1",
    code: "S000001",
    nameAr: "جاري",
    nameEn: "Gary Supply Co.",
    phone: "01011112001",
    email: "sales@gary.example",
    contactPerson: "كريم عادل",
    taxNumber: "300777888900001",
    category: "مواد خام",
    notes: null,
    paymentTermsDays: 30,
    currency: "EGP",
    openingBalance: "3200.00",
    active: true,
    addressCity: "القاهرة",
    addressDistrict: "مدينة نصر",
    addressStreet: "شارع مكرم عبيد",
    ...overrides,
  };
}

const inactiveSupplier = supplier({
  id: "sup-2",
  code: "S000002",
  nameAr: "مورد قطع الغيار الشرقي",
  nameEn: null,
  active: false,
});

function purchaseInvoice(overrides: Partial<PurchaseInvoiceDTO> = {}): PurchaseInvoiceDTO {
  return {
    id: "pinv-x",
    number: "PINV-000001",
    supplierId: "sup-1",
    date: "2026-08-01",
    dueDate: null,
    supplierInvoiceNumber: null,
    branchId: "MAIN",
    warehouseId: "wh-1",
    currency: "EGP",
    fxRate: null,
    notes: null,
    receiptId: null,
    lines: [],
    status: "confirmed",
    subtotal: "1000.000000",
    tax: "0.000000",
    total: "1000.000000",
    amountPaid: "0.000000",
    remainingBalance: "1000.000000",
    createdBy: "USER-ADMIN",
    createdAt: "2026-08-01T00:00:00.000Z",
    ...overrides,
  };
}

function voucher(overrides: Partial<VoucherDTO> = {}): VoucherDTO {
  return {
    id: "vch-x",
    docNo: "PV-000001",
    voucherType: "supplier_payment",
    direction: "payment",
    status: "confirmed",
    date: "2026-08-10",
    memo: "",
    amount: "500.000000",
    currency: "EGP",
    branchId: "MAIN",
    paymentMethod: "cash",
    treasuryAccountId: "tr-1",
    treasuryGlAccountId: "1010",
    counterpartyGlAccountId: null,
    counterTreasuryAccountId: null,
    counterTreasuryGlAccountId: null,
    customerId: null,
    supplierId: "sup-1",
    referenceNo: null,
    costCenterId: null,
    withholdingAmount: null,
    withholdingRatePercent: null,
    netPaidAmount: "500.000000",
    journalEntryId: "je-x",
    confirmedAt: "2026-08-10T00:00:00.000Z",
    ...overrides,
  };
}

function voucherAllocation(overrides: Partial<VoucherAllocationDTO> = {}): VoucherAllocationDTO {
  return {
    id: "alloc-1",
    voucherId: "vch-x",
    invoiceId: "pinv-1",
    amount: "500.000000",
    status: "active",
    createdAt: "2026-08-10T00:00:00.000Z",
    reversedAt: null,
    ...overrides,
  };
}

function openInvoice(overrides: Partial<OpenInvoiceDTO> = {}): OpenInvoiceDTO {
  return {
    id: "pinv-1",
    invoiceNo: "PINV-000001",
    kind: "purchase",
    partyId: "sup-1",
    date: "2026-08-01",
    total: "1000.00",
    allocated: "0.00",
    outstanding: "1000.00",
    ...overrides,
  };
}

function textboxByLabel(container: HTMLElement, label: string): HTMLInputElement {
  return within(container).getByLabelText(label) as HTMLInputElement;
}

const EMPTY_AGING = { rows: [], groups: [], grandTotals: {}, reconciliation: null };

function renderScreen(
  suppliers: SupplierDTO[] = [supplier(), inactiveSupplier],
  opts: { patchRequests?: Array<{ id: string; patch: Record<string, unknown> }>; requests?: string[]; route?: string } = {},
) {
  let current = [...suppliers];
  const requests = opts.requests ?? [];
  const transport = stubTransport({
    "GET /suppliers": (_init, path) => {
      requests.push(path);
      const params = new URL(path, "http://x").searchParams;
      const status = params.get("status");
      const q = params.get("q")?.toLowerCase();
      let rows = status ? current.filter((s) => (status === "active" ? s.active : !s.active)) : current;
      if (q) rows = rows.filter((s) => s.nameAr.toLowerCase().includes(q) || s.code.toLowerCase().includes(q));
      return { body: rows };
    },
    "GET /suppliers/counts": () => ({
      body: {
        all: current.length,
        active: current.filter((s) => s.active).length,
        inactive: current.filter((s) => !s.active).length,
      },
    }),
    "POST /suppliers": (init) => {
      const body = JSON.parse((init?.body as string) ?? "{}");
      const created: SupplierDTO = { ...supplier(), ...body, id: body.id, code: body.code };
      current = [...current, created];
      return { status: 201, body: created };
    },
    "PATCH /suppliers/*": (init, path) => {
      const id = path.split("/").pop()!.split("?")[0]!;
      const patch = JSON.parse((init?.body as string) ?? "{}");
      opts.patchRequests?.push({ id, patch });
      const index = current.findIndex((s) => s.id === id);
      const updated: SupplierDTO = { ...current[index]!, ...patch };
      current = [...current.slice(0, index), updated, ...current.slice(index + 1)];
      return { body: updated };
    },
    "GET /purchases/invoices": () => ({ body: [] }),
    "GET /vouchers": () => ({ body: [] }),
    "GET /open-invoices": () => ({ body: [] }),
    "GET /reports/aging/suppliers": () => ({ body: EMPTY_AGING }),
    "GET /purchase-returns": () => ({ body: [] }),
    "GET /cheques": () => ({ body: [] }),
  });
  return renderWithProviders(<SuppliersScreen />, { transport, initialSession: testAdminSession, route: opts.route });
}

describe("SuppliersScreen coverage", () => {
  it("shows an empty subtotal, tax and total as a formatted zero when the invoice's own figures are blank strings", async () => {
    const inv = purchaseInvoice({ id: "pinv-1", number: "PINV-000010", subtotal: "", tax: "", total: "" });
    const transport = stubTransport({
      "GET /suppliers": () => ({ body: [supplier()] }),
      "GET /suppliers/counts": () => ({ body: { all: 1, active: 1, inactive: 0 } }),
      "GET /purchases/invoices": () => ({ body: [inv] }),
      "GET /vouchers": () => ({ body: [] }),
      "GET /open-invoices": () => ({ body: [] }),
      "GET /reports/aging/suppliers": () => ({ body: EMPTY_AGING }),
      "GET /purchase-returns": () => ({ body: [] }),
      "GET /cheques": () => ({ body: [] }),
    });
    renderWithProviders(<SuppliersScreen />, { transport, initialSession: testAdminSession });
    fireEvent.click(await screen.findByText("جاري"));
    fireEvent.click(screen.getByRole("tab", { name: "فواتير المشتريات" }));

    const row = (await screen.findByText("PINV-000010")).closest("tr")!;
    const cells = within(row).getAllByRole("cell");
    expect(cells.at(-1)?.textContent).toBe("0.00");
  });

  it("shows the invoices tab's own empty message when this supplier has no purchase invoices, even though another supplier does", async () => {
    const other = purchaseInvoice({ id: "pinv-9", number: "PINV-999999", supplierId: "sup-2" });
    const transport = stubTransport({
      "GET /suppliers": () => ({ body: [supplier()] }),
      "GET /suppliers/counts": () => ({ body: { all: 1, active: 1, inactive: 0 } }),
      "GET /purchases/invoices": () => ({ body: [other] }),
      "GET /vouchers": () => ({ body: [] }),
      "GET /open-invoices": () => ({ body: [] }),
      "GET /reports/aging/suppliers": () => ({ body: EMPTY_AGING }),
      "GET /purchase-returns": () => ({ body: [] }),
      "GET /cheques": () => ({ body: [] }),
    });
    renderWithProviders(<SuppliersScreen />, { transport, initialSession: testAdminSession });
    fireEvent.click(await screen.findByText("جاري"));
    fireEvent.click(screen.getByRole("tab", { name: "فواتير المشتريات" }));

    expect(await screen.findByText("لا توجد فواتير مشتريات مسجّلة لهذا المورد")).toBeInTheDocument();
  });

  it("breaks a tie between two invoices sharing the same date by their own number, ascending", async () => {
    const first = purchaseInvoice({ id: "pinv-1", number: "PINV-000002", date: "2026-08-05" });
    const second = purchaseInvoice({ id: "pinv-2", number: "PINV-000001", date: "2026-08-05" });
    const transport = stubTransport({
      "GET /suppliers": () => ({ body: [supplier()] }),
      "GET /suppliers/counts": () => ({ body: { all: 1, active: 1, inactive: 0 } }),
      "GET /purchases/invoices": () => ({ body: [first, second] }),
      "GET /vouchers": () => ({ body: [] }),
      "GET /open-invoices": () => ({ body: [] }),
      "GET /reports/aging/suppliers": () => ({ body: EMPTY_AGING }),
      "GET /purchase-returns": () => ({ body: [] }),
      "GET /cheques": () => ({ body: [] }),
    });
    renderWithProviders(<SuppliersScreen />, { transport, initialSession: testAdminSession });
    fireEvent.click(await screen.findByText("جاري"));
    fireEvent.click(screen.getByRole("tab", { name: "فواتير المشتريات" }));

    await screen.findByText("PINV-000001");
    const numbers = screen.getAllByRole("row").slice(1).map((row) => within(row).getAllByRole("cell")[0]!.textContent);
    expect(numbers).toEqual(["PINV-000001", "PINV-000002"]);
  });

  it("shows an invoice's own due date once set, instead of the dash", async () => {
    const inv = purchaseInvoice({ id: "pinv-1", number: "PINV-000010", dueDate: "2026-09-15" });
    const transport = stubTransport({
      "GET /suppliers": () => ({ body: [supplier()] }),
      "GET /suppliers/counts": () => ({ body: { all: 1, active: 1, inactive: 0 } }),
      "GET /purchases/invoices": () => ({ body: [inv] }),
      "GET /vouchers": () => ({ body: [] }),
      "GET /open-invoices": () => ({ body: [] }),
      "GET /reports/aging/suppliers": () => ({ body: EMPTY_AGING }),
      "GET /purchase-returns": () => ({ body: [] }),
      "GET /cheques": () => ({ body: [] }),
    });
    renderWithProviders(<SuppliersScreen />, { transport, initialSession: testAdminSession });
    fireEvent.click(await screen.findByText("جاري"));
    fireEvent.click(screen.getByRole("tab", { name: "فواتير المشتريات" }));

    expect(await screen.findByText("15/09/2026")).toBeInTheDocument();
  });

  it("includes a posted (not just confirmed) supplier voucher in the statement, and excludes a still-draft one", async () => {
    const posted = voucher({ id: "vch-posted", status: "posted", amount: "200.000000" });
    const draft = voucher({ id: "vch-draft", status: "draft", amount: "999.000000" });
    const transport = stubTransport({
      "GET /suppliers": () => ({ body: [supplier({ openingBalance: "0.00" })] }),
      "GET /suppliers/counts": () => ({ body: { all: 1, active: 1, inactive: 0 } }),
      "GET /purchases/invoices": () => ({ body: [] }),
      "GET /vouchers": () => ({ body: [posted, draft] }),
      "GET /vouchers/vch-posted/allocations": () => ({ body: { allocations: [] } }),
      "GET /open-invoices": () => ({ body: [] }),
      "GET /reports/aging/suppliers": () => ({ body: EMPTY_AGING }),
      "GET /purchase-returns": () => ({ body: [] }),
      "GET /cheques": () => ({ body: [] }),
    });
    renderWithProviders(<SuppliersScreen />, { transport, initialSession: testAdminSession });
    fireEvent.click(await screen.findByText("جاري"));
    fireEvent.click(screen.getByRole("tab", { name: "كشف حساب المورد" }));

    // Only the posted voucher's 200.00 shows as debit; the draft one is ignored entirely.
    expect((await screen.findByText("إجمالي المسدَّد (مدين)")).nextElementSibling?.textContent).toBe("200.00");
  });

  it("excludes a draft purchase invoice from the statement's credit total, counting only the confirmed one", async () => {
    const confirmedInv = purchaseInvoice({ id: "pinv-1", number: "PINV-000010", status: "confirmed", total: "1000.000000" });
    const draftInv = purchaseInvoice({ id: "pinv-2", number: "PINV-000011", status: "draft", total: "500.000000" });
    const transport = stubTransport({
      "GET /suppliers": () => ({ body: [supplier({ openingBalance: "0.00" })] }),
      "GET /suppliers/counts": () => ({ body: { all: 1, active: 1, inactive: 0 } }),
      "GET /purchases/invoices": () => ({ body: [confirmedInv, draftInv] }),
      "GET /vouchers": () => ({ body: [] }),
      "GET /open-invoices": () => ({ body: [] }),
      "GET /reports/aging/suppliers": () => ({ body: EMPTY_AGING }),
      "GET /purchase-returns": () => ({ body: [] }),
      "GET /cheques": () => ({ body: [] }),
    });
    renderWithProviders(<SuppliersScreen />, { transport, initialSession: testAdminSession });
    fireEvent.click(await screen.findByText("جاري"));
    fireEvent.click(screen.getByRole("tab", { name: "كشف حساب المورد" }));

    expect((await screen.findByText("إجمالي المشتريات (دائن)")).nextElementSibling?.textContent).toBe("1,000.00");
  });

  it("shows a negative opening balance as a debit, not a credit", async () => {
    const transport = stubTransport({
      "GET /suppliers": () => ({ body: [supplier({ openingBalance: "-500.00" })] }),
      "GET /suppliers/counts": () => ({ body: { all: 1, active: 1, inactive: 0 } }),
      "GET /purchases/invoices": () => ({ body: [] }),
      "GET /vouchers": () => ({ body: [] }),
      "GET /open-invoices": () => ({ body: [] }),
      "GET /reports/aging/suppliers": () => ({ body: EMPTY_AGING }),
      "GET /purchase-returns": () => ({ body: [] }),
      "GET /cheques": () => ({ body: [] }),
    });
    renderWithProviders(<SuppliersScreen />, { transport, initialSession: testAdminSession });
    fireEvent.click(await screen.findByText("جاري"));
    fireEvent.click(screen.getByRole("tab", { name: "كشف حساب المورد" }));

    const openingRow = (await screen.findByText("رصيد افتتاحي", { selector: "td" })).closest("tr")!;
    const cells = within(openingRow).getAllByRole("cell");
    // debit column is index 3 (date, movement, reference, debit, credit, balance)
    expect(cells[3]?.textContent).toBe("500.00");
    expect(cells[4]?.textContent).toBe("—");
  });

  it("skips a transfer-direction voucher entirely — it never appears as a statement row", async () => {
    const transfer = voucher({ id: "vch-xfer", direction: "transfer", amount: "999.000000" });
    const transport = stubTransport({
      "GET /suppliers": () => ({ body: [supplier({ openingBalance: "0.00" })] }),
      "GET /suppliers/counts": () => ({ body: { all: 1, active: 1, inactive: 0 } }),
      "GET /purchases/invoices": () => ({ body: [] }),
      "GET /vouchers": () => ({ body: [transfer] }),
      "GET /vouchers/vch-xfer/allocations": () => ({ body: { allocations: [] } }),
      "GET /open-invoices": () => ({ body: [] }),
      "GET /reports/aging/suppliers": () => ({ body: EMPTY_AGING }),
      "GET /purchase-returns": () => ({ body: [] }),
      "GET /cheques": () => ({ body: [] }),
    });
    renderWithProviders(<SuppliersScreen />, { transport, initialSession: testAdminSession });
    fireEvent.click(await screen.findByText("جاري"));
    fireEvent.click(screen.getByRole("tab", { name: "كشف حساب المورد" }));

    await screen.findByText("رصيد افتتاحي", { selector: "td" });
    expect(screen.queryByText("PV-000001")).not.toBeInTheDocument();
    expect((screen.getByText("إجمالي المسدَّد (مدين)")).nextElementSibling?.textContent).toBe("0.00");
  });

  it("labels a receipt-direction voucher as money received from the supplier, and posts its allocation as a credit", async () => {
    const inv = purchaseInvoice({ id: "pinv-1", number: "PINV-000010", status: "confirmed", total: "1000.000000" });
    const refund = voucher({ id: "vch-refund", docNo: null as unknown as string, direction: "receipt", amount: "200.000000" });
    const alloc = voucherAllocation({ id: "alloc-1", voucherId: "vch-refund", invoiceId: "pinv-1", amount: "200.000000" });
    const transport = stubTransport({
      "GET /suppliers": () => ({ body: [supplier({ openingBalance: "0.00" })] }),
      "GET /suppliers/counts": () => ({ body: { all: 1, active: 1, inactive: 0 } }),
      "GET /purchases/invoices": () => ({ body: [inv] }),
      "GET /vouchers": () => ({ body: [refund] }),
      "GET /vouchers/vch-refund/allocations": () => ({ body: { allocations: [alloc] } }),
      "GET /open-invoices": () => ({ body: [] }),
      "GET /reports/aging/suppliers": () => ({ body: EMPTY_AGING }),
      "GET /purchase-returns": () => ({ body: [] }),
      "GET /cheques": () => ({ body: [] }),
    });
    renderWithProviders(<SuppliersScreen />, { transport, initialSession: testAdminSession });
    fireEvent.click(await screen.findByText("جاري"));
    fireEvent.click(screen.getByRole("tab", { name: "كشف حساب المورد" }));

    expect(await screen.findByText("سند قبض من المورد")).toBeInTheDocument();
    // The voucher's own id stands in for its reference — it never got a docNo.
    expect(screen.getByText("vch-refund")).toBeInTheDocument();
    // A receipt raises the payable further: 1000 (invoice) + 200 (receipt) = 1,200.00.
    expect(screen.getByText("الرصيد الختامي (مستحق للمورد)").nextElementSibling?.textContent).toBe("1,200.00");
  });

  it("falls back to the allocation's raw invoice id in its note when the invoice isn't in either loaded list", async () => {
    const payment = voucher({ id: "vch-1", direction: "payment", amount: "300.000000" });
    const alloc = voucherAllocation({ id: "alloc-1", voucherId: "vch-1", invoiceId: "pinv-vanished", amount: "300.000000" });
    const transport = stubTransport({
      "GET /suppliers": () => ({ body: [supplier({ openingBalance: "0.00" })] }),
      "GET /suppliers/counts": () => ({ body: { all: 1, active: 1, inactive: 0 } }),
      "GET /purchases/invoices": () => ({ body: [] }),
      "GET /vouchers": () => ({ body: [payment] }),
      "GET /vouchers/vch-1/allocations": () => ({ body: { allocations: [alloc] } }),
      "GET /open-invoices": () => ({ body: [] }),
      "GET /reports/aging/suppliers": () => ({ body: EMPTY_AGING }),
      "GET /purchase-returns": () => ({ body: [] }),
      "GET /cheques": () => ({ body: [] }),
    });
    renderWithProviders(<SuppliersScreen />, { transport, initialSession: testAdminSession });
    fireEvent.click(await screen.findByText("جاري"));
    fireEvent.click(screen.getByRole("tab", { name: "كشف حساب المورد" }));

    expect(await screen.findByText("مخصص على الفاتورة pinv-vanished")).toBeInTheDocument();
  });

  it("posts an over-allocated voucher's remainder to the credit side instead of debit", async () => {
    // The allocation (600) exceeds the voucher's own amount (500) — a data
    // inconsistency the statement must still render without going negative
    // in the wrong direction.
    const payment = voucher({ id: "vch-1", direction: "payment", amount: "500.000000" });
    const alloc = voucherAllocation({ id: "alloc-1", voucherId: "vch-1", invoiceId: "pinv-1", amount: "600.000000" });
    const transport = stubTransport({
      "GET /suppliers": () => ({ body: [supplier({ openingBalance: "0.00" })] }),
      "GET /suppliers/counts": () => ({ body: { all: 1, active: 1, inactive: 0 } }),
      "GET /purchases/invoices": () => ({ body: [] }),
      "GET /vouchers": () => ({ body: [payment] }),
      "GET /vouchers/vch-1/allocations": () => ({ body: { allocations: [alloc] } }),
      "GET /open-invoices": () => ({ body: [] }),
      "GET /reports/aging/suppliers": () => ({ body: EMPTY_AGING }),
      "GET /purchase-returns": () => ({ body: [] }),
      "GET /cheques": () => ({ body: [] }),
    });
    renderWithProviders(<SuppliersScreen />, { transport, initialSession: testAdminSession });
    fireEvent.click(await screen.findByText("جاري"));
    fireEvent.click(screen.getByRole("tab", { name: "كشف حساب المورد" }));

    const unallocatedRow = (await screen.findByText("غير مخصص على فاتورة — تحت حساب المورد")).closest("tr")!;
    const cells = within(unallocatedRow).getAllByRole("cell");
    expect(cells[3]?.textContent).toBe("—");
    expect(cells[4]?.textContent).toBe("100.00");
  });

  it("skips a reversed allocation and one whose voucher no longer settles, when reconciling the sub-ledger", async () => {
    const inv = purchaseInvoice({ id: "pinv-1", number: "PINV-000010", status: "confirmed", total: "1000.000000" });
    const payment = voucher({ id: "vch-1", direction: "payment", amount: "300.000000" });
    const reversedAlloc = voucherAllocation({ id: "alloc-reversed", voucherId: "vch-1", invoiceId: "pinv-1", amount: "300.000000", status: "reversed" });
    const orphanAlloc = voucherAllocation({ id: "alloc-orphan", voucherId: "vch-gone", invoiceId: "pinv-1", amount: "999.000000", status: "active" });
    const transport = stubTransport({
      "GET /suppliers": () => ({ body: [supplier({ openingBalance: "0.00" })] }),
      "GET /suppliers/counts": () => ({ body: { all: 1, active: 1, inactive: 0 } }),
      "GET /purchases/invoices": () => ({ body: [inv] }),
      "GET /vouchers": () => ({ body: [payment] }),
      "GET /vouchers/vch-1/allocations": () => ({ body: { allocations: [reversedAlloc, orphanAlloc] } }),
      "GET /open-invoices": () => ({ body: [openInvoice({ id: "pinv-1", outstanding: "1000.00" })] }),
      "GET /reports/aging/suppliers": () => ({ body: EMPTY_AGING }),
      "GET /purchase-returns": () => ({ body: [] }),
      "GET /cheques": () => ({ body: [] }),
    });
    renderWithProviders(<SuppliersScreen />, { transport, initialSession: testAdminSession });
    fireEvent.click(await screen.findByText("جاري"));
    fireEvent.click(screen.getByRole("tab", { name: "كشف حساب المورد" }));

    // Neither the reversed allocation nor the orphaned one (its voucher isn't
    // one of this supplier's settled vouchers) reduced the open balance — the
    // sub-ledger reconciliation still matches the untouched 1,000.00.
    expect(await screen.findByText("مطابق لدفتر الفواتير المفتوحة")).toBeInTheDocument();
  });

  it("shows a minimal supplier's edit form with every optional field blank", async () => {
    const minimal = supplier({
      id: "sup-min",
      nameEn: null,
      phone: null,
      email: null,
      contactPerson: null,
      taxNumber: null,
      category: null,
      addressCity: null,
      addressDistrict: null,
      addressStreet: null,
    });
    renderScreen([minimal]);
    await screen.findByText("جاري");
    fireEvent.click(screen.getByRole("button", { name: "إجراءات جاري" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "تعديل" }));
    const dialog = screen.getByRole("dialog", { name: "تعديل مورد" });

    for (const label of ["الاسم بالإنجليزي", "الهاتف", "البريد الإلكتروني", "جهة الاتصال", "الرقم الضريبي", "التصنيف", "المدينة", "الحي", "الشارع"]) {
      expect(textboxByLabel(dialog, label).value).toBe("");
    }
  });

  it("shows a minimal supplier's own detail page with every fallback in place", async () => {
    const minimal = supplier({
      id: "sup-min",
      nameEn: null,
      phone: null,
      email: null,
      contactPerson: null,
      taxNumber: null,
      category: null,
      notes: null,
      addressCity: null,
      addressDistrict: null,
      addressStreet: null,
    });
    renderScreen([minimal]);
    fireEvent.click(await screen.findByText("جاري"));

    expect(screen.getByRole("heading", { name: /جاري · S000001/ })).toBeInTheDocument();
    expect(screen.getAllByText("لا يوجد").length).toBeGreaterThan(0);
    expect(screen.getByText("بدون تصنيف")).toBeInTheDocument();
    // No English subtitle and no notes card in the overview grid — only the
    // (closed) side panel's own notes field label exists in the DOM.
    expect(screen.queryByText("Gary Supply Co.")).not.toBeInTheDocument();
    expect(screen.queryByText("ملاحظات", { selector: "div" })).not.toBeInTheDocument();
  });

  it("shows a supplier's own notes card and English subtitle when both are set", async () => {
    renderScreen([supplier({ notes: "يفضّل التواصل صباحاً" })]);
    fireEvent.click(await screen.findByText("جاري"));

    expect(screen.getByText("Gary Supply Co.")).toBeInTheDocument();
    expect(screen.getByText("يفضّل التواصل صباحاً")).toBeInTheDocument();
  });

  it("joins a supplier's own address parts, and shows the plain address when all three are present", async () => {
    renderScreen([supplier()]);
    fireEvent.click(await screen.findByText("جاري"));

    expect(screen.getByText("شارع مكرم عبيد، مدينة نصر، القاهرة")).toBeInTheDocument();
  });

  it("sends the supplier's own typed code exactly, instead of auto-generating one", async () => {
    let created: Record<string, unknown> | undefined;
    const transport = stubTransport({
      "GET /suppliers": () => ({ body: [supplier(), inactiveSupplier] }),
      "GET /suppliers/counts": () => ({ body: { all: 2, active: 1, inactive: 1 } }),
      "POST /suppliers": (init) => {
        created = JSON.parse((init?.body as string) ?? "{}");
        return { status: 201, body: { ...supplier(), ...created } };
      },
      "GET /purchases/invoices": () => ({ body: [] }),
      "GET /vouchers": () => ({ body: [] }),
      "GET /open-invoices": () => ({ body: [] }),
      "GET /reports/aging/suppliers": () => ({ body: EMPTY_AGING }),
      "GET /purchase-returns": () => ({ body: [] }),
      "GET /cheques": () => ({ body: [] }),
    });
    renderWithProviders(<SuppliersScreen />, { transport, initialSession: testAdminSession });
    await screen.findByText("جاري");
    fireEvent.click(screen.getByRole("button", { name: "إضافة مورد" }));
    const dialog = screen.getByRole("dialog", { name: "إضافة مورد" });

    fireEvent.change(textboxByLabel(dialog, "اسم المورد *"), { target: { value: "مورد بكود مخصص" } });
    fireEvent.change(textboxByLabel(dialog, "الكود"), { target: { value: "SUP-CUSTOM-01" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "إضافة مورد" }));

    await waitFor(() => expect(created).toBeDefined());
    expect(created?.code).toBe("SUP-CUSTOM-01");
  });

  it("defaults a blank currency field to EGP on save", async () => {
    let created: Record<string, unknown> | undefined;
    const transport = stubTransport({
      "GET /suppliers": () => ({ body: [supplier(), inactiveSupplier] }),
      "GET /suppliers/counts": () => ({ body: { all: 2, active: 1, inactive: 1 } }),
      "POST /suppliers": (init) => {
        created = JSON.parse((init?.body as string) ?? "{}");
        return { status: 201, body: { ...supplier(), ...created } };
      },
      "GET /purchases/invoices": () => ({ body: [] }),
      "GET /vouchers": () => ({ body: [] }),
      "GET /open-invoices": () => ({ body: [] }),
      "GET /reports/aging/suppliers": () => ({ body: EMPTY_AGING }),
      "GET /purchase-returns": () => ({ body: [] }),
      "GET /cheques": () => ({ body: [] }),
    });
    renderWithProviders(<SuppliersScreen />, { transport, initialSession: testAdminSession });
    await screen.findByText("جاري");
    fireEvent.click(screen.getByRole("button", { name: "إضافة مورد" }));
    const dialog = screen.getByRole("dialog", { name: "إضافة مورد" });

    fireEvent.change(textboxByLabel(dialog, "اسم المورد *"), { target: { value: "مورد بدون عملة" } });
    fireEvent.change(textboxByLabel(dialog, "العملة"), { target: { value: "  " } });
    fireEvent.click(within(dialog).getByRole("button", { name: "إضافة مورد" }));

    await waitFor(() => expect(created).toBeDefined());
    expect(created?.currency).toBe("EGP");
  });

  it("shows the server's own refusal message and keeps the panel open when creating a supplier is rejected", async () => {
    const transport = stubTransport({
      "GET /suppliers": () => ({ body: [supplier(), inactiveSupplier] }),
      "GET /suppliers/counts": () => ({ body: { all: 2, active: 1, inactive: 1 } }),
      "POST /suppliers": () => ({ status: 409, body: { message: "هذا الكود مستخدم من مورد آخر بالفعل." } }),
      "GET /purchases/invoices": () => ({ body: [] }),
      "GET /vouchers": () => ({ body: [] }),
      "GET /open-invoices": () => ({ body: [] }),
      "GET /reports/aging/suppliers": () => ({ body: EMPTY_AGING }),
      "GET /purchase-returns": () => ({ body: [] }),
      "GET /cheques": () => ({ body: [] }),
    });
    renderWithProviders(<SuppliersScreen />, { transport, initialSession: testAdminSession });
    await screen.findByText("جاري");
    fireEvent.click(screen.getByRole("button", { name: "إضافة مورد" }));
    const dialog = screen.getByRole("dialog", { name: "إضافة مورد" });
    fireEvent.change(textboxByLabel(dialog, "اسم المورد *"), { target: { value: "مورد يرفضه الخادم" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "إضافة مورد" }));

    expect(await screen.findByText("هذا الكود مستخدم من مورد آخر بالفعل.")).toBeInTheDocument();
    expect(screen.getByRole("dialog", { name: "إضافة مورد" })).toBeInTheDocument();
  });

  it("sorts invoices on different dates with the newest first", async () => {
    const older = purchaseInvoice({ id: "pinv-1", number: "PINV-000001", date: "2026-07-01" });
    const newer = purchaseInvoice({ id: "pinv-2", number: "PINV-000002", date: "2026-08-20" });
    const transport = stubTransport({
      "GET /suppliers": () => ({ body: [supplier()] }),
      "GET /suppliers/counts": () => ({ body: { all: 1, active: 1, inactive: 0 } }),
      "GET /purchases/invoices": () => ({ body: [older, newer] }),
      "GET /vouchers": () => ({ body: [] }),
      "GET /open-invoices": () => ({ body: [] }),
      "GET /reports/aging/suppliers": () => ({ body: EMPTY_AGING }),
      "GET /purchase-returns": () => ({ body: [] }),
      "GET /cheques": () => ({ body: [] }),
    });
    renderWithProviders(<SuppliersScreen />, { transport, initialSession: testAdminSession });
    fireEvent.click(await screen.findByText("جاري"));
    fireEvent.click(screen.getByRole("tab", { name: "فواتير المشتريات" }));

    await screen.findByText("PINV-000002");
    const numbers = screen.getAllByRole("row").slice(1).map((row) => within(row).getAllByRole("cell")[0]!.textContent);
    expect(numbers).toEqual(["PINV-000002", "PINV-000001"]);
  });
});
