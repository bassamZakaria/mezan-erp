// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, expect, it } from "vitest";
import { screen, fireEvent, within, waitFor } from "@testing-library/react";
import type { BranchDTO, TreasuryAccountDTO, WarehouseDTO } from "@mezan/contracts";
import { BranchesPage } from "./BranchesPage";
import { renderWithProviders, stubTransport, testAdminSession } from "../data/test-support";

const MAIN: BranchDTO = {
  id: "b1",
  code: "MAIN",
  name: "الفرع الرئيسي",
  parentBranchId: null,
  phone: "0223456789",
  email: "main@cyag.example",
  address: "القاهرة الجديدة، القاهرة",
  isMain: true,
  active: true,
};

const ALEX: BranchDTO = {
  id: "b2",
  code: "ALEX",
  name: "فرع الإسكندرية",
  parentBranchId: "b1",
  phone: "0334567890",
  email: null,
  address: "سموحة، الإسكندرية",
  isMain: false,
  active: true,
};

const WAREHOUSE: WarehouseDTO = { id: "w1", code: "WH-MAIN", name: "مستودع الفرع الرئيسي", branchId: "b1", type: "MAIN", isDefault: true, active: true };

const TREASURY: TreasuryAccountDTO = {
  id: "ta-1",
  code: "CASH-001",
  name: "صندوق نقدي",
  type: "cash",
  currency: "EGP",
  branchId: "b1",
  glAccountId: "1100",
  openingBalance: "338.000000",
  openingBalanceDate: null,
  status: "active",
};

function renderPage(options: { createFails?: boolean } = {}) {
  let branches = [MAIN, ALEX];
  const transport = stubTransport({
    "GET /branches": () => ({ body: branches }),
    "GET /warehouses": () => ({ body: [WAREHOUSE] }),
    "GET /treasury-accounts": () => ({ body: [TREASURY] }),
    "POST /branches": (init) => {
      if (options.createFails) return { status: 422, body: { message: "كود الفرع غير صالح" } };
      const body = JSON.parse((init?.body as string) ?? "{}") as BranchDTO;
      const created: BranchDTO = { ...MAIN, ...body };
      branches = [...branches, created];
      return { status: 201, body: created };
    },
  });
  return renderWithProviders(<BranchesPage />, { transport, initialSession: testAdminSession });
}

describe("BranchesPage", () => {
  it("lists the branches the API returns", async () => {
    renderPage();
    expect(screen.getByRole("heading", { name: "الفروع" })).toBeInTheDocument();
    expect(await screen.findByText("MAIN")).toBeInTheDocument();
    expect(screen.getByText("فرع الإسكندرية")).toBeInTheDocument();
  });

  it("opens the Branch 360 detail on row click, with live treasury accounts and stub tabs", async () => {
    renderPage();
    fireEvent.click(await screen.findByText("MAIN"));
    expect(screen.getByRole("heading", { name: /الفرع الرئيسي/ })).toBeInTheDocument();
    expect(await screen.findByText("صندوق نقدي")).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "المخزون" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("tab", { name: "المخزون" }));
    expect(screen.getAllByText("قريباً").length).toBeGreaterThan(0);
  });

  it("returns to the list from the detail view", async () => {
    renderPage();
    fireEvent.click(await screen.findByText("MAIN"));
    fireEvent.click(screen.getByRole("button", { name: "رجوع لقائمة الفروع" }));
    expect(screen.getByRole("heading", { name: "الفروع" })).toBeInTheDocument();
  });

  it("adds a new branch through the side panel", async () => {
    renderPage();
    await screen.findByText("MAIN");
    fireEvent.click(screen.getByRole("button", { name: "إضافة فرع" }));

    const dialog = screen.getByRole("dialog", { name: "إضافة فرع" });
    fireEvent.change(within(dialog).getByLabelText("اسم الفرع"), { target: { value: "فرع الجيزة" } });
    fireEvent.change(within(dialog).getByLabelText("رمز الفرع"), { target: { value: "GIZA" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "حفظ الفرع" }));

    expect(await screen.findByText("فرع الجيزة")).toBeInTheDocument();
  });

  it("surfaces the server's rejection instead of adding an invalid branch", async () => {
    renderPage({ createFails: true });
    await screen.findByText("MAIN");
    fireEvent.click(screen.getByRole("button", { name: "إضافة فرع" }));
    const dialog = screen.getByRole("dialog", { name: "إضافة فرع" });
    fireEvent.click(within(dialog).getByRole("button", { name: "حفظ الفرع" }));
    await waitFor(() => expect(within(dialog).getByText("كود الفرع غير صالح")).toBeInTheDocument());
  });
});
