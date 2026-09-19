// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, expect, it } from "vitest";
import { screen, fireEvent, within } from "@testing-library/react";
import type { ContractDTO, EmployeeDTO } from "@mezan/contracts";
import { ContractsScreen } from "./ContractsScreen";
import { renderWithProviders, stubTransport, testAdminSession } from "../data/test-support";

function pickFromCombobox(dialog: HTMLElement, label: string, optionLabel: string) {
  const input = within(dialog).getByLabelText(label);
  fireEvent.focus(input);
  fireEvent.change(input, { target: { value: optionLabel } });
  const option = within(dialog).getByRole("button", { name: (accessibleName) => accessibleName.startsWith(optionLabel) });
  fireEvent.mouseDown(option);
}

/**
 * `TextField` (settings/form-controls.tsx) renders a `<label>` that is never
 * associated with its input via `for`/`id`, so `getByLabelText` can't find
 * these fields. Fall back to the DOM structure the shared `Field` wrapper
 * always uses: a `<label>` immediately followed by its control in the same
 * wrapper `<div>`.
 */
function textFieldInput(container: HTMLElement, labelText: string): HTMLInputElement {
  const label = within(container).getByText(labelText, { selector: "label" });
  const input = label.parentElement?.querySelector<HTMLInputElement>("input, textarea");
  if (!input) throw new Error(`No input control found next to label "${labelText}"`);
  return input;
}

/** MoneyInput only commits its draft to React state on blur. */
function typeMoney(input: HTMLElement, value: string) {
  fireEvent.change(input, { target: { value } });
  fireEvent.blur(input);
}

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
    requireBiometricAtClockIn: false, deviceBadgeId: null, hasPensionEntitlement: null, taxDisabilityExemption: false,
    address: null,
    emergencyContact: null,
    status: "active",
    terminatedAt: null,
    createdAt: "2026-08-11T00:00:00.000Z",
  },
];

const sampleContracts: ContractDTO[] = [
  {
    id: "ctr-1",
    number: "CTR-0001",
    employeeId: "emp-1",
    type: "indefinite",
    payBasis: "monthly",
    payFrequency: "monthly",
    startDate: "2026-08-11",
    endDate: null,
    monthlySalary: "14000.000000",
    currency: "EGP",
    leaveEntitlement: { annualLeaveDays: null, sickLeaveDays: null, personalLeaveDays: null },
    allowances: [],
    deductions: [],
    status: "active",
    expiringSoon: false,
    terminatedAt: null,
    createdAt: "2026-08-11T00:00:00.000Z",
  },
];

function renderScreen(contracts: ContractDTO[] = sampleContracts) {
  let current = [...contracts];
  const transport = stubTransport({
    "GET /hr/contracts": () => ({ body: current }),
    "GET /hr/employees": () => ({ body: sampleEmployees }),
    "POST /hr/contracts": (init) => {
      const body = JSON.parse((init?.body as string) ?? "{}");
      const created: ContractDTO = {
        id: "ctr-new",
        number: "CTR-0002",
        employeeId: body.employeeId,
        type: body.type ?? "indefinite",
        payBasis: body.payBasis ?? "monthly",
        payFrequency: body.payFrequency ?? "monthly",
        startDate: body.startDate,
        endDate: body.endDate ?? null,
        monthlySalary: body.monthlySalary,
        currency: body.currency ?? "EGP",
        leaveEntitlement: { annualLeaveDays: null, sickLeaveDays: null, personalLeaveDays: null },
        allowances: [],
        deductions: [],
        status: "active",
        expiringSoon: false,
        terminatedAt: null,
        createdAt: "2026-08-21T00:00:00.000Z",
      };
      current = [...current, created];
      return { status: 201, body: created };
    },
    "POST /hr/contracts/ctr-1/terminate": () => {
      const updated: ContractDTO = { ...current[0]!, status: "terminated", terminatedAt: "2026-08-21T00:00:00.000Z" };
      current = [updated, ...current.slice(1)];
      return { body: updated };
    },
  });
  return renderWithProviders(<ContractsScreen />, { transport, initialSession: testAdminSession });
}

describe("ContractsScreen", () => {
  it("lists contracts with the employee name and salary", async () => {
    renderScreen();
    expect(screen.getByRole("heading", { name: "العقود" })).toBeInTheDocument();
    expect(await screen.findByText("CTR-0001")).toBeInTheDocument();
    expect(screen.getByText("أحمد محمود")).toBeInTheDocument();
  });

  it("adds a new contract through the create panel", async () => {
    renderScreen();
    await screen.findByText("CTR-0001");
    fireEvent.click(screen.getByRole("button", { name: "إضافة عقد" }));

    const dialog = screen.getByRole("dialog", { name: "عقد جديد" });
    pickFromCombobox(dialog, "اسم الموظف *", "EMP-0001");
    fireEvent.change(textFieldInput(dialog, "تاريخ البداية *"), { target: { value: "2026-08-21" } });
    typeMoney(within(dialog).getByLabelText("الراتب الشهري"), "15000");
    fireEvent.click(within(dialog).getByRole("button", { name: "حفظ" }));

    expect(await screen.findByText("CTR-0002")).toBeInTheDocument();
  });

  it("terminates an active contract from the detail panel", async () => {
    renderScreen();
    fireEvent.click(await screen.findByText("CTR-0001"));
    const dialog = screen.getByRole("dialog", { name: "CTR-0001" });
    fireEvent.click(within(dialog).getByRole("button", { name: "إنهاء العقد" }));

    expect(await within(dialog).findByText("مفسوخ")).toBeInTheDocument();
  });

  it("shows an error banner with a retry action when contracts fail to load", async () => {
    const transport = stubTransport({
      "GET /hr/contracts": () => ({ status: 500, body: { error: "INTERNAL" } }),
      "GET /hr/employees": () => ({ body: sampleEmployees }),
    });
    renderWithProviders(<ContractsScreen />, { transport, initialSession: testAdminSession });
    expect(await screen.findByText("تعذّر تحميل العقود. (رمز 500)")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "إعادة المحاولة" })).toBeInTheDocument();
  });
});
