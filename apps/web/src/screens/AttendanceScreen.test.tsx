// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, expect, it } from "vitest";
import { screen, fireEvent, within } from "@testing-library/react";
import type { AttendanceDayStatusDTO, EmployeeRefDTO, EmployeeMonthGridDTO, MonthlyAttendanceSummaryDTO } from "@mezan/contracts";
import { AttendanceScreen } from "./AttendanceScreen";
import { renderWithProviders, stubTransport, testAdminSession } from "../data/test-support";

const sampleEmployees: EmployeeRefDTO[] = [{ id: "emp-1", code: "EMP-0001", nameAr: "أحمد محمود", departmentId: null, active: true }];

function gridWithMark(year: number, month: number, date: string, status: AttendanceDayStatusDTO | null): EmployeeMonthGridDTO[] {
  const dayCount = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const days = Array.from({ length: dayCount }, (_, i) => {
    const d = `${year}-${String(month).padStart(2, "0")}-${String(i + 1).padStart(2, "0")}`;
    return { date: d, status: d === date ? status : null, overtimeHours: 0 };
  });
  return [{ employeeId: "emp-1", days }];
}

function renderScreen() {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth() + 1;
  let grid = gridWithMark(year, month, `${year}-${String(month).padStart(2, "0")}-05`, "ABSENT");

  const summary: MonthlyAttendanceSummaryDTO = {
    employeeId: "emp-1",
    year,
    month,
    workingDays: 22,
    presentDays: 0,
    absentDays: 1,
    halfDays: 0,
    onLeaveDays: 0,
    publicHolidayDays: 0,
    overtimeHours: 0,
    attendanceRate: 0,
  };

  const transport = stubTransport({
    "GET /hr/employees-ref": () => ({ body: sampleEmployees }),
    "GET /hr/attendance/grid": () => ({ body: grid }),
    "GET /hr/attendance/summary": () => ({ body: summary }),
    "POST /hr/attendance": (init) => {
      const body = JSON.parse((init?.body as string) ?? "{}");
      grid = grid.map((row) =>
        row.employeeId === body.employeeId
          ? { ...row, days: row.days.map((d) => (d.date === body.date ? { ...d, status: body.status, overtimeHours: body.overtimeHours ?? 0 } : d)) }
          : row,
      );
      return { status: 201, body: { id: "rec-1", ...body, overtimeHours: body.overtimeHours ?? 0, createdAt: "now", updatedAt: "now" } };
    },
  });
  return { ...renderWithProviders(<AttendanceScreen />, { transport, initialSession: testAdminSession }), year, month };
}

describe("AttendanceScreen", () => {
  it("renders the employee row and the monthly grid legend", async () => {
    renderScreen();
    expect(screen.getByRole("heading", { name: "الحضور والانصراف" })).toBeInTheDocument();
    expect(await screen.findByText(/أحمد محمود/)).toBeInTheDocument();
  });

  it("shows the marked day's status code in its cell", async () => {
    const { year, month } = renderScreen();
    await screen.findByText(/أحمد محمود/);
    const date = `${year}-${String(month).padStart(2, "0")}-05`;
    const cell = screen.getByRole("button", { name: `أحمد محمود — ${date}` });
    expect(cell).toHaveTextContent("A");
  });

  it("marks a day through the side panel and reflects it in the grid", async () => {
    const { year, month } = renderScreen();
    await screen.findByText(/أحمد محمود/);
    const date = `${year}-${String(month).padStart(2, "0")}-10`;
    fireEvent.click(screen.getByRole("button", { name: `أحمد محمود — ${date}` }));

    const dialog = screen.getByRole("dialog", { name: `تسجيل حضور — ${date}` });
    fireEvent.change(within(dialog).getByLabelText("الحالة *"), { target: { value: "PRESENT" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "حفظ" }));

    const cell = await screen.findByRole("button", { name: `أحمد محمود — ${date}` });
    expect(cell).toHaveTextContent("P");
  });

  it("opens the monthly summary panel for an employee", async () => {
    renderScreen();
    await screen.findByText(/أحمد محمود/);
    fireEvent.click(screen.getByRole("button", { name: "عرض الملخص الشهري" }));

    const dialog = await screen.findByRole("dialog", { name: /الملخص الشهري —/ });
    expect(await within(dialog).findByText("22")).toBeInTheDocument();
  });

  it("filters employees by the search box", async () => {
    renderScreen();
    await screen.findByText(/أحمد محمود/);
    fireEvent.change(screen.getByLabelText("بحث"), { target: { value: "غير موجود" } });
    expect(screen.queryByText(/أحمد محمود/)).not.toBeInTheDocument();
  });
});
