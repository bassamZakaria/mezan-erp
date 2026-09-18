// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, expect, it } from "vitest";
import { screen, fireEvent, within, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { EmployeeDTO, LeaveBalanceDTO } from "@mezan/contracts";
import { LeaveBalancesScreen } from "./LeaveBalancesScreen";
import { renderWithProviders, stubTransport, testAdminSession } from "../data/test-support";

// jsdom has no layout engine and does not implement scrollIntoView; the
// dropdown menu (Select) calls it when the active option changes.
if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = () => {};
}

/** `TextField` renders a `<label>` with no `htmlFor`/`id`, so query the sibling input via the label text. */
function fieldInput(container: HTMLElement, labelText: string): HTMLElement {
  const label = within(container).getByText(labelText);
  const input = label.parentElement?.querySelector("input");
  if (!input) throw new Error(`no input found next to label "${labelText}"`);
  return input;
}

const employees: EmployeeDTO[] = [
  {
    id: "emp-1", code: "EMP-0001", firstName: "Ahmed", lastName: "Mahmoud", firstNameAr: "أحمد", lastNameAr: "محمود",
    email: null, phone: null, birthDate: null, nationalId: null, gender: null, maritalStatus: null,
    departmentId: null, jobTitleId: null, managerId: null, branchId: "MAIN", hireDate: "2026-08-11",
    workerCategory: "staff", employmentType: "full_time", overtimeEligibility: "inherit_department",
    standardWorkHours: null, probationEndDate: null, priorServiceYears: 0, requireSelfieAtClockIn: false,
    requireBiometricAtClockIn: false, hasPensionEntitlement: null, taxDisabilityExemption: false, address: null, emergencyContact: null, status: "active", terminatedAt: null,
    createdAt: "2026-08-11T00:00:00.000Z",
  },
  {
    id: "emp-2", code: "EMP-0002", firstName: "Sara", lastName: "Adel", firstNameAr: "سارة", lastNameAr: "عادل",
    email: null, phone: null, birthDate: null, nationalId: null, gender: null, maritalStatus: null,
    departmentId: null, jobTitleId: null, managerId: null, branchId: "MAIN", hireDate: "2026-08-11",
    workerCategory: "staff", employmentType: "full_time", overtimeEligibility: "inherit_department",
    standardWorkHours: null, probationEndDate: null, priorServiceYears: 0, requireSelfieAtClockIn: false,
    requireBiometricAtClockIn: false, hasPensionEntitlement: null, taxDisabilityExemption: false, address: null, emergencyContact: null, status: "active", terminatedAt: null,
    createdAt: "2026-08-11T00:00:00.000Z",
  },
];

const CURRENT_YEAR = new Date().getUTCFullYear();

function balance(overrides: Partial<LeaveBalanceDTO> = {}): LeaveBalanceDTO {
  return {
    id: "bal-1",
    employeeId: "emp-1",
    leaveType: "annual",
    year: CURRENT_YEAR,
    entitled: "21.000000",
    carriedOver: "3.000000",
    used: "5.000000",
    available: "19.000000",
    createdAt: "2026-08-11T00:00:00.000Z",
    updatedAt: "2026-08-11T00:00:00.000Z",
    ...overrides,
  };
}

function renderScreen(balances: LeaveBalanceDTO[] = [balance()]) {
  let current = [...balances];
  let lastPath = "";
  let lastBody: unknown = null;
  const transport = stubTransport({
    "GET /hr/employees": () => ({ body: employees }),
    "GET /hr/leave-balances": (_init, path) => {
      lastPath = path;
      return { body: current };
    },
    "POST /hr/leave-balances": (init) => {
      const parsed = JSON.parse((init?.body as string) ?? "{}") as LeaveBalanceDTO;
      lastBody = parsed;
      const next: LeaveBalanceDTO = {
        id: "bal-new",
        employeeId: parsed.employeeId,
        leaveType: parsed.leaveType,
        year: parsed.year,
        entitled: parsed.entitled ?? "0",
        carriedOver: parsed.carriedOver ?? "0",
        used: parsed.used ?? "0",
        available: "0",
        createdAt: "2026-08-20T00:00:00.000Z",
        updatedAt: "2026-08-20T00:00:00.000Z",
      };
      current = [...current, next];
      return { body: next };
    },
  });
  const result = renderWithProviders(<LeaveBalancesScreen />, { transport, initialSession: testAdminSession });
  return { ...result, getPath: () => lastPath, getBody: () => lastBody };
}

describe("LeaveBalancesScreen", () => {
  it("lists balances and sends the year filter on the request", async () => {
    const { getPath } = renderScreen();
    expect(screen.getByRole("heading", { name: /أرصدة الإجازات/ })).toBeInTheDocument();
    await screen.findByText("أحمد محمود");
    expect(getPath()).toContain(`year=${CURRENT_YEAR}`);
  });

  it("renders days formatted (trimmed decimal), not the raw six-decimal wire string", async () => {
    renderScreen([balance({ entitled: "21.000000", available: "19.500000" })]);
    await screen.findByText("21");
    expect(screen.getByText("19.5")).toBeInTheDocument();
    expect(screen.queryByText("21.000000")).not.toBeInTheDocument();
  });

  it("shows the empty state honestly when there are zero balances", async () => {
    renderScreen([]);
    expect(await screen.findByText("لا توجد أرصدة إجازات — شغّل دورة استحقاق لإنشائها")).toBeInTheDocument();
  });

  it("shows an Arabic error banner with a working retry on load failure", async () => {
    let calls = 0;
    const transport = stubTransport({
      "GET /hr/employees": () => ({ body: employees }),
      "GET /hr/leave-balances": () => {
        calls += 1;
        return calls === 1 ? { status: 500, body: { error: "SERVER_ERROR" } } : { body: [balance()] };
      },
    });
    renderWithProviders(<LeaveBalancesScreen />, { transport, initialSession: testAdminSession });
    expect(await screen.findByText("تعذّر تحميل أرصدة الإجازات. (رمز 500)")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "إعادة المحاولة" }));
    await screen.findByText("أحمد محمود");
    await waitFor(() => expect(screen.queryByText("تعذّر تحميل أرصدة الإجازات. (رمز 500)")).not.toBeInTheDocument());
  });

  it("changing the year chip re-requests with the new year", async () => {
    const { getPath } = renderScreen();
    await screen.findByText("أحمد محمود");
    fireEvent.click(screen.getByText(String(CURRENT_YEAR - 1)));
    await waitFor(() => expect(getPath()).toContain(`year=${CURRENT_YEAR - 1}`));
  });

  it("changing the employee filter re-requests scoped to that employee's real id", async () => {
    const user = userEvent.setup();
    const { getPath } = renderScreen();
    await screen.findByText("أحمد محمود");
    await user.click(screen.getByLabelText("الموظف"));
    await user.click(await screen.findByRole("option", { name: "سارة عادل" }));
    await waitFor(() => expect(getPath()).toContain("employeeId=emp-2"));
  });

  it("adjust-balance form posts the real employee id and leave type, trimmed day counts", async () => {
    const user = userEvent.setup();
    const { getBody } = renderScreen();
    await screen.findByText("أحمد محمود");
    fireEvent.click(screen.getByRole("button", { name: "تسوية رصيد" }));
    const dialog = screen.getByRole("dialog");
    await user.click(within(dialog).getByLabelText("الموظف *"));
    await user.click(await screen.findByRole("option", { name: "سارة عادل" }));
    const entitledInput = fieldInput(dialog, "المستحق");
    fireEvent.change(entitledInput, { target: { value: " 15 " } });
    fireEvent.click(within(dialog).getByRole("button", { name: "حفظ" }));
    await waitFor(() => expect(getBody()).not.toBeNull());
    const body = getBody() as Record<string, unknown>;
    expect(body.employeeId).toBe("emp-2");
    expect(body.entitled).toBe("15");
    expect(body.year).toBe(CURRENT_YEAR);
  });

  it("a server refusal on save renders the server's Arabic message, not raw JSON", async () => {
    const transport = stubTransport({
      "GET /hr/employees": () => ({ body: employees }),
      "GET /hr/leave-balances": () => ({ body: [balance()] }),
      "POST /hr/leave-balances": () => ({ status: 400, body: { message: "لا يمكن أن يكون الرصيد المستخدم أكبر من المستحق" } }),
    });
    renderWithProviders(<LeaveBalancesScreen />, { transport, initialSession: testAdminSession });
    await screen.findByText("أحمد محمود");
    fireEvent.click(screen.getByRole("button", { name: "تسوية رصيد" }));
    const dialog = screen.getByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "حفظ" }));
    expect(await screen.findByText("لا يمكن أن يكون الرصيد المستخدم أكبر من المستحق")).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByText(/"message"/)).not.toBeInTheDocument());
  });
});
