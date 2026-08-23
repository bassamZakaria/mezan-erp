// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, expect, it } from "vitest";
import { screen, fireEvent, within } from "@testing-library/react";
import type { BranchDTO, EmployeeDTO } from "@mezan/contracts";
import { EmployeesScreen } from "./EmployeesScreen";
import { renderWithProviders, stubTransport, testAdminSession } from "../data/test-support";

function pickFromCombobox(dialog: HTMLElement, label: string, optionLabel: string) {
  const input = within(dialog).getByLabelText(label);
  fireEvent.focus(input);
  fireEvent.change(input, { target: { value: optionLabel } });
  const option = within(dialog).getByRole("button", { name: (accessibleName) => accessibleName.startsWith(optionLabel) });
  fireEvent.mouseDown(option);
}

const sampleBranches: BranchDTO[] = [
  { id: "MAIN", code: "MAIN", name: "الفرع الرئيسي", parentBranchId: null, phone: null, email: null, address: null, isMain: true, active: true },
];

const sampleEmployees: EmployeeDTO[] = [
  {
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
  },
];

function renderScreen(employees: EmployeeDTO[] = sampleEmployees) {
  let current = [...employees];
  const transport = stubTransport({
    "GET /hr/employees": () => ({ body: current }),
    "GET /hr/departments": () => ({ body: [] }),
    "GET /hr/job-titles": () => ({ body: [] }),
    "GET /branches": () => ({ body: sampleBranches }),
    "GET /hr/employees/emp-1/contracts": () => ({ body: [] }),
    "POST /hr/employees": (init) => {
      const body = JSON.parse((init?.body as string) ?? "{}");
      const created: EmployeeDTO = { ...current[0]!, ...body, id: "emp-new", code: "EMP-0002", status: "active", terminatedAt: null };
      current = [...current, created];
      return { status: 201, body: created };
    },
    "POST /hr/employees/emp-1/transition": (init) => {
      const body = JSON.parse((init?.body as string) ?? "{}");
      const updated: EmployeeDTO = { ...current[0]!, status: body.status };
      current = [updated, ...current.slice(1)];
      return { body: updated };
    },
  });
  return renderWithProviders(<EmployeesScreen />, { transport, initialSession: testAdminSession });
}

describe("EmployeesScreen", () => {
  it("lists employees from the real backend", async () => {
    renderScreen();
    expect(screen.getByRole("heading", { name: "الموظفون" })).toBeInTheDocument();
    expect(await screen.findByText("أحمد محمود")).toBeInTheDocument();
    expect(screen.getByText("EMP-0001")).toBeInTheDocument();
  });

  it("adds a new employee through the create panel", async () => {
    renderScreen();
    await screen.findByText("أحمد محمود");
    fireEvent.click(screen.getByRole("button", { name: "إضافة موظف" }));

    const dialog = screen.getByRole("dialog", { name: "موظف جديد" });
    fireEvent.change(within(dialog).getByLabelText("الاسم الأول *"), { target: { value: "Sara" } });
    fireEvent.change(within(dialog).getByLabelText("اسم العائلة *"), { target: { value: "Aly" } });
    pickFromCombobox(dialog, "الفرع *", "الفرع الرئيسي");
    fireEvent.change(within(dialog).getByLabelText("تاريخ التعيين *"), { target: { value: "2026-08-21" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "حفظ" }));

    expect(await screen.findByText("Sara Aly")).toBeInTheDocument();
  });

  it("opens the detail panel and transitions the employee to on_leave", async () => {
    renderScreen();
    fireEvent.click(await screen.findByText("أحمد محمود"));
    const dialog = screen.getByRole("dialog", { name: "أحمد محمود" });
    fireEvent.click(within(dialog).getByRole("button", { name: "في إجازة" }));

    expect(await within(dialog).findByRole("button", { name: "نشط" })).toBeInTheDocument();
  });
});
