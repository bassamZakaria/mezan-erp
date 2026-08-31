// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, expect, it } from "vitest";
import { screen, fireEvent, within, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { EmployeeDTO, LeaveRequestDTO } from "@mezan/contracts";
import { LeaveRequestsScreen } from "./LeaveRequestsScreen";
import { renderWithProviders, stubTransport, testAdminSession } from "../data/test-support";

// jsdom has no layout engine and does not implement scrollIntoView; the
// dropdown menu (Select) calls it when the active option changes.
if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = () => {};
}

function fieldInput(container: HTMLElement, labelText: string): HTMLElement {
  const label = within(container).getByText(labelText);
  const input = label.parentElement?.querySelector("input");
  if (!input) throw new Error(`no input found next to label "${labelText}"`);
  return input;
}

function pickFromCombobox(container: HTMLElement, label: string, optionLabel: string) {
  const input = within(container).getByLabelText(label);
  fireEvent.focus(input);
  fireEvent.change(input, { target: { value: optionLabel } });
  const option = within(container).getByRole("button", { name: (accessibleName) => accessibleName.startsWith(optionLabel) });
  fireEvent.mouseDown(option);
}

/** A `tone: "danger"` `RowMenu` item (e.g. "رفض") auto-confirms via a `ConfirmDialog` with the same label. */
function openRowMenu(row: HTMLElement, itemLabel: string) {
  fireEvent.click(within(row).getByRole("button", { name: /^إجراءات/ }));
  fireEvent.click(within(row).getByRole("menuitem", { name: itemLabel }));
  const confirmDialog = screen.queryByRole("dialog");
  if (confirmDialog) fireEvent.click(within(confirmDialog).getByRole("button", { name: itemLabel }));
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

function request(overrides: Partial<LeaveRequestDTO> = {}): LeaveRequestDTO {
  return {
    id: "req-1",
    number: "LR-000001",
    employeeId: "emp-1",
    leaveType: "annual",
    halfDay: false,
    startDate: "2026-09-01",
    endDate: "2026-09-03",
    days: 3,
    reason: "سفر",
    status: "pending",
    createdAt: "2026-08-20T00:00:00.000Z",
    decidedAt: null,
    decidedBy: null,
    ...overrides,
  };
}

function renderScreen(requests: LeaveRequestDTO[] = [request()]) {
  let current = [...requests];
  let lastPath = "";
  let lastCreateBody: unknown = null;
  let lastDecideBody: unknown = null;
  const transport = stubTransport({
    "GET /hr/employees": () => ({ body: employees }),
    "GET /hr/leave-requests": (_init, path) => {
      lastPath = path;
      return { body: current };
    },
    "GET /hr/leave-requests/counts": () => ({
      body: {
        total: current.length,
        pending: current.filter((r) => r.status === "pending").length,
        approved: current.filter((r) => r.status === "approved").length,
        rejected: current.filter((r) => r.status === "rejected").length,
        cancelled: current.filter((r) => r.status === "cancelled").length,
      },
    }),
    "POST /hr/leave-requests": (init) => {
      lastCreateBody = JSON.parse((init?.body as string) ?? "{}");
      const body = lastCreateBody as Partial<LeaveRequestDTO>;
      const created = request({ id: "req-new", number: "LR-000002", ...body });
      current = [...current, created];
      return { body: created };
    },
    "POST /hr/leave-requests/*/approve": (init, path) => {
      lastDecideBody = init?.body ? JSON.parse(init.body as string) : null;
      const id = path.split("/")[3]!;
      current = current.map((r) => (r.id === id ? { ...r, status: "approved" } : r));
      return { body: { held: false, workflowRequestId: null, request: current.find((r) => r.id === id)! } };
    },
    "POST /hr/leave-requests/*/reject": (init, path) => {
      lastDecideBody = init?.body ? JSON.parse(init.body as string) : null;
      const id = path.split("/")[3]!;
      current = current.map((r) => (r.id === id ? { ...r, status: "rejected" } : r));
      return { body: { held: false, workflowRequestId: null, request: current.find((r) => r.id === id)! } };
    },
  });
  const result = renderWithProviders(<LeaveRequestsScreen />, { transport, initialSession: testAdminSession });
  return { ...result, getPath: () => lastPath, getCreateBody: () => lastCreateBody, getDecideBody: () => lastDecideBody };
}

describe("LeaveRequestsScreen", () => {
  it("lists requests", async () => {
    renderScreen();
    expect(screen.getByRole("heading", { name: "طلبات الإجازات" })).toBeInTheDocument();
    expect(await screen.findByText("LR-000001")).toBeInTheDocument();
    expect(screen.getByText("أحمد محمود")).toBeInTheDocument();
  });

  it("shows the empty state honestly when nothing matches", async () => {
    renderScreen([]);
    expect(await screen.findByText("لا توجد نتائج مطابقة للفلتر الحالي")).toBeInTheDocument();
  });

  it("shows an Arabic error banner with a working retry on load failure", async () => {
    let calls = 0;
    const transport = stubTransport({
      "GET /hr/employees": () => ({ body: employees }),
      "GET /hr/leave-requests": () => {
        calls += 1;
        return calls === 1 ? { status: 500, body: { error: "SERVER_ERROR" } } : { body: [request()] };
      },
      "GET /hr/leave-requests/counts": () => ({ body: { total: 1, pending: 1, approved: 0, rejected: 0, cancelled: 0 } }),
    });
    renderWithProviders(<LeaveRequestsScreen />, { transport, initialSession: testAdminSession });
    expect(await screen.findByText("تعذّر تحميل طلبات الإجازات.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "إعادة المحاولة" }));
    await screen.findByText("LR-000001");
    await waitFor(() => expect(screen.queryByText("تعذّر تحميل طلبات الإجازات.")).not.toBeInTheDocument());
  });

  it("status chip filter changes the outgoing request", async () => {
    // A zero-count chip is hidden by `ListViews` (`view.count !== 0 || ...`),
    // so the fixture needs a real approved row for the "موافق عليه" chip to render at all.
    const { getPath } = renderScreen([request(), request({ id: "req-2", number: "LR-000002", status: "approved" })]);
    await screen.findByText("LR-000001");
    fireEvent.click(screen.getByRole("tab", { name: /موافق عليه/ }));
    await waitFor(() => expect(getPath()).toContain("status=approved"));
  });

  it("employee, leave-type and date filters each change the outgoing request", async () => {
    const user = userEvent.setup();
    const { getPath } = renderScreen();
    await screen.findByText("LR-000001");

    // The list-filter `Select` trigger is a `<button role="combobox">` labeled
    // "الموظف"; the create-form's `EntityPicker` (always mounted, closed) is
    // an `<input role="combobox">` with the SAME label — filter by tag to
    // reach the real filter control.
    const employeeSelect = screen.getAllByRole("combobox", { name: "الموظف" }).find((el) => el.tagName === "BUTTON")!;
    await user.click(employeeSelect);
    await user.click(await screen.findByRole("option", { name: "أحمد محمود" }));
    await waitFor(() => expect(getPath()).toContain("employeeId=emp-1"));

    await user.click(screen.getByRole("combobox", { name: "نوع الإجازة" }));
    await user.click(await screen.findByRole("option", { name: "إجازة مرضية" }));
    await waitFor(() => expect(getPath()).toContain("leaveType=sick"));

    const from = fieldInput(document.body, "من تاريخ");
    fireEvent.change(from, { target: { value: "2026-09-01" } });
    await waitFor(() => expect(getPath()).toContain("from=2026-09-01"));

    const to = fieldInput(document.body, "إلى تاريخ");
    fireEvent.change(to, { target: { value: "2026-09-30" } });
    await waitFor(() => expect(getPath()).toContain("to=2026-09-30"));
  });

  it("creates a leave request with the real employee id (EntityPicker), leaveType and dates", async () => {
    const { getCreateBody } = renderScreen([]);
    await screen.findByText(/لا توجد نتائج/);
    fireEvent.click(screen.getAllByRole("button", { name: "طلب إجازة جديد" })[0]!);
    const dialog = screen.getByRole("dialog");

    pickFromCombobox(dialog, "الموظف", "أحمد محمود");
    const start = fieldInput(dialog, "تاريخ البداية");
    fireEvent.change(start, { target: { value: "2026-09-10" } });
    const end = fieldInput(dialog, "تاريخ النهاية");
    fireEvent.change(end, { target: { value: "2026-09-12" } });

    fireEvent.click(within(dialog).getByRole("button", { name: "حفظ الطلب" }));
    await waitFor(() => expect(getCreateBody()).not.toBeNull());
    const body = getCreateBody() as Record<string, unknown>;
    expect(body.employeeId).toBe("emp-1");
    expect(body.startDate).toBe("2026-09-10");
    expect(body.endDate).toBe("2026-09-12");
    expect(body.leaveType).toBe("annual");
  });

  it("half-day mode mirrors the end date onto the start date and disables the end-date field", async () => {
    const { getCreateBody } = renderScreen([]);
    await screen.findByText(/لا توجد نتائج/);
    fireEvent.click(screen.getAllByRole("button", { name: "طلب إجازة جديد" })[0]!);
    const dialog = screen.getByRole("dialog");

    pickFromCombobox(dialog, "الموظف", "أحمد محمود");
    fireEvent.click(within(dialog).getByRole("switch", { name: "نصف يوم" }));
    const start = fieldInput(dialog, "تاريخ البداية");
    fireEvent.change(start, { target: { value: "2026-09-10" } });
    expect(fieldInput(dialog, "تاريخ النهاية")).toBeDisabled();

    fireEvent.click(within(dialog).getByRole("button", { name: "حفظ الطلب" }));
    await waitFor(() => expect(getCreateBody()).not.toBeNull());
    const body = getCreateBody() as Record<string, unknown>;
    expect(body.halfDay).toBe(true);
    expect(body.endDate).toBe("2026-09-10");
  });

  it("blocks submit with an Arabic message when no employee is picked", async () => {
    renderScreen([]);
    await screen.findByText(/لا توجد نتائج/);
    fireEvent.click(screen.getAllByRole("button", { name: "طلب إجازة جديد" })[0]!);
    const dialog = screen.getByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "حفظ الطلب" }));
    expect(await within(dialog).findByText("اختر الموظف صاحب الطلب.")).toBeInTheDocument();
  });

  it("approves a pending request from the row menu, posting to the real endpoint", async () => {
    const { getDecideBody } = renderScreen();
    const row = (await screen.findByText("LR-000001")).closest("tr") as HTMLElement;
    openRowMenu(row, "موافقة");
    await waitFor(() => expect(getDecideBody()).toEqual({ decision: "approved", comment: null }));
    expect(await within(row).findByText("موافق عليه")).toBeInTheDocument();
  });

  it("rejects a pending request from the row menu", async () => {
    renderScreen();
    const row = (await screen.findByText("LR-000001")).closest("tr") as HTMLElement;
    openRowMenu(row, "رفض");
    expect(await within(row).findByText("مرفوض")).toBeInTheDocument();
  });

  it("shows the awaiting-approvals banner when the decision is held by a workflow", async () => {
    const transport = stubTransport({
      "GET /hr/employees": () => ({ body: employees }),
      "GET /hr/leave-requests": () => ({ body: [request()] }),
      "GET /hr/leave-requests/counts": () => ({ body: { total: 1, pending: 1, approved: 0, rejected: 0, cancelled: 0 } }),
      "POST /hr/leave-requests/*/approve": () => ({
        body: { held: true, workflowRequestId: "wf-1", requiredRole: "manager", request: request({ status: "pending" }) },
      }),
    });
    renderWithProviders(<LeaveRequestsScreen />, { transport, initialSession: testAdminSession });
    const row = (await screen.findByText("LR-000001")).closest("tr") as HTMLElement;
    openRowMenu(row, "موافقة");
    expect(await screen.findByText("الطلب LR-000001 بانتظار سلسلة الموافقات — الدور المطلوب: manager.")).toBeInTheDocument();
  });

  it("a server refusal on the decide action renders the Arabic error, not raw JSON", async () => {
    const transport = stubTransport({
      "GET /hr/employees": () => ({ body: employees }),
      "GET /hr/leave-requests": () => ({ body: [request()] }),
      "GET /hr/leave-requests/counts": () => ({ body: { total: 1, pending: 1, approved: 0, rejected: 0, cancelled: 0 } }),
      "POST /hr/leave-requests/*/approve": () => ({ status: 400, body: { message: "تم اتخاذ قرار بشأن هذا الطلب بالفعل." } }),
    });
    renderWithProviders(<LeaveRequestsScreen />, { transport, initialSession: testAdminSession });
    const row = (await screen.findByText("LR-000001")).closest("tr") as HTMLElement;
    openRowMenu(row, "موافقة");
    expect(await screen.findByRole("alert")).toHaveTextContent("تم اتخاذ قرار بشأن هذا الطلب بالفعل.");
  });

  it("a server refusal on create renders the server's Arabic message, not raw JSON", async () => {
    const transport = stubTransport({
      "GET /hr/employees": () => ({ body: employees }),
      "GET /hr/leave-requests": () => ({ body: [] }),
      "GET /hr/leave-requests/counts": () => ({ body: { total: 0, pending: 0, approved: 0, rejected: 0, cancelled: 0 } }),
      "POST /hr/leave-requests": () => ({ status: 400, body: { message: "لا يوجد رصيد كافٍ لهذا النوع من الإجازة" } }),
    });
    renderWithProviders(<LeaveRequestsScreen />, { transport, initialSession: testAdminSession });
    await screen.findByText(/لا توجد نتائج/);
    fireEvent.click(screen.getAllByRole("button", { name: "طلب إجازة جديد" })[0]!);
    const dialog = screen.getByRole("dialog");
    pickFromCombobox(dialog, "الموظف", "أحمد محمود");
    fireEvent.change(fieldInput(dialog, "تاريخ البداية"), { target: { value: "2026-09-10" } });
    fireEvent.change(fieldInput(dialog, "تاريخ النهاية"), { target: { value: "2026-09-12" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "حفظ الطلب" }));
    expect(await within(dialog).findByText("لا يوجد رصيد كافٍ لهذا النوع من الإجازة")).toBeInTheDocument();
  });
});
