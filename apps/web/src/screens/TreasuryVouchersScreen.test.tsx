// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import type { AccountDTO, BranchDTO, CustomerDTO, OpenInvoiceDTO, SupplierDTO, TreasuryAccountDTO, VoucherAllocationDTO, VoucherDTO } from "@mezan/contracts";
import { TreasuryVouchersScreen } from "./TreasuryVouchersScreen";
import { renderWithProviders, stubTransport, testAdminSession } from "../data/test-support";
import type { VoucherDetailDTO, VoucherRowDTO } from "../data/hooks";

afterEach(() => {
  document.documentElement.removeAttribute("data-theme");
});

function setMoney(input: HTMLElement, value: string) {
  fireEvent.focus(input);
  fireEvent.change(input, { target: { value } });
  fireEvent.blur(input);
}

const accounts: AccountDTO[] = [
  { id: "4900", code: "4900", nameAr: "إيرادات أخرى", nameEn: null, type: "revenue", naturalBalance: "credit", parentId: null, isHeader: false, status: "active" },
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
const suppliers: SupplierDTO[] = [];
const branches: BranchDTO[] = [
  { id: "MAIN", code: "MAIN", name: "الفرع الرئيسي", parentBranchId: null, phone: null, email: null, address: null, isMain: true, active: true },
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

const seededVouchers: VoucherRowDTO[] = [
  { ...voucher(), allocatable: true, allocationSummary: { voucherAmount: "1000.000000", allocated: "400.000000", unallocated: "600.000000", fullyAllocated: false, needsAllocation: true } },
  { ...voucher({ id: "cv-2", docNo: "CV-000002", voucherType: "other_income", amount: "500.000000", counterpartyGlAccountId: "4900", customerId: null }), allocatable: false, allocationSummary: { voucherAmount: "500.000000", allocated: "0", unallocated: "0", fullyAllocated: true, needsAllocation: false } },
  { ...voucher({ id: "cv-3", docNo: "CV-000003", voucherType: "inter_treasury_transfer", direction: "transfer", amount: "200.000000", counterpartyGlAccountId: null, counterTreasuryAccountId: "ta-cash2", counterTreasuryGlAccountId: "1300-2", customerId: null }), allocatable: false, allocationSummary: { voucherAmount: "200.000000", allocated: "0", unallocated: "0", fullyAllocated: true, needsAllocation: false } },
  { ...voucher({ id: "cv-4", docNo: "CV-000004", voucherType: "supplier_payment", direction: "payment", amount: "800.000000", counterpartyGlAccountId: "2100", customerId: null, supplierId: "sup-nile" }), allocatable: true, allocationSummary: { voucherAmount: "800.000000", allocated: "0", unallocated: "800.000000", fullyAllocated: false, needsAllocation: true } },
];

const seededAllocations: Record<string, VoucherAllocationDTO[]> = {
  "cv-1": [
    { id: "alloc-1", voucherId: "cv-1", invoiceId: "inv-1", amount: "400.000000", status: "active", createdAt: "2026-08-07T10:00:00.000Z", reversedAt: null },
  ],
};

const openInvoices: OpenInvoiceDTO[] = [
  { id: "inv-1", invoiceNo: "INV-000001", kind: "sales", partyId: "cust-amal", date: "2026-08-06", total: "1000.000000", allocated: "400.000000", outstanding: "600.000000" },
  { id: "inv-2", invoiceNo: "INV-000002", kind: "sales", partyId: "cust-amal", date: "2026-08-11", total: "600.000000", allocated: "0", outstanding: "600.000000" },
];

function renderScreen() {
  let current = [...seededVouchers];
  let nextSeq = 5;
  const allocationsByVoucher = { ...seededAllocations };
  const transport = stubTransport({
    "GET /vouchers": () => ({ body: current }),
    "GET /vouchers/cv-1": () => {
      const doc = current.find((v) => v.id === "cv-1")!;
      return { body: { ...doc, allocations: allocationsByVoucher["cv-1"] ?? [] } satisfies VoucherDetailDTO };
    },
    "GET /customers": () => ({ body: customers }),
    "GET /suppliers": () => ({ body: suppliers }),
    "GET /treasury-accounts": () => ({ body: treasuryAccounts }),
    "GET /accounts": () => ({ body: accounts }),
    "GET /open-invoices": () => ({ body: openInvoices }),
    "GET /branches": () => ({ body: branches }),
    "POST /vouchers": (init) => {
      const body = JSON.parse((init?.body as string) ?? "{}");
      const created = voucher({ ...body, id: `cv-${nextSeq}`, docNo: null, status: "draft", confirmedAt: null, journalEntryId: null });
      current = [...current, { ...created, allocatable: false, allocationSummary: { voucherAmount: created.amount, allocated: "0", unallocated: created.amount, fullyAllocated: false, needsAllocation: false } }];
      return { status: 201, body: created };
    },
    "POST /vouchers/cv-5/confirm": () => {
      const docNo = `CV-${String(nextSeq).padStart(6, "0")}`;
      nextSeq += 1;
      current = current.map((v) => (v.id === "cv-5" ? { ...v, status: "confirmed", docNo, confirmedAt: "2026-08-22T10:00:00.000Z" } : v));
      return { body: { ...current.find((v) => v.id === "cv-5")!, held: false } };
    },
    "POST /vouchers/cv-1/allocations": (init) => {
      const body = JSON.parse((init?.body as string) ?? "{}");
      const alloc: VoucherAllocationDTO = { id: "alloc-2", voucherId: "cv-1", invoiceId: body.invoiceId, amount: body.amount, status: "active", createdAt: "2026-08-22T10:00:00.000Z", reversedAt: null };
      allocationsByVoucher["cv-1"] = [...(allocationsByVoucher["cv-1"] ?? []), alloc];
      return { status: 201, body: alloc };
    },
    "POST /allocations/alloc-1/reverse": () => {
      allocationsByVoucher["cv-1"] = (allocationsByVoucher["cv-1"] ?? []).map((a) => (a.id === "alloc-1" ? { ...a, status: "reversed" as const } : a));
      return { body: allocationsByVoucher["cv-1"]!.find((a) => a.id === "alloc-1") };
    },
  });
  return renderWithProviders(<TreasuryVouchersScreen />, { transport, initialSession: testAdminSession });
}

describe("TreasuryVouchersScreen — list", () => {
  it("renders the seeded vouchers and type-breakdown chips", async () => {
    renderScreen();
    expect(screen.getByRole("heading", { name: "السندات النقدية" })).toBeInTheDocument();
    expect(await screen.findByText("CV-000001")).toBeInTheDocument();
    expect(screen.getByText("CV-000004")).toBeInTheDocument();
    // Type-breakdown quick-filter chip for the collection type.
    expect(screen.getByRole("button", { name: /تحصيل من عميل/ })).toBeInTheDocument();
  });

  it("shows an empty state when there are no vouchers yet", async () => {
    const transport = stubTransport({
      "GET /vouchers": () => ({ body: [] }),
      "GET /customers": () => ({ body: [] }),
      "GET /suppliers": () => ({ body: [] }),
      "GET /treasury-accounts": () => ({ body: [] }),
      "GET /accounts": () => ({ body: [] }),
    });
    renderWithProviders(<TreasuryVouchersScreen />, { transport, initialSession: testAdminSession });
    expect(await screen.findByText("لا توجد سندات مطابقة")).toBeInTheDocument();
  });

  it("filters to vouchers that still need allocation", async () => {
    renderScreen();
    await screen.findByText("CV-000001");
    fireEvent.click(screen.getByRole("tab", { name: /بحاجة لتخصيص/ }));
    // CV-000001 (1000, only 400 allocated) needs allocation and stays visible.
    expect(screen.getByText("CV-000001")).toBeInTheDocument();
    // CV-000002 (other income, not allocatable) is filtered out.
    expect(screen.queryByText("CV-000002")).not.toBeInTheDocument();
  });
});

describe("TreasuryVouchersScreen — create + confirm", () => {
  it("creates and confirms a customer collection, adding a CV- numbered row", async () => {
    renderScreen();
    await screen.findByText("CV-000001");
    fireEvent.click(screen.getByRole("button", { name: "سند جديد" }));

    // Step 1: pick the type.
    fireEvent.click(screen.getByText("تحصيل من عميل"));

    // Step 2: fill the form.
    setMoney(screen.getByLabelText("المبلغ"), "300");
    const partyInput = screen.getByPlaceholderText("ابحث عن عميل…");
    fireEvent.focus(partyInput);
    fireEvent.mouseDown(screen.getByText("شركة الأمل للتجارة"));

    fireEvent.click(screen.getByRole("button", { name: "إنشاء وتأكيد" }));

    await waitFor(() => expect(screen.getByRole("heading", { name: "السندات النقدية" })).toBeInTheDocument());
    // Continues the sequence from CV-000004 → CV-000005.
    expect(await screen.findByText("CV-000005")).toBeInTheDocument();
  });
});

describe("TreasuryVouchersScreen — allocation", () => {
  it("allocates part of a collection to an open invoice and reverses it", async () => {
    renderScreen();
    fireEvent.click(await screen.findByText("CV-000001"));

    // Open the allocation tab (seeded with one allocation to INV-000001).
    fireEvent.click(await screen.findByRole("tab", { name: /تخصيص على الفواتير/ }));
    expect(await screen.findByText("INV-000001")).toBeInTheDocument();

    // Allocate 200 more to INV-000002.
    fireEvent.change(await screen.findByLabelText("الفاتورة"), { target: { value: "inv-2" } });
    setMoney(screen.getByLabelText("مبلغ التخصيص"), "200");
    fireEvent.click(screen.getByRole("button", { name: "تخصيص" }));

    expect(await screen.findByText("INV-000002")).toBeInTheDocument();
    // 1000 − 400 − 200 = 400 still unallocated → still needs allocation.
    expect(screen.getByText("بحاجة لتخصيص")).toBeInTheDocument();

    // Reverse the first (seeded) allocation → INV-000001 leaves the active list.
    const reverseButtons = screen.getAllByRole("button", { name: "عكس التخصيص" });
    fireEvent.click(reverseButtons[0]!);
    await waitFor(() => expect(screen.queryByText("INV-000001")).not.toBeInTheDocument());
  });
});
