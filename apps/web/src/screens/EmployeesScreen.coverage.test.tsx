// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it } from "vitest";
import { screen, fireEvent, within, waitFor } from "@testing-library/react";
import type {
  BranchDTO,
  ContractDTO,
  DepartmentDTO,
  EmployeeAdvanceDTO,
  EmployeeDTO,
  JobTitleDTO,
  LeaveBalanceDTO,
  LeaveRequestDTO,
  PayslipDTO,
  AttendanceEntryDTO,
} from "@mezan/contracts";
import { EmployeesScreen } from "./EmployeesScreen";
import { renderWithProviders, stubTransport, testAdminSession } from "../data/test-support";

function pickFromCombobox(dialog: HTMLElement, label: string, optionLabel: string) {
  const input = within(dialog).getByLabelText(label);
  fireEvent.focus(input);
  fireEvent.change(input, { target: { value: optionLabel } });
  const option = within(dialog).getByRole("button", { name: (accessibleName) => accessibleName.startsWith(optionLabel) });
  fireEvent.mouseDown(option);
}

function chooseSelectOption(triggerLabel: string, optionLabel: string) {
  fireEvent.click(screen.getByRole("combobox", { name: triggerLabel }));
  fireEvent.mouseDown(screen.getByRole("option", { name: optionLabel }));
}

/** `TextField`/`NumberField` render a `<label>` with no `htmlFor`/`id`, so it has no accessible name to query by. */
function fieldInput(container: HTMLElement, labelText: string): HTMLElement {
  const label = within(container).getByText(labelText);
  const input = label.parentElement?.querySelector("input");
  if (!input) throw new Error(`no input found next to label "${labelText}"`);
  return input;
}

afterEach(() => {
  localStorage.removeItem("mezan.locale");
});

const sampleBranches: BranchDTO[] = [
  { id: "MAIN", code: "MAIN", name: "الفرع الرئيسي", parentBranchId: null, phone: null, email: null, address: null, isMain: true, active: true },
];

const departments: DepartmentDTO[] = [
  { id: "DEPT-1", code: "D1", name: "Sales", nameAr: "المبيعات", parentDepartmentId: null, managerId: null, overtimeEligible: true, standardWorkHours: 8, active: true, createdAt: "2026-01-01T00:00:00.000Z" },
];

const jobTitles: JobTitleDTO[] = [
  { id: "JOB-1", departmentId: "DEPT-1", name: "Sales rep", nameAr: "مندوب مبيعات", active: true, createdAt: "2026-01-01T00:00:00.000Z" },
];

function baseEmployee(overrides: Partial<EmployeeDTO> = {}): EmployeeDTO {
  return {
    id: "emp-1",
    code: "EMP-0001",
    firstName: "Ahmed",
    lastName: "Mahmoud",
    firstNameAr: "أحمد",
    lastNameAr: "محمود",
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
    hireDate: "2026-08-11",
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
    createdAt: "2026-08-11T00:00:00.000Z",
    ...overrides,
  };
}

const sampleEmployees: EmployeeDTO[] = [baseEmployee()];

interface RenderOpts {
  employees?: EmployeeDTO[];
  departments?: DepartmentDTO[];
  jobTitles?: JobTitleDTO[];
  branches?: BranchDTO[];
  contracts?: ContractDTO[];
  employeeContracts?: Record<string, ContractDTO[]>;
  leaveBalances?: LeaveBalanceDTO[];
  leaveRequests?: LeaveRequestDTO[];
  payslips?: PayslipDTO[];
  advances?: EmployeeAdvanceDTO[];
  attendance?: AttendanceEntryDTO[];
  employeesStatus?: number;
  onTransition?: (id: string, status: string) => { status?: number; body: unknown } | undefined;
  onTerminate?: (id: string) => { status?: number; body: unknown } | undefined;
  onRehire?: (id: string, hireDate: string) => { status?: number; body: unknown } | undefined;
  onCreate?: (body: unknown) => { status?: number; body: unknown } | undefined;
}

function renderScreen(opts: RenderOpts = {}) {
  let current = [...(opts.employees ?? sampleEmployees)];
  const transport = stubTransport({
    "GET /hr/employees": () =>
      opts.employeesStatus && opts.employeesStatus >= 400
        ? { status: opts.employeesStatus, body: { message: "تعذّر تحميل الموظفين." } }
        : { body: current },
    "GET /hr/departments": () => ({ body: opts.departments ?? [] }),
    "GET /hr/job-titles": () => ({ body: opts.jobTitles ?? [] }),
    "GET /hr/contracts": () => ({ body: opts.contracts ?? [] }),
    "GET /branches": () => ({ body: opts.branches ?? sampleBranches }),
    "GET /hr/employees/*/contracts": (_init, path) => {
      const id = path.split("/")[3]!;
      return { body: opts.employeeContracts?.[id] ?? [] };
    },
    "GET /hr/leave-balances": () => ({ body: opts.leaveBalances ?? [] }),
    "GET /hr/leave-requests": () => ({ body: opts.leaveRequests ?? [] }),
    "GET /hr/payroll/payslips": () => ({ body: opts.payslips ?? [] }),
    "GET /hr/advances": () => ({ body: opts.advances ?? [] }),
    "GET /hr/attendance": () => ({ body: opts.attendance ?? [] }),
    "POST /hr/employees": (init) => {
      const body = JSON.parse((init?.body as string) ?? "{}");
      const overridden = opts.onCreate?.(body);
      if (overridden) return overridden;
      const created: EmployeeDTO = { ...current[0]!, ...body, id: "emp-new", code: "EMP-0002", status: "active", terminatedAt: null };
      current = [...current, created];
      return { status: 201, body: created };
    },
    "POST /hr/employees/*/transition": (init, path) => {
      const id = path.split("/")[3]!;
      const body = JSON.parse((init?.body as string) ?? "{}");
      const overridden = opts.onTransition?.(id, body.status);
      if (overridden) return overridden;
      const index = current.findIndex((e) => e.id === id);
      const updated: EmployeeDTO = { ...current[index]!, status: body.status };
      current = [...current.slice(0, index), updated, ...current.slice(index + 1)];
      return { body: updated };
    },
    "POST /hr/employees/*/terminate": (_init, path) => {
      const id = path.split("/")[3]!;
      const overridden = opts.onTerminate?.(id);
      if (overridden) return overridden;
      const index = current.findIndex((e) => e.id === id);
      const updated: EmployeeDTO = { ...current[index]!, status: "terminated", terminatedAt: "2026-08-25T00:00:00.000Z" };
      current = [...current.slice(0, index), updated, ...current.slice(index + 1)];
      return { body: updated };
    },
    "POST /hr/employees/*/rehire": (init, path) => {
      const id = path.split("/")[3]!;
      const body = JSON.parse((init?.body as string) ?? "{}");
      const overridden = opts.onRehire?.(id, body.hireDate);
      if (overridden) return overridden;
      const index = current.findIndex((e) => e.id === id);
      const updated: EmployeeDTO = { ...current[index]!, status: "active", terminatedAt: null, hireDate: body.hireDate };
      current = [...current.slice(0, index), updated, ...current.slice(index + 1)];
      return { body: updated };
    },
  });
  return renderWithProviders(<EmployeesScreen />, { transport, initialSession: testAdminSession });
}

function contract(overrides: Partial<ContractDTO> = {}): ContractDTO {
  return {
    id: "c-1",
    number: "CT-000001",
    employeeId: "emp-1",
    type: "indefinite",
    payBasis: "monthly",
    payFrequency: "monthly",
    startDate: "2025-01-01",
    endDate: null,
    monthlySalary: "5000.000000",
    currency: "EGP",
    leaveEntitlement: { annualLeaveDays: null, sickLeaveDays: null, personalLeaveDays: null },
    allowances: [],
    deductions: [],
    status: "active",
    expiringSoon: false,
    terminatedAt: null,
    createdAt: "2025-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("EmployeesScreen — reading employee identity", () => {
  it("reads an employee's name in English when neither Arabic name is set, and leaves personal fields dashed", async () => {
    const noArabic = baseEmployee({
      firstNameAr: null,
      lastNameAr: null,
      phone: null,
      birthDate: null,
      gender: null,
      maritalStatus: null,
      probationEndDate: null,
      employmentType: "part_time",
    });
    renderScreen({ employees: [noArabic] });

    expect(await screen.findByText("Ahmed Mahmoud")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Ahmed Mahmoud"));

    expect(screen.getByRole("heading", { name: "Ahmed Mahmoud" })).toBeInTheDocument();
    const personalTab = screen.getByRole("tabpanel");
    expect(within(personalTab).getByText("دوام جزئي")).toBeInTheDocument();
    const dashes = within(personalTab).getAllByText("—");
    expect(dashes.length).toBeGreaterThanOrEqual(4);
  });

  it("falls back to the raw id when an employee's branch isn't in the branch list", async () => {
    const ghostBranch = baseEmployee({ branchId: "GHOST" });
    renderScreen({ employees: [ghostBranch] });

    await screen.findByText("أحمد محمود");
    expect(screen.getAllByText("GHOST").length).toBeGreaterThan(0);
  });

  it("shows an employee's gender and marital status once they are recorded", async () => {
    const withDetails = baseEmployee({ gender: "female", maritalStatus: "married" });
    renderScreen({ employees: [withDetails] });
    fireEvent.click(await screen.findByText("أحمد محمود"));

    const personalTab = screen.getByRole("tabpanel");
    expect(within(personalTab).getByText("أنثى")).toBeInTheDocument();
    expect(within(personalTab).getByText("متزوج")).toBeInTheDocument();
  });

  it("shows the bilingual department and job title once the employee is linked to real records", async () => {
    const linked = baseEmployee({ departmentId: "DEPT-1", jobTitleId: "JOB-1" });
    renderScreen({ employees: [linked], departments, jobTitles });

    await screen.findByText("أحمد محمود");
    expect(screen.getAllByText("المبيعات").length).toBeGreaterThan(0);
    expect(screen.getAllByText("مندوب مبيعات").length).toBeGreaterThan(0);
  });
});

describe("EmployeesScreen — status and employment-type coverage", () => {
  it("a suspended employee's detail offers only reactivation, and reactivating opens the active transitions", async () => {
    const suspended = baseEmployee({ status: "suspended" });
    renderScreen({ employees: [suspended] });
    fireEvent.click(await screen.findByText("أحمد محمود"));

    expect(screen.getByRole("button", { name: "نشط" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "في إجازة" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "نشط" }));

    await waitFor(() => expect(screen.getByRole("button", { name: "في إجازة" })).toBeInTheDocument());
    expect(screen.getByRole("button", { name: "موقوف" })).toBeInTheDocument();
  });

  it("an on_leave employee's detail offers reactivating and suspending, and suspending applies it", async () => {
    const onLeave = baseEmployee({ status: "on_leave" });
    renderScreen({ employees: [onLeave] });
    fireEvent.click(await screen.findByText("أحمد محمود"));

    expect(screen.getByRole("button", { name: "نشط" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "موقوف" }));

    expect(await screen.findByRole("button", { name: "نشط" })).toBeInTheDocument();
  });

  it("rehiring a terminated employee with a date reactivates them and closes the panel", async () => {
    const terminated = baseEmployee({ status: "terminated", terminatedAt: "2026-01-01T00:00:00.000Z" });
    renderScreen({ employees: [terminated] });
    fireEvent.click(await screen.findByText("أحمد محمود"));
    fireEvent.click(screen.getByRole("button", { name: "إعادة تعيين" }));

    const dialog = screen.getByRole("dialog");
    fireEvent.change(within(dialog).getByPlaceholderText("YYYY-MM-DD"), { target: { value: "2026-09-01" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "إعادة تعيين" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(await screen.findByRole("button", { name: "في إجازة" })).toBeInTheDocument();
  });

  it("shows the server's refusal when a status transition fails, and the failure follows the user back to the list", async () => {
    renderScreen({
      employees: [baseEmployee()],
      onTransition: () => ({ status: 409, body: { message: "لا يمكن نقل الموظف لهذه الحالة." } }),
    });
    fireEvent.click(await screen.findByText("أحمد محمود"));
    fireEvent.click(screen.getByRole("button", { name: "في إجازة" }));

    expect(await screen.findByText("لا يمكن نقل الموظف لهذه الحالة.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "رجوع للقائمة" }));

    expect(await screen.findByText("لا يمكن نقل الموظف لهذه الحالة.")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "الموظفون" })).toBeInTheDocument();
  });
});

describe("EmployeesScreen — loading employees fails and can be retried", () => {
  it("shows the load failure and recovers once the user retries", async () => {
    let attempt = 0;
    const transport = stubTransport({
      "GET /hr/employees": () => {
        attempt += 1;
        return attempt === 1 ? { status: 500, body: { message: "server down" } } : { body: sampleEmployees };
      },
      "GET /hr/departments": () => ({ body: [] }),
      "GET /hr/job-titles": () => ({ body: [] }),
      "GET /hr/contracts": () => ({ body: [] }),
      "GET /branches": () => ({ body: sampleBranches }),
      "GET /hr/attendance": () => ({ body: [] }),
    });
    renderWithProviders(<EmployeesScreen />, { transport, initialSession: testAdminSession });

    expect(await screen.findByText("تعذّر تحميل الموظفين.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "إعادة المحاولة" }));

    expect(await screen.findByText("أحمد محمود")).toBeInTheDocument();
  });
});

describe("EmployeesScreen — the employee 360's tabs", () => {
  const linkedEmployee = baseEmployee({ id: "emp-1", departmentId: "DEPT-1", jobTitleId: "JOB-1" });

  it("shows an active contract's badge and picks the latest one when more than one is active, ignoring terminated contracts", async () => {
    const older = contract({ id: "c-old", number: "CT-000001", startDate: "2025-01-01", status: "active" });
    const newer = contract({ id: "c-new", number: "CT-000002", startDate: "2026-01-01", status: "active", expiringSoon: true });
    const endedEarly = contract({ id: "c-term", number: "CT-000003", startDate: "2026-06-01", status: "terminated" });
    renderScreen({
      employees: [linkedEmployee],
      contracts: [older, newer, endedEarly],
      employeeContracts: { "emp-1": [older, newer, endedEarly] },
    });

    await screen.findByText("أحمد محمود");
    const row = screen.getByText("أحمد محمود").closest("tr")!;
    expect(within(row).getByText("CT-000002")).toBeInTheDocument();
    expect(within(row).getByText("قريب الانتهاء")).toBeInTheDocument();
    expect(within(row).queryByText("CT-000001")).not.toBeInTheDocument();
  });

  it("shows the no-active-contract label for an employee with no active contract", async () => {
    renderScreen({ employees: [linkedEmployee], contracts: [] });
    await screen.findByText("أحمد محمود");
    expect(screen.getByText("لا يوجد عقد ساري")).toBeInTheDocument();
  });

  it("the contracts tab lists an employee's contracts", async () => {
    const withContract = contract();
    renderScreen({ employees: [linkedEmployee], employeeContracts: { "emp-1": [withContract] } });
    fireEvent.click(await screen.findByText("أحمد محمود"));
    fireEvent.click(screen.getByRole("tab", { name: "العقود" }));
    expect(await screen.findByText("CT-000001")).toBeInTheDocument();
  });

  it("the contracts tab shows the empty message for an employee with no contracts", async () => {
    renderScreen({ employees: [linkedEmployee], employeeContracts: {} });
    fireEvent.click(await screen.findByText("أحمد محمود"));
    fireEvent.click(screen.getByRole("tab", { name: "العقود" }));
    expect(await screen.findByText("لا توجد عقود مرتبطة بهذا الموظف.")).toBeInTheDocument();
  });

  it("the leave tab shows balances and requests for an employee who has them", async () => {
    const withLeave = baseEmployee({ id: "emp-leave" });
    renderScreen({
      employees: [withLeave],
      leaveBalances: [
        { id: "lb-1", employeeId: "emp-leave", leaveType: "annual", year: 2026, entitled: "21", carriedOver: "3", used: "5", available: "19", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" },
      ],
      leaveRequests: [
        { id: "lr-1", number: "LR-000001", employeeId: "emp-leave", leaveType: "sick", halfDay: false, startDate: "2026-03-01", endDate: "2026-03-02", days: 2, reason: null, status: "approved", createdAt: "2026-03-01T00:00:00.000Z", decidedAt: "2026-03-01T00:00:00.000Z", decidedBy: null },
      ],
    });
    fireEvent.click(await screen.findByText("أحمد محمود"));
    fireEvent.click(screen.getByRole("tab", { name: "الإجازات" }));
    expect(await screen.findByText("LR-000001")).toBeInTheDocument();
    expect(screen.getByText("24")).toBeInTheDocument();
  });

  it("the leave tab shows empty messages for an employee with no balances or requests", async () => {
    const withoutLeave = baseEmployee({ id: "emp-noleave" });
    renderScreen({ employees: [withoutLeave] });
    fireEvent.click(await screen.findByText("أحمد محمود"));
    fireEvent.click(screen.getByRole("tab", { name: "الإجازات" }));
    expect(await screen.findByText("لا يوجد رصيد إجازات مسجّل لهذا الموظف عن هذه السنة.")).toBeInTheDocument();
    expect(screen.getByText("لا توجد طلبات إجازة لهذا الموظف.")).toBeInTheDocument();
  });

  it("the payslips tab lists an employee's payslips", async () => {
    const withSlip = baseEmployee({ id: "emp-slip" });
    renderScreen({
      employees: [withSlip],
      payslips: [
        { id: "ps-1", number: "PS-000001", runId: "run-1", employeeId: "emp-slip", contractId: "c-1", currency: "EGP", periodStart: "2026-03-01", periodEnd: "2026-03-31", periodDays: 31, paidDays: 31, lines: [], grossEarnings: "5000.000000", totalDeductions: "500.000000", employerContributions: "0.000000", netPay: "4500.000000", createdAt: "2026-04-01T00:00:00.000Z" },
      ],
    });
    fireEvent.click(await screen.findByText("أحمد محمود"));
    fireEvent.click(screen.getByRole("tab", { name: "كشوف الرواتب" }));
    expect(await screen.findByText("PS-000001")).toBeInTheDocument();
  });

  it("the payslips tab shows the empty message for an employee with none", async () => {
    const noSlip = baseEmployee({ id: "emp-noslip" });
    renderScreen({ employees: [noSlip] });
    fireEvent.click(await screen.findByText("أحمد محمود"));
    fireEvent.click(screen.getByRole("tab", { name: "كشوف الرواتب" }));
    expect(await screen.findByText("لا توجد كشوف رواتب لهذا الموظف.")).toBeInTheDocument();
  });

  it("the advances tab lists an employee's advances and totals their outstanding balance", async () => {
    const withAdvance = baseEmployee({ id: "emp-adv" });
    renderScreen({
      employees: [withAdvance],
      advances: [
        {
          id: "adv-1", number: "ADV-000001", employeeId: "emp-adv", amount: "2000.000000", currency: "EGP",
          installmentCount: 4, firstDeductionDate: "2026-04-01", reason: null, installments: [],
          outstanding: "1500.000000", recovered: "500.000000", status: "disbursed", requestedAt: "2026-03-01T00:00:00.000Z",
          decidedAt: "2026-03-01T00:00:00.000Z", decidedBy: null, disbursedAt: "2026-03-02T00:00:00.000Z", disbursementVoucherId: null,
          disbursementJournalEntryId: null, repaidAt: null, createdAt: "2026-03-01T00:00:00.000Z",
        },
      ],
    });
    fireEvent.click(await screen.findByText("أحمد محمود"));
    fireEvent.click(screen.getByRole("tab", { name: "السلف" }));
    expect(await screen.findByText("ADV-000001")).toBeInTheDocument();
  });

  it("the advances tab shows the empty message for an employee with no advances", async () => {
    const noAdvance = baseEmployee({ id: "emp-noadv" });
    renderScreen({ employees: [noAdvance] });
    fireEvent.click(await screen.findByText("أحمد محمود"));
    fireEvent.click(screen.getByRole("tab", { name: "السلف" }));
    expect(await screen.findByText("لا توجد سلف لهذا الموظف.")).toBeInTheDocument();
  });

  it("the attendance tab lists an employee's attendance records", async () => {
    const withAttendance = baseEmployee({ id: "emp-att" });
    renderScreen({
      employees: [withAttendance],
      attendance: [
        { id: "att-1", employeeId: "emp-att", date: "2026-08-01", checkIn: "09:00", checkOut: "17:00", workedMinutes: 480, status: "present", notes: null, createdAt: "2026-08-01T09:00:00.000Z", updatedAt: "2026-08-01T17:00:00.000Z" },
        { id: "att-2", employeeId: "emp-att", date: "2026-08-02", checkIn: null, checkOut: null, workedMinutes: 0, status: "absent", notes: null, createdAt: "2026-08-02T00:00:00.000Z", updatedAt: "2026-08-02T00:00:00.000Z" },
      ],
    });
    fireEvent.click(await screen.findByText("أحمد محمود"));
    fireEvent.click(screen.getByRole("tab", { name: "الحضور" }));
    expect(await screen.findByText("2026-08-02")).toBeInTheDocument();
    expect(screen.getByText("غائب")).toBeInTheDocument();
  });

  it("the attendance tab shows the empty message for an employee with no records", async () => {
    const noAttendance = baseEmployee({ id: "emp-noatt" });
    renderScreen({ employees: [noAttendance] });
    fireEvent.click(await screen.findByText("أحمد محمود"));
    fireEvent.click(screen.getByRole("tab", { name: "الحضور" }));
    expect(await screen.findByText("لا توجد سجلات حضور لهذا الموظف.")).toBeInTheDocument();
  });
});

describe("EmployeesScreen — filtering and paging", () => {
  it("filters the list by department, hiding employees from other departments", async () => {
    const salesEmployee = baseEmployee({ id: "emp-sales", departmentId: "DEPT-1" });
    const unassigned = baseEmployee({ id: "emp-none", firstName: "Youssef", lastName: "Nabil", firstNameAr: "يوسف", lastNameAr: "نبيل" });
    renderScreen({ employees: [salesEmployee, unassigned], departments });

    await screen.findByText("أحمد محمود");
    expect(screen.getByText("يوسف نبيل")).toBeInTheDocument();

    chooseSelectOption("القسم", "المبيعات");
    await waitFor(() => expect(screen.queryByText("يوسف نبيل")).not.toBeInTheDocument());
    expect(screen.getByText("أحمد محمود")).toBeInTheDocument();
  });

  it("filters the list by status chip, showing only suspended employees", async () => {
    const active = baseEmployee({ id: "emp-active" });
    const suspended = baseEmployee({ id: "emp-susp", firstName: "Sara", lastName: "Aly", firstNameAr: "سارة", lastNameAr: "علي", status: "suspended" });
    renderScreen({ employees: [active, suspended] });

    await screen.findByText("أحمد محمود");
    fireEvent.click(screen.getByRole("tab", { name: /^موقوف/ }));

    await waitFor(() => expect(screen.queryByText("أحمد محمود")).not.toBeInTheDocument());
    expect(screen.getByText("سارة علي")).toBeInTheDocument();
  });

  it("finds an employee by their employee code, not just their name", async () => {
    const target = baseEmployee({ id: "emp-target", code: "EMP-9999", firstName: "Nadia", lastName: "Kamal", firstNameAr: "نادية", lastNameAr: "كمال" });
    renderScreen({ employees: [target, baseEmployee({ id: "emp-other" })] });
    await screen.findByText("أحمد محمود");
    expect(screen.getByText("نادية كمال")).toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText("بحث بالاسم أو الرقم..."), { target: { value: "9999" } });
    await waitFor(() => expect(screen.queryByText("أحمد محمود")).not.toBeInTheDocument());
    expect(screen.getByText("نادية كمال")).toBeInTheDocument();
  });

  it("resets to page 1 when the URL names a page past the end of the list", async () => {
    const transport = stubTransport({
      "GET /hr/employees": () => ({ body: sampleEmployees }),
      "GET /hr/departments": () => ({ body: [] }),
      "GET /hr/job-titles": () => ({ body: [] }),
      "GET /hr/contracts": () => ({ body: [] }),
      "GET /branches": () => ({ body: sampleBranches }),
      "GET /hr/attendance": () => ({ body: [] }),
    });
    renderWithProviders(<EmployeesScreen />, { transport, initialSession: testAdminSession, route: "/?page=5" });
    expect(await screen.findByText("أحمد محمود")).toBeInTheDocument();
  });
});

describe("EmployeesScreen — creating an employee", () => {
  it("requires the first name, last name, branch and hire date before submitting", async () => {
    renderScreen();
    await screen.findByText("أحمد محمود");
    fireEvent.click(screen.getByRole("button", { name: "إضافة موظف" }));
    const dialog = screen.getByRole("dialog", { name: "موظف جديد" });
    fireEvent.click(within(dialog).getByRole("button", { name: "حفظ" }));

    expect(await screen.findByText("الاسم الأول واسم العائلة والفرع وتاريخ التعيين مطلوبة.")).toBeInTheDocument();
  });

  it("shows the server's refusal when adding an employee fails", async () => {
    renderScreen({ onCreate: () => ({ status: 409, body: { message: "رقم الهوية مستخدم من قبل." } }) });
    await screen.findByText("أحمد محمود");
    fireEvent.click(screen.getByRole("button", { name: "إضافة موظف" }));
    const dialog = screen.getByRole("dialog", { name: "موظف جديد" });
    fireEvent.change(fieldInput(dialog, "الاسم الأول *"), { target: { value: "Sara" } });
    fireEvent.change(fieldInput(dialog, "اسم العائلة *"), { target: { value: "Aly" } });
    pickFromCombobox(dialog, "الفرع *", "الفرع الرئيسي");
    fireEvent.change(fieldInput(dialog, "تاريخ التعيين *"), { target: { value: "2026-08-21" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "حفظ" }));

    expect(await screen.findByText("رقم الهوية مستخدم من قبل.")).toBeInTheDocument();
  });

  it("submits every optional field — address, emergency contact, department, job title and manager", async () => {
    let submitted: Record<string, unknown> | null = null;
    renderScreen({
      employees: [baseEmployee({ id: "emp-mgr", firstName: "Manal", lastName: "Kamal", firstNameAr: "منال", lastNameAr: "كمال" })],
      departments,
      jobTitles,
      onCreate: (body) => {
        submitted = body as Record<string, unknown>;
        return undefined;
      },
    });
    await screen.findByText("منال كمال");
    fireEvent.click(screen.getByRole("button", { name: "إضافة موظف" }));
    const dialog = screen.getByRole("dialog", { name: "موظف جديد" });

    fireEvent.change(fieldInput(dialog, "الاسم الأول *"), { target: { value: "Sara" } });
    fireEvent.change(fieldInput(dialog, "اسم العائلة *"), { target: { value: "Aly" } });
    fireEvent.change(fieldInput(dialog, "الاسم الأول (عربي)"), { target: { value: "سارة" } });
    fireEvent.change(fieldInput(dialog, "اسم العائلة (عربي)"), { target: { value: "علي" } });
    fireEvent.change(fieldInput(dialog, "البريد الإلكتروني"), { target: { value: "sara@example.com" } });
    fireEvent.change(fieldInput(dialog, "الهاتف"), { target: { value: "0100000000" } });
    fireEvent.change(fieldInput(dialog, "تاريخ الميلاد"), { target: { value: "1995-01-01" } });
    fireEvent.change(fieldInput(dialog, "رقم الهوية"), { target: { value: "29501010100000" } });
    chooseSelectOption("الجنس", "أنثى");
    chooseSelectOption("الحالة الاجتماعية", "أعزب");

    pickFromCombobox(dialog, "القسم", "المبيعات");
    pickFromCombobox(dialog, "المسمى الوظيفي", "مندوب مبيعات");
    pickFromCombobox(dialog, "المدير المباشر", "منال كمال");
    pickFromCombobox(dialog, "الفرع *", "الفرع الرئيسي");
    fireEvent.change(fieldInput(dialog, "تاريخ التعيين *"), { target: { value: "2026-08-21" } });
    chooseSelectOption("فئة العامل *", "عامل");
    chooseSelectOption("نوع التوظيف", "دوام جزئي");
    chooseSelectOption("احتساب العمل الإضافي", "مستحق");
    fireEvent.change(fieldInput(dialog, "نهاية فترة التجربة"), { target: { value: "2026-11-01" } });

    fireEvent.change(fieldInput(dialog, "الشارع"), { target: { value: "شارع الجمهورية" } });
    fireEvent.change(fieldInput(dialog, "المدينة"), { target: { value: "القاهرة" } });
    fireEvent.change(fieldInput(dialog, "المحافظة"), { target: { value: "القاهرة" } });
    fireEvent.change(fieldInput(dialog, "الرمز البريدي"), { target: { value: "11511" } });

    fireEvent.change(fieldInput(dialog, "الاسم"), { target: { value: "كريم علي" } });
    fireEvent.change(fieldInput(dialog, "صلة القرابة"), { target: { value: "أخ" } });
    fireEvent.change(fieldInput(dialog, "رقم الهاتف"), { target: { value: "0111111111" } });
    fireEvent.change(fieldInput(dialog, "رقم هاتف آخر"), { target: { value: "0122222222" } });

    fireEvent.click(within(dialog).getByRole("button", { name: "حفظ" }));

    await waitFor(() => expect(submitted).not.toBeNull());
    expect(submitted).toMatchObject({
      firstNameAr: "سارة",
      lastNameAr: "علي",
      email: "sara@example.com",
      phone: "0100000000",
      departmentId: "DEPT-1",
      jobTitleId: "JOB-1",
      managerId: "emp-mgr",
      workerCategory: "worker",
      employmentType: "part_time",
      address: expect.objectContaining({ street: "شارع الجمهورية" }),
      emergencyContact: expect.objectContaining({ name: "كريم علي" }),
    });
  });
});
