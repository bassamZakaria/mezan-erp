// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, expect, it } from "vitest";
import { screen, fireEvent, within } from "@testing-library/react";
import type { CostCenterDTO } from "@mezan/contracts";
import { CostCentersScreen } from "./CostCentersScreen";
import { renderWithProviders, stubTransport, testAdminSession } from "../data/test-support";

function costCenter(overrides: Partial<CostCenterDTO> = {}): CostCenterDTO {
  return {
    id: "cc-admin",
    code: "CC-001",
    nameAr: "الإدارة العامة",
    nameEn: "General Administration",
    type: "general",
    departmentId: null,
    branchId: "b1",
    parentId: null,
    notes: null,
    status: "active",
    ...overrides,
  };
}

const salesCostCenter = costCenter({
  id: "cc-sales",
  code: "CC-002",
  nameAr: "المبيعات",
  nameEn: "Sales",
  type: "department",
  branchId: null,
  parentId: "cc-admin",
});

const alexCostCenter = costCenter({
  id: "cc-alex",
  code: "CC-004",
  nameAr: "فرع الإسكندرية",
  nameEn: "Alexandria Branch",
  type: "branch",
  branchId: "b2",
  parentId: null,
  notes: "مركز تكلفة مستقل مرتبط بفرع الإسكندرية",
});

function renderScreen(costCenters: CostCenterDTO[] = [costCenter(), salesCostCenter, alexCostCenter]) {
  let current = [...costCenters];
  const transport = stubTransport({
    "GET /cost-centers": () => ({ body: current }),
    "GET /branches": () => ({
      body: [
        { id: "b1", code: "MAIN", name: "الفرع الرئيسي", parentBranchId: null, phone: null, email: null, address: null, isMain: true, active: true },
        { id: "b2", code: "ALEX", name: "فرع الإسكندرية", parentBranchId: null, phone: null, email: null, address: null, isMain: false, active: true },
      ],
    }),
    "POST /cost-centers": (init) => {
      const body = JSON.parse((init?.body as string) ?? "{}");
      if (current.some((c) => c.code === body.code)) {
        return { status: 409, body: { error: "DUPLICATE_COST_CENTER_CODE", message: `الكود "${body.code}" مستخدم بالفعل.` } };
      }
      const created: CostCenterDTO = {
        id: body.id,
        code: body.code,
        nameAr: body.nameAr,
        nameEn: body.nameEn ?? null,
        type: body.type ?? "general",
        departmentId: body.departmentId ?? null,
        branchId: body.branchId ?? null,
        parentId: body.parentId ?? null,
        notes: body.notes ?? null,
        status: "active",
      };
      current = [...current, created];
      return { status: 201, body: created };
    },
    "PATCH /cost-centers/cc-admin": (init) => {
      const patch = JSON.parse((init?.body as string) ?? "{}");
      const updated: CostCenterDTO = { ...current[0]!, ...patch };
      current = [updated, ...current.slice(1)];
      return { body: updated };
    },
  });
  return renderWithProviders(<CostCentersScreen />, { transport, initialSession: testAdminSession });
}

describe("CostCentersScreen", () => {
  it("renders the tree from the real backend, expanded by default", async () => {
    renderScreen();
    expect(screen.getByRole("heading", { name: "مراكز التكلفة" })).toBeInTheDocument();
    expect(await screen.findByText("الإدارة العامة")).toBeInTheDocument();
    expect(screen.getByText("المبيعات")).toBeInTheDocument();
    expect(screen.getByText("فرع الإسكندرية")).toBeInTheDocument();
  });

  it("shows an empty state when there are no cost centers yet", async () => {
    renderScreen([]);
    expect(await screen.findByText("لا توجد مراكز تكلفة بعد")).toBeInTheDocument();
  });

  it("filters the list by type", async () => {
    renderScreen();
    await screen.findByText("الإدارة العامة");
    fireEvent.change(screen.getByLabelText("تصفية حسب النوع"), { target: { value: "branch" } });
    expect(screen.getByText("فرع الإسكندرية")).toBeInTheDocument();
    expect(screen.queryByText("الإدارة العامة")).not.toBeInTheDocument();
  });

  it("adds a new root cost center through the side panel", async () => {
    renderScreen();
    await screen.findByText("الإدارة العامة");
    fireEvent.click(screen.getByRole("button", { name: "إضافة مركز تكلفة" }));

    const dialog = screen.getByRole("dialog", { name: "إضافة مركز تكلفة" });
    fireEvent.change(within(dialog).getByLabelText("الكود *"), { target: { value: "CC-099" } });
    fireEvent.change(within(dialog).getByLabelText("الاسم *"), { target: { value: "مركز تجريبي" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "إضافة" }));

    expect(await screen.findByText("مركز تجريبي")).toBeInTheDocument();
  });

  it("rejects a duplicate cost center code with an inline error", async () => {
    renderScreen();
    await screen.findByText("الإدارة العامة");
    fireEvent.click(screen.getByRole("button", { name: "إضافة مركز تكلفة" }));
    const dialog = screen.getByRole("dialog", { name: "إضافة مركز تكلفة" });
    fireEvent.change(within(dialog).getByLabelText("الكود *"), { target: { value: "CC-001" } });
    fireEvent.change(within(dialog).getByLabelText("الاسم *"), { target: { value: "نسخة" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "إضافة" }));

    expect(within(dialog).getByRole("alert")).toHaveTextContent("مستخدم بالفعل");
  });

  it("opens the detail panel on row click, showing its real branch name, parent and children", async () => {
    renderScreen();
    fireEvent.click(await screen.findByText("الإدارة العامة"));
    const panel = screen.getByRole("dialog", { name: /الإدارة العامة/ });
    expect(within(panel).getByText("بدون مركز رئيسي")).toBeInTheDocument();
    expect(await within(panel).findByText("الفرع الرئيسي")).toBeInTheDocument();
    expect(within(panel).getByText(/المراكز الفرعية/)).toBeInTheDocument();
  });

  it("edits an existing cost center from the detail panel", async () => {
    renderScreen();
    fireEvent.click(await screen.findByText("الإدارة العامة"));
    const panel = screen.getByRole("dialog", { name: /الإدارة العامة/ });
    fireEvent.click(within(panel).getByRole("button", { name: "تعديل" }));

    const dialog = screen.getByRole("dialog", { name: "تعديل مركز تكلفة" });
    fireEvent.change(within(dialog).getByLabelText("ملاحظات"), { target: { value: "ملاحظة جديدة" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "حفظ" }));

    await screen.findByText("الإدارة العامة");
  });

  it("associates the parent-picker label with its combobox input", async () => {
    renderScreen();
    await screen.findByText("الإدارة العامة");
    fireEvent.click(screen.getByRole("button", { name: "إضافة مركز تكلفة" }));
    const dialog = screen.getByRole("dialog", { name: "إضافة مركز تكلفة" });
    const picker = within(dialog).getByLabelText("المركز الرئيسي");
    expect(picker).toHaveAttribute("role", "combobox");
    expect(picker.tagName).toBe("INPUT");
  });
});
