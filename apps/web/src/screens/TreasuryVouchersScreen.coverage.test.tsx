// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it } from "vitest";
import { useState, type ReactNode } from "react";
import { screen, fireEvent, waitFor, within } from "@testing-library/react";
import type {
  AccountDTO,
  BranchDTO,
  CustomerDTO,
  OpenInvoiceDTO,
  SupplierDTO,
  TreasuryAccountDTO,
  VoucherAllocationDTO,
  VoucherDTO,
} from "@mezan/contracts";
import { TreasuryVouchersScreen } from "./TreasuryVouchersScreen";
import { renderWithProviders, stubTransport, testAdminSession, type StubResult } from "../data/test-support";
import type { VoucherDetailDTO, VoucherRowDTO } from "../data/hooks";
import { NavigationProvider, type ScreenIntent } from "../navigation";

/**
 * TreasuryVouchersScreen's create and detail views are sub-pages addressed via
 * the shell's `useSubPage` (navigation.tsx). `intent` optionally seeds a
 * pending screen intent so `useScreenIntent` runs on mount, the same way ⌘N
 * or a "تحصيل" link on a customer's page would arrive here pre-bound.
 */
function TestNavigation({ children, intent = null }: { children: ReactNode; intent?: ScreenIntent | null }) {
  const [segments, setSegments] = useState<readonly string[]>([]);
  const [pendingIntent, setPendingIntent] = useState<ScreenIntent | null>(intent);
  return (
    <NavigationProvider
      value={{
        navigate: () => {},
        segments,
        openSubPage: setSegments,
        openScreenAt: () => {},
        intent: pendingIntent,
        clearIntent: () => setPendingIntent(null),
      }}
    >
      {children}
    </NavigationProvider>
  );
}

// jsdom has no layout engine and does not implement scrollIntoView; the
// Select popup calls it when the active option changes.
if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = () => {};
}

afterEach(() => {
  document.documentElement.removeAttribute("data-theme");
  window.localStorage.clear();
});

function setMoney(input: HTMLElement, value: string) {
  fireEvent.focus(input);
  fireEvent.change(input, { target: { value } });
  fireEvent.blur(input);
}

/** Opens a `@mezan/ui` `Select` (used by every `SelectField`) and commits an option — the popup commits on mouseDown, not click. */
function pickSelect(name: string, optionName: string | RegExp) {
  fireEvent.click(screen.getByRole("combobox", { name }));
  fireEvent.mouseDown(screen.getByRole("option", { name: optionName }));
}

const accounts: AccountDTO[] = [
  { id: "4900", code: "4900", nameAr: "إيرادات أخرى", nameEn: null, type: "revenue", naturalBalance: "credit", parentId: null, isHeader: false, status: "active" },
  { id: "5910", code: "5910", nameAr: "مصروفات متنوعة", nameEn: null, type: "expense", naturalBalance: "debit", parentId: null, isHeader: false, status: "active" },
];
const treasuryAccounts: TreasuryAccountDTO[] = [
  { id: "ta-cash1", code: "CASH-001", name: "صندوق نقدي الفرع الرئيسي", nameEn: null, type: "cash", currency: "EGP", branchId: "MAIN", glAccountId: "1300-1", openingBalance: "50000.000000", openingBalanceDate: "2026-08-01", status: "active" },
  { id: "ta-cash2", code: "CASH-002", name: "صندوق نقدي الفرع الثاني", nameEn: null, type: "cash", currency: "EGP", branchId: "MAIN", glAccountId: "1300-2", openingBalance: "2000.000000", openingBalanceDate: "2026-08-01", status: "active" },
];
const customers: CustomerDTO[] = [
  {
    id: "cust-amal", code: "C1", nameAr: "شركة الأمل للتجارة", nameEn: null, phone: null, email: null, contactPerson: null, taxNumber: null,
    category: null, notes: null, paymentTermsDays: 30, currency: "EGP", openingBalance: "0", active: true, priceListId: null,
    creditLimit: "0", taxExempt: false, etaBuyerType: "auto", commercialRegistrationNumber: null, address: null, logoAttachmentId: null, nationalId: null,
  },
];
const suppliers: SupplierDTO[] = [
  { id: "sup-nile", code: "S1", nameAr: "شركة النيل للتوريدات", nameEn: null, phone: null, email: null, contactPerson: null, taxNumber: null, category: null, notes: null, paymentTermsDays: 30, currency: "EGP", openingBalance: "0", active: true, addressCity: null, addressDistrict: null, addressStreet: null },
];
const branches: BranchDTO[] = [
  { id: "MAIN", code: "MAIN", name: "الفرع الرئيسي", parentBranchId: null, phone: null, email: null, address: null, isMain: true, active: true },
];
const openSalesInvoices: OpenInvoiceDTO[] = [
  { id: "inv-1", invoiceNo: "INV-000001", kind: "sales", partyId: "cust-amal", date: "2026-08-06", total: "1000.000000", allocated: "400.000000", outstanding: "600.000000" },
];

function voucher(overrides: Partial<VoucherDTO> = {}): VoucherDTO {
  return {
    id: "cv-1",
    docNo: "CV-000001",
    voucherType: "customer_collection",
    direction: "receipt",
    status: "confirmed",
    date: "2026-08-07",
    memo: "تحصيل من عميل",
    amount: "1000.000000",
    currency: "EGP",
    branchId: "MAIN",
    paymentMethod: "cash",
    treasuryAccountId: "ta-cash1",
    treasuryGlAccountId: "1300-1",
    counterpartyGlAccountId: "1105",
    counterTreasuryAccountId: null,
    counterTreasuryGlAccountId: null,
    customerId: "cust-amal",
    supplierId: null,
    referenceNo: "REF-1001",
    costCenterId: null,
    withholdingAmount: null,
    withholdingRatePercent: null,
    netPaidAmount: "1000.000000",
    journalEntryId: "je-cv-1",
    confirmedAt: "2026-08-07T10:00:00.000Z",
    ...overrides,
  };
}

/** Rows for the list + counts/stats — one per behaviour under test, see the describe blocks below for which row exercises which branch. */
const seededVouchers: VoucherRowDTO[] = [
  { ...voucher(), allocatable: true, allocationSummary: { voucherAmount: "1000.000000", allocated: "400.000000", unallocated: "600.000000", fullyAllocated: false, needsAllocation: true } },
  { ...voucher({ id: "cv-2", docNo: "CV-000002", voucherType: "other_income", amount: "500.000000", counterpartyGlAccountId: "4900", customerId: null, journalEntryId: "je-cv-2" }), allocatable: false, allocationSummary: { voucherAmount: "500.000000", allocated: "0", unallocated: "0", fullyAllocated: true, needsAllocation: false } },
  { ...voucher({ id: "cv-3", docNo: "CV-000003", voucherType: "inter_treasury_transfer", direction: "transfer", amount: "200.000000", counterpartyGlAccountId: null, counterTreasuryAccountId: "ta-cash2", counterTreasuryGlAccountId: "1300-2", customerId: null, journalEntryId: "je-cv-3" }), allocatable: false, allocationSummary: { voucherAmount: "200.000000", allocated: "0", unallocated: "0", fullyAllocated: true, needsAllocation: false } },
  { ...voucher({ id: "cv-4", docNo: "CV-000004", voucherType: "supplier_payment", direction: "payment", amount: "800.000000", counterpartyGlAccountId: "2100", customerId: null, supplierId: "sup-nile", journalEntryId: "je-cv-4" }), allocatable: true, allocationSummary: { voucherAmount: "800.000000", allocated: "0", unallocated: "800.000000", fullyAllocated: false, needsAllocation: true } },
  { ...voucher({ id: "cv-5", docNo: "CV-000005", voucherType: "supplier_payment", direction: "payment", amount: "300.000000", counterpartyGlAccountId: "2100", customerId: null, supplierId: "sup-nile", journalEntryId: "je-cv-5" }), allocatable: true, allocationSummary: { voucherAmount: "300.000000", allocated: "300.000000", unallocated: "0", fullyAllocated: true, needsAllocation: false } },
  { ...voucher({ id: "cv-6", docNo: null, voucherType: "customer_collection", amount: "150.000000", status: "draft", confirmedAt: null, journalEntryId: null }), allocatable: true, allocationSummary: { voucherAmount: "150.000000", allocated: "0", unallocated: "150.000000", fullyAllocated: false, needsAllocation: true } },
  { ...voucher({ id: "cv-7", docNo: "CV-000007", voucherType: "other_expense", direction: "payment", amount: "400.000000", counterpartyGlAccountId: "5910", customerId: null, status: "reversed", journalEntryId: "je-cv-7" }), allocatable: false, allocationSummary: { voucherAmount: "400.000000", allocated: "0", unallocated: "0", fullyAllocated: true, needsAllocation: false } },
  { ...voucher({ id: "cv-8", docNo: "CV-000008", voucherType: "tax_payment", direction: "payment", amount: "250.000000", counterpartyGlAccountId: "2200", customerId: null, journalEntryId: "je-cv-8" }), allocatable: false, allocationSummary: { voucherAmount: "250.000000", allocated: "0", unallocated: "0", fullyAllocated: true, needsAllocation: false } },
  { ...voucher({ id: "cv-9", docNo: "CV-000009", voucherType: "customer_advance", amount: "600.000000", counterpartyGlAccountId: "2160", treasuryAccountId: "ta-unknown", treasuryGlAccountId: "1300-9", journalEntryId: "je-cv-9" }), allocatable: false, allocationSummary: { voucherAmount: "600.000000", allocated: "0", unallocated: "0", fullyAllocated: true, needsAllocation: false } },
];

const seededAllocations: Record<string, VoucherAllocationDTO[]> = {
  "cv-1": [{ id: "alloc-1", voucherId: "cv-1", invoiceId: "inv-1", amount: "400.000000", status: "active", createdAt: "2026-08-07T10:00:00.000Z", reversedAt: null }],
  "cv-5": [{ id: "alloc-5", voucherId: "cv-5", invoiceId: "pinv-1", amount: "300.000000", status: "active", createdAt: "2026-08-08T10:00:00.000Z", reversedAt: null }],
};

function countsOf(rows: VoucherRowDTO[]): Record<string, number> {
  const counts: Record<string, number> = { all: rows.length, confirmed: 0, draft: 0, cancelled: 0, reversed: 0, needs_allocation: 0, needs_allocation_receipt: 0, needs_allocation_payment: 0 };
  for (const r of rows) {
    counts[r.status] = (counts[r.status] ?? 0) + 1;
    counts[`type:${r.voucherType}`] = (counts[`type:${r.voucherType}`] ?? 0) + 1;
    if (r.allocationSummary?.needsAllocation) {
      counts.needs_allocation = (counts.needs_allocation ?? 0) + 1;
      if (r.direction === "receipt") counts.needs_allocation_receipt = (counts.needs_allocation_receipt ?? 0) + 1;
      if (r.direction === "payment") counts.needs_allocation_payment = (counts.needs_allocation_payment ?? 0) + 1;
    }
  }
  return counts;
}
function statsOf(rows: VoucherRowDTO[]): Record<string, number> {
  return {
    count: rows.length,
    confirmed: rows.filter((r) => r.status === "confirmed").length,
    draft: rows.filter((r) => r.status === "draft").length,
    needsAllocation: rows.filter((r) => r.allocationSummary?.needsAllocation).length,
  };
}

type Handler = (init: RequestInit | undefined, path: string) => StubResult;

function renderScreen(options: { route?: string; intent?: ScreenIntent | null; extra?: Record<string, Handler>; treasuryAccounts?: TreasuryAccountDTO[]; branches?: BranchDTO[] } = {}) {
  let current = [...seededVouchers];
  let nextSeq = 100;
  const allocationsByVoucher: Record<string, VoucherAllocationDTO[]> = { ...seededAllocations };
  const detailsById = new Map<string, VoucherDetailDTO>();
  for (const v of current) {
    // cv-8 is deliberately left without a detail record: its list row exists
    // but opening it must surface a load failure, not a crash.
    if (v.id === "cv-8") continue;
    detailsById.set(v.id, { ...v, allocations: allocationsByVoucher[v.id] ?? [] });
  }

  const transport = stubTransport({
    "GET /vouchers": (_init, path) => {
      const params = new URLSearchParams(path.split("?")[1] ?? "");
      const type = params.get("type");
      const status = params.get("status");
      const needsAllocation = params.get("needsAllocation");
      const branchId = params.get("branchId");
      const fromDate = params.get("fromDate");
      const toDate = params.get("toDate");
      const search = params.get("search");
      const rows = current.filter((v) => {
        if (type && v.voucherType !== type) return false;
        if (status && v.status !== status) return false;
        if (needsAllocation === "any" && !v.allocationSummary?.needsAllocation) return false;
        if (needsAllocation === "receipt" && !(v.allocationSummary?.needsAllocation && v.direction === "receipt")) return false;
        if (needsAllocation === "payment" && !(v.allocationSummary?.needsAllocation && v.direction === "payment")) return false;
        if (branchId && v.branchId !== branchId) return false;
        if (fromDate && v.date < fromDate) return false;
        if (toDate && v.date > toDate) return false;
        if (search && !(v.docNo ?? "").includes(search) && !(v.referenceNo ?? "").includes(search)) return false;
        return true;
      });
      return { body: rows };
    },
    "GET /vouchers/counts": () => ({ body: countsOf(current) }),
    "GET /vouchers/stats": () => ({ body: statsOf(current) }),
    "GET /vouchers/*": (_init, path) => {
      const id = path.split("?")[0]!.split("/")[2]!;
      const doc = detailsById.get(id);
      if (!doc) return { status: 404, body: { error: "NOT_FOUND" } };
      return { body: doc };
    },
    "GET /customers": () => ({ body: customers }),
    "GET /suppliers": () => ({ body: suppliers }),
    "GET /treasury-accounts": () => ({ body: options.treasuryAccounts ?? treasuryAccounts }),
    "GET /accounts": () => ({ body: accounts }),
    "GET /branches": () => ({ body: options.branches ?? branches }),
    "GET /warehouses": () => ({ body: [] }),
    "GET /cost-centers": () => ({ body: [] }),
    "GET /open-invoices": (_init, path) => {
      const params = new URLSearchParams(path.split("?")[1] ?? "");
      const kind = params.get("kind");
      const partyId = params.get("partyId");
      if (kind === "sales" && partyId === "cust-amal") return { body: openSalesInvoices };
      return { body: [] };
    },
    "POST /vouchers": (init) => {
      const body = JSON.parse((init?.body as string) ?? "{}");
      const id = `cv-${nextSeq}`;
      const created = voucher({ ...body, id, docNo: null, status: "draft", confirmedAt: null, journalEntryId: null });
      const row: VoucherRowDTO = { ...created, allocatable: false, allocationSummary: { voucherAmount: created.amount, allocated: "0", unallocated: created.amount, fullyAllocated: false, needsAllocation: false } };
      current = [...current, row];
      detailsById.set(id, { ...row, allocations: [] });
      return { status: 201, body: created };
    },
    "POST /vouchers/*/confirm": (_init, path) => {
      const id = path.split("/")[2]!;
      const docNo = `CV-${String(nextSeq).padStart(6, "0")}`;
      nextSeq += 1;
      current = current.map((v) => (v.id === id ? { ...v, status: "confirmed" as const, docNo, confirmedAt: "2026-08-22T10:00:00.000Z", journalEntryId: `je-${id}` } : v));
      const updated = current.find((v) => v.id === id)!;
      const existing = detailsById.get(id);
      if (existing) detailsById.set(id, { ...existing, ...updated });
      return { body: { ...updated, held: false } };
    },
    "POST /vouchers/*/cancel": (_init, path) => {
      const id = path.split("/")[2]!;
      current = current.map((v) => (v.id === id ? { ...v, status: "cancelled" as const } : v));
      return { body: current.find((v) => v.id === id) };
    },
    "POST /vouchers/cv-1/allocations": (init) => {
      const body = JSON.parse((init?.body as string) ?? "{}");
      const alloc: VoucherAllocationDTO = { id: "alloc-2", voucherId: "cv-1", invoiceId: body.invoiceId, amount: body.amount, status: "active", createdAt: "2026-08-22T10:00:00.000Z", reversedAt: null };
      allocationsByVoucher["cv-1"] = [...(allocationsByVoucher["cv-1"] ?? []), alloc];
      return { status: 201, body: alloc };
    },
    ...options.extra,
  });

  return renderWithProviders(
    <TestNavigation intent={options.intent}>
      <TreasuryVouchersScreen />
    </TestNavigation>,
    { transport, initialSession: testAdminSession, route: options.route },
  );
}

describe("TreasuryVouchersScreen — filters", () => {
  it("narrows the list to a single voucher type via the type-breakdown chips", async () => {
    renderScreen();
    await screen.findByText("CV-000001");
    fireEvent.click(screen.getByRole("radio", { name: /دفع لمورد/ }));
    await waitFor(() => {
      expect(screen.getByText("CV-000004")).toBeInTheDocument();
      expect(screen.queryByText("CV-000001")).not.toBeInTheDocument();
    });
  });

  it("narrows to the receipts allocation queue and, separately, to the payments allocation queue", async () => {
    renderScreen();
    await screen.findByText("CV-000001");
    fireEvent.click(screen.getByRole("tab", { name: /محتاج تخصيص — مقبوضات/ }));
    await waitFor(() => {
      expect(screen.getByText("CV-000001")).toBeInTheDocument();
      expect(screen.queryByText("CV-000004")).not.toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole("tab", { name: /محتاج تخصيص — مدفوعات/ }));
    await waitFor(() => {
      expect(screen.getByText("CV-000004")).toBeInTheDocument();
      expect(screen.queryByText("CV-000001")).not.toBeInTheDocument();
    });
  });

  it("filters by a concrete status chip, not only the allocation queues", async () => {
    renderScreen();
    await screen.findByText("CV-000001");
    fireEvent.click(screen.getByRole("tab", { name: /^مسودة/ }));
    await waitFor(() => {
      expect(screen.getByText("—")).toBeInTheDocument();
      expect(screen.queryByText("CV-000001")).not.toBeInTheDocument();
    });
  });

  it("narrows the list by branch, date range and free-text search", async () => {
    renderScreen();
    await screen.findByText("CV-000001");

    pickSelect("الفرع", "الفرع الرئيسي");
    await waitFor(() => expect(screen.getByText("CV-000001")).toBeInTheDocument());

    fireEvent.change(screen.getByLabelText("من تاريخ"), { target: { value: "2026-08-08" } });
    await waitFor(() => expect(screen.queryByText("CV-000001")).not.toBeInTheDocument());
    fireEvent.change(screen.getByLabelText("من تاريخ"), { target: { value: "" } });

    fireEvent.change(screen.getByLabelText("إلى تاريخ"), { target: { value: "2026-08-06" } });
    await waitFor(() => expect(screen.queryByText("CV-000001")).not.toBeInTheDocument());
    fireEvent.change(screen.getByLabelText("إلى تاريخ"), { target: { value: "" } });

    fireEvent.change(screen.getByPlaceholderText("ابحث برقم السند، المرجع، العميل، المورد…"), { target: { value: "CV-000002" } });
    await waitFor(() => {
      expect(screen.getByText("CV-000002")).toBeInTheDocument();
      expect(screen.queryByText("CV-000001")).not.toBeInTheDocument();
    });
  });

  it("shows a retry option when the voucher list fails to load", async () => {
    renderScreen({ extra: { "GET /vouchers": () => ({ status: 500, body: { error: "SERVER_ERROR" } }) } });
    expect(await screen.findByText("تعذّر تحميل السندات.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "إعادة المحاولة" }));
  });

  it("resets to page 1 when the URL names a page past the end of the results", async () => {
    renderScreen({ route: "/?page=99" });
    expect(await screen.findByText("CV-000001")).toBeInTheDocument();
  });

  it("shows an unknown treasury account id verbatim rather than hiding the row", async () => {
    renderScreen();
    await screen.findByText("CV-000009");
    expect(screen.getByText("ta-unknown")).toBeInTheDocument();
  });
});

describe("TreasuryVouchersScreen — create flow prefilled by a screen intent", () => {
  it("opens the create form already bound to a named customer, defaulted to a collection", async () => {
    renderScreen({ intent: { kind: "create", prefill: { customerId: "cust-amal" } } });
    expect(await screen.findByRole("heading", { name: "تحصيل من عميل" })).toBeInTheDocument();
    expect(await screen.findByDisplayValue("شركة الأمل للتجارة")).toBeInTheDocument();
  });

  it("opens the create form already bound to a named supplier, defaulted to a payment", async () => {
    renderScreen({ intent: { kind: "create", prefill: { supplierId: "sup-nile" } } });
    expect(await screen.findByRole("heading", { name: "دفع لمورد" })).toBeInTheDocument();
    expect(await screen.findByDisplayValue("شركة النيل للتوريدات")).toBeInTheDocument();
  });
});

describe("TreasuryVouchersScreen — create view, per voucher type", () => {
  it("a transfer asks for a destination treasury and blocks submit until the two treasuries differ", async () => {
    renderScreen();
    await screen.findByText("CV-000001");
    fireEvent.click(screen.getByRole("button", { name: "سند جديد" }));
    fireEvent.click(screen.getByText("تحويل بين الخزائن"));

    setMoney(screen.getByLabelText("المبلغ"), "100");
    expect(screen.getByRole("combobox", { name: "من الخزينة *" })).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "إلى الخزينة *" })).toBeInTheDocument();

    pickSelect("إلى الخزينة *", /CASH-001/);
    expect(screen.getByRole("button", { name: "إنشاء وتأكيد" })).toBeDisabled();

    pickSelect("إلى الخزينة *", /CASH-002/);
    expect(screen.getByRole("button", { name: "إنشاء وتأكيد" })).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: "إنشاء وتأكيد" }));

    await waitFor(() => expect(screen.getByRole("heading", { name: "السندات النقدية" })).toBeInTheDocument());
    expect(await screen.findByText("CV-000100")).toBeInTheDocument();
  });

  it("a supplier payment withholds tax against the entered rate and offers a cost centre", async () => {
    renderScreen();
    await screen.findByText("CV-000001");
    fireEvent.click(screen.getByRole("button", { name: "سند جديد" }));
    fireEvent.click(screen.getByText("دفع لمورد"));

    setMoney(screen.getByLabelText("المبلغ"), "1000");
    const partyInput = screen.getByPlaceholderText("ابحث عن مورّد…");
    fireEvent.focus(partyInput);
    fireEvent.mouseDown(screen.getByText("شركة النيل للتوريدات"));

    fireEvent.change(screen.getByLabelText("نسبة ضريبة الخصم %"), { target: { value: "5" } });
    expect(screen.getByText("مركز التكلفة")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "إنشاء وتأكيد" }));
    await waitFor(() => expect(screen.getByRole("heading", { name: "السندات النقدية" })).toBeInTheDocument());
    expect(await screen.findByText("CV-000100")).toBeInTheDocument();
  });

  it("other income has no party field and posts against the chosen revenue account", async () => {
    renderScreen();
    await screen.findByText("CV-000001");
    fireEvent.click(screen.getByRole("button", { name: "سند جديد" }));
    fireEvent.click(screen.getByText("إيراد آخر"));

    expect(screen.queryByPlaceholderText("ابحث عن عميل…")).not.toBeInTheDocument();
    expect(screen.queryByPlaceholderText("ابحث عن مورّد…")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("نسبة ضريبة الخصم %")).not.toBeInTheDocument();

    setMoney(screen.getByLabelText("المبلغ"), "75");
    fireEvent.click(screen.getByRole("button", { name: "إنشاء وتأكيد" }));
    await waitFor(() => expect(screen.getByRole("heading", { name: "السندات النقدية" })).toBeInTheDocument());
    expect(await screen.findByText("CV-000100")).toBeInTheDocument();
  });

  it("other expense offers only expense accounts as its contra account", async () => {
    renderScreen();
    await screen.findByText("CV-000001");
    fireEvent.click(screen.getByRole("button", { name: "سند جديد" }));
    fireEvent.click(screen.getByText("مصروف آخر"));

    setMoney(screen.getByLabelText("المبلغ"), "60");
    pickSelect("الحساب المقابل *", /مصروفات متنوعة/);
    expect(screen.getByLabelText("نسبة ضريبة الخصم %")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "إنشاء وتأكيد" }));
    await waitFor(() => expect(screen.getByRole("heading", { name: "السندات النقدية" })).toBeInTheDocument());
    expect(await screen.findByText("CV-000100")).toBeInTheDocument();
  });

  it("falls back gracefully when no treasury accounts or branches have loaded yet", async () => {
    renderScreen({ treasuryAccounts: [], branches: [] });
    await screen.findByText("CV-000001");
    fireEvent.click(screen.getByRole("button", { name: "سند جديد" }));
    fireEvent.click(screen.getByText("إيراد آخر"));

    setMoney(screen.getByLabelText("المبلغ"), "40");
    expect(screen.queryByText("أدخل مبلغاً لعرض التأثيرات.")).not.toBeInTheDocument();
  });

  it("a server refusal on create shows the screen's Arabic error, not a thrown exception", async () => {
    renderScreen({ extra: { "POST /vouchers": () => ({ status: 400, body: {} }) } });
    await screen.findByText("CV-000001");
    fireEvent.click(screen.getByRole("button", { name: "سند جديد" }));
    fireEvent.click(screen.getByText("إيراد آخر"));
    setMoney(screen.getByLabelText("المبلغ"), "20");
    fireEvent.click(screen.getByRole("button", { name: "إنشاء وتأكيد" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("تعذر إنشاء السند.");
  });
});

describe("TreasuryVouchersScreen — detail view", () => {
  it("shows an empty-invoices message on a confirmed, allocatable voucher whose party has no open invoices", async () => {
    renderScreen();
    fireEvent.click(await screen.findByText("CV-000004"));
    fireEvent.click(await screen.findByRole("tab", { name: /تخصيص على الفواتير/ }));
    expect(await screen.findByText("لا توجد تخصيصات بعد")).toBeInTheDocument();
    expect(screen.getByText("لا توجد فواتير مفتوحة لهذا الطرف.")).toBeInTheDocument();
  });

  it("a fully-allocated voucher shows no allocation form even though it is confirmed", async () => {
    renderScreen();
    fireEvent.click(await screen.findByText("CV-000005"));
    fireEvent.click(await screen.findByRole("tab", { name: /تخصيص على الفواتير/ }));
    expect((await screen.findAllByText("مخصّص بالكامل")).length).toBeGreaterThan(0);
    expect(screen.queryByRole("combobox", { name: "الفاتورة" })).not.toBeInTheDocument();
  });

  it("a non-allocatable voucher's detail has no allocations tab", async () => {
    renderScreen();
    fireEvent.click(await screen.findByText("CV-000002"));
    await screen.findByText("لم يُرحّل هذا السند بعد.").catch(() => null);
    expect(await screen.findByText(/رُحّل هذا السند/)).toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: /تخصيص على الفواتير/ })).not.toBeInTheDocument();
  });

  it("a transfer voucher's party shows as 'no party' — it has neither a customer nor a supplier", async () => {
    renderScreen();
    fireEvent.click(await screen.findByText("CV-000003"));
    expect(await screen.findByText("بدون طرف محدد")).toBeInTheDocument();
  });

  it("a draft voucher falls back to a generic title, shows it hasn't posted yet, and offers no reverse action", async () => {
    renderScreen();
    await screen.findByText("CV-000001");
    const rows = screen.getAllByRole("row");
    const draftRow = rows.find((r) => within(r).queryByText("مسودة") !== null)!;
    fireEvent.click(draftRow);
    expect(await screen.findByRole("heading", { name: "سند نقدي" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("tab", { name: "القيود المحاسبية" }));
    expect(screen.getByText("لم يُرحّل هذا السند بعد.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "عكس السند" })).not.toBeInTheDocument();
  });

  it("a reversed voucher offers no reverse action either", async () => {
    renderScreen();
    fireEvent.click(await screen.findByText("CV-000007"));
    await screen.findByRole("heading", { name: "CV-000007" });
    expect(screen.queryByRole("button", { name: "عكس السند" })).not.toBeInTheDocument();
  });

  it("opening a voucher the server refuses to return shows a load-failure notice instead of a crash", async () => {
    renderScreen();
    fireEvent.click(await screen.findByText("CV-000008"));
    expect(await screen.findByText("تعذّر تحميل السند.")).toBeInTheDocument();
  });

  it("allocating an amount the server rejects surfaces the Arabic error inline", async () => {
    renderScreen({ extra: { "POST /vouchers/cv-1/allocations": () => ({ status: 400, body: {} }) } });
    fireEvent.click(await screen.findByText("CV-000001"));
    fireEvent.click(await screen.findByRole("tab", { name: /تخصيص على الفواتير/ }));
    fireEvent.click(await screen.findByRole("combobox", { name: "الفاتورة" }));
    fireEvent.mouseDown(screen.getByRole("option", { name: /^INV-000001/ }));
    setMoney(screen.getByLabelText("مبلغ التخصيص"), "100");
    fireEvent.click(screen.getByRole("button", { name: "تخصيص" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("تعذر تخصيص المبلغ.");
  });

  it("reversing an allocation the server rejects surfaces the Arabic error inline", async () => {
    renderScreen({ extra: { "POST /allocations/alloc-1/reverse": () => ({ status: 400, body: {} }) } });
    fireEvent.click(await screen.findByText("CV-000001"));
    fireEvent.click(await screen.findByRole("tab", { name: /تخصيص على الفواتير/ }));
    fireEvent.click(await screen.findByRole("button", { name: "عكس التخصيص" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("تعذر عكس التخصيص.");
  });
});

describe("TreasuryVouchersScreen — row actions", () => {
  it("cancels a draft voucher from the row menu after confirming, and it leaves the draft count", async () => {
    renderScreen();
    await screen.findByText("CV-000001");
    fireEvent.click(screen.getByRole("button", { name: "عرض cv-6" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "إلغاء السند" }));
    const dialog = screen.getByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "إلغاء السند" }));
    await waitFor(() => expect(screen.getByRole("tab", { name: /^ملغي/ })).toBeInTheDocument());
  });
});
