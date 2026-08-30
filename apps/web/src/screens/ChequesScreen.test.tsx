// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, expect, it } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { BranchDTO, ChequeDTO, CustomerDTO, SupplierDTO, TreasuryAccountDTO } from "@mezan/contracts";
import { ChequesScreen } from "./ChequesScreen";
import { renderWithProviders, stubTransport, testAdminSession, type StubResult } from "../data/test-support";

// jsdom has no layout engine and does not implement scrollIntoView; the
// custom Select combobox calls it when opening its dropdown.
if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = () => {};
}

function cheque(overrides: Partial<ChequeDTO> = {}): ChequeDTO {
  return {
    id: "chq-1",
    direction: "incoming",
    status: "pending",
    effectiveStatus: "pending",
    chequeNumber: "CHQ-5001",
    bankName: "بنك مصر",
    bankBranchName: null,
    bankAccountNumber: null,
    amount: "1000.000000",
    currency: "EGP",
    issueDate: "2026-08-01",
    dueDate: "2026-09-20",
    branchId: "BR1",
    notes: null,
    partyId: "cust-1",
    counterpartyGlAccountId: "1105",
    controlAccounts: { underCollectionAccountId: "1320", bouncedAccountId: "1360" },
    bankTreasuryAccountId: null,
    createdAt: "2026-08-01T00:00:00.000Z",
    depositedAt: null,
    collectedAt: null,
    bouncedAt: null,
    replacesChequeId: null,
    replacedByChequeId: null,
    creationJournalEntryId: "je-1",
    collectionJournalEntryId: null,
    bounceJournalEntryId: null,
    ...overrides,
  };
}

const CUSTOMER: CustomerDTO = {
  id: "cust-1",
  code: "C000001",
  nameAr: "شركة النيل",
  nameEn: null,
  phone: null,
  email: null,
  contactPerson: null,
  taxNumber: null,
  category: null,
  notes: null,
  paymentTermsDays: 30,
  currency: "EGP",
  openingBalance: "0.00",
  active: true,
  priceListId: null,
  creditLimit: "0.00",
  taxExempt: false,
  etaBuyerType: "business",
  commercialRegistrationNumber: null,
  address: null,
  logoAttachmentId: null,
  nationalId: null,
};

const SUPPLIER: SupplierDTO = {
  id: "sup-1",
  code: "S000001",
  nameAr: "مورد الدلتا",
  nameEn: null,
  phone: null,
  email: null,
  contactPerson: null,
  taxNumber: null,
  category: null,
  notes: null,
  paymentTermsDays: 30,
  currency: "EGP",
  openingBalance: "0.00",
  active: true,
  addressCity: null,
  addressDistrict: null,
  addressStreet: null,
};

const BRANCH: BranchDTO = {
  id: "BR1",
  code: "BR1",
  name: "الفرع الرئيسي",
  parentBranchId: null,
  phone: null,
  email: null,
  address: null,
  isMain: true,
  active: true,
};

const BANK_ACCOUNT: TreasuryAccountDTO = {
  id: "ta-bank1",
  code: "BANK-001",
  name: "بنك مصر — الحساب الجاري", nameEn: null,
  type: "bank",
  currency: "EGP",
  branchId: "BR1",
  glAccountId: "1310",
  openingBalance: "0.000000",
  openingBalanceDate: null,
  status: "active",
};

function baseHandlers(cheques: ChequeDTO[]): Record<string, () => StubResult> {
  return {
    "GET /cheques": () => ({ body: cheques }),
    "GET /customers": () => ({ body: [CUSTOMER] }),
    "GET /suppliers": () => ({ body: [SUPPLIER] }),
    "GET /branches": () => ({ body: [BRANCH] }),
    "GET /treasury-accounts": () => ({ body: [BANK_ACCOUNT] }),
  };
}

/** Mimics the real `/cheques` list endpoint's server-side direction/status/search filtering (R1.1). */
function chequesListHandler(cheques: ChequeDTO[]) {
  return (_init: RequestInit | undefined, path: string): StubResult => {
    const query = new URLSearchParams(path.split("?")[1] ?? "");
    const direction = query.get("direction");
    const status = query.get("status");
    const search = query.get("search");
    const rows = cheques.filter((c) => {
      if (direction && c.direction !== direction) return false;
      if (status && c.effectiveStatus !== status) return false;
      if (search && !c.chequeNumber.includes(search)) return false;
      return true;
    });
    return { body: rows };
  };
}

describe("ChequesScreen — list", () => {
  it("renders the real register off GET /cheques with the party resolved from real customers", async () => {
    renderWithProviders(<ChequesScreen />, {
      initialSession: testAdminSession,
      transport: stubTransport(baseHandlers([cheque()])),
    });
    expect(await screen.findByText("CHQ-5001")).toBeInTheDocument();
    expect(await screen.findByText("شركة النيل")).toBeInTheDocument();
    expect(screen.getByText("بنك مصر")).toBeInTheDocument();
    expect(screen.getAllByText("واردة").length).toBeGreaterThan(0);
  });

  it("shows the documented empty state when the register is empty", async () => {
    renderWithProviders(<ChequesScreen />, {
      initialSession: testAdminSession,
      transport: stubTransport(baseHandlers([])),
    });
    expect(await screen.findByText("لا توجد شيكات")).toBeInTheDocument();
  });

  it("exposes all seven status filter tabs and partitions rows by the server-derived effective status", async () => {
    const user = userEvent.setup();
    renderWithProviders(<ChequesScreen />, {
      initialSession: testAdminSession,
      transport: stubTransport({
        ...baseHandlers([]),
        "GET /cheques": chequesListHandler([
          cheque(),
          cheque({ id: "chq-2", chequeNumber: "CHQ-5002", status: "deposited", effectiveStatus: "deposited" }),
          cheque({ id: "chq-3", chequeNumber: "CHQ-5003", effectiveStatus: "due_today" }),
        ]),
      }),
    });
    await screen.findByText("CHQ-5001");

    // "تحت التحصيل"/"المستحقة اليوم" were renamed to "يقترب موعد الاستحقاق"/"استحق ولم يُودع" (D55) —
    // they describe the maturity window, not a bank action the row's button already offers.
    for (const label of [
      "الكل",
      "قيد الانتظار",
      "يقترب موعد الاستحقاق",
      "استحق ولم يُودع",
      "تحت التحصيل بالبنك",
      "محصل",
      "مرتد",
      "مستبدل",
    ]) {
      expect(screen.getByRole("tab", { name: new RegExp(label) })).toBeInTheDocument();
    }

    await user.click(screen.getByRole("tab", { name: /^تحت التحصيل بالبنك/ }));
    await waitFor(() => expect(screen.queryByText("CHQ-5001")).not.toBeInTheDocument());
    expect(screen.getByText("CHQ-5002")).toBeInTheDocument();
  });

  it("filters by cheque number through the search box", async () => {
    const user = userEvent.setup();
    renderWithProviders(<ChequesScreen />, {
      initialSession: testAdminSession,
      transport: stubTransport({
        ...baseHandlers([]),
        "GET /cheques": chequesListHandler([cheque(), cheque({ id: "chq-2", chequeNumber: "CHQ-9999" })]),
      }),
    });
    await screen.findByText("CHQ-5001");
    await user.type(screen.getByPlaceholderText("بحث برقم الشيك..."), "9999");
    await waitFor(() => expect(screen.queryByText("CHQ-5001")).not.toBeInTheDocument());
    expect(screen.getByText("CHQ-9999")).toBeInTheDocument();
  });

  it("sends the direction filter to the server as a query param", async () => {
    const user = userEvent.setup();
    const paths: string[] = [];
    renderWithProviders(<ChequesScreen />, {
      initialSession: testAdminSession,
      transport: (path, init) => {
        const method = (init?.method ?? "GET").toUpperCase();
        if (method === "GET" && path.startsWith("/cheques")) paths.push(path);
        const key = `${method} ${path.split("?")[0]}`;
        const handler = baseHandlers([cheque()])[key];
        const result: StubResult = handler ? handler() : { status: 404, body: { error: "NOT_FOUND" } };
        const status = result.status ?? 200;
        return Promise.resolve({
          status,
          ok: status >= 200 && status < 400,
          json: <T,>() => Promise.resolve(result.body as T),
          text: () => Promise.resolve(JSON.stringify(result.body)),
        });
      },
    });
    await screen.findByText("CHQ-5001");
    await user.click(screen.getByLabelText("الاتجاه"));
    await user.click(await screen.findByRole("option", { name: "صادرة" }));
    await waitFor(() => expect(paths.some((p) => p.includes("direction=outgoing"))).toBe(true));
  });

  it("offers only the transitions legal from the cheque's current status and posts the chosen one", async () => {
    const user = userEvent.setup();
    let deposited = false;
    renderWithProviders(<ChequesScreen />, {
      initialSession: testAdminSession,
      transport: stubTransport({
        ...baseHandlers([]),
        "GET /cheques": () => ({ body: [deposited ? cheque({ status: "deposited", effectiveStatus: "deposited" }) : cheque()] }),
        "POST /cheques/chq-1/deposit": () => {
          deposited = true;
          return { body: cheque({ status: "deposited", effectiveStatus: "deposited", bankTreasuryAccountId: "ta-bank1" }) };
        },
      }),
    });
    await screen.findByText("CHQ-5001");
    await user.click(screen.getByRole("button", { name: "إجراءات CHQ-5001" }));
    await user.click(screen.getByRole("menuitem", { name: "عرض" }));

    const panel = await screen.findByRole("dialog", { name: /CHQ-5001/ });
    expect(within(panel).getByRole("button", { name: "إيداع في البنك" })).toBeInTheDocument();
    // pending cheques can only be deposited — never collected or bounced
    expect(within(panel).queryByRole("button", { name: "تأكيد التحصيل" })).not.toBeInTheDocument();
    expect(within(panel).queryByRole("button", { name: "تسجيل ارتداد" })).not.toBeInTheDocument();

    await user.click(within(panel).getByRole("button", { name: "إيداع في البنك" }));
    await waitFor(() => expect(deposited).toBe(true));
    // the refetched row is now deposited, so its legal actions become collect/bounce
    await user.click(await screen.findByRole("button", { name: "إجراءات CHQ-5001" }));
    await user.click(screen.getByRole("menuitem", { name: "عرض" }));
    const reopened = await screen.findByRole("dialog", { name: /CHQ-5001/ });
    expect(await within(reopened).findByRole("button", { name: "تأكيد التحصيل" })).toBeInTheDocument();
    expect(within(reopened).getByRole("button", { name: "تسجيل ارتداد" })).toBeInTheDocument();
  });

  it("surfaces a rejected transition's server error instead of silently succeeding", async () => {
    const user = userEvent.setup();
    renderWithProviders(<ChequesScreen />, {
      initialSession: testAdminSession,
      transport: stubTransport({
        ...baseHandlers([cheque({ status: "deposited", effectiveStatus: "deposited" })]),
        "POST /cheques/chq-1/collect": () => ({
          status: 422,
          body: { error: "PERIOD_NOT_OPEN", message: "الفترة المالية مغلقة." },
        }),
      }),
    });
    await screen.findByText("CHQ-5001");
    await user.click(screen.getByRole("button", { name: "إجراءات CHQ-5001" }));
    await user.click(screen.getByRole("menuitem", { name: "عرض" }));
    const panel = await screen.findByRole("dialog", { name: /CHQ-5001/ });
    await user.click(within(panel).getByRole("button", { name: "تأكيد التحصيل" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("الفترة المالية مغلقة.");
  });
});

describe("ChequesScreen — create form", () => {
  it("swaps the party typeahead by direction and posts the real create body", async () => {
    const user = userEvent.setup();
    let created: Record<string, unknown> | null = null;
    renderWithProviders(<ChequesScreen />, {
      initialSession: testAdminSession,
      transport: stubTransport({
        ...baseHandlers([]),
        "GET /cheques": () => ({ body: created ? [cheque()] : [] }),
        "POST /cheques": (init) => {
          created = JSON.parse(String(init?.body));
          return { status: 201, body: cheque() };
        },
      }),
    });
    await screen.findByText("لا توجد شيكات");
    // the header action and the empty state's own action share the same label
    await user.click(screen.getAllByRole("button", { name: "شيك جديد" })[0]);

    expect(screen.getByRole("heading", { name: "بيانات الشيك" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "القيمة والتواريخ" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "الفرع والملاحظات" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /واردة/ }));
    const party = await screen.findByPlaceholderText("اختر العميل...");
    await user.type(party, "النيل");
    await user.click(await screen.findByText("شركة النيل"));

    // switching direction swaps customers → suppliers and clears the picked party
    await user.click(screen.getByRole("button", { name: /صادرة/ }));
    const supplierPicker = await screen.findByPlaceholderText("اختر المورد...");
    await user.type(supplierPicker, "الدلتا");
    await user.click(await screen.findByText("مورد الدلتا"));

    await user.type(screen.getByLabelText("رقم الشيك *"), "CHQ-9001");
    await user.type(screen.getByLabelText("اسم البنك *"), "البنك الأهلي");
    await user.type(screen.getByLabelText("المبلغ"), "500");

    const branch = screen.getByPlaceholderText("اختر الفرع...");
    await user.type(branch, "الرئيسي");
    await user.click(await screen.findByText("الفرع الرئيسي"));

    await user.click(screen.getByRole("button", { name: "حفظ الشيك" }));
    await waitFor(() => expect(created).not.toBeNull());
    expect(created).toMatchObject({
      direction: "outgoing",
      partyId: "sup-1",
      chequeNumber: "CHQ-9001",
      bankName: "البنك الأهلي",
      amount: "500",
      branchId: "BR1",
      counterpartyGlAccountId: "2100",
      controlAccounts: { underCollectionAccountId: "2150", bouncedAccountId: null },
    });
  });

  it("keeps حفظ الشيك disabled until every required field is filled", async () => {
    const user = userEvent.setup();
    renderWithProviders(<ChequesScreen />, {
      initialSession: testAdminSession,
      transport: stubTransport(baseHandlers([])),
    });
    await screen.findByText("لا توجد شيكات");
    await user.click(screen.getAllByRole("button", { name: "شيك جديد" })[0]);
    expect(screen.getByRole("button", { name: "حفظ الشيك" })).toBeDisabled();
  });
});
