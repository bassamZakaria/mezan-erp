// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, expect, it } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { BranchDTO, ChequeDTO, CustomerDTO, SupplierDTO, TreasuryAccountDTO } from "@mezan/contracts";
import { ChequesScreen } from "./ChequesScreen";
import { renderWithProviders, stubTransport, testAdminSession, type StubResult } from "../data/test-support";

if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = () => {};
}

/** `TextField` renders a `<label>` with no `for`, so only DOM adjacency finds its input. */
function inputNextToLabel(labelText: string): HTMLElement {
  const label = screen.getByText(labelText);
  const input = label.parentElement?.querySelector("input, textarea, select");
  if (!(input instanceof HTMLElement)) throw new Error(`No form control found next to the label "${labelText}"`);
  return input;
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
  id: "cust-1", code: "C000001", nameAr: "شركة النيل", nameEn: null, phone: null, email: null,
  contactPerson: null, taxNumber: null, category: null, notes: null, paymentTermsDays: 30, currency: "EGP",
  openingBalance: "0.00", active: true, priceListId: null, creditLimit: "0.00", taxExempt: false,
  etaBuyerType: "business", commercialRegistrationNumber: null, address: null, logoAttachmentId: null, nationalId: null,
};

const SUPPLIER: SupplierDTO = {
  id: "sup-1", code: "S000001", nameAr: "مورد الدلتا", nameEn: null, phone: null, email: null,
  contactPerson: null, taxNumber: null, category: null, notes: null, paymentTermsDays: 30, currency: "EGP",
  openingBalance: "0.00", active: true, addressCity: null, addressDistrict: null, addressStreet: null,
};

const BRANCH: BranchDTO = {
  id: "BR1", code: "BR1", name: "الفرع الرئيسي", parentBranchId: null, phone: null, email: null,
  address: null, isMain: true, active: true,
};

const BANK_ACCOUNT: TreasuryAccountDTO = {
  id: "ta-bank1", code: "BANK-001", name: "بنك مصر — الحساب الجاري", nameEn: null, type: "bank",
  currency: "EGP", branchId: "BR1", glAccountId: "1310", openingBalance: "0.000000",
  openingBalanceDate: null, status: "active",
};

type Handlers = Record<string, (init: RequestInit | undefined, path: string) => StubResult>;

function mount(cheques: ChequeDTO[], overrides: Handlers = {}) {
  renderWithProviders(<ChequesScreen />, {
    initialSession: testAdminSession,
    transport: stubTransport({
      "GET /cheques": () => ({ body: cheques }),
      "GET /customers": () => ({ body: [CUSTOMER] }),
      "GET /suppliers": () => ({ body: [SUPPLIER] }),
      "GET /branches": () => ({ body: [BRANCH] }),
      "GET /treasury-accounts": () => ({ body: [BANK_ACCOUNT] }),
      ...overrides,
    }),
  });
}

async function openPanel(user: ReturnType<typeof userEvent.setup>, number = "CHQ-5001") {
  await screen.findByText(number);
  await user.click(screen.getByRole("button", { name: `إجراءات ${number}` }));
  await user.click(screen.getByRole("menuitem", { name: "عرض" }));
  return screen.findByRole("dialog", { name: new RegExp(number) });
}

describe("ChequesScreen — the seven-state lifecycle's dead ends", () => {
  it("offers a replacement for an INCOMING cheque that bounced", async () => {
    const user = userEvent.setup();
    mount([cheque({ status: "bounced", effectiveStatus: "bounced", bouncedAt: "2026-09-21T00:00:00.000Z" })]);
    const panel = await openPanel(user);

    expect(within(panel).getByRole("button", { name: "استبدال الشيك" })).toBeInTheDocument();
    expect(within(panel).queryByRole("button", { name: "إيداع في البنك" })).not.toBeInTheDocument();
  });

  it("offers NOTHING on an outgoing cheque that bounced — the supplier replaces it, not us", async () => {
    const user = userEvent.setup();
    mount([
      cheque({
        direction: "outgoing", partyId: "sup-1", status: "bounced", effectiveStatus: "bounced",
        bouncedAt: "2026-09-21T00:00:00.000Z", counterpartyGlAccountId: "2100",
      }),
    ]);
    const panel = await openPanel(user);

    expect(within(panel).getByText("لا توجد إجراءات متاحة على هذا الشيك.")).toBeInTheDocument();
  });

  it("offers nothing on a cheque already collected", async () => {
    const user = userEvent.setup();
    mount([cheque({ status: "collected", effectiveStatus: "collected", collectedAt: "2026-09-21T00:00:00.000Z" })]);
    const panel = await openPanel(user);

    expect(within(panel).getByText("لا توجد إجراءات متاحة على هذا الشيك.")).toBeInTheDocument();
  });

  it("posts a replacement carrying the original's bank details under a -R number", async () => {
    const user = userEvent.setup();
    let replacement: { newCheque: Record<string, unknown> } | null = null;
    mount(
      [
        cheque({
          status: "bounced", effectiveStatus: "bounced", bouncedAt: "2026-09-21T00:00:00.000Z",
          bankBranchName: "فرع وسط البلد", bankAccountNumber: "123456789", notes: "شيك العميل الأول",
        }),
      ],
      {
        "POST /cheques/chq-1/replace": (init) => {
          replacement = JSON.parse((init?.body as string) ?? "{}") as typeof replacement;
          return { body: cheque({ id: "chq-2", chequeNumber: "CHQ-5001-R" }) };
        },
      },
    );
    const panel = await openPanel(user);

    await user.click(within(panel).getByRole("button", { name: "استبدال الشيك" }));
    await waitFor(() => expect(replacement).not.toBeNull());
    expect(replacement!.newCheque).toMatchObject({
      chequeNumber: "CHQ-5001-R",
      bankName: "بنك مصر",
      bankBranchName: "فرع وسط البلد",
      bankAccountNumber: "123456789",
      branchId: "BR1",
      notes: "شيك العميل الأول",
    });
  });

  it("records a bounce against a deposited cheque", async () => {
    const user = userEvent.setup();
    let bounced = false;
    mount([cheque({ status: "deposited", effectiveStatus: "deposited", bankTreasuryAccountId: "ta-bank1" })], {
      "POST /cheques/chq-1/bounce": () => {
        bounced = true;
        return { body: cheque({ status: "bounced", effectiveStatus: "bounced" }) };
      },
    });
    const panel = await openPanel(user);

    await user.click(within(panel).getByRole("button", { name: "تسجيل ارتداد" }));
    await waitFor(() => expect(bounced).toBe(true));
  });
});

describe("ChequesScreen — a deposit with nowhere to go", () => {
  it("refuses to deposit when the tenant has no active bank treasury account", async () => {
    const user = userEvent.setup();
    let deposits = 0;
    mount([cheque()], {
      "GET /treasury-accounts": () => ({ body: [{ ...BANK_ACCOUNT, status: "inactive" as const }] }),
      "POST /cheques/chq-1/deposit": () => {
        deposits += 1;
        return { body: cheque({ status: "deposited" }) };
      },
    });
    const panel = await openPanel(user);

    await user.click(within(panel).getByRole("button", { name: "إيداع في البنك" }));
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(deposits).toBe(0);
  });

  it("ignores a cash treasury account when looking for somewhere to deposit", async () => {
    const user = userEvent.setup();
    mount([cheque()], {
      "GET /treasury-accounts": () => ({ body: [{ ...BANK_ACCOUNT, id: "ta-cash", type: "cash" as const }] }),
    });
    const panel = await openPanel(user);

    await user.click(within(panel).getByRole("button", { name: "إيداع في البنك" }));
    expect(await screen.findByRole("alert")).toBeInTheDocument();
  });
});

describe("ChequesScreen — narrowing the register", () => {
  function listHandler(cheques: ChequeDTO[]) {
    return (_init: RequestInit | undefined, path: string): StubResult => {
      const query = new URLSearchParams(path.split("?")[1] ?? "");
      const from = query.get("fromDate");
      const to = query.get("toDate");
      const rows = cheques.filter((c) => {
        if (from && c.dueDate < from) return false;
        if (to && c.dueDate > to) return false;
        return true;
      });
      return { body: rows };
    };
  }

  it("sends each date bound to the server independently", async () => {
    const user = userEvent.setup();
    const rows = [cheque(), cheque({ id: "chq-2", chequeNumber: "CHQ-5002", dueDate: "2026-11-30" })];
    mount(rows, { "GET /cheques": listHandler(rows) });

    await screen.findByText("CHQ-5002");
    await user.type(screen.getByLabelText("من تاريخ"), "2026-10-01");
    await waitFor(() => expect(screen.queryByText("CHQ-5001")).not.toBeInTheDocument());
    expect(screen.getByText("CHQ-5002")).toBeInTheDocument();

    await user.clear(screen.getByLabelText("من تاريخ"));
    await user.type(screen.getByLabelText("إلى تاريخ"), "2026-09-30");
    await waitFor(() => expect(screen.queryByText("CHQ-5002")).not.toBeInTheDocument());
    expect(screen.getByText("CHQ-5001")).toBeInTheDocument();
  });

  it("falls back to the raw party id for a cheque whose customer is no longer registered", async () => {
    mount([cheque({ partyId: "cust-gone" })]);
    expect(await screen.findByText("cust-gone")).toBeInTheDocument();
  });

  it("says the register could not be loaded rather than claiming it is empty", async () => {
    mount([], { "GET /cheques": () => ({ status: 500, body: { error: "INTERNAL", message: "تعذّر الوصول لقاعدة البيانات." } }) });

    await waitFor(() => expect(screen.queryByText("لا توجد شيكات")).not.toBeInTheDocument());
    expect(await screen.findByText(/تعذّر/)).toBeInTheDocument();
  });
});

describe("ChequesScreen — writing a cheque", () => {
  it("offers no party picker at all until a direction is chosen", async () => {
    const user = userEvent.setup();
    mount([]);
    await screen.findByText("لا توجد شيكات");
    await user.click(screen.getAllByRole("button", { name: "شيك جديد" })[0]!);

    expect(screen.getByRole("heading", { name: "بيانات الشيك" })).toBeInTheDocument();
    expect(screen.queryByPlaceholderText("اختر العميل...")).not.toBeInTheDocument();
    expect(screen.queryByPlaceholderText("اختر المورد...")).not.toBeInTheDocument();
  });

  it("sends null rather than an empty string for the optional bank branch, account number and notes", async () => {
    const user = userEvent.setup();
    let posted: Record<string, unknown> | null = null;
    mount([], {
      "POST /cheques": (init) => {
        posted = JSON.parse((init?.body as string) ?? "{}") as Record<string, unknown>;
        return { status: 201, body: cheque() };
      },
    });
    await screen.findByText("لا توجد شيكات");
    await user.click(screen.getAllByRole("button", { name: "شيك جديد" })[0]!);

    await user.click(screen.getByRole("button", { name: /واردة/ }));
    const party = await screen.findByPlaceholderText("اختر العميل...");
    await user.type(party, "النيل");
    await user.click(await screen.findByText("شركة النيل"));

    await user.type(inputNextToLabel("رقم الشيك *"), "CHQ-9001");
    await user.type(inputNextToLabel("اسم البنك *"), "بنك القاهرة");
    await user.type(screen.getByLabelText("المبلغ"), "2500");

    const branch = screen.getByPlaceholderText("اختر الفرع...");
    await user.type(branch, "الرئيسي");
    await user.click(await screen.findByText("الفرع الرئيسي"));

    await user.click(screen.getByRole("button", { name: "حفظ الشيك" }));

    await waitFor(() => expect(posted).not.toBeNull());
    expect(posted).toMatchObject({
      direction: "incoming",
      partyId: "cust-1",
      bankBranchName: null,
      bankAccountNumber: null,
      notes: null,
      amount: "2500",
      counterpartyGlAccountId: "1105",
    });
  });
});
