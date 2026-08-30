// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, expect, it } from "vitest";
import { screen, fireEvent, within } from "@testing-library/react";
import type { DepartmentDTO, EmployeeDTO } from "@mezan/contracts";
import { DepartmentsScreen } from "./DepartmentsScreen";
import { renderWithProviders, stubTransport, testAdminSession } from "../data/test-support";

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

function renderScreen(departments: DepartmentDTO[] = sampleDepartments, employees: EmployeeDTO[] = []) {
  let current = [...departments];
  const transport = stubTransport({
    "GET /hr/departments": () => ({ body: current }),
    "GET /hr/employees": () => ({ body: employees }),
    "POST /hr/departments": (init) => {
      const body = JSON.parse((init?.body as string) ?? "{}");
      const created: DepartmentDTO = {
        id: "dept-new",
        code: body.code,
        name: body.name,
        nameAr: body.nameAr ?? null,
        parentDepartmentId: null,
        managerId: null,
        overtimeEligible: body.overtimeEligible ?? true,
        standardWorkHours: body.standardWorkHours ?? null,
        active: true,
        createdAt: "2026-08-21T00:00:00.000Z",
      };
      current = [...current, created];
      return { status: 201, body: created };
    },
    "PUT /hr/departments/dept-1": (init) => {
      const body = JSON.parse((init?.body as string) ?? "{}");
      const updated: DepartmentDTO = { ...current[0]!, ...body };
      current = [updated];
      return { body: updated };
    },
  });
  return renderWithProviders(<DepartmentsScreen />, { transport, initialSession: testAdminSession });
}

describe("DepartmentsScreen", () => {
  it("lists departments from the real backend", async () => {
    renderScreen();
    expect(screen.getByRole("heading", { name: "الأقسام" })).toBeInTheDocument();
    expect(await screen.findByText("المبيعات")).toBeInTheDocument();
  });

  it("adds a new department through the side panel", async () => {
    renderScreen();
    await screen.findByText("المبيعات");
    fireEvent.click(screen.getByRole("button", { name: "إضافة قسم" }));

    const dialog = screen.getByRole("dialog", { name: "إضافة قسم" });
    fireEvent.change(textFieldInput(dialog, "كود القسم *"), { target: { value: "HR" } });
    fireEvent.change(textFieldInput(dialog, "اسم القسم *"), { target: { value: "Human Resources" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "إضافة" }));

    expect(await screen.findByText("Human Resources")).toBeInTheDocument();
  });

  it("edits a department's active flag through the row panel", async () => {
    renderScreen();
    const row = (await screen.findByText("المبيعات")).closest("tr")!;
    fireEvent.click(row);
    const dialog = screen.getByRole("dialog", { name: "تعديل القسم" });
    fireEvent.click(within(dialog).getByRole("switch", { name: "نشط" }));
    fireEvent.click(within(dialog).getByRole("button", { name: "حفظ التعديلات" }));

    // The tab strip's inactive-status chip also reads "غير نشط", so this must
    // check the row's own status pill, not just any matching text on screen.
    expect(await within(row).findByText("غير نشط")).toBeInTheDocument();
  });

  it("shows an error banner with a retry action when departments fail to load", async () => {
    const transport = stubTransport({
      "GET /hr/departments": () => ({ status: 500, body: { error: "INTERNAL" } }),
      "GET /hr/employees": () => ({ body: [] }),
    });
    renderWithProviders(<DepartmentsScreen />, { transport, initialSession: testAdminSession });
    expect(await screen.findByText("تعذّر تحميل الأقسام.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "إعادة المحاولة" })).toBeInTheDocument();
  });
});
