// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, expect, it } from "vitest";
import { screen, fireEvent, within } from "@testing-library/react";
import type { EmployeeRefDTO, LeaveApplicationDTO } from "@mezan/contracts";
import { LeaveRequestsScreen } from "./LeaveRequestsScreen";
import { renderWithProviders, stubTransport, testAdminSession } from "../data/test-support";

const sampleEmployees: EmployeeRefDTO[] = [{ id: "emp-1", code: "EMP-0001", nameAr: "أحمد محمود", departmentId: null, active: true }];

const sampleRequests: LeaveApplicationDTO[] = [
  {
    id: "req-1",
    requestNo: "LR-000001",
    employeeId: "emp-1",
    leaveTypeCode: "ANNUAL",
    startDate: "2026-08-16",
    endDate: "2026-08-17",
    halfDay: false,
    days: 2,
    reason: null,
    status: "PENDING",
    gateActionType: "HR_LEAVE_APPROVE_ANNUAL",
    workflowRequestId: "req-1",
    steps: [{ role: "hr_manager" }],
    currentStepIndex: 0,
    decisions: [],
    submittedBy: "user-1",
    createdAt: "2026-08-15T00:00:00.000Z",
    decidedAt: null,
  },
];

function renderScreen(requests: LeaveApplicationDTO[] = sampleRequests) {
  let current = [...requests];
  const transport = stubTransport({
    "GET /hr/leave-applications": () => ({ body: current }),
    "GET /hr/employees-ref": () => ({ body: sampleEmployees }),
    "POST /hr/leave-applications": (init) => {
      const body = JSON.parse((init?.body as string) ?? "{}");
      const created: LeaveApplicationDTO = {
        id: "req-2",
        requestNo: "LR-000002",
        employeeId: body.employeeId,
        leaveTypeCode: body.leaveTypeCode,
        startDate: body.startDate,
        endDate: body.endDate,
        halfDay: body.halfDay ?? false,
        days: 1,
        reason: body.reason ?? null,
        status: "APPROVED",
        gateActionType: "HR_LEAVE_APPROVE_SICK",
        workflowRequestId: "req-2",
        steps: [],
        currentStepIndex: 0,
        decisions: [],
        submittedBy: "user-1",
        createdAt: "2026-08-15T00:00:00.000Z",
        decidedAt: "2026-08-15T00:00:00.000Z",
      };
      current = [...current, created];
      return { status: 201, body: created };
    },
    "POST /hr/leave-applications/req-1/decide": (init) => {
      const body = JSON.parse((init?.body as string) ?? "{}");
      const decided: LeaveApplicationDTO = { ...current[0]!, status: body.decision === "approve" ? "APPROVED" : "REJECTED", decidedAt: "now" };
      current = [decided, ...current.slice(1)];
      return { body: decided };
    },
    "POST /hr/leave-applications/req-1/cancel": () => {
      const cancelled: LeaveApplicationDTO = { ...current[0]!, status: "CANCELLED", decidedAt: "now" };
      current = [cancelled, ...current.slice(1)];
      return { body: cancelled };
    },
  });
  return renderWithProviders(<LeaveRequestsScreen />, { transport, initialSession: testAdminSession });
}

describe("LeaveRequestsScreen", () => {
  it("lists leave requests from the real backend, resolving the employee name", async () => {
    renderScreen();
    expect(screen.getByRole("heading", { name: "طلبات الإجازات" })).toBeInTheDocument();
    expect(await screen.findByText("LR-000001")).toBeInTheDocument();
    expect(screen.getByText("أحمد محمود")).toBeInTheDocument();
    expect(screen.getAllByText("إجازة سنوية").length).toBeGreaterThan(0);
  });

  it("submits a new leave request through the side panel", async () => {
    renderScreen();
    await screen.findByText("LR-000001");
    fireEvent.click(screen.getByRole("button", { name: "طلب إجازة جديد" }));

    const dialog = screen.getByRole("dialog", { name: "طلب إجازة جديد" });
    fireEvent.change(within(dialog).getByLabelText("اسم الموظف *"), { target: { value: "emp-1" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "إرسال الطلب" }));

    expect(await screen.findByText("LR-000002")).toBeInTheDocument();
  });

  it("approves a pending request via its row action", async () => {
    renderScreen();
    await screen.findByText("LR-000001");
    fireEvent.click(screen.getByRole("button", { name: "موافقة" }));

    expect(await screen.findByText("موافق عليه")).toBeInTheDocument();
  });

  it("rejects a pending request via its row action", async () => {
    renderScreen();
    await screen.findByText("LR-000001");
    fireEvent.click(screen.getByRole("button", { name: "رفض" }));

    expect(await screen.findByText("مرفوض")).toBeInTheDocument();
  });

  it("cancels a pending request via its row action", async () => {
    renderScreen();
    await screen.findByText("LR-000001");
    fireEvent.click(screen.getByRole("button", { name: "إلغاء" }));

    expect(await screen.findByText("ملغى")).toBeInTheDocument();
  });

  it("filters by status via the chip row", async () => {
    renderScreen();
    await screen.findByText("LR-000001");
    fireEvent.click(screen.getByRole("tab", { name: /^مرفوض/ }));
    expect(screen.queryByText("LR-000001")).not.toBeInTheDocument();
  });
});
