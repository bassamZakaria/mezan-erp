// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, expect, it } from "vitest";
import { screen, fireEvent, within, waitFor } from "@testing-library/react";
import type { PurchaseInvoiceDTO, SupplierDTO, VoucherDTO } from "@mezan/contracts";
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

/** `TextField` renders a plain `<label>` with no `for`/`aria-labelledby`, so
 * `getByLabelText` cannot find its `<input>` — locate it by DOM adjacency
 * instead, matching the `Field` primitive's label-then-control layout. */
function textboxByLabel(container: HTMLElement, label: string): HTMLInputElement {
  const labelNode = within(container).getByText(label);
  const input = labelNode.parentElement?.querySelector("input, textarea");
  if (!input) throw new Error(`no text input associated with label "${label}"`);
  return input as HTMLInputElement;
}

function renderScreen(suppliers: SupplierDTO[] = [supplier(), inactiveSupplier]) {
  let current = [...suppliers];
  const transport = stubTransport({
    "GET /suppliers": (_init, path) => {
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
    "PATCH /suppliers/sup-1": (init) => {
      const patch = JSON.parse((init?.body as string) ?? "{}");
      const updated: SupplierDTO = { ...current[0]!, ...patch };
      current = [updated, ...current.slice(1)];
      return { body: updated };
    },
    // The statement tab (كشف حساب المورد) builds a real AP ledger from these.
    "GET /purchases/invoices": () => ({ body: [] }),
    "GET /vouchers": () => ({ body: [] }),
    "GET /open-invoices": () => ({ body: [] }),
    "GET /reports/aging/suppliers": () => ({ body: { rows: [], groups: [], grandTotals: {}, reconciliation: null } }),
  });
  return renderWithProviders(<SuppliersScreen />, { transport, initialSession: testAdminSession });
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

  it("LIMITATION (D123): a failed supplier list load renders the error banner over the ordinary empty-list message too", async () => {
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
    // A user cannot tell "the load failed" from "there are no suppliers" from this alone —
    // the same D123 shape already filed for items, price lists, promotions and the chart of accounts.
    expect(screen.getByText("لا يوجد موردون مطابقون")).toBeInTheDocument();
  });

  it("computes the statement's closing payable from a real opening balance and a confirmed purchase invoice", async () => {
    const inv: PurchaseInvoiceDTO = {
      id: "pinv-1",
      number: "PINV-000001",
      supplierId: "sup-1",
      date: "2026-08-15",
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
      createdAt: "2026-08-15T00:00:00.000Z",
    };
    const payment: VoucherDTO = {
      id: "vch-1",
      docNo: "PV-000001",
      voucherType: "supplier_payment",
      direction: "payment",
      status: "confirmed",
      date: "2026-08-18",
      memo: "",
      amount: "300.000000",
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
      netPaidAmount: "300.000000",
      journalEntryId: "je-1",
      confirmedAt: "2026-08-18T00:00:00.000Z",
    };
    const transport = stubTransport({
      "GET /suppliers": () => ({ body: [supplier()] }),
      "GET /suppliers/counts": () => ({ body: { all: 1, active: 1, inactive: 0 } }),
      "GET /purchases/invoices": () => ({ body: [inv] }),
      "GET /vouchers": () => ({ body: [payment] }),
      "GET /vouchers/vch-1/allocations": () => ({ body: { allocations: [] } }),
      "GET /open-invoices": () => ({ body: [] }),
      "GET /reports/aging/suppliers": () => ({ body: { rows: [], groups: [], grandTotals: {}, reconciliation: null } }),
      "GET /purchase-returns": () => ({ body: [] }),
      "GET /cheques": () => ({ body: [] }),
    });
    renderWithProviders(<SuppliersScreen />, { transport, initialSession: testAdminSession });

    fireEvent.click(await screen.findByText("جاري"));
    fireEvent.click(screen.getByRole("tab", { name: "كشف حساب المورد" }));

    // opening 3200.00 (credit) + invoice total 1000.00 (credit) − the unallocated
    // 300.00 payment (debit) = 3,900.00. Swapping the subtraction for an addition
    // (a real bug shape: crediting a payment as if it were another purchase)
    // would read 4,500.00 instead.
    const closingValue = (await screen.findByText("الرصيد الختامي (مستحق للمورد)")).nextElementSibling;
    expect(closingValue?.textContent).toBe("3,900.00");
  });
});
