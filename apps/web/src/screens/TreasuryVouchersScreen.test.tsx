// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it } from "vitest";
import { useState, type ReactNode } from "react";
import { screen, fireEvent, waitFor, within } from "@testing-library/react";
import type { Session } from "../data/session";
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
    creditLimit: "0", taxExempt: false, taxExemptionRateId: null, etaBuyerType: "auto", commercialRegistrationNumber: null, address: null, logoAttachmentId: null, nationalId: null,
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

type CollectionAnswer = { status: number; body: unknown } | undefined;

function renderScreen({
  heldOnConfirm = false,
  allocations = seededAllocations,
  permissions,
  vouchers = seededVouchers,
  answerCollection,
  answerAllocation,
  heldOnStaleApproval = false,
  session = testAdminSession,
  drafts = [],
}: {
  heldOnConfirm?: boolean;
  allocations?: Record<string, VoucherAllocationDTO[]>;
  permissions?: string[];
  vouchers?: VoucherRowDTO[];
  answerCollection?: (attempt: number) => CollectionAnswer;
  answerAllocation?: (attempt: number) => CollectionAnswer;
  heldOnStaleApproval?: boolean;
  session?: Session;
  drafts?: VoucherRowDTO[];
} = {}) {
  const allocationRequests: { allocationId?: string; invoiceId: string; amount: string; date?: string }[] = [];
  let current = heldOnStaleApproval ? vouchers.map((v) => (v.id === "cv-1" ? { ...v, status: "pending" as const, workflowRequestId: "cv-1:confirm" } : v)) : [...vouchers, ...drafts];
  const createRequests: Record<string, unknown>[] = [];
  const draftConfirms: string[] = [];
  let standingStatus = "reapproval_required";
  const confirmRequests: string[] = [];
  let nextSeq = 5;
  const allocationsByVoucher = { ...allocations };
  const reverseRequests: { date?: string }[] = [];
  const collectionRequests: Record<string, unknown>[] = [];
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
    "GET /vouchers/cv-1-rev": () => {
      const doc = current.find((v) => v.id === "cv-1-rev")!;
      return { body: { ...doc, allocations: [] } satisfies VoucherDetailDTO };
    },
    "GET /workflow/requests/*/standing": () => ({
      body: { id: "cv-1:confirm", status: standingStatus, reason: standingStatus === "reapproval_required" ? STALE_APPROVAL_REASON : null, reasonEn: null },
    }),
    "POST /vouchers/cv-1/confirm": () => {
      confirmRequests.push("cv-1");
      standingStatus = "pending";
      return { body: { ...current.find((v) => v.id === "cv-1")!, held: true } };
    },
    "GET /customers": () => ({ body: customers }),
    "GET /suppliers": () => ({ body: suppliers }),
    "GET /treasury-accounts": () => ({ body: treasuryAccounts }),
    "GET /accounts": () => ({ body: accounts }),
    "GET /open-invoices": () => ({ body: openInvoices }),
    "GET /branches": () => ({ body: branches }),
    "POST /vouchers/draft-a/confirm": () => {
      draftConfirms.push("draft-a");
      current = current.map((v) => (v.id === "draft-a" ? { ...v, status: "confirmed" as const, docNo: "CV-000101", confirmedAt: "2026-08-22T10:00:00.000Z" } : v));
      return { body: { ...current.find((v) => v.id === "draft-a")!, held: false } };
    },
    "POST /vouchers/draft-b/confirm": () => {
      draftConfirms.push("draft-b");
      return { status: 422, body: { error: "CASH_BALANCE_NEGATIVE", message: "لا يمكن تأكيد السند: رصيد الخزينة سيصبح سالباً." } };
    },
    "POST /vouchers": (init) => {
      const body = JSON.parse((init?.body as string) ?? "{}");
      createRequests.push(body);
      const created = voucher({ ...body, id: `cv-${nextSeq}`, docNo: null, status: "draft", confirmedAt: null, journalEntryId: null });
      current = [...current, { ...created, allocatable: false, allocationSummary: { voucherAmount: created.amount, allocated: "0", unallocated: created.amount, fullyAllocated: false, needsAllocation: false } }];
      return { status: 201, body: created };
    },
    "POST /vouchers/collections": (init) => {
      const body = JSON.parse((init?.body as string) ?? "{}");
      collectionRequests.push(body);
      const instead = answerCollection?.(collectionRequests.length);
      if (instead) return instead;
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
      const refused = answerAllocation?.(allocationRequests.length);
      if (refused) return refused;
      const alloc: VoucherAllocationDTO = { id: body.allocationId ?? `alloc-${allocationRequests.length + 1}`, voucherId: "cv-1", invoiceId: body.invoiceId, amount: body.amount, status: "active", createdAt: "2026-08-22T10:00:00.000Z", reversedAt: null, date: body.date ?? "2026-09-01" };
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
    { transport, initialSession: permissions ? { ...session, permissions } : session },
  );
  return { ...result, reverseRequests, collectionRequests, allocationRequests, confirmRequests, createRequests, draftConfirms };
}

const STALE_APPROVAL_REASON = "اعتُمد هذا المستند أو أُرسل للموافقة قبل تحديث النظام ولم يُرحَّل؛ الموافقة السابقة لم تعد صالحة للترحيل.";

describe("TreasuryVouchersScreen — a voucher held on an approval given before the upgrade", () => {
  it("says why on the voucher and requests approval again through its own confirm", async () => {
    const { confirmRequests } = renderScreen({ heldOnStaleApproval: true });
    fireEvent.click(await screen.findByText("CV-000001"));
    const notice = await screen.findByTestId("reapproval-notice");
    expect(notice).toHaveTextContent(STALE_APPROVAL_REASON);
    fireEvent.click(within(notice).getByRole("button", { name: "طلب الموافقة من جديد" }));
    await waitFor(() => expect(confirmRequests).toEqual(["cv-1"]));
    await waitFor(() => expect(screen.queryByTestId("reapproval-notice")).not.toBeInTheDocument());
  });

  it("a voucher that is not held shows no such notice", async () => {
    renderScreen();
    fireEvent.click(await screen.findByText("CV-000001"));
    await screen.findByRole("tab", { name: /تخصيص على الفواتير/ });
    expect(screen.queryByTestId("reapproval-notice")).not.toBeInTheDocument();
  });
});

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

  async function fillCollection(amount: string) {
    fireEvent.click(screen.getByRole("button", { name: "سند جديد" }));
    fireEvent.click(screen.getByText("تحصيل من عميل"));
    setMoney(screen.getByLabelText("المبلغ"), amount);
    fireEvent.focus(screen.getByPlaceholderText("ابحث عن عميل…"));
    fireEvent.mouseDown(screen.getByText("شركة الأمل للتجارة"));
    return screen.getByRole("button", { name: "إنشاء وتأكيد" });
  }

  it("sends the same voucher id again when the first save got no answer, and a fresh one for the next voucher", async () => {
    const { collectionRequests } = renderScreen({
      answerCollection: (attempt) => (attempt === 1 ? { status: 503, body: { error: "DATABASE_BUSY", message: "قاعدة البيانات مشغولة" } } : undefined),
    });
    await screen.findByText("CV-000001");
    const save = await fillCollection("300");

    fireEvent.click(save);
    expect(await screen.findByText("قاعدة البيانات مشغولة")).toBeInTheDocument();
    await waitFor(() => expect(save).toBeEnabled());
    fireEvent.click(save);
    await waitFor(() => expect(screen.getByRole("heading", { name: "السندات النقدية" })).toBeInTheDocument());

    expect(collectionRequests).toHaveLength(2);
    expect(collectionRequests[0]?.["id"]).toMatch(/^[0-9a-f-]{36}$/);
    expect(collectionRequests[1]?.["id"]).toBe(collectionRequests[0]?.["id"]);

    fireEvent.click(await fillCollection("120"));
    await waitFor(() => expect(collectionRequests).toHaveLength(3));
    expect(collectionRequests[2]?.["id"]).not.toBe(collectionRequests[0]?.["id"]);
  });

  it("opens the voucher already recorded, with a notice, when its id was used with other contents", async () => {
    const { collectionRequests } = renderScreen({
      answerCollection: () => ({ status: 409, body: { error: "IDEMPOTENCY_KEY_REUSED", message: "سبق تسجيل مستند بهذا المعرّف ببيانات مختلفة" } }),
    });
    await screen.findByText("CV-000001");

    fireEvent.click(await fillCollection("300"));

    expect(await screen.findByRole("status")).toHaveTextContent("سبق تسجيل هذا السند، ففُتح السند المسجَّل بدل تسجيل آخر");
    expect(screen.queryByRole("button", { name: "إنشاء وتأكيد" })).not.toBeInTheDocument();
    expect(collectionRequests).toHaveLength(1);
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

    await waitFor(() => expect(allocationRequests).toEqual([{ allocationId: expect.any(String), invoiceId: "inv-2", amount: "100" }]));
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

    await waitFor(() => expect(allocationRequests).toEqual([{ allocationId: expect.any(String), invoiceId: "inv-2", amount: "100", date: "2026-08-20" }]));
  });
});

describe("TreasuryVouchersScreen — an allocation pressed again", () => {
  async function allocate(invoice: RegExp, amount: string) {
    fireEvent.click(await screen.findByRole("combobox", { name: "الفاتورة" }));
    fireEvent.mouseDown(screen.getByRole("option", { name: invoice }));
    setMoney(screen.getByLabelText("مبلغ التخصيص"), amount);
    fireEvent.click(screen.getByRole("button", { name: "تخصيص" }));
  }

  it("sends the same allocation id after a press that got no answer, and a new one for the next allocation", async () => {
    const { allocationRequests } = renderScreen({
      answerAllocation: (attempt) => (attempt === 1 ? { status: 503, body: { error: "DATABASE_BUSY", message: "الخادم مشغول، أعد المحاولة" } } : undefined),
    });
    fireEvent.click(await screen.findByText("CV-000001"));
    fireEvent.click(await screen.findByRole("tab", { name: /تخصيص على الفواتير/ }));

    await allocate(/^INV-000002/, "200");
    expect(await screen.findByText(/الخادم مشغول/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "تخصيص" }));
    await waitFor(() => expect(allocationRequests).toHaveLength(2));
    await screen.findByText("INV-000002");

    await allocate(/^INV-000002/, "100");
    await waitFor(() => expect(allocationRequests).toHaveLength(3));

    expect(allocationRequests[0]!.allocationId).toMatch(/^[0-9a-f-]{36}$/);
    expect(allocationRequests[1]!.allocationId).toBe(allocationRequests[0]!.allocationId);
    expect(allocationRequests[2]!.allocationId).not.toBe(allocationRequests[0]!.allocationId);
  });

  it("says an allocation was already recorded, and starts a fresh one, when its id was used with other contents", async () => {
    const { allocationRequests } = renderScreen({
      answerAllocation: (attempt) => (attempt === 1 ? { status: 409, body: { error: "IDEMPOTENCY_KEY_REUSED", message: "سبق تسجيل مستند بهذا المعرّف ببيانات مختلفة" } } : undefined),
    });
    fireEvent.click(await screen.findByText("CV-000001"));
    fireEvent.click(await screen.findByRole("tab", { name: /تخصيص على الفواتير/ }));

    await allocate(/^INV-000002/, "200");

    expect(await screen.findByRole("status")).toHaveTextContent("سبق تسجيل تخصيص من هذا النموذج ببيانات أخرى");
    await allocate(/^INV-000002/, "100");
    await waitFor(() => expect(allocationRequests).toHaveLength(2));
    expect(allocationRequests[1]!.allocationId).not.toBe(allocationRequests[0]!.allocationId);
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

describe("TreasuryVouchersScreen — reversal is offered only to a session the server would let reverse", () => {
  const VIEW = ["treasury.cash_voucher.view", "treasury.account.view", "treasury.allocation.view"];

  it("a role given only «عكس السند» is offered no reversal, because the server also asks for the type's void", async () => {
    renderScreen({ permissions: [...VIEW, "treasury.cash_voucher.reverse"] });
    fireEvent.click(await screen.findByText("CV-000001"));
    await screen.findByRole("tab", { name: /تخصيص على الفواتير/ });

    expect(screen.queryByRole("button", { name: "عكس السند" })).not.toBeInTheDocument();
  });

  it("holding both, the reversal is offered", async () => {
    renderScreen({ permissions: [...VIEW, "treasury.cash_voucher.reverse", "treasury.cash_voucher.void"] });
    fireEvent.click(await screen.findByText("CV-000001"));

    expect(await screen.findByRole("button", { name: "عكس السند" })).toBeInTheDocument();
  });

  it("another type's void does not count: a transfer's void with the reversal permission offers nothing on a collection", async () => {
    renderScreen({ permissions: [...VIEW, "treasury.cash_voucher.reverse", "treasury.transfer.void"] });
    fireEvent.click(await screen.findByText("CV-000001"));
    await screen.findByRole("tab", { name: /تخصيص على الفواتير/ });

    expect(screen.queryByRole("button", { name: "عكس السند" })).not.toBeInTheDocument();
  });
});

describe("TreasuryVouchersScreen — a reversed voucher and the voucher that reversed it", () => {
  it("each row names the other by its number, and the link opens it", async () => {
    const [first, ...rest] = seededVouchers;
    const original: VoucherRowDTO = { ...first!, status: "reversed", reversedByDocId: "cv-1-rev" };
    const mirror: VoucherRowDTO = { ...first!, id: "cv-1-rev", docNo: "CV-000009", date: "2026-08-20", reversesDocId: "cv-1" };
    renderScreen({ vouchers: [original, mirror, ...rest] });

    expect(await screen.findByRole("button", { name: "عُكس بالسند CV-000009" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "يعكس السند CV-000001" }));

    expect(await screen.findByRole("tab", { name: /تخصيص على الفواتير/ })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "CV-000001" })).toBeInTheDocument();
  });
});

describe("TreasuryVouchersScreen — the page of a reversal's mirror", () => {
  const settled = { voucherAmount: "1000.000000", allocated: "0", unallocated: "1000.000000", fullyAllocated: false, needsAllocation: false };
  const [first, ...rest] = seededVouchers;
  const original: VoucherRowDTO = { ...first!, status: "reversed", reversedByDocId: "cv-1-rev", allocatable: false, allocationSummary: settled };
  const mirror: VoucherRowDTO = { ...first!, id: "cv-1-rev", docNo: "CV-000009", date: "2026-08-20", reversesDocId: "cv-1", allocatable: false, allocationSummary: settled };

  it("offers no allocation — no tab, no badge, no form — and no reversal", async () => {
    renderScreen({ vouchers: [original, mirror, ...rest] });
    fireEvent.click(await screen.findByText("CV-000009"));

    expect(await screen.findByRole("heading", { name: "CV-000009" })).toBeInTheDocument();
    await screen.findByRole("tab", { name: "القيود المحاسبية" });
    expect(screen.queryByRole("tab", { name: /تخصيص على الفواتير/ })).not.toBeInTheDocument();
    expect(screen.queryByText("بحاجة لتخصيص")).not.toBeInTheDocument();
    expect(screen.queryByText("مخصّص بالكامل")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "تخصيص" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "عكس السند" })).not.toBeInTheDocument();
  });

  it("the reversed original keeps its allocation history but claims neither «بحاجة لتخصيص» nor «مخصّص بالكامل»", async () => {
    renderScreen({ vouchers: [original, mirror, ...rest] });
    fireEvent.click(await screen.findByText("CV-000001"));

    expect(await screen.findByRole("tab", { name: /تخصيص على الفواتير/ })).toBeInTheDocument();
    expect(screen.queryByText("بحاجة لتخصيص")).not.toBeInTheDocument();
    expect(screen.queryByText("مخصّص بالكامل")).not.toBeInTheDocument();
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


describe("TreasuryVouchersScreen — the cashier writes a voucher and the branch manager confirms it", () => {
  const cashier: Session = { ...testAdminSession, isCompanyAdmin: false, roleCode: "TREASURY_CASHIER", permissions: ["treasury.account.view", "treasury.cash_voucher.view", "treasury.cash_voucher.create", "sales.customer.view"] };
  const manager: Session = { ...testAdminSession, isCompanyAdmin: false, roleCode: "BRANCH_MANAGER", permissions: ["treasury.account.view", "treasury.cash_voucher.view", "treasury.cash_voucher.confirm", "sales.customer.view"] };
  const draft = (id: string, memo: string): VoucherRowDTO => ({
    ...voucher({ id, docNo: null, status: "draft", confirmedAt: null, journalEntryId: null, memo, voucherType: "other_income", amount: "75.000000", counterpartyGlAccountId: "4900", customerId: null }),
    allocatable: false,
    allocationSummary: { voucherAmount: "75.000000", allocated: "0", unallocated: "75.000000", fullyAllocated: false, needsAllocation: false },
  });

  it("a cashier's voucher is saved as a draft for confirmation — neither the one-call collection nor a confirm is attempted", async () => {
    const { createRequests, collectionRequests, draftConfirms, confirmRequests } = renderScreen({ session: cashier });
    await screen.findByText("CV-000001");
    fireEvent.click(screen.getByRole("button", { name: "سند جديد" }));
    fireEvent.click(screen.getByText("تحصيل من عميل"));
    setMoney(screen.getByLabelText("المبلغ"), "300");
    const partyInput = screen.getByPlaceholderText("ابحث عن عميل…");
    fireEvent.focus(partyInput);
    fireEvent.mouseDown(screen.getByText("شركة الأمل للتجارة"));
    expect(screen.queryByRole("button", { name: "إنشاء وتأكيد" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "حفظ كمسودة للاعتماد" }));

    expect(await screen.findByText("حُفظ السند مسودة بانتظار الاعتماد")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("لم يُرحَّل شيء ولم تتحرك أي نقدية");
    expect(createRequests).toHaveLength(1);
    expect(createRequests[0]).toMatchObject({ voucherType: "customer_collection", amount: "300.000000", customerId: "cust-amal" });
    expect(collectionRequests).toEqual([]);
    expect(draftConfirms).toEqual([]);
    expect(confirmRequests).toEqual([]);
  });

  it("a branch manager has no «سند جديد» and confirms the cashier's draft from its row", async () => {
    const { draftConfirms } = renderScreen({ session: manager, drafts: [draft("draft-a", "إيراد من الصندوق")] });
    await screen.findByText("CV-000001");
    expect(screen.queryByRole("button", { name: "سند جديد" })).not.toBeInTheDocument();
    fireEvent.click(await screen.findByRole("button", { name: "عرض draft-a" }));
    fireEvent.click(await screen.findByRole("menuitem", { name: "تأكيد السند" }));
    await waitFor(() => expect(draftConfirms).toEqual(["draft-a"]));
    expect(await screen.findByText("CV-000101")).toBeInTheDocument();
  });

  it("a refused confirm says why in Arabic on the list and leaves the other draft's own action usable", async () => {
    const { draftConfirms } = renderScreen({ session: manager, drafts: [draft("draft-a", "إيراد من الصندوق"), draft("draft-b", "صرف بلا رصيد")] });
    fireEvent.click(await screen.findByRole("button", { name: "عرض draft-b" }));
    fireEvent.click(await screen.findByRole("menuitem", { name: "تأكيد السند" }));
    expect(await screen.findByText("لا يمكن تأكيد السند: رصيد الخزينة سيصبح سالباً.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "عرض draft-a" }));
    fireEvent.click(await screen.findByRole("menuitem", { name: "تأكيد السند" }));
    await waitFor(() => expect(draftConfirms).toEqual(["draft-b", "draft-a"]));
  });

  it("a cashier's draft row offers no confirm", async () => {
    renderScreen({ session: cashier, drafts: [draft("draft-a", "إيراد من الصندوق")] });
    fireEvent.click(await screen.findByRole("button", { name: "عرض draft-a" }));
    await screen.findByRole("menuitem", { name: "عرض" });
    expect(screen.queryByRole("menuitem", { name: "تأكيد السند" })).not.toBeInTheDocument();
  });
});

describe("TreasuryVouchersScreen — a collection with a transfer commission (#115)", () => {
  it("the voucher page shows the commission and the net that reached the treasury, in the voucher's currency", async () => {
    const usd = voucher({ paymentMethod: "bank", currency: "USD", fxRate: "50.000000", amount: "100.000000", baseAmount: "5000.000000", commissionAmount: "2.500000", commissionGlAccountId: "5910" } as Partial<VoucherDTO>);
    renderScreen({ vouchers: [{ ...usd, allocatable: true, allocationSummary: { voucherAmount: "100.000000", allocated: "0", unallocated: "100.000000", fullyAllocated: false, needsAllocation: true } }], allocations: {} });
    fireEvent.click(await screen.findByText("CV-000001"));
    const net = (await screen.findByText("صافي ما وصل الخزينة")).parentElement!;
    expect(net).toHaveTextContent("97.50");
    expect(net).toHaveTextContent("USD");
    expect(screen.getByText("عمولة التحويل").parentElement).toHaveTextContent("2.50");
  });

  it("the form says what comes off the customer's balance once a commission is typed on a bank collection", async () => {
    renderScreen();
    await screen.findByText("CV-000001");
    fireEvent.click(screen.getByRole("button", { name: "سند جديد" }));
    fireEvent.click(screen.getByText("تحصيل من عميل"));
    expect(screen.queryByLabelText("عمولة التحويل")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("combobox", { name: "طريقة الدفع *" }));
    fireEvent.mouseDown(screen.getByRole("option", { name: "بنكي" }));
    setMoney(screen.getByLabelText("المبلغ"), "485");
    setMoney(screen.getByLabelText("عمولة التحويل"), "15");
    expect(screen.getByText(/يُخصم من رصيد العميل:/)).toHaveTextContent("500.00");
  });
});
