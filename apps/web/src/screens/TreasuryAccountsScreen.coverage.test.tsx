// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, expect, it } from "vitest";
import { screen, fireEvent, within, waitFor } from "@testing-library/react";
import type { BranchDTO, TreasuryAccountDTO } from "@mezan/contracts";
import { TreasuryAccountsScreen } from "./TreasuryAccountsScreen";
import { renderWithProviders, stubTransport, testAdminSession, type StubResult } from "../data/test-support";

const branches: BranchDTO[] = [
  { id: "b1", code: "MAIN", name: "الفرع الرئيسي", parentBranchId: null, phone: null, email: null, address: null, isMain: true, active: true },
  { id: "b2", code: "ALEX", name: "فرع الإسكندرية", parentBranchId: "b1", phone: null, email: null, address: null, isMain: false, active: true },
];

function account(overrides: Partial<TreasuryAccountDTO> = {}): TreasuryAccountDTO {
  return {
    id: "ta-cash1",
    code: "CASH-001",
    name: "صندوق نقدي",
    nameEn: null,
    type: "cash",
    currency: "EGP",
    branchId: "b1",
    glAccountId: "1300-1",
    openingBalance: "0.000000",
    openingBalanceDate: null,
    status: "active",
    ...overrides,
  };
}

const accounts: TreasuryAccountDTO[] = [
  account(),
  account({ id: "ta-cash2", code: "CASH-002", name: "خزنة فرع الإسكندرية", branchId: "b2", glAccountId: null, status: "inactive" }),
  account({ id: "ta-bank1", code: "BANK-001", name: "البنك الأهلي المصري — جاري", type: "bank", glAccountId: "1310", openingBalance: "50000.000000", openingBalanceDate: "2026-01-01" }),
];

type Handlers = Record<string, (init: RequestInit | undefined, path: string) => StubResult>;

function mount(rows: TreasuryAccountDTO[] = accounts, overrides: Handlers = {}) {
  const transport = stubTransport({
    "GET /treasury-accounts": () => ({ body: rows }),
    "GET /branches": () => ({ body: branches }),
    ...overrides,
  });
  renderWithProviders(<TreasuryAccountsScreen />, { transport, initialSession: testAdminSession });
}

function textboxByLabel(container: HTMLElement, label: string): HTMLInputElement {
  const labelNode = within(container).getByText(label);
  const input = labelNode.parentElement?.querySelector("input, textarea");
  if (!input) throw new Error(`no text input associated with label "${label}"`);
  return input as HTMLInputElement;
}

/**
 * The draft's branch is seeded from the loaded branch list at the moment the
 * form opens, so the list must have arrived first — otherwise every save is
 * refused for a missing branch before it reaches the code under test.
 */
async function openCreateForm() {
  await screen.findByText("صندوق نقدي");
  fireEvent.click(screen.getByRole("button", { name: "إضافة حساب" }));
  return screen.getByRole("dialog", { name: "إضافة حساب" });
}

describe("TreasuryAccountsScreen — what the form refuses before it reaches the server", () => {
  it("refuses an account with no code", async () => {
    mount();
    const dialog = await openCreateForm();

    fireEvent.change(textboxByLabel(dialog, "اسم الحساب *"), { target: { value: "خزنة" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "إضافة" }));

    expect(await within(dialog).findByRole("alert")).toHaveTextContent("الكود مطلوب.");
  });

  it("refuses an account with no name", async () => {
    mount();
    const dialog = await openCreateForm();

    fireEvent.change(textboxByLabel(dialog, "الكود *"), { target: { value: "CASH-099" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "إضافة" }));

    expect(await within(dialog).findByRole("alert")).toHaveTextContent("اسم الحساب مطلوب.");
  });

  it("names the offending code when it is already on the books, without asking the server", async () => {
    mount();
    const dialog = await openCreateForm();

    fireEvent.change(textboxByLabel(dialog, "الكود *"), { target: { value: "CASH-001" } });
    fireEvent.change(textboxByLabel(dialog, "اسم الحساب *"), { target: { value: "نسخة" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "إضافة" }));

    expect(await within(dialog).findByRole("alert")).toHaveTextContent('الكود "CASH-001" مستخدم بالفعل');
  });

  it("lets an account keep its OWN code while being edited", async () => {
    let patched: Record<string, unknown> | null = null;
    mount(accounts, {
      "PATCH /treasury-accounts/ta-cash1": (init) => {
        patched = JSON.parse((init?.body as string) ?? "{}") as Record<string, unknown>;
        return { body: account({ name: "صندوق نقدي محدّث" }) };
      },
    });

    fireEvent.click(await screen.findByText("صندوق نقدي"));
    fireEvent.click(within(screen.getByRole("dialog", { name: /كشف حساب/ })).getByRole("button", { name: "تعديل" }));

    const dialog = screen.getByRole("dialog", { name: "تعديل حساب" });
    fireEvent.change(textboxByLabel(dialog, "اسم الحساب *"), { target: { value: "صندوق نقدي محدّث" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "حفظ التعديلات" }));

    await waitFor(() => expect(patched).not.toBeNull());
    expect(patched).toMatchObject({ code: "CASH-001", status: "active" });
  });

  it("refuses a cash till opened on a negative balance — a till cannot owe money", async () => {
    mount();
    const dialog = await openCreateForm();

    fireEvent.change(textboxByLabel(dialog, "الكود *"), { target: { value: "CASH-099" } });
    fireEvent.change(textboxByLabel(dialog, "اسم الحساب *"), { target: { value: "خزنة" } });
    const opening = textboxByLabel(dialog, "الرصيد الافتتاحي (اختياري)");
    fireEvent.change(opening, { target: { value: "-50" } });
    fireEvent.blur(opening);
    fireEvent.click(within(dialog).getByRole("button", { name: "إضافة" }));

    expect(await within(dialog).findByRole("alert")).toHaveTextContent("لا يمكن أن يكون الرصيد الافتتاحي لحساب نقدي رصيداً سالباً.");
  });

  it("sends null rather than an empty string for the optional English name, GL account and opening date", async () => {
    let posted: Record<string, unknown> | null = null;
    mount(accounts, {
      "POST /treasury-accounts": (init) => {
        posted = JSON.parse((init?.body as string) ?? "{}") as Record<string, unknown>;
        return { status: 201, body: account({ id: "new", code: "CASH-099", name: "خزنة" }) };
      },
    });
    const dialog = await openCreateForm();

    fireEvent.change(textboxByLabel(dialog, "الكود *"), { target: { value: "CASH-099" } });
    fireEvent.change(textboxByLabel(dialog, "اسم الحساب *"), { target: { value: "  خزنة  " } });
    fireEvent.click(within(dialog).getByRole("button", { name: "إضافة" }));

    await waitFor(() => expect(posted).not.toBeNull());
    expect(posted).toMatchObject({
      code: "CASH-099",
      name: "خزنة",
      nameEn: null,
      glAccountId: null,
      openingBalanceDate: null,
      openingBalance: "0.000000",
    });
  });

  it("surfaces the server's own refusal inside the form rather than closing it", async () => {
    mount(accounts, {
      "POST /treasury-accounts": () => ({ status: 422, body: { error: "INVALID", message: "الفرع لا يقبل خزائن جديدة." } }),
    });
    const dialog = await openCreateForm();

    fireEvent.change(textboxByLabel(dialog, "الكود *"), { target: { value: "CASH-099" } });
    fireEvent.change(textboxByLabel(dialog, "اسم الحساب *"), { target: { value: "خزنة" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "إضافة" }));

    expect(await within(dialog).findByRole("alert")).toHaveTextContent("الفرع لا يقبل خزائن جديدة.");
    expect(screen.getByRole("dialog", { name: "إضافة حساب" })).toBeInTheDocument();
  });
});

describe("TreasuryAccountsScreen — narrowing the register", () => {
  it("narrows to the active accounts, then to the inactive ones", async () => {
    mount();
    await screen.findByText("صندوق نقدي");

    fireEvent.click(screen.getByRole("radio", { name: /^نشط/ }));
    await waitFor(() => expect(screen.queryByText("خزنة فرع الإسكندرية")).not.toBeInTheDocument());

    fireEvent.click(screen.getByRole("radio", { name: /^غير نشط/ }));
    expect(await screen.findByText("خزنة فرع الإسكندرية")).toBeInTheDocument();
    expect(screen.queryByText("البنك الأهلي المصري — جاري")).not.toBeInTheDocument();
  });

  it("narrows to the bank accounts alone", async () => {
    mount();
    await screen.findByText("صندوق نقدي");

    fireEvent.click(screen.getByRole("radio", { name: /^بنكي/ }));
    expect(await screen.findByText("البنك الأهلي المصري — جاري")).toBeInTheDocument();
    expect(screen.queryByText("صندوق نقدي")).not.toBeInTheDocument();
  });

  it("finds an account by its name and by its code", async () => {
    mount();
    const search = await screen.findByRole("searchbox");

    fireEvent.change(search, { target: { value: "الأهلي" } });
    await waitFor(() => expect(screen.queryByText("صندوق نقدي")).not.toBeInTheDocument());

    fireEvent.change(search, { target: { value: "CASH-002" } });
    expect(await screen.findByText("خزنة فرع الإسكندرية")).toBeInTheDocument();
    expect(screen.queryByText("البنك الأهلي المصري — جاري")).not.toBeInTheDocument();
  });
});

describe("TreasuryAccountsScreen — the opening-balance posting", () => {
  it("is offered only for a till that is empty and bound to a ledger account", async () => {
    mount();
    await screen.findByText("خزنة فرع الإسكندرية");

    // CASH-002 has no GL account behind it, so there is nowhere to post to and
    // the row offers no menu at all; CASH-001 is empty and bound, so it does.
    const unbound = screen.getByText("خزنة فرع الإسكندرية").closest("tr")!;
    expect(within(unbound).queryByRole("button", { name: "خزنة فرع الإسكندرية" })).not.toBeInTheDocument();

    const bound = screen.getByText("صندوق نقدي").closest("tr")!;
    expect(within(bound).getByRole("button", { name: "صندوق نقدي" })).toBeInTheDocument();
  });

  it("posts a balanced entry that debits the till and credits opening equity", async () => {
    let posted: { lines: Array<{ accountId: string; debit: string; credit: string }> } | null = null;
    mount(accounts, {
      "POST /gl/journal-entries": (init) => {
        posted = JSON.parse((init?.body as string) ?? "{}") as typeof posted;
        return { status: 201, body: { id: "je-1" } };
      },
    });

    const row = (await screen.findByText("صندوق نقدي")).closest("tr")!;
    fireEvent.click(within(row).getByRole("button", { name: "صندوق نقدي" }));
    fireEvent.click(await screen.findByRole("menuitem"));

    const dialog = await screen.findByRole("dialog", { name: "رصيد افتتاحي للخزنة" });
    const amount = within(dialog).getByLabelText("الرصيد");
    fireEvent.change(amount, { target: { value: "1500" } });
    fireEvent.blur(amount);
    fireEvent.click(within(dialog).getByRole("button", { name: "حفظ" }));

    await waitFor(() => expect(posted).not.toBeNull());
    expect(posted!.lines[0]).toMatchObject({ accountId: "1300-1", debit: "1500.00", credit: "0.00" });
    expect(posted!.lines[1]).toMatchObject({ debit: "0.00", credit: "1500.00" });
  });

  it("keeps the dialog open and says why when the posting is refused", async () => {
    mount(accounts, {
      "POST /gl/journal-entries": () => ({ status: 422, body: { error: "CLOSED_PERIOD", message: "الفترة المحاسبية مقفلة." } }),
    });

    const row = (await screen.findByText("صندوق نقدي")).closest("tr")!;
    fireEvent.click(within(row).getByRole("button", { name: "صندوق نقدي" }));
    fireEvent.click(await screen.findByRole("menuitem"));

    const dialog = await screen.findByRole("dialog", { name: "رصيد افتتاحي للخزنة" });
    const amount = within(dialog).getByLabelText("الرصيد");
    fireEvent.change(amount, { target: { value: "1500" } });
    fireEvent.blur(amount);
    fireEvent.click(within(dialog).getByRole("button", { name: "حفظ" }));

    expect(await within(dialog).findByText("الفترة المحاسبية مقفلة.")).toBeInTheDocument();
  });

  it("will not post nothing — the save stays disabled until an amount is entered", async () => {
    mount();

    const row = (await screen.findByText("صندوق نقدي")).closest("tr")!;
    fireEvent.click(within(row).getByRole("button", { name: "صندوق نقدي" }));
    fireEvent.click(await screen.findByRole("menuitem"));

    const dialog = await screen.findByRole("dialog", { name: "رصيد افتتاحي للخزنة" });
    expect(within(dialog).getByRole("button", { name: "حفظ" })).toBeDisabled();
  });
});

describe("TreasuryAccountsScreen — the statement panel", () => {
  it("says the ledger account is chosen by type when the account names none", async () => {
    mount();
    fireEvent.click(await screen.findByText("خزنة فرع الإسكندرية"));

    const dialog = screen.getByRole("dialog", { name: /كشف حساب/ });
    expect(within(dialog).getByText("تلقائي حسب النوع")).toBeInTheDocument();
  });

  it("falls back to the opening balance as the closing figure while the ledger is empty, and dates it", async () => {
    mount(accounts, { "GET /gl/accounts/1310/ledger": () => ({ body: { lines: [], balance: null } }) });

    fireEvent.click(await screen.findByText("البنك الأهلي المصري — جاري"));
    const dialog = screen.getByRole("dialog", { name: /كشف حساب/ });

    expect(await within(dialog).findByText("لا توجد حركات مرحّلة على هذا الحساب.")).toBeInTheDocument();
    expect(within(dialog).getByText(/2026-01-01/)).toBeInTheDocument();
    expect(within(dialog).getAllByText("50,000.00").length).toBeGreaterThan(0);
  });

  it("reports the ledger's own closing balance once the account has movements", async () => {
    mount(accounts, {
      "GET /gl/accounts/1310/ledger": () => ({
        body: {
          lines: [
            { entryId: "je-1", entryNo: "JE-000001", date: "2026-02-01", memo: "إيداع", debit: "2500.000000", credit: "0.000000", balance: "52500.000000" },
          ],
          balance: { balance: "52500.000000", debit: "52500.000000", credit: "0.000000" },
        },
      }),
    });

    fireEvent.click(await screen.findByText("البنك الأهلي المصري — جاري"));
    const dialog = screen.getByRole("dialog", { name: /كشف حساب/ });

    expect(await within(dialog).findByText("JE-000001")).toBeInTheDocument();
    expect(within(dialog).getByText("52,500.00")).toBeInTheDocument();
  });
});
