// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, expect, it } from "vitest";
import { screen, fireEvent, within, waitFor } from "@testing-library/react";
import type { OpenInvoiceDTO, PartyStatementDTO, PartyStatementLineDTO, PurchaseInvoiceDTO, SupplierDTO, VoucherAllocationDTO, VoucherDTO } from "@mezan/contracts";
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
    bankAccount: null,
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
    projectId: null,
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
    projectId: null,
    costCategory: null,
    voucherType: "supplier_payment",
    direction: "payment",
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
    // The statement tab (كشف حساب المورد) builds a real AP ledger from these.
    "GET /purchases/invoices": () => ({ body: [] }),
    "GET /vouchers": () => ({ body: [] }),
    "GET /open-invoices": () => ({ body: [] }),
    "GET /reports/aging/suppliers": () => ({ body: { rows: [], groups: [], grandTotals: {}, reconciliation: null } }),
    "GET /reports/statements/suppliers/*": (_init, path) => ({ body: statementOf(path.split("/").pop()!, []) }),
  });
  return renderWithProviders(<SuppliersScreen />, { transport, initialSession: testAdminSession, route: opts.route });
}

type StatementLine = Pick<PartyStatementLineDTO, "kind" | "reference" | "increase" | "decrease"> & Partial<PartyStatementLineDTO>;

/** What `/reports/statements/suppliers/:id` answers: base amounts, a running balance, and the supplier's aging row beside the closing. */
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

function statementTransport(statement: (id: string) => { status?: number; body: unknown }, agingRows: Array<Record<string, unknown>> = []) {
  return stubTransport({
    "GET /suppliers": () => ({ body: [supplier({ owed: "3900.000000" })] }),
    "GET /suppliers/counts": () => ({ body: { all: 1, active: 1, inactive: 0 } }),
    "GET /purchases/invoices": () => ({ body: [] }),
    "GET /reports/aging/suppliers": () => ({ body: { rows: agingRows, groups: [], grandTotals: {}, reconciliation: null } }),
    "GET /reports/statements/suppliers/*": (_init, path) => statement(path.split("/").pop()!),
  });
}

describe("SuppliersScreen", () => {
  it("lists suppliers from the real backend", async () => {
    renderScreen();
    expect(screen.getByRole("heading", { name: "الموردون" })).toBeInTheDocument();
    expect(await screen.findByText("جاري")).toBeInTheDocument();
    expect(screen.getByText("S000001")).toBeInTheDocument();
  });

  it("shows an empty state when there are no suppliers yet", async () => {
    renderScreen([]);
    expect(await screen.findByText("لا يوجد موردون مطابقون")).toBeInTheDocument();
  });

  it("opens the supplier detail on row click, with an overview tab and a real statement tab", async () => {
    renderScreen();
    fireEvent.click(await screen.findByText("جاري"));
    expect(screen.getByRole("heading", { name: /جاري/ })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "نظرة عامة" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "كشف حساب المورد" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("tab", { name: "كشف حساب المورد" }));
    // كشف حساب المورد is a real AP movement ledger now, not a "قريباً" stub — the opening-balance
    // label appears both as a MiniStat and as the ledger's first row.
    expect((await screen.findAllByText("رصيد افتتاحي")).length).toBeGreaterThan(0);
  });

  it("returns to the list from the detail view", async () => {
    renderScreen();
    fireEvent.click(await screen.findByText("جاري"));
    fireEvent.click(screen.getByRole("button", { name: "رجوع لقائمة الموردين" }));
    expect(screen.getByRole("heading", { name: "الموردون" })).toBeInTheDocument();
  });

  it("filters by status chip", async () => {
    renderScreen();
    await screen.findByText("جاري");
    fireEvent.click(screen.getByRole("tab", { name: /غير نشط/ }));
    await waitFor(() => {
      expect(screen.getByText("مورد قطع الغيار الشرقي")).toBeInTheDocument();
      expect(screen.queryByText("جاري")).not.toBeInTheDocument();
    });
  });

  it("adds a new supplier through the side panel", async () => {
    renderScreen();
    await screen.findByText("جاري");
    fireEvent.click(screen.getByRole("button", { name: "إضافة مورد" }));

    const dialog = screen.getByRole("dialog", { name: "إضافة مورد" });
    fireEvent.change(textboxByLabel(dialog, "اسم المورد *"), { target: { value: "مورد تجريبي" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "إضافة مورد" }));

    expect(await screen.findByText("مورد تجريبي")).toBeInTheDocument();
  });

  it("shows an Arabic validation error instead of adding an invalid supplier", async () => {
    renderScreen();
    await screen.findByText("جاري");
    fireEvent.click(screen.getByRole("button", { name: "إضافة مورد" }));
    const dialog = screen.getByRole("dialog", { name: "إضافة مورد" });
    // Leave the required Arabic name empty and try to save.
    fireEvent.click(within(dialog).getByRole("button", { name: "إضافة مورد" }));
    expect(within(dialog).getByText("الاسم بالعربية مطلوب")).toBeInTheDocument();
  });

  it("edits an existing supplier from the detail view without clobbering its opening balance", async () => {
    renderScreen();
    fireEvent.click(await screen.findByText("جاري"));
    fireEvent.click(screen.getByRole("button", { name: "تعديل" }));

    const dialog = screen.getByRole("dialog", { name: "تعديل مورد" });
    fireEvent.change(textboxByLabel(dialog, "الهاتف"), { target: { value: "01000000000" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "حفظ التعديلات" }));

    await waitFor(() => expect(screen.getByText(/3,200|3200/)).toBeInTheDocument());
  });

  it("lets an editing supplier be toggled inactive via the active/inactive switch", async () => {
    renderScreen();
    fireEvent.click(await screen.findByText("جاري"));
    fireEvent.click(screen.getByRole("button", { name: "تعديل" }));

    const dialog = screen.getByRole("dialog", { name: "تعديل مورد" });
    expect(within(dialog).getByRole("switch", { name: "نشط" })).toHaveAttribute("aria-checked", "true");
    fireEvent.click(within(dialog).getByRole("switch", { name: "نشط" }));
    fireEvent.click(within(dialog).getByRole("button", { name: "حفظ التعديلات" }));

    await waitFor(() => expect(screen.getByText("غير نشط")).toBeInTheDocument());
  });

  it("filters the list by search text, hiding the non-matching supplier", async () => {
    renderScreen();
    await screen.findByText("جاري");
    fireEvent.change(screen.getByPlaceholderText("ابحث باسم المورد أو الكود أو الهاتف…"), { target: { value: "الشرقي" } });

    await waitFor(() => {
      expect(screen.queryByText("جاري")).not.toBeInTheDocument();
      expect(screen.getByText("مورد قطع الغيار الشرقي")).toBeInTheDocument();
    });
  });

  it("tells a failed supplier list load apart from an empty one: the banner shows and the empty state does NOT (D123)", async () => {
    const transport = stubTransport({
      "GET /suppliers": () => ({ status: 500, body: { error: "INTERNAL" } }),
      "GET /suppliers/counts": () => ({ body: {} }),
      "GET /purchases/invoices": () => ({ body: [] }),
      "GET /vouchers": () => ({ body: [] }),
      "GET /open-invoices": () => ({ body: [] }),
      "GET /reports/aging/suppliers": () => ({ body: { rows: [], groups: [], grandTotals: {}, reconciliation: null } }),
    });
    renderWithProviders(<SuppliersScreen />, { transport, initialSession: testAdminSession });

    expect(await screen.findByText("تعذّر تحميل الموردين.")).toBeInTheDocument();
    // "The load failed" and "there are no suppliers" are different facts, and
    // the screen must not assert the second one while the first is true.
    expect(screen.queryByText("لا يوجد موردون مطابقون")).not.toBeInTheDocument();
  });

  it("shows the ordinary empty state — and no error banner — when the list genuinely comes back empty", async () => {
    const transport = stubTransport({
      "GET /suppliers": () => ({ body: [] }),
      "GET /suppliers/counts": () => ({ body: {} }),
      "GET /purchases/invoices": () => ({ body: [] }),
      "GET /vouchers": () => ({ body: [] }),
      "GET /open-invoices": () => ({ body: [] }),
      "GET /reports/aging/suppliers": () => ({ body: { rows: [], groups: [], grandTotals: {}, reconciliation: null } }),
    });
    renderWithProviders(<SuppliersScreen />, { transport, initialSession: testAdminSession });

    expect(await screen.findByText("لا يوجد موردون مطابقون")).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByText("تعذّر تحميل الموردين.")).not.toBeInTheDocument());
  });

  it("scopes the invoices tab to this supplier's own purchase invoices, excluding another supplier's, with real stats", async () => {
    const mine1 = purchaseInvoice({ id: "pinv-1", number: "PINV-000010", supplierId: "sup-1", status: "confirmed", total: "300.000000" });
    const mine2 = purchaseInvoice({ id: "pinv-2", number: "PINV-000011", supplierId: "sup-1", status: "draft", total: "150.000000" });
    const other = purchaseInvoice({ id: "pinv-9", number: "PINV-999999", supplierId: "sup-2", status: "confirmed" });
    const transport = stubTransport({
      "GET /suppliers": () => ({ body: [supplier()] }),
      "GET /suppliers/counts": () => ({ body: { all: 1, active: 1, inactive: 0 } }),
      "GET /purchases/invoices": () => ({ body: [mine1, mine2, other] }),
      "GET /vouchers": () => ({ body: [] }),
      "GET /open-invoices": () => ({ body: [] }),
      "GET /reports/aging/suppliers": () => ({ body: { rows: [], groups: [], grandTotals: {}, reconciliation: null } }),
      "GET /cheques": () => ({ body: [] }),
    });
    renderWithProviders(<SuppliersScreen />, { transport, initialSession: testAdminSession });
    fireEvent.click(await screen.findByText("جاري"));
    fireEvent.click(screen.getByRole("tab", { name: "فواتير المشتريات" }));

    expect(await screen.findByText("PINV-000010")).toBeInTheDocument();
    expect(screen.getByText("PINV-000011")).toBeInTheDocument();
    expect(screen.queryByText("PINV-999999")).not.toBeInTheDocument();
    // Count is both invoices; "confirmed" narrows to just the one confirmed total (300.00).
    expect(screen.getByText("عدد الفواتير").nextElementSibling?.textContent).toBe("2");
    expect(screen.getByText("فواتير مؤكدة").nextElementSibling?.textContent).toBe("1");
    expect(screen.getByText("إجمالي المؤكد").nextElementSibling?.textContent).toBe("300.00");
  });

  it("recovers the invoices tab via retry after its request fails once", async () => {
    let fail = true;
    const transport = stubTransport({
      "GET /suppliers": () => ({ body: [supplier()] }),
      "GET /suppliers/counts": () => ({ body: { all: 1, active: 1, inactive: 0 } }),
      "GET /purchases/invoices": () =>
        fail ? { status: 500, body: { error: "INTERNAL" } } : { body: [purchaseInvoice({ id: "pinv-1", number: "PINV-000010", supplierId: "sup-1" })] },
      "GET /vouchers": () => ({ body: [] }),
      "GET /open-invoices": () => ({ body: [] }),
      "GET /reports/aging/suppliers": () => ({ body: { rows: [], groups: [], grandTotals: {}, reconciliation: null } }),
      "GET /cheques": () => ({ body: [] }),
    });
    renderWithProviders(<SuppliersScreen />, { transport, initialSession: testAdminSession });
    fireEvent.click(await screen.findByText("جاري"));
    fireEvent.click(screen.getByRole("tab", { name: "فواتير المشتريات" }));

    expect(await screen.findByText("تعذّر تحميل فواتير المشتريات.")).toBeInTheDocument();
    fail = false;
    fireEvent.click(screen.getByRole("button", { name: "إعادة المحاولة" }));
    expect(await screen.findByText("PINV-000010")).toBeInTheDocument();
  });

  it("recovers the aging ladder via its own retry after the aging report fails once", async () => {
    let calls = 0;
    const transport = stubTransport({
      "GET /reports/statements/suppliers/*": (_init, path) => ({ body: statementOf(path.split("/").pop()!, []) }),
      "GET /suppliers": () => ({ body: [supplier()] }),
      "GET /suppliers/counts": () => ({ body: { all: 1, active: 1, inactive: 0 } }),
      "GET /purchases/invoices": () => ({ body: [] }),
      "GET /vouchers": () => ({ body: [] }),
      "GET /open-invoices": () => ({ body: [] }),
      "GET /reports/aging/suppliers": () => {
        calls += 1;
        if (calls === 1) return { status: 500, body: { error: "INTERNAL" } };
        return { body: { rows: [], groups: [], grandTotals: {}, reconciliation: null } };
      },
      "GET /cheques": () => ({ body: [] }),
    });
    renderWithProviders(<SuppliersScreen />, { transport, initialSession: testAdminSession });
    fireEvent.click(await screen.findByText("جاري"));
    fireEvent.click(screen.getByRole("tab", { name: "كشف حساب المورد" }));

    expect(await screen.findByText("تعذّر تحميل تقرير أعمار ديون الموردين.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "إعادة المحاولة" }));
    await waitFor(() => expect(screen.queryByText("تعذّر تحميل تقرير أعمار ديون الموردين.")).not.toBeInTheDocument());
  });

  it("shows only 'عرض' on an inactive supplier's row menu, and opens the edit form via the active supplier's 'edit' item", async () => {
    renderScreen();
    await screen.findByText("جاري");

    fireEvent.click(screen.getByRole("button", { name: "إجراءات مورد قطع الغيار الشرقي" }));
    const inactiveMenuItems = screen.getAllByRole("menuitem");
    expect(inactiveMenuItems).toHaveLength(1);
    expect(inactiveMenuItems[0]).toHaveTextContent("عرض");
    fireEvent.click(document.body);

    fireEvent.click(screen.getByRole("button", { name: "إجراءات جاري" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "تعديل" }));
    expect(screen.getByRole("dialog", { name: "تعديل مورد" })).toBeInTheDocument();
  });

  it("sends every field the user filled in, exactly as typed, on a new supplier", async () => {
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
      "GET /reports/aging/suppliers": () => ({ body: { rows: [], groups: [], grandTotals: {}, reconciliation: null } }),
      "GET /cheques": () => ({ body: [] }),
    });
    renderWithProviders(<SuppliersScreen />, { transport, initialSession: testAdminSession });
    await screen.findByText("جاري");
    fireEvent.click(screen.getByRole("button", { name: "إضافة مورد" }));
    const dialog = screen.getByRole("dialog", { name: "إضافة مورد" });

    fireEvent.change(textboxByLabel(dialog, "اسم المورد *"), { target: { value: "مورد كامل البيانات" } });
    fireEvent.change(textboxByLabel(dialog, "الاسم بالإنجليزي"), { target: { value: "Full Data Supplier" } });
    fireEvent.change(textboxByLabel(dialog, "الهاتف"), { target: { value: "01099998888" } });
    fireEvent.change(textboxByLabel(dialog, "شروط الدفع (أيام)"), { target: { value: "45" } });
    fireEvent.change(textboxByLabel(dialog, "التصنيف"), { target: { value: "مواد بناء" } });
    fireEvent.change(textboxByLabel(dialog, "الرصيد الافتتاحي"), { target: { value: "500" } });
    fireEvent.change(textboxByLabel(dialog, "البريد الإلكتروني"), { target: { value: "info@fulldata.example" } });
    fireEvent.change(textboxByLabel(dialog, "الرقم الضريبي"), { target: { value: "300123123123001" } });
    fireEvent.change(textboxByLabel(dialog, "جهة الاتصال"), { target: { value: "منى سليم" } });
    fireEvent.change(textboxByLabel(dialog, "المدينة"), { target: { value: "الجيزة" } });
    fireEvent.change(textboxByLabel(dialog, "الحي"), { target: { value: "الدقي" } });
    fireEvent.change(textboxByLabel(dialog, "الشارع"), { target: { value: "شارع التحرير" } });
    fireEvent.change(textboxByLabel(dialog, "ملاحظات"), { target: { value: "مورد جديد من معرض بناء مصر" } });

    fireEvent.click(within(dialog).getByRole("button", { name: "إضافة مورد" }));

    await waitFor(() => expect(created).toBeDefined());
    expect(created).toMatchObject({
      nameAr: "مورد كامل البيانات",
      nameEn: "Full Data Supplier",
      phone: "01099998888",
      paymentTermsDays: 45,
      category: "مواد بناء",
      openingBalance: "500",
      email: "info@fulldata.example",
      taxNumber: "300123123123001",
      contactPerson: "منى سليم",
      addressCity: "الجيزة",
      addressDistrict: "الدقي",
      addressStreet: "شارع التحرير",
      bankAccount: null,
      notes: "مورد جديد من معرض بناء مصر",
    });
  });

  it("closes the panel without saving on cancel, and again via the panel's own close button", async () => {
    renderScreen();
    await screen.findByText("جاري");
    fireEvent.click(screen.getByRole("button", { name: "إضافة مورد" }));
    let dialog = screen.getByRole("dialog", { name: "إضافة مورد" });
    fireEvent.change(textboxByLabel(dialog, "اسم المورد *"), { target: { value: "مورد ملغى" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "إلغاء" }));
    expect(screen.queryByRole("dialog", { name: "إضافة مورد" })).not.toBeInTheDocument();
    expect(screen.queryByText("مورد ملغى")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "إضافة مورد" }));
    dialog = screen.getByRole("dialog", { name: "إضافة مورد" });
    fireEvent.click(within(dialog).getByRole("button", { name: "إغلاق اللوحة" }));
    expect(screen.queryByRole("dialog", { name: "إضافة مورد" })).not.toBeInTheDocument();
  });

  it("paginates by real page size, showing rows beyond the previous cutoff after the size changes", async () => {
    const many = Array.from({ length: 15 }, (_, i) => supplier({ id: `sup-${i + 1}`, code: `S${String(i + 1).padStart(6, "0")}`, nameAr: `مورد رقم ${i + 1}` }));
    renderScreen(many, { route: "/?size=10" });
    await screen.findByText("مورد رقم 1");
    await waitFor(() => expect(screen.queryByText("مورد رقم 15")).not.toBeInTheDocument());

    fireEvent.click(screen.getByLabelText("صفوف لكل صفحة"));
    fireEvent.mouseDown(screen.getByRole("option", { name: "25" }));

    await waitFor(() => expect(screen.getByText("مورد رقم 15")).toBeInTheDocument());
  });

  it("sends the typed search text as the real `q` request param", async () => {
    const requests: string[] = [];
    renderScreen([supplier(), inactiveSupplier], { requests });
    await screen.findByText("جاري");
    requests.length = 0;

    fireEvent.change(screen.getByPlaceholderText("ابحث باسم المورد أو الكود أو الهاتف…"), { target: { value: "الشرقي" } });
    await waitFor(() => expect(screen.queryByText("جاري")).not.toBeInTheDocument());
    expect(requests.some((p) => new URL(p, "http://x").searchParams.get("q") === "الشرقي")).toBe(true);
  });

  it("shows the server's statement with the payable on the credit side, and the payable column is the server's owed (D201)", async () => {
    const transport = statementTransport((id) => ({
      body: statementOf(id, [
        { kind: "opening", reference: "", increase: "3200.000000", decrease: "0.000000" },
        { kind: "invoice", reference: "PINV-000001", increase: "1320.000000", decrease: "0.000000" },
        { kind: "payment", reference: "PV-000001", increase: "0.000000", decrease: "700.000000", allocations: [{ invoiceRef: "PINV-000001", amount: "600.000000" }] },
        { kind: "journal", reference: "JE-000003", increase: "80.000000", decrease: "0.000000" },
      ]),
    }), [{ supplierId: "sup-1", supplierNameAr: "جاري", supplierNameEn: null, current: "3900.000000", d31to60: "0.000000", d61to90: "0.000000", d91to120: "0.000000", over120: "0.000000", total: "3900.000000" }]);
    renderWithProviders(<SuppliersScreen />, { transport, initialSession: testAdminSession });
    expect(await screen.findByText("3,900.00")).toBeInTheDocument();
    fireEvent.click(await screen.findByText("جاري"));
    fireEvent.click(screen.getByRole("tab", { name: "كشف حساب المورد" }));

    expect((await screen.findByText("إجمالي المشتريات (دائن)")).nextElementSibling?.textContent).toBe("4,600.00");
    expect(screen.getByText("إجمالي المسدَّد (مدين)").nextElementSibling?.textContent).toBe("700.00");
    expect(screen.getByText("الرصيد الختامي (مستحق للمورد)").nextElementSibling?.textContent).toBe("3,900.00");
    expect(screen.getByText("مخصص على الفاتورة PINV-000001")).toBeInTheDocument();
    expect(screen.getByText(/غير مخصص/)).toBeInTheDocument();
    expect(screen.getByText("قيد يومية")).toBeInTheDocument();
    expect(screen.getByText("مطابق لتقرير أعمار الديون")).toBeInTheDocument();
    const agingTable = screen.getByText("أعمار فواتير هذا المورد").closest("div")!.querySelector("table")!;
    expect(within(agingTable).getAllByRole("cell").at(-1)?.textContent).toBe("3,900.00");
  });

  it("says the statement differs from the aging report when the server's two figures disagree", async () => {
    const transport = statementTransport((id) => ({
      body: statementOf(id, [{ kind: "invoice", reference: "PINV-1", increase: "1000.000000", decrease: "0.000000" }], "250.000000"),
    }));
    renderWithProviders(<SuppliersScreen />, { transport, initialSession: testAdminSession });
    fireEvent.click(await screen.findByText("جاري"));
    fireEvent.click(screen.getByRole("tab", { name: "كشف حساب المورد" }));

    expect(await screen.findByText("يختلف عن تقرير أعمار الديون")).toBeInTheDocument();
  });

  it("recovers the statement tab via retry after its request fails once", async () => {
    let fail = true;
    const transport = statementTransport((id) =>
      fail ? { status: 500, body: { error: "INTERNAL" } } : { body: statementOf(id, [{ kind: "opening", reference: "", increase: "5.000000", decrease: "0.000000" }]) },
    );
    renderWithProviders(<SuppliersScreen />, { transport, initialSession: testAdminSession });
    fireEvent.click(await screen.findByText("جاري"));
    fireEvent.click(screen.getByRole("tab", { name: "كشف حساب المورد" }));

    expect(await screen.findByText("تعذّر تحميل حركة حساب المورد.")).toBeInTheDocument();
    fail = false;
    fireEvent.click(screen.getByRole("button", { name: "إعادة المحاولة" }));
    expect((await screen.findAllByText("رصيد افتتاحي")).length).toBe(2);
  });
});
