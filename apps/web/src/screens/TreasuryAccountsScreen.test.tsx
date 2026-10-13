// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, expect, it } from "vitest";
import { screen, fireEvent, within, waitFor } from "@testing-library/react";
import type { BranchDTO, TreasuryAccountDTO } from "@mezan/contracts";
import { TreasuryAccountsScreen } from "./TreasuryAccountsScreen";
import { renderWithProviders, stubTransport, testAdminSession } from "../data/test-support";

const sampleBranches: BranchDTO[] = [
  { id: "b1", code: "MAIN", name: "الفرع الرئيسي", parentBranchId: null, phone: null, email: null, address: null, isMain: true, active: true },
  { id: "b2", code: "ALEX", name: "فرع الإسكندرية", parentBranchId: "b1", phone: null, email: null, address: null, isMain: false, active: true },
];

const sampleAccounts: TreasuryAccountDTO[] = [
  { id: "ta-cash1", code: "CASH-001", name: "صندوق نقدي", nameEn: null, type: "cash", currency: "EGP", bankAccountNumber: null, branchId: "b1", glAccountId: null, openingBalance: "0.000000", openingBalanceDate: null, guaranteeFacilityLimit: null, status: "active" },
  { id: "ta-cash2", code: "CASH-002", name: "صندوق نقدي الفرع الرئيسي", nameEn: null, type: "cash", currency: "EGP", bankAccountNumber: null, branchId: "b1", glAccountId: "1300-1", openingBalance: "238.000000", openingBalanceDate: "2026-08-01", guaranteeFacilityLimit: null, status: "active" },
  { id: "ta-bank1", code: "BANK-001", name: "البنك الأهلي المصري — جاري", nameEn: null, type: "bank", currency: "EGP", bankAccountNumber: null, branchId: "b1", glAccountId: "1310", openingBalance: "50000.000000", openingBalanceDate: "2026-01-01", guaranteeFacilityLimit: null, status: "active" },
];

/** `TextField` renders a plain `<label>` with no `for`/`aria-labelledby`, so
 * `getByLabelText` cannot find its `<input>` — locate it by DOM adjacency
 * instead, matching the `Field` primitive's label-then-control layout. */
function textboxByLabel(container: HTMLElement, label: string): HTMLInputElement {
  const labelNode = within(container).getByText(label);
  const input = labelNode.parentElement?.querySelector("input, textarea");
  if (!input) throw new Error(`no text input associated with label "${label}"`);
  return input as HTMLInputElement;
}

function renderScreen(accounts: TreasuryAccountDTO[] = sampleAccounts) {
  let current = [...accounts];
  const transport = stubTransport({
    "GET /treasury-accounts": () => ({ body: current }),
    "GET /branches": () => ({ body: sampleBranches }),
    "POST /treasury-accounts": (init) => {
      const body = JSON.parse((init?.body as string) ?? "{}");
      if (current.some((a) => a.code === body.code)) {
        return { status: 409, body: { error: "DUPLICATE_TREASURY_ACCOUNT_CODE", message: `الكود "${body.code}" مستخدم بالفعل.` } };
      }
      const created: TreasuryAccountDTO = {
        ...body,
        type: body.type ?? "cash",
        currency: body.currency ?? "EGP",
        glAccountId: body.glAccountId ?? null,
        openingBalance: body.openingBalance ?? "0.000000",
        openingBalanceDate: body.openingBalanceDate ?? null,
        status: "active",
      };
      current = [...current, created];
      return { status: 201, body: created };
    },
    "PATCH /treasury-accounts/ta-cash2": (init) => {
      const patch = JSON.parse((init?.body as string) ?? "{}");
      const updated: TreasuryAccountDTO = { ...current[1]!, ...patch };
      current = [current[0]!, updated, ...current.slice(2)];
      return { body: updated };
    },
  });
  return renderWithProviders(<TreasuryAccountsScreen />, { transport, initialSession: testAdminSession });
}

describe("TreasuryAccountsScreen", () => {
  it("lists treasury accounts from the real backend (2 cash + 1 bank)", async () => {
    renderScreen();
    expect(screen.getByRole("heading", { name: "حسابات الخزينة" })).toBeInTheDocument();
    expect(await screen.findByText("صندوق نقدي")).toBeInTheDocument();
    expect(screen.getByText("صندوق نقدي الفرع الرئيسي")).toBeInTheDocument();
    expect(screen.getByText("البنك الأهلي المصري — جاري")).toBeInTheDocument();
  });

  it("a foreign-currency account shows what it holds in its own currency beside the base balance", async () => {
    renderScreen([{ ...sampleAccounts[2]!, id: "ta-usd", code: "BANK-USD", name: "البنك الأهلي — دولار", currency: "USD", foreignBalance: "1100.000000", foreignBalanceBase: "53745.000000", foreignBalanceDerivedLines: 0 }]);
    const row = (await screen.findByText("البنك الأهلي — دولار")).closest("tr")!;
    expect(row).toHaveTextContent("1,100.00 USD");
  });

  it("shows an empty state when there are no treasury accounts yet", async () => {
    renderScreen([]);
    expect(await screen.findByText("لا توجد حسابات خزينة مطابقة")).toBeInTheDocument();
  });

  it("filters the list by type via the chip row", async () => {
    renderScreen();
    await screen.findByText("صندوق نقدي");
    fireEvent.click(screen.getByRole("radio", { name: /^بنكي/ }));
    expect(screen.getByText("البنك الأهلي المصري — جاري")).toBeInTheDocument();
    expect(screen.queryByText("صندوق نقدي")).not.toBeInTheDocument();
  });

  it("adds a new treasury account through the side panel", async () => {
    renderScreen();
    await screen.findByText("صندوق نقدي");
    fireEvent.click(screen.getByRole("button", { name: "إضافة حساب" }));

    const dialog = screen.getByRole("dialog", { name: "إضافة حساب" });
    fireEvent.change(textboxByLabel(dialog, "اسم الحساب *"), { target: { value: "صندوق تجريبي" } });
    fireEvent.change(textboxByLabel(dialog, "الكود *"), { target: { value: "CASH-099" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "إضافة" }));

    expect(await screen.findByText("صندوق تجريبي")).toBeInTheDocument();
  });

  it("rejects a duplicate treasury account code with an inline error", async () => {
    renderScreen();
    await screen.findByText("صندوق نقدي");
    fireEvent.click(screen.getByRole("button", { name: "إضافة حساب" }));
    const dialog = screen.getByRole("dialog", { name: "إضافة حساب" });
    fireEvent.change(textboxByLabel(dialog, "اسم الحساب *"), { target: { value: "نسخة" } });
    fireEvent.change(textboxByLabel(dialog, "الكود *"), { target: { value: "CASH-001" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "إضافة" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("مستخدم بالفعل");
  });

  it("opens the account statement panel on row click", async () => {
    renderScreen();
    fireEvent.click(await screen.findByText("صندوق نقدي الفرع الرئيسي"));
    expect(screen.getByRole("dialog", { name: /كشف حساب/ })).toBeInTheDocument();
  });

  it("edits an existing treasury account from the detail panel, including toggling it inactive", async () => {
    renderScreen();
    fireEvent.click(await screen.findByText("صندوق نقدي الفرع الرئيسي"));
    fireEvent.click(within(screen.getByRole("dialog", { name: /كشف حساب/ })).getByRole("button", { name: "تعديل" }));

    const editDialog = screen.getByRole("dialog", { name: "تعديل حساب" });
    fireEvent.change(textboxByLabel(editDialog, "اسم الحساب *"), { target: { value: "صندوق الفرع الرئيسي المحدّث" } });
    fireEvent.click(within(editDialog).getByRole("switch", { name: "نشط" }));
    fireEvent.click(within(editDialog).getByRole("button", { name: "حفظ التعديلات" }));

    expect(await screen.findByText("صندوق الفرع الرئيسي المحدّث")).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByText("صندوق نقدي الفرع الرئيسي")).not.toBeInTheDocument());
    expect(screen.getAllByText("غير نشط").length).toBeGreaterThan(0);
  });

  it("shows a retry card when the treasury accounts request fails", async () => {
    let getCalls = 0;
    const transport = stubTransport({
      "GET /treasury-accounts": () => {
        getCalls += 1;
        return { status: 500, body: { error: "INTERNAL" } };
      },
      "GET /branches": () => ({ body: sampleBranches }),
    });
    renderWithProviders(<TreasuryAccountsScreen />, { transport, initialSession: testAdminSession });

    expect(await screen.findByText("تعذّر تحميل حسابات الخزينة. (رمز 500)")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "إعادة المحاولة" }));
    await waitFor(() => expect(getCalls).toBeGreaterThan(1));
  });
});

/** guards §4.5 #13 — the error card shows the SERVER's reason, not the screen's fixed sentence. */
describe("TreasuryAccountsScreen — a 502 body reaches the error card", () => {
  it("renders the server's own Arabic reason", async () => {
    renderWithProviders(
      <TreasuryAccountsScreen />,
      {
        transport: stubTransport({
          "GET /treasury-accounts": () => ({ status: 502, body: { message: "تعذّر الوصول إلى الجهاز الرئيسي. الجهاز مغلق أو غير متصل بالشبكة." } }),
          "GET /branches": () => ({ body: sampleBranches }),
        }),
        initialSession: testAdminSession,
      },
    );

    expect(await screen.findByText("تعذّر الوصول إلى الجهاز الرئيسي. الجهاز مغلق أو غير متصل بالشبكة.")).toBeInTheDocument();
    expect(screen.queryByText("تعذّر تحميل حسابات الخزينة.")).not.toBeInTheDocument();
  });
});
