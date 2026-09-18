// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { screen, fireEvent, within, waitFor } from "@testing-library/react";
import type { AttendanceEntryDTO, AttendanceSummaryDTO, BranchDTO, EmployeeDTO } from "@mezan/contracts";
import { AttendanceScreen } from "./AttendanceScreen";
import { renderWithProviders, stubTransport, testAdminSession } from "../data/test-support";

/**
 * `Select`'s trigger is a `role="combobox"` button carrying `aria-label`, so
 * `getByRole("combobox", { name })` finds it; the popup options render with
 * `role="option"` on a portal, selected on `mouseDown` (the same shape the
 * EntityPicker combobox uses, minus free text).
 */
function pickFromSelect(label: string, optionLabel: string) {
  fireEvent.click(screen.getByRole("combobox", { name: label }));
  fireEvent.mouseDown(screen.getByRole("option", { name: optionLabel }));
}

function fieldInput(container: HTMLElement, labelText: string): HTMLInputElement {
  const label = within(container).getByText(labelText, { selector: "label" });
  const input = label.parentElement?.querySelector<HTMLInputElement>("input, textarea");
  if (!input) throw new Error(`No input control found next to label "${labelText}"`);
  return input;
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

function attendanceEntry(overrides: Partial<AttendanceEntryDTO> = {}): AttendanceEntryDTO {
  return {
    id: "att-1",
    employeeId: "emp-1",
    date: "2026-08-05",
    checkIn: "09:05",
    checkOut: "17:10",
    workedMinutes: 485,
    status: "late",
    notes: null,
    createdAt: "2026-08-05T09:05:00.000Z",
    updatedAt: "2026-08-05T17:10:00.000Z",
    ...overrides,
  };
}

const entries: AttendanceEntryDTO[] = [
  attendanceEntry(),
  attendanceEntry({ id: "att-2", employeeId: "emp-2", date: "2026-08-06", checkIn: "09:00", checkOut: "17:00", workedMinutes: 480, status: "present" }),
];

function attendanceSummary(overrides: Partial<AttendanceSummaryDTO> = {}): AttendanceSummaryDTO {
  return {
    employeeId: "emp-1",
    from: "2026-08-01",
    to: "2026-08-31",
    workingDays: 20,
    daysPresent: 18,
    daysLate: 2,
    daysAbsent: 0,
    halfDays: 0,
    daysOnLeave: 0,
    holidays: 1,
    weeklyOffDays: 8,
    workedMinutes: 9600,
    attendanceRatePercent: 100,
    ...overrides,
  };
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(Date.UTC(2026, 7, 15, 12, 0, 0)));
});

afterEach(() => {
  vi.useRealTimers();
});

function renderScreen(options: { rows?: AttendanceEntryDTO[]; extra?: Record<string, (init: RequestInit | undefined, path: string) => { status?: number; body: unknown }> } = {}) {
  const rows = options.rows ?? entries;
  const calls: string[] = [];
  const transport = stubTransport({
    "GET /hr/attendance": (_init, path) => {
      calls.push(path);
      return { body: rows };
    },
    "GET /hr/attendance/summary": () => ({ body: attendanceSummary() }),
    "GET /hr/employees": () => ({ body: employees }),
    ...options.extra,
  });
  const view = renderWithProviders(<AttendanceScreen />, { transport, initialSession: testAdminSession });
  return { ...view, calls };
}

describe("AttendanceScreen", () => {
  it("lists attendance rows and scopes the request to the current calendar month", async () => {
    const { calls } = renderScreen();
    expect(screen.getByRole("heading", { name: "الحضور والانصراف" })).toBeInTheDocument();
    expect(await screen.findByText("أحمد حسن")).toBeInTheDocument();
    expect(screen.getByText("منى سالم")).toBeInTheDocument();
    expect(screen.getByText("8:05")).toBeInTheDocument();
    expect(screen.getByText("8:00")).toBeInTheDocument();
    expect(calls).toEqual(["/hr/attendance?from=2026-08-01&to=2026-08-31"]);
  });

  it("re-fetches with the employeeId filter when an employee is chosen, and loads that employee's summary", async () => {
    const { calls } = renderScreen();
    await screen.findByText("أحمد حسن");
    pickFromSelect("الموظف", "منى سالم");
    await screen.findByText("الملخص الشهري للحضور");
    expect(calls.at(-1)).toBe("/hr/attendance?employeeId=emp-2&from=2026-08-01&to=2026-08-31");
  });

  it("re-fetches with the status filter when a status is chosen", async () => {
    const { calls } = renderScreen();
    await screen.findByText("أحمد حسن");
    pickFromSelect("الحالة", "تأخير");
    expect(calls.at(-1)).toBe("/hr/attendance?from=2026-08-01&to=2026-08-31&status=late");
  });

  it("re-fetches with a new month range when the month field changes", async () => {
    const { calls } = renderScreen();
    await screen.findByText("أحمد حسن");
    const monthInput = fieldInput(document.body, "الشهر");
    fireEvent.change(monthInput, { target: { value: "2026-02" } });
    expect(calls.at(-1)).toBe("/hr/attendance?from=2026-02-01&to=2026-02-28");
  });

  it("renders an honest empty state, not a stuck spinner or a fabricated row", async () => {
    renderScreen({ rows: [] });
    expect(await screen.findByText("لا توجد سجلات حضور لهذه الفترة")).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByText("أحمد حسن")).not.toBeInTheDocument());
  });

  it("renders an Arabic failure message on a load error, and the retry button re-fetches", async () => {
    let attempt = 0;
    renderScreen({
      extra: {
        "GET /hr/attendance": () => {
          attempt += 1;
          return attempt === 1 ? { status: 500, body: { error: "INTERNAL" } } : { body: entries };
        },
      },
    });
    expect(await screen.findByText("تعذّر تحميل سجل الحضور. (رمز 500)")).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByText("INTERNAL")).not.toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "إعادة المحاولة" }));
    expect(await screen.findByText("أحمد حسن")).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByText("تعذّر تحميل سجل الحضور. (رمز 500)")).not.toBeInTheDocument());
  });

  it("records a new attendance entry with the real employee id from the picker, not typed text", async () => {
    let posted: unknown = null;
    renderScreen({
      extra: {
        "POST /hr/attendance": (init) => {
          posted = JSON.parse((init?.body as string) ?? "{}");
          return { body: attendanceEntry({ id: "att-new" }) };
        },
      },
    });
    await screen.findByText("أحمد حسن");
    fireEvent.click(screen.getByRole("button", { name: "تسجيل حضور" }));
    pickFromSelect("الموظف *", "منى سالم");
    const dateInput = fieldInput(document.body, "التاريخ *");
    fireEvent.change(dateInput, { target: { value: "2026-08-20" } });
    const checkInInput = fieldInput(document.body, "وقت الحضور");
    fireEvent.change(checkInInput, { target: { value: "09:00" } });
    fireEvent.click(screen.getByRole("button", { name: "تسجيل" }));

    await waitFor(() => expect(screen.queryByRole("button", { name: "تسجيل" })).not.toBeInTheDocument());
    expect(posted).toEqual({
      employeeId: "emp-2",
      date: "2026-08-20",
      checkIn: "09:00",
      checkOut: null,
      halfDay: false,
      expectedCheckIn: null,
      status: null,
      notes: null,
    });
  });

  it("renders the Arabic refusal message when recording attendance is rejected, not a raw enum", async () => {
    renderScreen({
      extra: {
        "POST /hr/attendance": () => ({
          status: 409,
          body: { error: "DUPLICATE_ATTENDANCE", message: "هذا الموظف لديه سجل حضور بالفعل لهذا اليوم." },
        }),
      },
    });
    await screen.findByText("أحمد حسن");
    fireEvent.click(screen.getByRole("button", { name: "تسجيل حضور" }));
    fireEvent.click(screen.getByRole("button", { name: "تسجيل" }));
    expect(await screen.findByText("هذا الموظف لديه سجل حضور بالفعل لهذا اليوم.")).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByText("DUPLICATE_ATTENDANCE")).not.toBeInTheDocument());
  });

  it("corrects an existing entry via PUT, with the employee and date locked", async () => {
    let putBody: unknown = null;
    let putId = "";
    renderScreen({
      extra: {
        "PUT /hr/attendance/*": (init, path) => {
          putId = path;
          putBody = JSON.parse((init?.body as string) ?? "{}");
          return { body: attendanceEntry({ checkIn: "09:30" }) };
        },
      },
    });
    await screen.findByText("أحمد حسن");
    fireEvent.click(screen.getByRole("button", { name: "تعديل سجل 2026-08-05" }));
    expect(screen.getByRole("heading", { name: "تعديل سجل الحضور" })).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "الموظف *" })).toBeDisabled();
    const checkInInput = fieldInput(document.body, "وقت الحضور");
    fireEvent.change(checkInInput, { target: { value: "09:30" } });
    fireEvent.click(screen.getByRole("button", { name: "حفظ التعديلات" }));

    await waitFor(() => expect(screen.queryByRole("button", { name: "حفظ التعديلات" })).not.toBeInTheDocument());
    expect(putId).toBe("/hr/attendance/att-1");
    expect(putBody).toEqual({
      checkIn: "09:30",
      checkOut: "17:10",
      halfDay: false,
      expectedCheckIn: null,
      status: "late",
      notes: null,
    });
  });
});
