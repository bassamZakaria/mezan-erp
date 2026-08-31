// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, expect, it } from "vitest";
import { screen, fireEvent, within, waitFor } from "@testing-library/react";
import type { BranchDTO, EmployeeAdvanceDTO, EmployeeDTO, TreasuryAccountDTO } from "@mezan/contracts";
import { EmployeeAdvancesScreen } from "./EmployeeAdvancesScreen";
import { renderWithProviders, stubTransport, testAdminSession } from "../data/test-support";

/** Type into an EntityPicker combobox and pick the matching option — selection
 * fires on `onMouseDown` (not `click`), so the input's blur never wins the race. */
function pickFromCombobox(container: HTMLElement, label: string, optionLabel: string) {
  const input = within(container).getByLabelText(label);
  fireEvent.focus(input);
  fireEvent.change(input, { target: { value: optionLabel } });
  const option = within(container).getByRole("button", { name: (accessibleName) => accessibleName.startsWith(optionLabel) });
  fireEvent.mouseDown(option);
}

/** MoneyInput only commits its draft to React state on blur. */
function typeMoney(input: HTMLElement, value: string) {
  fireEvent.change(input, { target: { value } });
  fireEvent.blur(input);
}

function fieldInput(container: HTMLElement, labelText: string): HTMLInputElement {
  const label = within(container).getByText(labelText, { selector: "label" });
  const input = label.parentElement?.querySelector<HTMLInputElement>("input, textarea");
  if (!input) throw new Error(`No input control found next to label "${labelText}"`);
  return input;
}

function openRowMenu(row: HTMLElement, itemLabel: string) {
  fireEvent.click(within(row).getByRole("button", { name: /^إجراءات/ }));
  fireEvent.click(within(row).getByRole("menuitem", { name: itemLabel }));
}

function employee(overrides: Partial<EmployeeDTO> = {}): EmployeeDTO {
  return {
    id: "emp-1",
    code: "EMP-0001",
    firstName: "Ahmed",
    lastName: "Hassan",
    firstNameAr: "أحمد",
    lastNameAr: "حسن",
    email: null,
    phone: null,
    birthDate: null,
    nationalId: null,
    gender: null,
    maritalStatus: null,
    departmentId: null,
    jobTitleId: null,
    managerId: null,
    branchId: "MAIN",
    hireDate: "2024-01-01",
    workerCategory: "staff",
    employmentType: "full_time",
    overtimeEligibility: "inherit_department",
    standardWorkHours: null,
    probationEndDate: null,
    priorServiceYears: 0,
    requireSelfieAtClockIn: false,
    requireBiometricAtClockIn: false,
    address: null,
    emergencyContact: null,
    status: "active",
    terminatedAt: null,
    createdAt: "2024-01-01T00:00:00.000Z",
    ...overrides,
  };
}

const employees: EmployeeDTO[] = [
  employee(),
  employee({ id: "emp-2", code: "EMP-0002", firstName: "Mona", lastName: "Salem", firstNameAr: "منى", lastNameAr: "سالم" }),
];

const branches: BranchDTO[] = [
  { id: "MAIN", code: "MAIN", name: "الفرع الرئيسي", parentBranchId: null, phone: null, email: null, address: null, isMain: true, active: true },
];

const treasuryAccounts: TreasuryAccountDTO[] = [
  { id: "tre-1", code: "CASH-MAIN", name: "خزينة رئيسية", nameEn: null, type: "cash", currency: "EGP", branchId: "MAIN", glAccountId: null, openingBalance: "0", openingBalanceDate: null, status: "active" },
];

function advance(overrides: Partial<EmployeeAdvanceDTO> = {}): EmployeeAdvanceDTO {
  return {
    id: "adv-1",
    number: "ADV-000001",
    employeeId: "emp-1",
    amount: "3000.000000",
    currency: "EGP",
    installmentCount: 3,
    firstDeductionDate: "2026-09-01",
    reason: "ظروف عائلية",
    installments: [
      { seq: 1, dueDate: "2026-09-01", amount: "1000.000000", recovered: "0.000000" },
      { seq: 2, dueDate: "2026-10-01", amount: "1000.000000", recovered: "0.000000" },
      { seq: 3, dueDate: "2026-11-01", amount: "1000.000000", recovered: "0.000000" },
    ],
    outstanding: "3000.000000",
    recovered: "0.000000",
    status: "pending",
    requestedAt: "2026-08-10T09:00:00.000Z",
    decidedAt: null,
    decidedBy: null,
    disbursedAt: null,
    disbursementVoucherId: null,
    disbursementJournalEntryId: null,
    repaidAt: null,
    createdAt: "2026-08-10T09:00:00.000Z",
    ...overrides,
  };
}

const approvedAdvance = advance({
  id: "adv-2",
  number: "ADV-000002",
  employeeId: "emp-2",
  amount: "1500.000000",
  outstanding: "1500.000000",
  installmentCount: 1,
  installments: [{ seq: 1, dueDate: "2026-09-15", amount: "1500.000000", recovered: "0.000000" }],
  status: "approved",
  reason: null,
});

function renderScreen(options: { advances?: EmployeeAdvanceDTO[]; extra?: Record<string, (init: RequestInit | undefined, path: string) => { status?: number; body: unknown }> } = {}) {
  let current = options.advances ?? [advance(), approvedAdvance];
  const calls: string[] = [];
  const transport = stubTransport({
    "GET /hr/advances": (_init, path) => {
      calls.push(path);
      return { body: current };
    },
    "GET /hr/advances/outstanding": () => ({
      body: [
        { employeeId: "emp-1", outstanding: "3000.000000", advanceCount: 1 },
        { employeeId: "emp-2", outstanding: "1500.000000", advanceCount: 1 },
      ],
    }),
    "GET /hr/employees": () => ({ body: employees }),
    "GET /treasury-accounts": () => ({ body: treasuryAccounts }),
    "GET /branches": () => ({ body: branches }),
    "POST /hr/advances/*/approve": (_init, path) => {
      const id = path.split("/")[3];
      current = current.map((a) => (a.id === id ? { ...a, status: "approved" as const } : a));
      return { body: current.find((a) => a.id === id)! };
    },
    ...options.extra,
  });
  const view = renderWithProviders(<EmployeeAdvancesScreen />, { transport, initialSession: testAdminSession });
  return { ...view, calls, getCurrent: () => current };
}

describe("EmployeeAdvancesScreen", () => {
  it("lists advances from GET /hr/advances with money rendered through the formatter, not raw strings", async () => {
    const { calls } = renderScreen();
    expect(screen.getByRole("heading", { name: "سلف الموظفين" })).toBeInTheDocument();
    expect(await screen.findByText("ADV-000001")).toBeInTheDocument();
    expect(screen.getByText("أحمد حسن")).toBeInTheDocument();
    expect(screen.getByText("منى سالم")).toBeInTheDocument();
    expect(screen.getAllByText("3,000.00").length).toBeGreaterThan(0);
    expect(screen.queryByText("3000.000000")).not.toBeInTheDocument();
    expect(calls).toEqual(["/hr/advances"]);
  });

  it("renders an honest empty state when there are no advances", async () => {
    renderScreen({ advances: [] });
    expect(await screen.findByText("لا توجد سلف — ابدأ بتسجيل طلب سلفة لموظف")).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByText("ADV-000001")).not.toBeInTheDocument());
  });

  it("renders an Arabic failure message on a load error, never a raw enum, and retry re-fetches", async () => {
    let attempt = 0;
    renderScreen({
      extra: {
        "GET /hr/advances": () => {
          attempt += 1;
          return attempt === 1 ? { status: 500, body: { error: "INTERNAL" } } : { body: [advance()] };
        },
      },
    });
    expect(await screen.findByText("تعذّر تحميل السلف.")).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByText("INTERNAL")).not.toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "إعادة المحاولة" }));
    expect(await screen.findByText("ADV-000001")).toBeInTheDocument();
  });

  it("the status tabs filter the already-loaded rows client-side, without a new request", async () => {
    const { calls } = renderScreen();
    await screen.findByText("ADV-000001");
    expect(calls).toHaveLength(1);
    fireEvent.click(screen.getByRole("tab", { name: /معتمدة/ }));
    // The status filter lives in the URL and is written on a microtask,
    // so the re-render lags one tick behind the click.
    await waitFor(() => expect(screen.queryByText("ADV-000001")).not.toBeInTheDocument());
    expect(screen.getByText("ADV-000002")).toBeInTheDocument();
    // No new fetch was made — the whole list was already in memory.
    expect(calls).toHaveLength(1);
  });

  it("the search box filters the already-loaded rows client-side, without a new request", async () => {
    const { calls } = renderScreen();
    await screen.findByText("ADV-000001");
    fireEvent.change(screen.getByPlaceholderText("ابحث برقم السلفة أو اسم الموظف..."), { target: { value: "منى" } });
    await waitFor(() => expect(screen.queryByText("ADV-000001")).not.toBeInTheDocument());
    expect(screen.getByText("ADV-000002")).toBeInTheDocument();
    expect(calls).toHaveLength(1);
  });

  it("opens a detail panel showing the schedule with formatted money", async () => {
    renderScreen();
    fireEvent.click(await screen.findByText("ADV-000001"));
    expect(screen.getByText("جدول الأقساط")).toBeInTheDocument();
    expect(screen.getAllByText("1,000.00").length).toBe(3);
    expect(screen.getByText("ظروف عائلية")).toBeInTheDocument();
  });

  it("requests a new advance with the real employee id from the EntityPicker and the exact JSON body", async () => {
    let posted: unknown = null;
    renderScreen({
      extra: {
        "POST /hr/advances": (init) => {
          posted = JSON.parse((init?.body as string) ?? "{}");
          return { body: advance({ id: "adv-new", number: "ADV-000003", employeeId: "emp-2" }) };
        },
      },
    });
    await screen.findByText("ADV-000001");
    fireEvent.click(screen.getByRole("button", { name: "طلب سلفة" }));
    expect(screen.getByRole("heading", { name: "طلب سلفة" })).toBeInTheDocument();

    pickFromCombobox(document.body, "الموظف *", "EMP-0002 — منى سالم");
    typeMoney(screen.getByLabelText("المبلغ"), "2400");
    fireEvent.change(fieldInput(document.body, "عدد الأقساط *"), { target: { value: "4" } });
    fireEvent.change(fieldInput(document.body, "أول خصم *"), { target: { value: "2026-09-05" } });
    fireEvent.change(fieldInput(document.body, "السبب"), { target: { value: "علاج طبي" } });
    fireEvent.click(screen.getByRole("button", { name: "إضافة" }));

    await waitFor(() => expect(screen.queryByRole("button", { name: "إضافة" })).not.toBeInTheDocument());
    expect(posted).toEqual({
      employeeId: "emp-2",
      amount: "2400.000000",
      installmentCount: 4,
      firstDeductionDate: "2026-09-05",
      reason: "علاج طبي",
    });
  });

  it("shows the Arabic refusal message when the server rejects a new advance, not a raw enum", async () => {
    renderScreen({
      extra: {
        "POST /hr/advances": () => ({
          status: 422,
          body: { error: "EMPLOYEE_HAS_OPEN_ADVANCE", message: "لدى هذا الموظف سلفة قائمة بالفعل." },
        }),
      },
    });
    await screen.findByText("ADV-000001");
    fireEvent.click(screen.getByRole("button", { name: "طلب سلفة" }));
    pickFromCombobox(document.body, "الموظف *", "EMP-0001 — أحمد حسن");
    typeMoney(screen.getByLabelText("المبلغ"), "500");
    fireEvent.change(fieldInput(document.body, "أول خصم *"), { target: { value: "2026-09-05" } });
    fireEvent.click(screen.getByRole("button", { name: "إضافة" }));

    expect(await screen.findByText("لدى هذا الموظف سلفة قائمة بالفعل.")).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByText("EMPLOYEE_HAS_OPEN_ADVANCE")).not.toBeInTheDocument());
  });

  it("approves a pending advance from the row menu and reflects the new status", async () => {
    const { getCurrent } = renderScreen();
    const row = (await screen.findByText("ADV-000001")).closest("tr") as HTMLElement;
    openRowMenu(row, "اعتماد");
    await waitFor(() => expect(getCurrent().find((a) => a.id === "adv-1")?.status).toBe("approved"));
    expect(await within(row).findByText("معتمدة")).toBeInTheDocument();
  });

  it("DEFECT: a row-menu decision that the server refuses fails silently — no panel is open to show the Arabic message", async () => {
    renderScreen({
      extra: {
        "POST /hr/advances/*/reject": () => ({
          status: 409,
          body: { error: "ALREADY_DECIDED", message: "تم اتخاذ قرار بشأن هذه السلفة بالفعل." },
        }),
      },
    });
    const row = (await screen.findByText("ADV-000001")).closest("tr") as HTMLElement;
    openRowMenu(row, "رفض");
    // The menu closes on click; by the time it has, the (synchronously
    // resolving) stub mutation has also settled.
    await waitFor(() => expect(screen.queryByRole("menuitem", { name: "رفض" })).not.toBeInTheDocument());
    // The refusal's Arabic message is nowhere on screen — the panel it would
    // render into was never opened, unlike the "view" row-menu entry.
    expect(screen.queryByText("تم اتخاذ قرار بشأن هذه السلفة بالفعل.")).not.toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("disburses an approved advance with the chosen treasury account and branch", async () => {
    let posted: unknown = null;
    renderScreen({
      advances: [approvedAdvance],
      extra: {
        "POST /hr/advances/*/disburse": (init) => {
          posted = JSON.parse((init?.body as string) ?? "{}");
          return { body: { ...approvedAdvance, status: "disbursed" as const } };
        },
      },
    });
    fireEvent.click(await screen.findByText("ADV-000002"));
    expect(screen.getByText("صرف السلفة")).toBeInTheDocument();

    // Paying out without choosing an account/branch is refused locally, with
    // no request sent at all.
    fireEvent.click(screen.getByRole("button", { name: "صرف" }));
    expect(await screen.findByText("اختر الخزينة والفرع قبل الصرف.")).toBeInTheDocument();
    expect(posted).toBeNull();

    fireEvent.click(screen.getByRole("combobox", { name: "الخزينة *" }));
    fireEvent.mouseDown(screen.getByRole("option", { name: /خزينة رئيسية/ }));
    fireEvent.click(screen.getByRole("combobox", { name: "الفرع *" }));
    fireEvent.mouseDown(screen.getByRole("option", { name: "الفرع الرئيسي" }));
    fireEvent.click(screen.getByRole("button", { name: "صرف" }));

    await waitFor(() => expect(posted).not.toBeNull());
    expect(posted).toEqual({ treasuryAccountId: "tre-1", branchId: "MAIN" });
  });
});
