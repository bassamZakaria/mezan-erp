// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, expect, it } from "vitest";
import { screen, fireEvent, within, waitFor } from "@testing-library/react";
import type { TreasuryAccountDTO } from "@mezan/contracts";
import { TreasuryAccountsScreen } from "./TreasuryAccountsScreen";
import { renderWithProviders, stubTransport, testAdminSession } from "../data/test-support";

const sampleAccounts: TreasuryAccountDTO[] = [
  { id: "ta-cash1", code: "CASH-001", name: "صندوق نقدي", type: "cash", currency: "EGP", branchId: "b1", glAccountId: null, openingBalance: "0.000000", openingBalanceDate: null, status: "active" },
  { id: "ta-cash2", code: "CASH-002", name: "صندوق نقدي الفرع الرئيسي", type: "cash", currency: "EGP", branchId: "b1", glAccountId: "1300-1", openingBalance: "238.000000", openingBalanceDate: "2026-08-01", status: "active" },
  { id: "ta-bank1", code: "BANK-001", name: "البنك الأهلي المصري — جاري", type: "bank", currency: "EGP", branchId: "b1", glAccountId: "1310", openingBalance: "50000.000000", openingBalanceDate: "2026-01-01", status: "active" },
];

function renderScreen(accounts: TreasuryAccountDTO[] = sampleAccounts) {
  let current = [...accounts];
  const transport = stubTransport({
    "GET /branches": () => ({
      body: [{ id: "b1", code: "MAIN", name: "الفرع الرئيسي", parentBranchId: null, phone: null, email: null, address: null, isMain: true, active: true }],
    }),
    "GET /treasury-accounts": () => ({ body: current }),
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

  it("shows an empty state when there are no treasury accounts yet", async () => {
    renderScreen([]);
    expect(await screen.findByText("لا توجد حسابات خزينة مطابقة")).toBeInTheDocument();
  });

  it("filters the list by type via the chip row", async () => {
    renderScreen();
    await screen.findByText("صندوق نقدي");
    fireEvent.click(screen.getByRole("button", { name: "بنكي" }));
    expect(screen.getByText("البنك الأهلي المصري — جاري")).toBeInTheDocument();
    expect(screen.queryByText("صندوق نقدي")).not.toBeInTheDocument();
  });

  it("adds a new treasury account through the side panel", async () => {
    renderScreen();
    await screen.findByText("صندوق نقدي");
    fireEvent.click(screen.getByRole("button", { name: "إضافة حساب" }));

    const dialog = screen.getByRole("dialog", { name: "إضافة حساب" });
    fireEvent.change(within(dialog).getByLabelText("اسم الحساب *"), { target: { value: "صندوق تجريبي" } });
    fireEvent.change(within(dialog).getByLabelText("الكود *"), { target: { value: "CASH-099" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "إضافة" }));

    expect(await screen.findByText("صندوق تجريبي")).toBeInTheDocument();
  });

  it("rejects a duplicate treasury account code with an inline error", async () => {
    renderScreen();
    await screen.findByText("صندوق نقدي");
    fireEvent.click(screen.getByRole("button", { name: "إضافة حساب" }));
    const dialog = screen.getByRole("dialog", { name: "إضافة حساب" });
    fireEvent.change(within(dialog).getByLabelText("اسم الحساب *"), { target: { value: "نسخة" } });
    fireEvent.change(within(dialog).getByLabelText("الكود *"), { target: { value: "CASH-001" } });
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
    fireEvent.change(within(editDialog).getByLabelText("اسم الحساب *"), { target: { value: "صندوق الفرع الرئيسي المحدّث" } });
    fireEvent.click(within(editDialog).getByRole("switch", { name: "نشط" }));
    fireEvent.click(within(editDialog).getByRole("button", { name: "حفظ التعديلات" }));

    expect(await screen.findByText("صندوق الفرع الرئيسي المحدّث")).toBeInTheDocument();
    expect(screen.queryByText("صندوق نقدي الفرع الرئيسي")).not.toBeInTheDocument();
    expect(screen.getAllByText("غير نشط").length).toBeGreaterThan(0);
  });
});
