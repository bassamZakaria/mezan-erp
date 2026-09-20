// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, expect, it } from "vitest";
import { screen, fireEvent, within } from "@testing-library/react";
import type { LeaveRequestDTO } from "@mezan/contracts";
import { MyLeaveScreen } from "./MyLeaveScreen";
import { renderWithProviders, stubTransport, testAdminSession } from "../data/test-support";
import type { MyLeaveDTO } from "../data/hooks";

function renderScreen(initial: MyLeaveDTO) {
  let current = { ...initial, requests: [...initial.requests] };
  const transport = stubTransport({
    "GET /hr/leave-requests/me": () => ({ body: current }),
    // Self-service writes go to `/hr/self/*` (gated on `hr.self.leave`), not
    // to the manager-side `/hr/leave-requests` — an employee filing their own
    // leave must not need the HR creation permission.
    "POST /hr/self/leave-requests": (init) => {
      const body = JSON.parse((init?.body as string) ?? "{}");
      const created: LeaveRequestDTO = {
        id: "lr-new",
        number: "LR-000002",
        employeeId: current.employeeId ?? "emp-1",
        leaveType: body.leaveType,
        halfDay: body.halfDay ?? false,
        startDate: body.startDate,
        endDate: body.endDate,
        days: 1,
        reason: body.reason ?? null,
        status: "pending",
        createdAt: "2026-08-21T00:00:00.000Z",
        decidedAt: null,
        decidedBy: null,
      };
      current = { ...current, requests: [...current.requests, created] };
      return { status: 201, body: created };
    },
    "POST /hr/self/leave-requests/lr-1/cancel": () => {
      const updated: LeaveRequestDTO = { ...current.requests[0]!, status: "cancelled" };
      current = { ...current, requests: [updated, ...current.requests.slice(1)] };
      return { body: updated };
    },
  });
  return renderWithProviders(<MyLeaveScreen />, { transport, initialSession: testAdminSession });
}

describe("MyLeaveScreen", () => {
  it("shows the not-linked gate when the account has no employee record", async () => {
    renderScreen({ employeeId: null, requests: [] });
    expect(await screen.findByText("غير مرتبط بموظف")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "طلب إجازة" })).not.toBeInTheDocument();
  });

  it("shows the empty state for a linked employee with no requests yet", async () => {
    renderScreen({ employeeId: "emp-1", requests: [] });
    expect(await screen.findByText("لا توجد طلبات إجازة — لم تقدم أي طلب إجازة بعد")).toBeInTheDocument();
  });

  it("submits a new leave request", async () => {
    renderScreen({ employeeId: "emp-1", requests: [] });
    await screen.findByText("لا توجد طلبات إجازة — لم تقدم أي طلب إجازة بعد");
    fireEvent.click(screen.getByRole("button", { name: "طلب إجازة" }));

    const dialog = screen.getByRole("dialog", { name: "طلب إجازة" });
    expect(within(dialog).getByText("تاريخ البداية *")).toBeInTheDocument();
    expect(within(dialog).getByText("تاريخ النهاية *")).toBeInTheDocument();
    // Neither date label is programmatically linked to its input (see final report), so target
    // by position — start date then end date are the first two textboxes in the form.
    const [startInput, endInput] = within(dialog).getAllByRole("textbox");
    fireEvent.change(startInput!, { target: { value: "2026-08-25" } });
    fireEvent.change(endInput!, { target: { value: "2026-08-25" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "إرسال الطلب" }));

    expect(await screen.findByText("إجازة سنوية")).toBeInTheDocument();
  });

  it("cancels a pending leave request", async () => {
    const existing: LeaveRequestDTO = {
      id: "lr-1",
      number: "LR-000001",
      employeeId: "emp-1",
      leaveType: "annual",
      halfDay: false,
      startDate: "2026-08-10",
      endDate: "2026-08-12",
      days: 3,
      reason: null,
      status: "pending",
      createdAt: "2026-08-01T00:00:00.000Z",
      decidedAt: null,
      decidedBy: null,
    };
    renderScreen({ employeeId: "emp-1", requests: [existing] });
    await screen.findByRole("button", { name: "إلغاء طلب الإجازة LR-000001" });
    fireEvent.click(screen.getByRole("button", { name: "إلغاء طلب الإجازة LR-000001" }));

    expect(await screen.findByText("ملغى")).toBeInTheDocument();
  });
});
