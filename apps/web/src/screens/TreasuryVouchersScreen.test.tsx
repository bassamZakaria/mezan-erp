// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it } from "vitest";
import { useState, type ReactNode } from "react";
import { screen, fireEvent, waitFor, within } from "@testing-library/react";
import type { AccountDTO, BranchDTO, CustomerDTO, OpenInvoiceDTO, SupplierDTO, TreasuryAccountDTO, VoucherAllocationDTO, VoucherDTO } from "@mezan/contracts";
import { TreasuryVouchersScreen } from "./TreasuryVouchersScreen";
import { renderWithProviders, stubTransport, testAdminSession } from "../data/test-support";
import type { VoucherDetailDTO, VoucherRowDTO } from "../data/hooks";
import { NavigationProvider } from "../navigation";

/**
 * TreasuryVouchersScreen's create and detail views are sub-pages addressed via
 * the shell's `useSubPage` (navigation.tsx), which no-ops outside a real
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
  { id: "ta-cash1", code: "CASH-001", name: "صندوق نقدي الفرع الرئيسي", nameEn: null, type: "cash", currency: "EGP", bankAccountNumber: null, branchId: "MAIN", glAccountId: "1300-1", openingBalance: "50000.000000", openingBalanceDate: "2026-08-01", guaranteeFacilityLimit: null, status: "active" },
  { id: "ta-cash2", code: "CASH-002", name: "صندوق نقدي الفرع الثاني", nameEn: null, type: "cash", currency: "EGP", bankAccountNumber: null, branchId: "MAIN", glAccountId: "1300-2", openingBalance: "2000.000000", openingBalanceDate: "2026-08-01", guaranteeFacilityLimit: null, status: "active" },
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
  const row: VoucherDTO = {
    id: "cv-1",
    docNo: "CV-000001",
    voucherType: "customer_collection",
    direction: "receipt",
    status: "confirmed",
    date: "2026-08-07",
    memo: "تحصيل من عميل",
    amount: "1000.000000",
    currency: "EGP",
    fxRate: null,
    baseAmount: "1000.000000",
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
    projectId: null,
    costCategory: null,
    withholdingAmount: null,
    withholdingRatePercent: null,
    netPaidAmount: "1000.000000",
    journalEntryId: "je-cv-1",
    confirmedAt: "2026-08-07T10:00:00.000Z",
    ...overrides,
  };
  return { ...row, baseAmount: overrides.baseAmount ?? row.amount };
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

function countsOf(rows: VoucherRowDTO[]): Record<string, number> {
  const counts: Record<string, number> = {
    all: rows.length,
    confirmed: 0,
    draft: 0,
    cancelled: 0,
    needs_allocation: 0,
    needs_allocation_receipt: 0,
    needs_allocation_payment: 0,
  };
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

function renderScreen({ heldOnConfirm = false, allocations = seededAllocations, permissions }: { heldOnConfirm?: boolean; allocations?: Record<string, VoucherAllocationDTO[]>; permissions?: string[] } = {}) {
  let current = [...seededVouchers];
  let nextSeq = 5;
  const allocationsByVoucher = { ...allocations };
  const reverseRequests: { date?: string }[] = [];
  const collectionRequests: Record<string, unknown>[] = [];
  const allocationRequests: Record<string, unknown>[] = [];
  const transport = stubTransport({
    "GET /vouchers": (_init, path) => {
      const params = new URLSearchParams(path.split("?")[1] ?? "");
      const type = params.get("type");
      const status = params.get("status");
      const needsAllocation = params.get("needsAllocation");
      const rows = current.filter((v) => {
        if (type && v.voucherType !== type) return false;
        if (status && v.status !== status) return false;
        if (needsAllocation === "any" && !v.allocationSummary?.needsAllocation) return false;
        if (needsAllocation === "receipt" && !(v.allocationSummary?.needsAllocation && v.direction === "receipt")) return false;
        if (needsAllocation === "payment" && !(v.allocationSummary?.needsAllocation && v.direction === "payment")) return false;
        return true;
      });
      // guards Q-9: the list is a SERVER page now — a stub returning the whole
      // book would let a client-side slice pass unnoticed.
      const pageSize = Number(params.get("pageSize") ?? 25);
      const page = Number(params.get("page") ?? 1);
      return { body: rows.slice((page - 1) * pageSize, page * pageSize) };
    },
    "GET /vouchers/counts": () => ({ body: countsOf(current) }),
    "GET /vouchers/stats": () => ({ body: statsOf(current) }),
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
    "POST /vouchers/collections": (init) => {
      const body = JSON.parse((init?.body as string) ?? "{}");
      collectionRequests.push(body);
      const docNo = `CV-${String(nextSeq).padStart(6, "0")}`;
      const created = voucher({
        ...body,
        voucherType: "customer_collection",
        id: `cv-${nextSeq}`,
        docNo,
        status: heldOnConfirm ? "draft" : "confirmed",
        confirmedAt: heldOnConfirm ? null : "2026-08-22T10:00:00.000Z",
      });
      nextSeq += 1;
      current = [...current, { ...created, allocatable: true, allocationSummary: { voucherAmount: created.amount, allocated: "0", unallocated: created.amount, fullyAllocated: false, needsAllocation: !heldOnConfirm } }];
      return { status: 201, body: { voucher: created, held: heldOnConfirm, allocations: [] } };
    },
    "POST /vouchers/cv-5/confirm": () => {
      const docNo = `CV-${String(nextSeq).padStart(6, "0")}`;
      nextSeq += 1;
      if (heldOnConfirm) {
        // An approval gate holds the confirm: the voucher exists and is still a
        // draft, and NOTHING was posted.
        current = current.map((v) => (v.id === "cv-5" ? { ...v, docNo } : v));
        return { body: { ...current.find((v) => v.id === "cv-5")!, held: true } };
      }
      current = current.map((v) => (v.id === "cv-5" ? { ...v, status: "confirmed", docNo, confirmedAt: "2026-08-22T10:00:00.000Z" } : v));
      return { body: { ...current.find((v) => v.id === "cv-5")!, held: false } };
    },
    "POST /vouchers/cv-1/allocations": (init) => {
      const body = JSON.parse((init?.body as string) ?? "{}");
      allocationRequests.push(body);
      const alloc: VoucherAllocationDTO = { id: `alloc-${allocationRequests.length + 1}`, voucherId: "cv-1", invoiceId: body.invoiceId, amount: body.amount, status: "active", createdAt: "2026-08-22T10:00:00.000Z", reversedAt: null, date: body.date ?? "2026-09-01" };
      allocationsByVoucher["cv-1"] = [...(allocationsByVoucher["cv-1"] ?? []), alloc];
      return { status: 201, body: alloc };
    },
    "POST /allocations/alloc-1/reverse": () => {
      allocationsByVoucher["cv-1"] = (allocationsByVoucher["cv-1"] ?? []).map((a) => (a.id === "alloc-1" ? { ...a, status: "reversed" as const } : a));
      return { body: allocationsByVoucher["cv-1"]!.find((a) => a.id === "alloc-1") };
    },
    "POST /vouchers/cv-1/reverse": (init) => {
      const body = JSON.parse((init?.body as string) ?? "{}");
      reverseRequests.push(body);
      const original = current.find((v) => v.id === "cv-1")!;
      const reversed = { ...original, status: "reversed" as const };
      current = current.map((v) => (v.id === "cv-1" ? reversed : v));
      return { status: 201, body: { original: reversed, reversal: { ...voucher({ id: "cv-1:rev", date: body.date, status: "confirmed" }) } } };
    },
  });
  const result = renderWithProviders(
    <TestNavigation>
      <TreasuryVouchersScreen />
    </TestNavigation>,
    { transport, initialSession: permissions ? { ...testAdminSession, permissions } : testAdminSession },
  );
  return { ...result, reverseRequests, collectionRequests, allocationRequests };
}

describe("TreasuryVouchersScreen — list", () => {
  it("renders the seeded vouchers and type-breakdown chips", async () => {
    renderScreen();
    expect(screen.getByRole("heading", { name: "السندات النقدية" })).toBeInTheDocument();
    expect(await screen.findByText("CV-000001")).toBeInTheDocument();
    expect(screen.getByText("CV-000004")).toBeInTheDocument();
    // Type-breakdown quick-filter chip for the collection type — a radio
    // inside the type-filter radiogroup, not a plain button.
    expect(screen.getByRole("radio", { name: /تحصيل من عميل/ })).toBeInTheDocument();
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
    // `useUrlParam`'s write is buffered onto a microtask (url-state.ts) and the
    // filter is a server query, so both conditions have to be checked in the
    // same settled snapshot — not sequentially, which can catch the DOM
    // between the old and new fetch (both rows briefly absent while loading).
    await waitFor(() => {
      // CV-000001 (1000, only 400 allocated) needs allocation and stays visible.
      expect(screen.getByText("CV-000001")).toBeInTheDocument();
      // CV-000002 (other income, not allocatable) is filtered out.
      expect(screen.queryByText("CV-000002")).not.toBeInTheDocument();
    });
  });
});

describe("TreasuryVouchersScreen — create + confirm", () => {
  it("D338: creates and confirms a customer collection in one call, adding a CV- numbered row", async () => {
    const { collectionRequests } = renderScreen();
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
    expect(collectionRequests).toHaveLength(1);
    expect(collectionRequests[0]).toMatchObject({ amount: "300.000000", allocations: [] });
  });

  it("sends the amount as the decimal that was typed, digit for digit, where a binary number would have changed it", async () => {
    const { collectionRequests } = renderScreen();
    await screen.findByText("CV-000001");
    fireEvent.click(screen.getByRole("button", { name: "سند جديد" }));
    fireEvent.click(screen.getByText("تحصيل من عميل"));
    setMoney(screen.getByLabelText("المبلغ"), "9007199254740993.10");
    const partyInput = screen.getByPlaceholderText("ابحث عن عميل…");
    fireEvent.focus(partyInput);
    fireEvent.mouseDown(screen.getByText("شركة الأمل للتجارة"));

    fireEvent.click(screen.getByRole("button", { name: "إنشاء وتأكيد" }));

    await waitFor(() => expect(collectionRequests).toHaveLength(1));
    expect(collectionRequests[0]).toMatchObject({ amount: "9007199254740993.100000" });
  });

  /**
   * D83. When an approval gate held the confirm, the wizard closed on plain
   * success — the operator was told the money had moved when no entry had been
   * posted at all.
   */
  it("D83: says the voucher is awaiting approval instead of reporting a silent success", async () => {
    renderScreen({ heldOnConfirm: true });
    await screen.findByText("CV-000001");
    fireEvent.click(screen.getByRole("button", { name: "سند جديد" }));
    fireEvent.click(screen.getByText("تحصيل من عميل"));

    setMoney(screen.getByLabelText("المبلغ"), "300");
    const partyInput = screen.getByPlaceholderText("ابحث عن عميل…");
    fireEvent.focus(partyInput);
    fireEvent.mouseDown(screen.getByText("شركة الأمل للتجارة"));

    fireEvent.click(screen.getByRole("button", { name: "إنشاء وتأكيد" }));

    expect(await screen.findByRole("status")).toHaveTextContent("أوقفته دورة الاعتماد قبل الترحيل");
    expect(screen.getByText(/لم تتحرك أي أموال بعد/)).toBeInTheDocument();
    // The wizard did NOT fall back to the list as if the voucher had posted.
    expect(screen.queryByRole("heading", { name: "السندات النقدية" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "رجوع إلى السندات" }));
    await waitFor(() => expect(screen.getByRole("heading", { name: "السندات النقدية" })).toBeInTheDocument());
  });
});

describe("TreasuryVouchersScreen — allocation", () => {
  it("allocates part of a collection to an open invoice and reverses it", async () => {
    renderScreen();
    fireEvent.click(await screen.findByText("CV-000001"));

    // Open the allocation tab (seeded with one allocation to INV-000001).
    fireEvent.click(await screen.findByRole("tab", { name: /تخصيص على الفواتير/ }));
    expect(await screen.findByText("INV-000001")).toBeInTheDocument();

    // Allocate 200 more to INV-000002. The invoice field is a listbox
    // combobox, not a native <select> — open it, then commit the option.
    fireEvent.click(await screen.findByRole("combobox", { name: "الفاتورة" }));
    fireEvent.mouseDown(screen.getByRole("option", { name: /^INV-000002/ }));
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

describe("TreasuryVouchersScreen — the day an allocation takes effect", () => {
  async function chooseSecondInvoice() {
    fireEvent.click(await screen.findByText("CV-000001"));
    fireEvent.click(await screen.findByRole("tab", { name: /تخصيص على الفواتير/ }));
    fireEvent.click(await screen.findByRole("combobox", { name: "الفاتورة" }));
    fireEvent.mouseDown(screen.getByRole("option", { name: /^INV-000002/ }));
    setMoney(screen.getByLabelText("مبلغ التخصيص"), "100");
    return screen.getByLabelText("تاريخ التخصيص") as HTMLInputElement;
  }

  it("shows the later of the voucher's day and the invoice's; left alone it is not sent, and the day the server used is stated", async () => {
    const { allocationRequests } = renderScreen();
    const date = await chooseSecondInvoice();
    expect(date.value).toBe("2026-08-11");

    fireEvent.click(screen.getByRole("button", { name: "تخصيص" }));

    await waitFor(() => expect(allocationRequests).toEqual([{ invoiceId: "inv-2", amount: "100" }]));
    expect(await screen.findByRole("status")).toHaveTextContent("2026-09-01");
  });

  it("goes back to the new invoice's own day when another invoice is chosen after a day was picked", async () => {
    renderScreen();
    const date = await chooseSecondInvoice();
    fireEvent.change(date, { target: { value: "2026-08-20" } });

    fireEvent.click(screen.getByRole("combobox", { name: "الفاتورة" }));
    fireEvent.mouseDown(screen.getByRole("option", { name: /^INV-000001/ }));

    expect((screen.getByLabelText("تاريخ التخصيص") as HTMLInputElement).value).toBe("2026-08-07");
  });

  it("sends a later day the user picked", async () => {
    const { allocationRequests } = renderScreen();
    const date = await chooseSecondInvoice();

    fireEvent.change(date, { target: { value: "2026-08-20" } });
    fireEvent.click(screen.getByRole("button", { name: "تخصيص" }));

    await waitFor(() => expect(allocationRequests).toEqual([{ invoiceId: "inv-2", amount: "100", date: "2026-08-20" }]));
  });
});

describe("TreasuryVouchersScreen — reversal", () => {
  it("asks for a reason before it reverses, sends it, and leaves the date to the server when none is picked", async () => {
    const { reverseRequests } = renderScreen();
    fireEvent.click(await screen.findByText("CV-000001"));
    fireEvent.click(await screen.findByRole("button", { name: "عكس السند" }));

    const dialog = await screen.findByRole("dialog");
    const confirm = within(dialog).getByRole("button", { name: "عكس السند" });
    expect(confirm).toBeDisabled();
    expect((within(dialog).getByLabelText("تاريخ العكس") as HTMLInputElement).value).toBe("");

    fireEvent.change(within(dialog).getByLabelText("سبب العكس"), { target: { value: "سُجّل على العميل الخطأ" } });
    fireEvent.click(confirm);

    await waitFor(() => expect(reverseRequests).toEqual([{ memo: "سُجّل على العميل الخطأ" }]));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("offers no reversal to a user who holds the void permission but not the reversal one", async () => {
    renderScreen({ permissions: ["treasury.cash_voucher.view", "treasury.account.view", "treasury.allocation.view", "treasury.cash_voucher.void"] });
    fireEvent.click(await screen.findByText("CV-000001"));
    await screen.findByRole("tab", { name: /تخصيص على الفواتير/ });

    expect(screen.queryByRole("button", { name: "عكس السند" })).not.toBeInTheDocument();
  });
});

describe("TreasuryVouchersScreen — an allocation on a revalued invoice", () => {
  it("shows the invoice relieved at what it was carried at, so applied less relieved is the realised difference", async () => {
    renderScreen({
      allocations: {
        "cv-1": [
          { id: "alloc-r", voucherId: "cv-1", invoiceId: "inv-1", amount: "48700.000000", invoiceAmount: "48000.000000", revaluationShare: "450.000000", carryingAmount: "48450.000000", fxDifference: "250.000000", status: "active", createdAt: "2026-09-10T10:00:00.000Z", reversedAt: null },
        ],
      },
    });
    fireEvent.click(await screen.findByText("CV-000001"));
    fireEvent.click(await screen.findByRole("tab", { name: /تخصيص على الفواتير/ }));
    const row = (await screen.findByText("INV-000001")).closest("tr")!;
    expect(within(row).getByText("48,700.00")).toBeInTheDocument();
    expect(within(row).getByText("48,450.00")).toBeInTheDocument();
    expect(within(row).getByText("250.00")).toBeInTheDocument();
    expect(within(row).getByText("ربح")).toBeInTheDocument();
    expect(within(row).queryByText("48,000.00")).not.toBeInTheDocument();
  });
});

describe("TreasuryVouchersScreen — an allocation whose invoice is no longer open", () => {
  it("names the document by the number the allocation carries, never by its internal id", async () => {
    renderScreen({
      allocations: {
        "cv-1": [
          { id: "alloc-paid", voucherId: "cv-1", invoiceId: "0b8f6c1e-7c1d-4f0a-9d55-2f3f1c9a7e10", invoiceNo: "CV-000042", amount: "500.000000", status: "active", createdAt: "2026-09-10T10:00:00.000Z", reversedAt: null },
        ],
      },
    });
    fireEvent.click(await screen.findByText("CV-000001"));
    fireEvent.click(await screen.findByRole("tab", { name: /تخصيص على الفواتير/ }));
    expect(await screen.findByText("CV-000042")).toBeInTheDocument();
    expect(screen.queryByText(/0b8f6c1e/)).not.toBeInTheDocument();
  });
});

describe("TreasuryVouchersScreen — allocation table (D228)", () => {
  it("shows per allocation what was applied, what the invoice was relieved of and the realised difference as a gain or a loss", async () => {
    renderScreen({
      allocations: {
        "cv-1": [
          { id: "alloc-g", voucherId: "cv-1", invoiceId: "inv-1", amount: "500.000000", invoiceAmount: "480.000000", fxDifference: "20.000000", status: "active", createdAt: "2026-08-07T10:00:00.000Z", reversedAt: null },
          { id: "alloc-l", voucherId: "cv-1", invoiceId: "inv-2", amount: "300.000000", invoiceAmount: "312.500000", fxDifference: "-12.500000", status: "active", createdAt: "2026-08-07T10:00:00.000Z", reversedAt: null },
        ],
      },
    });
    fireEvent.click(await screen.findByText("CV-000001"));
    fireEvent.click(await screen.findByRole("tab", { name: /تخصيص على الفواتير/ }));

    for (const header of ["المبلغ المخصص (بعملة السند)", "ما خُصم من الفاتورة (بالعملة الأساسية)", "فروق عملة محققة (بالعملة الأساسية)"]) {
      expect(await screen.findByRole("columnheader", { name: header })).toBeInTheDocument();
    }
    const gainRow = (await screen.findByText("INV-000001")).closest("tr")!;
    expect(within(gainRow).getByText("ربح")).toBeInTheDocument();
    expect(within(gainRow).getByText("480.00")).toBeInTheDocument();
    expect(within(gainRow).getByText("20.00")).toBeInTheDocument();
    const lossRow = screen.getByText("INV-000002").closest("tr")!;
    expect(within(lossRow).getByText("خسارة")).toBeInTheDocument();
    expect(within(lossRow).getByText("312.50")).toBeInTheDocument();
    expect(within(lossRow).getByText("12.50")).toBeInTheDocument();
  });
});
