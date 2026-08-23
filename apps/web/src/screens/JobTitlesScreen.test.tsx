// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, expect, it } from "vitest";
import { screen, fireEvent, within } from "@testing-library/react";
import type { DepartmentDTO, EmployeeDTO, JobTitleDTO } from "@mezan/contracts";
import { JobTitlesScreen } from "./JobTitlesScreen";
import { renderWithProviders, stubTransport, testAdminSession } from "../data/test-support";

function pickFromCombobox(dialog: HTMLElement, label: string, optionLabel: string) {
  const input = within(dialog).getByLabelText(label);
  fireEvent.focus(input);
  fireEvent.change(input, { target: { value: optionLabel } });
  const option = within(dialog).getByRole("button", { name: (accessibleName) => accessibleName.startsWith(optionLabel) });
  fireEvent.mouseDown(option);
}

const sampleDepartments: DepartmentDTO[] = [
  {
    id: "dept-1",
    code: "SALES",
    name: "Sales",
    nameAr: "المبيعات",
    parentDepartmentId: null,
    managerId: null,
    overtimeEligible: true,
    standardWorkHours: null,
    active: true,
    createdAt: "2026-08-01T00:00:00.000Z",
  },
];

const sampleJobTitles: JobTitleDTO[] = [
  { id: "jt-1", departmentId: "dept-1", name: "Sales Officer", nameAr: "مسؤول مبيعات", active: true, createdAt: "2026-08-01T00:00:00.000Z" },
];

function renderScreen(jobTitles: JobTitleDTO[] = sampleJobTitles, employees: EmployeeDTO[] = []) {
  let current = [...jobTitles];
  const transport = stubTransport({
    "GET /hr/job-titles": () => ({ body: current }),
    "GET /hr/departments": () => ({ body: sampleDepartments }),
    "GET /hr/employees": () => ({ body: employees }),
    "POST /hr/job-titles": (init) => {
      const body = JSON.parse((init?.body as string) ?? "{}");
      const created: JobTitleDTO = {
        id: "jt-new",
        departmentId: body.departmentId,
        name: body.name,
        nameAr: body.nameAr ?? null,
        active: true,
        createdAt: "2026-08-21T00:00:00.000Z",
      };
      current = [...current, created];
      return { status: 201, body: created };
    },
  });
  return renderWithProviders(<JobTitlesScreen />, { transport, initialSession: testAdminSession });
}

describe("JobTitlesScreen", () => {
  it("lists job titles with their department name", async () => {
    renderScreen();
    expect(screen.getByRole("heading", { name: "المسميات الوظيفية" })).toBeInTheDocument();
    expect(await screen.findByText("مسؤول مبيعات")).toBeInTheDocument();
    expect(screen.getByText("المبيعات")).toBeInTheDocument();
  });

  it("adds a new job title scoped to a department", async () => {
    renderScreen();
    await screen.findByText("مسؤول مبيعات");
    fireEvent.click(screen.getByRole("button", { name: "إضافة مسمى وظيفي" }));

    const dialog = screen.getByRole("dialog", { name: "إضافة مسمى وظيفي" });
    pickFromCombobox(dialog, "القسم *", "المبيعات");
    fireEvent.change(within(dialog).getByLabelText("اسم المسمى الوظيفي *"), { target: { value: "Accountant" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "إضافة" }));

    expect(await screen.findByText("Accountant")).toBeInTheDocument();
  });
});
