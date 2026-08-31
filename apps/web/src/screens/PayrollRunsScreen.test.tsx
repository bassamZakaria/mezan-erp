// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, expect, it } from "vitest";
import { screen, fireEvent, within, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { BranchDTO, EmployeeDTO, PayrollRunDetailDTO, PayrollRunDTO, TreasuryAccountDTO } from "@mezan/contracts";
import { PayrollRunsScreen } from "./PayrollRunsScreen";
import { renderWithProviders, stubTransport, testAdminSession } from "../data/test-support";

// jsdom has no layout engine and does not implement scrollIntoView; the
// dropdown menu (Select) calls it when the active option changes.
if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = () => {};
}

const employees: EmployeeDTO[] = [
  {
    id: "emp-1", code: "EMP-0001", firstName: "Ahmed", lastName: "Mahmoud", firstNameAr: "أحمد", lastNameAr: "محمود",
    email: null, phone: null, birthDate: null, nationalId: null, gender: null, maritalStatus: null,
    departmentId: null, jobTitleId: null, managerId: null, branchId: "MAIN", hireDate: "2026-08-11",
    workerCategory: "staff", employmentType: "full_time", overtimeEligibility: "inherit_department",
    standardWorkHours: null, probationEndDate: null, priorServiceYears: 0, requireSelfieAtClockIn: false,
    requireBiometricAtClockIn: false, address: null, emergencyContact: null, status: "active", terminatedAt: null,
    createdAt: "2026-08-11T00:00:00.000Z",
  },
];

const branches: BranchDTO[] = [
  { id: "MAIN", code: "MAIN", name: "الفرع الرئيسي", parentBranchId: null, phone: null, email: null, address: null, isMain: true, active: true },
];

const treasuryAccounts: TreasuryAccountDTO[] = [
  { id: "treas-1", code: "CASH-1", name: "خزينة الفرع الرئيسي", nameEn: null, type: "cash", currency: "EGP", branchId: "MAIN", glAccountId: null, openingBalance: "0", openingBalanceDate: null, status: "active" },
];

function run(overrides: Partial<PayrollRunDTO> = {}): PayrollRunDTO {
  return {
    id: "run-1",
    number: "PR-000001",
    year: 2026,
    month: 8,
    periodStart: "2026-08-01",
    periodEnd: "2026-08-31",
    branchId: null,
    currency: "EGP",
    status: "draft",
    employeeCount: 1,
    totalGross: "10000.000000",
    totalDeductions: "0.000000",
    totalEmployerContributions: "0.000000",
    totalNet: "10000.000000",
    unpaidLeaveSource: "none",
    warnings: [],
    journalEntryId: null,
    disbursementVoucherId: null,
    calculatedAt: null,
    approvedAt: null,
    approvedBy: null,
    disbursedAt: null,
    cancelledAt: null,
    createdAt: "2026-08-20T00:00:00.000Z",
    ...overrides,
  };
}

function runDetail(overrides: Partial<PayrollRunDetailDTO> = {}): PayrollRunDetailDTO {
  return {
    ...run(),
    payslips: [
      {
        id: "slip-1",
        number: "PS-000001",
        runId: "run-1",
        employeeId: "emp-1",
        contractId: "contract-1",
        currency: "EGP",
        periodStart: "2026-08-01",
        periodEnd: "2026-08-31",
        periodDays: 31,
        paidDays: 31,
        lines: [
          { id: "line-1", kind: "earning", source: "contract_basic", nameAr: "الراتب الأساسي", amount: "10000.000000", glAccountId: null, referenceId: null },
        ],
        grossEarnings: "10000.000000",
        totalDeductions: "0.000000",
        employerContributions: "0.000000",
        netPay: "10000.000000",
        createdAt: "2026-08-20T00:00:00.000Z",
      },
    ],
    ...overrides,
  };
}

function renderScreen(runs: PayrollRunDTO[] = [run()]) {
  let current = [...runs];
  const details = new Map<string, PayrollRunDetailDTO>(current.map((r) => [r.id, runDetail({ ...r })]));
  let createdBody: unknown = null;
  let disburseBody: unknown = null;
  const transport = stubTransport({
    "GET /branches": () => ({ body: branches }),
    "GET /hr/employees": () => ({ body: employees }),
    "GET /treasury-accounts": () => ({ body: treasuryAccounts }),
    "GET /hr/payroll/runs": () => ({ body: current }),
    "GET /hr/payroll/runs/*": (_init, path) => {
      const id = path.split("/").pop()!;
      const detail = details.get(id);
      return detail ? { body: detail } : { status: 404, body: { error: "NOT_FOUND" } };
    },
    "POST /hr/payroll/runs": (init) => {
      createdBody = JSON.parse((init?.body as string) ?? "{}");
      const body = createdBody as Partial<PayrollRunDTO>;
      const created = run({ id: "run-new", number: "PR-000002", ...body });
      current = [...current, created];
      details.set(created.id, runDetail({ ...created }));
      return { body: created };
    },
    "POST /hr/payroll/runs/*/calculate": (_init, path) => {
      const id = path.split("/")[4]!;
      current = current.map((r) => (r.id === id ? { ...r, status: "calculated" } : r));
      const detail = { ...details.get(id)!, status: "calculated" as const };
      details.set(id, detail);
      return { body: detail };
    },
    "POST /hr/payroll/runs/*/approve": (_init, path) => {
      const id = path.split("/")[4]!;
      current = current.map((r) => (r.id === id ? { ...r, status: "approved" } : r));
      const detail = { ...details.get(id)!, status: "approved" as const, journalEntryId: "je-1" };
      details.set(id, detail);
      return { body: current.find((r) => r.id === id)! };
    },
    "POST /hr/payroll/runs/*/disburse": (init, path) => {
      disburseBody = JSON.parse((init?.body as string) ?? "{}");
      const id = path.split("/")[4]!;
      current = current.map((r) => (r.id === id ? { ...r, status: "disbursed" } : r));
      const detail = { ...details.get(id)!, status: "disbursed" as const };
      details.set(id, detail);
      return { body: current.find((r) => r.id === id)! };
    },
    "POST /hr/payroll/runs/*/cancel": (_init, path) => {
      const id = path.split("/")[4]!;
      current = current.map((r) => (r.id === id ? { ...r, status: "cancelled" } : r));
      const detail = { ...details.get(id)!, status: "cancelled" as const };
      details.set(id, detail);
      return { body: current.find((r) => r.id === id)! };
    },
  });
  const result = renderWithProviders(<PayrollRunsScreen />, { transport, initialSession: testAdminSession });
  return { ...result, getCreatedBody: () => createdBody, getDisburseBody: () => disburseBody };
}

describe("PayrollRunsScreen", () => {
  it("lists runs with formatted money, never a raw scaled-decimal string", async () => {
    renderScreen();
    expect(screen.getByRole("heading", { name: "الرواتب" })).toBeInTheDocument();
    expect(await screen.findByText("PR-000001")).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByText("10000.000000")).not.toBeInTheDocument());
    expect(screen.getAllByText((_, el) => el?.textContent === "10,000.00").length).toBeGreaterThan(0);
  });

  it("shows the empty state honestly when there are no runs", async () => {
    renderScreen([]);
    expect(await screen.findByText("لا توجد بيانات")).toBeInTheDocument();
  });

  it("shows an Arabic error banner with a working retry on load failure", async () => {
    let calls = 0;
    const transport = stubTransport({
      "GET /branches": () => ({ body: branches }),
      "GET /hr/employees": () => ({ body: employees }),
      "GET /treasury-accounts": () => ({ body: treasuryAccounts }),
      "GET /hr/payroll/runs": () => {
        calls += 1;
        return calls === 1 ? { status: 500, body: { error: "SERVER_ERROR" } } : { body: [run()] };
      },
    });
    renderWithProviders(<PayrollRunsScreen />, { transport, initialSession: testAdminSession });
    expect(await screen.findByText("تعذّر تحميل دورات الرواتب.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "إعادة المحاولة" }));
    await screen.findByText("PR-000001");
    await waitFor(() => expect(screen.queryByText("تعذّر تحميل دورات الرواتب.")).not.toBeInTheDocument());
  });

  it("status chip filter and search box each narrow the visible rows", async () => {
    renderScreen([run(), run({ id: "run-2", number: "PR-000002", status: "cancelled" })]);
    await screen.findByText("PR-000001");
    fireEvent.click(screen.getByRole("tab", { name: /^ملغى/ }));
    await waitFor(() => expect(screen.queryByText("PR-000001")).not.toBeInTheDocument());
    expect(screen.getByText("PR-000002")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("tab", { name: /^الكل/ }));
    await screen.findByText("PR-000001");
    fireEvent.change(screen.getByPlaceholderText(/رقم التشغيل/), { target: { value: "000002" } });
    await waitFor(() => expect(screen.queryByText("PR-000001")).not.toBeInTheDocument());
    expect(screen.getByText("PR-000002")).toBeInTheDocument();
  });

  it("creates a new run with the picked year/month, then opens its detail", async () => {
    const { getCreatedBody } = renderScreen([]);
    await screen.findByText("لا توجد بيانات");
    fireEvent.click(screen.getAllByRole("button", { name: "تشغيل رواتب جديد" })[0]!);
    const dialog = screen.getByRole("dialog");
    const user = userEvent.setup();
    await user.click(within(dialog).getByRole("combobox", { name: "الشهر *" }));
    await user.click(await screen.findByRole("option", { name: "سبتمبر" }));
    fireEvent.click(within(dialog).getByRole("button", { name: "إنشاء" }));
    await waitFor(() => expect(getCreatedBody()).not.toBeNull());
    const body = getCreatedBody() as Record<string, unknown>;
    expect(body.month).toBe(9);
    expect(typeof body.year).toBe("number");
    // Creating opens the new run's own detail panel.
    expect(await screen.findByRole("heading", { name: "PR-000002" })).toBeInTheDocument();
  });

  it("a server refusal on create renders the server's Arabic message, not raw JSON", async () => {
    const transport = stubTransport({
      "GET /branches": () => ({ body: branches }),
      "GET /hr/employees": () => ({ body: employees }),
      "GET /treasury-accounts": () => ({ body: treasuryAccounts }),
      "GET /hr/payroll/runs": () => ({ body: [] }),
      "POST /hr/payroll/runs": () => ({ status: 400, body: { message: "توجد دورة رواتب بالفعل لهذا الشهر" } }),
    });
    renderWithProviders(<PayrollRunsScreen />, { transport, initialSession: testAdminSession });
    await screen.findByText("لا توجد بيانات");
    fireEvent.click(screen.getAllByRole("button", { name: "تشغيل رواتب جديد" })[0]!);
    const dialog = screen.getByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "إنشاء" }));
    expect(await within(dialog).findByText("توجد دورة رواتب بالفعل لهذا الشهر")).toBeInTheDocument();
  });

  it("opens a run's detail panel showing status, totals and the unimplemented-rules note", async () => {
    renderScreen();
    fireEvent.click(await screen.findByText("PR-000001"));
    const dialog = screen.getByRole("dialog");
    expect(await within(dialog).findByText("مسودة")).toBeInTheDocument();
    expect(within(dialog).getByText("ضريبة كسب العمل")).toBeInTheDocument();
  });

  it("calculate → approve moves the run through its real lifecycle and posts the entry", async () => {
    renderScreen();
    fireEvent.click(await screen.findByText("PR-000001"));
    const dialog = screen.getByRole("dialog");
    fireEvent.click(await within(dialog).findByRole("button", { name: "احتساب الرواتب" }));
    await within(dialog).findByText("محتسب");
    fireEvent.click(within(dialog).getByRole("button", { name: "اعتماد وترحيل القيد" }));
    await within(dialog).findByText("معتمد");
    expect(within(dialog).getByText("je-1")).toBeInTheDocument();
  });

  it("cancel is only offered while draft/calculated, and works from the row menu", async () => {
    renderScreen();
    const row = (await screen.findByText("PR-000001")).closest("tr") as HTMLElement;
    fireEvent.click(within(row).getByRole("button", { name: /^إجراءات/ }));
    fireEvent.click(within(row).getByRole("menuitem", { name: "إلغاء الدورة" }));
    // A `tone: "danger"` `RowMenu` item auto-confirms via a `ConfirmDialog` with the same label.
    const confirmDialog = screen.getByRole("dialog");
    fireEvent.click(within(confirmDialog).getByRole("button", { name: "إلغاء الدورة" }));
    await within(row).findByText("ملغى");
    // Cancelling twice would reverse the payroll twice. Once the run is
    // cancelled the menu must not offer it again.
    fireEvent.click(within(row).getByRole("button", { name: /^إجراءات/ }));
    expect(within(row).queryByRole("menuitem", { name: "إلغاء الدورة" })).toBeNull();
  });

  it("does NOT offer cancel once a run is approved or disbursed — the entry is already in the books", async () => {
    // The test above promises this half in its title and never checked it. A
    // cancel offered on a disbursed run reverses money that has already left
    // the treasury.
    for (const status of ["approved", "disbursed"] as const) {
      const view = renderScreen([run({ status })]);
      const row = (await screen.findByText("PR-000001")).closest("tr") as HTMLElement;
      fireEvent.click(within(row).getByRole("button", { name: /^إجراءات/ }));
      // Prove the menu actually opened before reading absence from it —
      // otherwise a menu that failed to open would satisfy this test.
      expect(within(row).getAllByRole("menuitem").length).toBeGreaterThan(0);
      expect(within(row).queryByRole("menuitem", { name: "إلغاء الدورة" })).toBeNull();
      view.unmount();
    }
  });

  it("disburse requires a picked treasury account and branch, both real ids in the request body", async () => {
    const { getDisburseBody } = renderScreen([run({ status: "approved" })]);
    fireEvent.click(await screen.findByText("PR-000001"));
    const dialog = screen.getByRole("dialog");
    const payButton = await within(dialog).findByRole("button", { name: "صرف" });
    fireEvent.click(payButton);
    // Blocked with an Arabic message until both fields are picked.
    expect(await within(dialog).findByText("اختر الخزينة والفرع قبل الصرف.")).toBeInTheDocument();
    expect(getDisburseBody()).toBeNull();

    const user = userEvent.setup();
    await user.click(within(dialog).getByRole("combobox", { name: "الخزينة *" }));
    await user.click(await screen.findByRole("option", { name: /خزينة الفرع الرئيسي/ }));
    await user.click(within(dialog).getByRole("combobox", { name: "الفرع *" }));
    await user.click(await screen.findByRole("option", { name: "الفرع الرئيسي" }));
    fireEvent.click(payButton);
    await waitFor(() => expect(getDisburseBody()).not.toBeNull());
    const body = getDisburseBody() as Record<string, unknown>;
    expect(body.treasuryAccountId).toBe("treas-1");
    expect(body.branchId).toBe("MAIN");
  });

  it("a server refusal on an action renders the Arabic error, not raw JSON", async () => {
    const transport = stubTransport({
      "GET /branches": () => ({ body: branches }),
      "GET /hr/employees": () => ({ body: employees }),
      "GET /treasury-accounts": () => ({ body: treasuryAccounts }),
      "GET /hr/payroll/runs": () => ({ body: [run()] }),
      "GET /hr/payroll/runs/*": () => ({ body: runDetail() }),
      "POST /hr/payroll/runs/*/calculate": () => ({ status: 400, body: { message: "لا يمكن احتساب دورة بلا موظفين نشطين" } }),
    });
    renderWithProviders(<PayrollRunsScreen />, { transport, initialSession: testAdminSession });
    fireEvent.click(await screen.findByText("PR-000001"));
    const dialog = screen.getByRole("dialog");
    fireEvent.click(await within(dialog).findByRole("button", { name: "احتساب الرواتب" }));
    expect(await within(dialog).findByText("لا يمكن احتساب دورة بلا موظفين نشطين")).toBeInTheDocument();
  });

  it("payslip lines render the real employee name and formatted money, never a raw balance string", async () => {
    renderScreen();
    fireEvent.click(await screen.findByText("PR-000001"));
    const dialog = screen.getByRole("dialog");
    expect(await within(dialog).findByText("أحمد محمود")).toBeInTheDocument();
    expect(within(dialog).queryByText("10000.000000")).not.toBeInTheDocument();
  });
});
