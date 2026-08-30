// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, expect, it } from "vitest";
import { screen, fireEvent, within } from "@testing-library/react";
import type { RoleDTO, WorkflowConfigDTO } from "@mezan/contracts";
import { WorkflowConfigPage } from "./WorkflowConfigPage";
import { renderWithProviders, stubTransport, testAdminSession } from "../data/test-support";

/** The Select combobox commits on mousedown, not change (Select.tsx) — open it, then commit the matching option. */
function chooseSelectOption(container: HTMLElement, triggerLabel: string, optionLabel: string) {
  fireEvent.click(within(container).getByRole("combobox", { name: triggerLabel }));
  fireEvent.mouseDown(screen.getByRole("option", { name: optionLabel }));
}

const sampleRoles: RoleDTO[] = [
  { id: "role-admin", code: "ADMIN", name: "مدير", description: "", permissions: ["*"], isSystem: true, createdAt: "2026-08-01T00:00:00.000Z" },
  {
    id: "role-super",
    code: "SUPERVISOR",
    name: "مشرف",
    description: "",
    permissions: [],
    isSystem: false,
    createdAt: "2026-08-01T00:00:00.000Z",
  },
  {
    id: "role-fin",
    code: "FINANCE_MANAGER",
    name: "مدير مالي",
    description: "",
    permissions: [],
    isSystem: false,
    createdAt: "2026-08-01T00:00:00.000Z",
  },
];

const sampleConfig: WorkflowConfigDTO = {
  id: "cfg-1",
  actionType: "SALES_INVOICE_CONFIRM",
  steps: [{ role: "SUPERVISOR", description: "مراجعة المشرف" }],
  createdAt: "2026-08-08T00:00:00.000Z",
  updatedAt: "2026-08-08T00:00:00.000Z",
};

function renderScreen(configs: WorkflowConfigDTO[] = [sampleConfig]) {
  let current = [...configs];
  const transport = stubTransport({
    "GET /workflow/configs": () => ({ body: current }),
    "GET /roles": () => ({ body: sampleRoles }),
    "POST /workflow/configs": (init) => {
      const body = JSON.parse((init?.body as string) ?? "{}");
      const created: WorkflowConfigDTO = {
        id: `cfg-${current.length + 1}`,
        actionType: body.actionType,
        steps: body.steps,
        createdAt: "2026-08-21T00:00:00.000Z",
        updatedAt: "2026-08-21T00:00:00.000Z",
      };
      current = [...current, created];
      return { status: 201, body: created };
    },
    "PUT /workflow/configs/cfg-1": (init) => {
      const body = JSON.parse((init?.body as string) ?? "{}");
      const updated: WorkflowConfigDTO = { ...sampleConfig, steps: body.steps, updatedAt: "2026-08-21T00:00:00.000Z" };
      current = current.map((c) => (c.id === "cfg-1" ? updated : c));
      return { status: 200, body: updated };
    },
    "DELETE /workflow/configs/cfg-1": () => {
      current = current.filter((c) => c.id !== "cfg-1");
      return { status: 204, body: null };
    },
  });
  return renderWithProviders(<WorkflowConfigPage />, { transport, initialSession: testAdminSession });
}

describe("WorkflowConfigPage", () => {
  it("lists a configured workflow with its Arabic action-type label and step count", async () => {
    renderScreen();
    expect(screen.getByRole("heading", { name: "إعدادات الموافقات" })).toBeInTheDocument();
    const table = await screen.findByRole("table");
    expect(await within(table).findByText("تأكيد فاتورة المبيعات")).toBeInTheDocument();
  });

  it("shows the empty state with no configs", async () => {
    renderScreen([]);
    expect(await screen.findByText("لا توجد إعدادات موافقات")).toBeInTheDocument();
  });

  it("adds a new workflow through the side panel, picking a custom role for the step", async () => {
    renderScreen([]);
    await screen.findByText("لا توجد إعدادات موافقات");
    fireEvent.click(screen.getByRole("button", { name: "إضافة سير عمل جديد" }));

    const dialog = screen.getByRole("dialog", { name: "إضافة سير عمل جديد" });
    chooseSelectOption(dialog, "نوع الإجراء", "تأكيد أمر الشراء");
    chooseSelectOption(dialog, "اختر الدور", "مدير مالي");
    fireEvent.click(within(dialog).getByRole("button", { name: "حفظ سير العمل" }));

    const table = await screen.findByRole("table");
    expect(await within(table).findByText("تأكيد أمر الشراء")).toBeInTheDocument();
  });

  it("only offers custom (non-system) roles in the step's role picker", async () => {
    renderScreen([]);
    await screen.findByText("لا توجد إعدادات موافقات");
    fireEvent.click(screen.getByRole("button", { name: "إضافة سير عمل جديد" }));
    const dialog = screen.getByRole("dialog", { name: "إضافة سير عمل جديد" });
    fireEvent.click(within(dialog).getByRole("combobox", { name: "اختر الدور" }));
    const optionLabels = screen.getAllByRole("option").map((o) => o.textContent);
    expect(optionLabels).toEqual(["مشرف", "مدير مالي"]);
    expect(optionLabels).not.toContain("مدير");
  });

  it("edits an existing workflow's steps", async () => {
    renderScreen();
    const table = await screen.findByRole("table");
    fireEvent.click(await within(table).findByText("تأكيد فاتورة المبيعات"));
    const dialog = screen.getByRole("dialog", { name: "تعديل سير عمل" });
    fireEvent.click(within(dialog).getByRole("button", { name: "إضافة خطوة" }));
    const roleSelects = within(dialog).getAllByLabelText("اختر الدور");
    fireEvent.change(roleSelects[1]!, { target: { value: "FINANCE_MANAGER" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "حفظ سير العمل" }));

    expect(await screen.findByText("2")).toBeInTheDocument();
  });

  it("deletes a workflow config", async () => {
    renderScreen();
    const table = await screen.findByRole("table");
    const row = (await within(table).findByText("تأكيد فاتورة المبيعات")).closest("tr") as HTMLElement;
    fireEvent.click(within(row).getByRole("button", { name: "حذف" }));
    await screen.findByText("لا توجد إعدادات موافقات");
  });
});
